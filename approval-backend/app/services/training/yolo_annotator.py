"""
YOLO Annotation Generator

Converts AI extraction data (from Claude or local OCR) into YOLO object detection
annotation format. Each extraction field that has spatial meaning becomes a labelled
bounding box annotation.

YOLO format: class_id x_center y_center width height (all normalised 0-1)

Object classes for site plan detection:
  0: crossover         — the driveway/crossover area
  1: road_edge         — road boundary/kerb line
  2: property_boundary — lot boundary line
  3: building          — building/house footprint
  4: garage            — garage/carport
  5: fence             — fence line
  6: tree              — tree/vegetation
  7: dimension_line    — measurement annotation
  8: north_arrow       — north arrow symbol
  9: title_block       — title block/legend area
  10: utility          — power pole, water main, etc.
  11: drainage          — soakwell, pipe, pit
"""
import json
import re
from pathlib import Path
from typing import List, Dict, Optional
import logging

logger = logging.getLogger(__name__)

# YOLO class definitions
YOLO_CLASSES = {
    0: "crossover",
    1: "road_edge",
    2: "property_boundary",
    3: "building",
    4: "garage",
    5: "fence",
    6: "tree",
    7: "dimension_line",
    8: "north_arrow",
    9: "title_block",
    10: "utility",
    11: "drainage",
}

CLASS_NAMES = list(YOLO_CLASSES.values())


def generate_annotations_from_extraction(
    extraction: dict,
    image_width: int,
    image_height: int,
) -> List[str]:
    """
    Generate YOLO annotation lines from an AI extraction result.

    Since AI extraction doesn't give exact bounding boxes, we generate
    estimated regions based on the extracted data. These are initial
    annotations that officers can refine using the annotation UI.

    Returns: list of YOLO annotation strings "class_id x_center y_center w h"
    """
    annotations = []
    if not extraction or not image_width or not image_height:
        return annotations

    ext = extraction.get("extraction", extraction)

    # ── Crossover region (class 0) ──
    # Estimate: lower-center of the image (crossover typically at bottom where road is)
    dims = ext.get("crossover_dimensions", {}) or {}
    if dims.get("width_at_boundary_m"):
        # Crossover is typically in the lower 30% of the plan, centered horizontally
        annotations.append(_yolo_line(0, 0.5, 0.8, 0.25, 0.15))

    # ── Road edge (class 1) ──
    sm = ext.get("siteplan_measurements", {}) or {}
    if sm.get("road_name"):
        # Road is typically at the bottom of the plan
        annotations.append(_yolo_line(1, 0.5, 0.95, 0.9, 0.08))

    # ── Property boundary (class 2) ──
    prop = ext.get("property", {}) or {}
    if prop.get("lot_number"):
        # Lot boundary is the outer rectangle of the plan
        annotations.append(_yolo_line(2, 0.5, 0.5, 0.85, 0.85))

    # ── Building (class 3) ──
    if sm.get("building_setback_front_m"):
        # Building is typically in the upper-center
        annotations.append(_yolo_line(3, 0.5, 0.35, 0.4, 0.35))

    # ── Garage (class 4) ──
    if sm.get("garage_to_kerb_m") or sm.get("garage_setback_to_crossover_road_m"):
        # Garage near the crossover, typically lower-center
        annotations.append(_yolo_line(4, 0.45, 0.6, 0.15, 0.12))

    # ── Fences (class 5) ──
    af = ext.get("additional_findings", {}) or {}
    if af.get("fence_left_of_crossover"):
        annotations.append(_yolo_line(5, 0.15, 0.7, 0.05, 0.25))
    if af.get("fence_right_of_crossover"):
        annotations.append(_yolo_line(5, 0.85, 0.7, 0.05, 0.25))

    # ── Trees (class 6) ──
    if af.get("vegetation_on_verge") or af.get("trees_on_verge"):
        annotations.append(_yolo_line(6, 0.3, 0.9, 0.08, 0.08))

    # ── North arrow (class 8) ──
    # Usually top-right or top-left corner
    annotations.append(_yolo_line(8, 0.9, 0.1, 0.08, 0.08))

    # ── Title block (class 9) ──
    # Usually bottom-right
    annotations.append(_yolo_line(9, 0.85, 0.92, 0.25, 0.12))

    # ── Utilities (class 10) ──
    ut = ext.get("utilities", {}) or {}
    if ut.get("power_line_shown"):
        annotations.append(_yolo_line(10, 0.7, 0.85, 0.06, 0.06))
    if ut.get("water_main_shown"):
        annotations.append(_yolo_line(10, 0.6, 0.9, 0.06, 0.06))

    # ── Drainage (class 11) ──
    dr = ext.get("drainage", {}) or {}
    if dr.get("soakwells_proposed") or dr.get("drainage_plan_included"):
        annotations.append(_yolo_line(11, 0.4, 0.65, 0.08, 0.08))

    return annotations


def _yolo_line(class_id: int, x_center: float, y_center: float, width: float, height: float) -> str:
    """Format a YOLO annotation line (all values 0-1 normalised)."""
    return f"{class_id} {x_center:.6f} {y_center:.6f} {width:.6f} {height:.6f}"


def export_yolo_dataset(samples: list, output_dir: str) -> dict:
    """
    Export training samples as a YOLO dataset.

    Directory structure:
      output_dir/
        dataset.yaml          — YOLO config file
        images/
          train/              — training images (80%)
          val/                — validation images (20%)
        labels/
          train/              — annotation files
          val/                — annotation files

    Returns: {total, train, val, classes}
    """
    import shutil
    import random

    output = Path(output_dir)
    for d in ["images/train", "images/val", "labels/train", "labels/val"]:
        (output / d).mkdir(parents=True, exist_ok=True)

    # Split 80/20
    random.shuffle(samples)
    split = int(len(samples) * 0.8)
    train_samples = samples[:split]
    val_samples = samples[split:]

    def _process(sample_list, split_name):
        count = 0
        for s in sample_list:
            img_path = Path(s.get("image_path", ""))
            if not img_path.exists():
                continue

            extraction = s.get("extraction_json", {})
            img_w = s.get("image_width", 1)
            img_h = s.get("image_height", 1)

            # Generate annotations
            annotations = generate_annotations_from_extraction(extraction, img_w, img_h)
            if not annotations:
                continue

            # Copy image
            dest_img = output / "images" / split_name / img_path.name
            shutil.copy2(img_path, dest_img)

            # Write annotation file
            label_file = output / "labels" / split_name / (img_path.stem + ".txt")
            with open(label_file, "w") as f:
                f.write("\n".join(annotations))

            count += 1
        return count

    train_count = _process(train_samples, "train")
    val_count = _process(val_samples, "val")

    # Write dataset.yaml
    yaml_content = f"""# CAMS Site Plan Object Detection Dataset
# Generated by CAMS training pipeline

path: {output}
train: images/train
val: images/val

nc: {len(YOLO_CLASSES)}
names: {CLASS_NAMES}
"""
    with open(output / "dataset.yaml", "w") as f:
        f.write(yaml_content)

    return {
        "total": train_count + val_count,
        "train": train_count,
        "val": val_count,
        "classes": len(YOLO_CLASSES),
        "class_names": CLASS_NAMES,
        "dataset_yaml": str(output / "dataset.yaml"),
    }
