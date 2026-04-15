"""
YOLOv8 Training Pipeline for Site Plan Object Detection.

Detects drawing elements on site plans:
  - crossover (driveway area)
  - road_edge (road boundary/kerb line)
  - property_boundary (lot boundary line)
  - building (building footprint)
  - north_arrow (north indicator)
  - dimension_line (measurement annotation)
  - fence (fence line with type)
  - tree (tree symbol)
  - utility (power pole, water meter, gas, telco)
  - garage (garage/carport)
  - footpath (footpath across verge)

Training flow:
  1. Collect annotated samples (auto-annotated from AI extraction + manual corrections)
  2. Export as YOLO dataset (images/ + labels/ + data.yaml)
  3. Train YOLOv8 model
  4. Evaluate and deploy
"""
import os
import json
import shutil
from pathlib import Path
from typing import List, Dict, Optional
import logging

logger = logging.getLogger(__name__)

# Object classes for detection
YOLO_CLASSES = [
    "crossover",          # 0 - driveway/crossover area
    "road_edge",          # 1 - road boundary/kerb
    "property_boundary",  # 2 - lot boundary
    "building",           # 3 - building footprint
    "north_arrow",        # 4 - north indicator
    "dimension_line",     # 5 - measurement annotation
    "fence",              # 6 - fence line
    "tree",               # 7 - tree symbol
    "utility",            # 8 - utility (power, water, gas)
    "garage",             # 9 - garage/carport
    "footpath",           # 10 - footpath
    "retaining_wall",     # 11 - retaining wall
    "sight_triangle",     # 12 - sight triangle area
]

CLASS_TO_ID = {c: i for i, c in enumerate(YOLO_CLASSES)}


def auto_annotate_from_extraction(extraction: dict, img_width: int, img_height: int) -> List[Dict]:
    """
    Generate approximate bounding box annotations from AI extraction data.
    These are rough annotations based on what the AI found — officer can refine later.

    Returns list of: {class_name, class_id, x_center, y_center, width, height, confidence}
    All coordinates normalised 0-1 (YOLO format).
    """
    annotations = []

    # We can't get exact pixel positions from extraction data alone,
    # but we can create presence labels for training classification.
    # For actual bounding boxes, we need the annotation UI.

    ext = extraction if isinstance(extraction, dict) else {}
    prop = ext.get("property", {}) or {}
    dims = ext.get("crossover_dimensions", {}) or {}
    cons = ext.get("construction", {}) or {}
    site = ext.get("siteplan_measurements", {}) or {}
    util = ext.get("utilities", {}) or {}
    drain = ext.get("drainage", {}) or {}
    findings = ext.get("additional_findings", {}) or {}

    # Crossover — if dimensions exist, crossover was detected
    if dims.get("width_at_boundary_m"):
        # Approximate: crossover is typically in lower-centre of plan
        annotations.append({
            "class_name": "crossover", "class_id": 0,
            "x_center": 0.5, "y_center": 0.75,
            "width": 0.15, "height": 0.2,
            "confidence": 0.3, "source": "auto_from_extraction",
        })

    # Building — if setbacks exist, building was detected
    if site.get("building_setback_front_m"):
        annotations.append({
            "class_name": "building", "class_id": 3,
            "x_center": 0.5, "y_center": 0.4,
            "width": 0.4, "height": 0.3,
            "confidence": 0.3, "source": "auto_from_extraction",
        })

    # Garage — if garage measurements exist
    if site.get("garage_to_kerb_m") or site.get("garage_setback_to_crossover_road_m"):
        annotations.append({
            "class_name": "garage", "class_id": 9,
            "x_center": 0.5, "y_center": 0.6,
            "width": 0.15, "height": 0.12,
            "confidence": 0.3, "source": "auto_from_extraction",
        })

    # Fence — if fence data exists
    for side in ["fence_left_of_crossover", "fence_right_of_crossover"]:
        fence = findings.get(side)
        if fence and isinstance(fence, dict) and fence.get("exists"):
            x = 0.25 if "left" in side else 0.75
            annotations.append({
                "class_name": "fence", "class_id": 6,
                "x_center": x, "y_center": 0.7,
                "width": 0.05, "height": 0.3,
                "confidence": 0.3, "source": "auto_from_extraction",
            })

    # Tree — if vegetation detected
    if findings.get("vegetation_on_verge") or findings.get("trees_on_verge"):
        annotations.append({
            "class_name": "tree", "class_id": 7,
            "x_center": 0.3, "y_center": 0.85,
            "width": 0.08, "height": 0.08,
            "confidence": 0.3, "source": "auto_from_extraction",
        })

    # Utilities
    for util_key in ["power_line_shown", "water_main_shown", "gas_main_shown", "telco_shown"]:
        if util.get(util_key):
            annotations.append({
                "class_name": "utility", "class_id": 8,
                "x_center": 0.7, "y_center": 0.85,
                "width": 0.05, "height": 0.05,
                "confidence": 0.2, "source": "auto_from_extraction",
            })
            break  # Only one utility annotation

    # Retaining wall
    if findings.get("retaining_wall_near_crossover"):
        annotations.append({
            "class_name": "retaining_wall", "class_id": 11,
            "x_center": 0.5, "y_center": 0.7,
            "width": 0.3, "height": 0.05,
            "confidence": 0.2, "source": "auto_from_extraction",
        })

    return annotations


def export_yolo_dataset(samples, output_dir: str, train_split: float = 0.8):
    """
    Export training samples as YOLO dataset.

    Creates:
      output_dir/
        images/train/  — training images
        images/val/    — validation images
        labels/train/  — training labels (txt, one per image)
        labels/val/    — validation labels
        data.yaml      — dataset config for YOLOv8
    """
    output = Path(output_dir)
    for d in ["images/train", "images/val", "labels/train", "labels/val"]:
        (output / d).mkdir(parents=True, exist_ok=True)

    # Split samples
    import random
    random.shuffle(samples)
    split_idx = int(len(samples) * train_split)
    train_samples = samples[:split_idx]
    val_samples = samples[split_idx:]

    def _write_sample(sample, split):
        img_path = Path(sample.get("image_path", ""))
        if not img_path.exists():
            return False

        # Copy image
        img_name = f"sample_{sample.get('id', 0)}_{img_path.name}"
        dest_img = output / f"images/{split}" / img_name
        shutil.copy2(img_path, dest_img)

        # Write labels
        annotations = sample.get("annotations", [])
        label_name = img_name.rsplit(".", 1)[0] + ".txt"
        dest_label = output / f"labels/{split}" / label_name

        with open(dest_label, "w") as f:
            for ann in annotations:
                # YOLO format: class_id x_center y_center width height
                f.write(f"{ann['class_id']} {ann['x_center']:.6f} {ann['y_center']:.6f} {ann['width']:.6f} {ann['height']:.6f}\n")

        return True

    train_count = sum(1 for s in train_samples if _write_sample(s, "train"))
    val_count = sum(1 for s in val_samples if _write_sample(s, "val"))

    # Write data.yaml
    yaml_content = f"""# CAMS Site Plan Object Detection Dataset
# Auto-generated for YOLOv8 training

path: {output}
train: images/train
val: images/val

nc: {len(YOLO_CLASSES)}
names: {YOLO_CLASSES}
"""
    with open(output / "data.yaml", "w") as f:
        f.write(yaml_content)

    return {
        "train_images": train_count,
        "val_images": val_count,
        "total": train_count + val_count,
        "classes": len(YOLO_CLASSES),
        "output_dir": str(output),
        "data_yaml": str(output / "data.yaml"),
    }


def train_yolo_model(
    data_yaml: str,
    model_size: str = "n",  # n(ano), s(mall), m(edium), l(arge), x
    epochs: int = 100,
    imgsz: int = 640,
    batch: int = 8,
    output_dir: str = None,
):
    """
    Train YOLOv8 object detection model.

    Args:
        data_yaml: path to data.yaml
        model_size: yolov8n/s/m/l/x — smaller = faster, larger = more accurate
        epochs: training epochs
        imgsz: image size
        batch: batch size
        output_dir: where to save the trained model

    Returns: dict with model path, metrics
    """
    try:
        from ultralytics import YOLO
    except ImportError:
        return {"error": "ultralytics not installed. Run: pip install ultralytics"}

    model_name = f"yolov8{model_size}.pt"
    model = YOLO(model_name)

    # Train
    results = model.train(
        data=data_yaml,
        epochs=epochs,
        imgsz=imgsz,
        batch=batch,
        project=output_dir or "runs/detect",
        name="siteplan",
        exist_ok=True,
        verbose=True,
    )

    # Get best model path
    best_model = Path(results.save_dir) / "weights" / "best.pt"

    return {
        "model_path": str(best_model),
        "epochs": epochs,
        "model_size": model_size,
        "metrics": {
            "mAP50": float(results.results_dict.get("metrics/mAP50(B)", 0)),
            "mAP50_95": float(results.results_dict.get("metrics/mAP50-95(B)", 0)),
            "precision": float(results.results_dict.get("metrics/precision(B)", 0)),
            "recall": float(results.results_dict.get("metrics/recall(B)", 0)),
        },
    }


def run_inference(model_path: str, image_path: str, confidence: float = 0.5) -> List[Dict]:
    """
    Run YOLOv8 inference on a site plan image.

    Returns list of detections: {class_name, class_id, confidence, bbox: {x1,y1,x2,y2}}
    """
    try:
        from ultralytics import YOLO
    except ImportError:
        return []

    model = YOLO(model_path)
    results = model.predict(image_path, conf=confidence, verbose=False)

    detections = []
    for r in results:
        for box in r.boxes:
            cls_id = int(box.cls[0])
            cls_name = YOLO_CLASSES[cls_id] if cls_id < len(YOLO_CLASSES) else f"class_{cls_id}"
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            detections.append({
                "class_name": cls_name,
                "class_id": cls_id,
                "confidence": float(box.conf[0]),
                "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
            })

    return detections
