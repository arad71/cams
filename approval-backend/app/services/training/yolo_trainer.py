"""
YOLO Training Script for Site Plan Object Detection

Trains a YOLOv8 model to detect objects in engineering site plans:
  crossover, road_edge, property_boundary, building, garage,
  fence, tree, dimension_line, north_arrow, title_block,
  utility, drainage

Usage:
  python -m app.services.training.yolo_trainer --data /path/to/dataset.yaml --epochs 100

Requirements:
  pip install ultralytics
"""
import argparse
import logging
from pathlib import Path
from datetime import datetime

logger = logging.getLogger(__name__)


def train_model(
    dataset_yaml: str,
    model_base: str = "yolov8n.pt",  # nano model — fastest, good for small datasets
    epochs: int = 100,
    batch_size: int = 16,
    image_size: int = 640,
    output_dir: str = None,
    device: str = "",  # "" = auto, "cpu", "0" for GPU
) -> dict:
    """
    Train a YOLOv8 object detection model.

    Args:
        dataset_yaml: Path to dataset.yaml
        model_base: Pre-trained model to fine-tune (yolov8n/s/m/l/x)
        epochs: Training epochs (100 for small dataset, 300 for larger)
        batch_size: Batch size (16 for GPU, 4-8 for CPU)
        image_size: Input image size (640 standard, 1024 for more detail)
        output_dir: Where to save the trained model
        device: Device to train on

    Returns: dict with model_path, metrics, training_time
    """
    try:
        from ultralytics import YOLO
    except ImportError:
        raise RuntimeError(
            "ultralytics not installed. Install with: pip install ultralytics\n"
            "For GPU training also install: pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121"
        )

    dataset_path = Path(dataset_yaml)
    if not dataset_path.exists():
        raise FileNotFoundError(f"Dataset not found: {dataset_yaml}")

    if not output_dir:
        output_dir = str(dataset_path.parent / "runs")

    logger.info(f"Starting YOLO training: {model_base}, {epochs} epochs, batch={batch_size}")
    logger.info(f"Dataset: {dataset_yaml}")
    logger.info(f"Output: {output_dir}")

    # Load pre-trained model
    model = YOLO(model_base)

    # Train
    start_time = datetime.now()
    results = model.train(
        data=str(dataset_path),
        epochs=epochs,
        batch=batch_size,
        imgsz=image_size,
        project=output_dir,
        name="siteplan_detect",
        exist_ok=True,
        device=device,
        # Augmentation for engineering drawings
        hsv_h=0.0,      # No hue shift (drawings are B&W)
        hsv_s=0.0,       # No saturation shift
        hsv_v=0.2,       # Slight brightness variation
        degrees=10.0,    # Small rotation (plans can be slightly rotated)
        translate=0.1,   # Small translation
        scale=0.3,       # Scale variation
        flipud=0.0,      # No vertical flip (north should stay up)
        fliplr=0.0,      # No horizontal flip (left/right matters)
        mosaic=0.5,      # Reduced mosaic (engineering drawings don't tile well)
        # Training params
        lr0=0.01,
        lrf=0.001,
        patience=20,     # Early stopping
        save_period=10,  # Save every 10 epochs
        verbose=True,
    )

    training_time = (datetime.now() - start_time).total_seconds()
    model_path = Path(output_dir) / "siteplan_detect" / "weights" / "best.pt"

    # Get metrics
    metrics = {}
    if hasattr(results, "results_dict"):
        metrics = dict(results.results_dict)
    elif hasattr(results, "maps"):
        metrics = {"mAP50": float(results.maps[0]) if results.maps else 0}

    result = {
        "model_path": str(model_path),
        "model_base": model_base,
        "epochs": epochs,
        "training_time_seconds": training_time,
        "metrics": metrics,
        "dataset": str(dataset_yaml),
    }

    logger.info(f"Training complete in {training_time:.0f}s")
    logger.info(f"Model saved: {model_path}")
    logger.info(f"Metrics: {metrics}")

    return result


def run_inference(
    model_path: str,
    image_path: str,
    confidence: float = 0.25,
) -> list:
    """
    Run object detection on a site plan image.

    Returns: list of {class_name, confidence, bbox: [x1, y1, x2, y2]}
    """
    try:
        from ultralytics import YOLO
    except ImportError:
        raise RuntimeError("ultralytics not installed")

    model = YOLO(model_path)
    results = model.predict(
        source=image_path,
        conf=confidence,
        verbose=False,
    )

    detections = []
    from app.services.training.yolo_annotator import YOLO_CLASSES

    for r in results:
        if r.boxes is None:
            continue
        for box in r.boxes:
            cls_id = int(box.cls[0])
            conf = float(box.conf[0])
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            detections.append({
                "class_id": cls_id,
                "class_name": YOLO_CLASSES.get(cls_id, f"class_{cls_id}"),
                "confidence": round(conf, 3),
                "bbox": [round(x1), round(y1), round(x2), round(y2)],
            })

    return sorted(detections, key=lambda d: -d["confidence"])


def detections_to_extraction_hints(detections: list, image_width: int, image_height: int) -> dict:
    """
    Convert YOLO detections into hints for the extraction pipeline.

    These hints tell the OCR/AI where to look for specific information,
    improving extraction accuracy.

    Returns: dict of spatial hints per field group
    """
    hints = {
        "crossover_region": None,
        "road_region": None,
        "building_region": None,
        "garage_region": None,
        "fence_regions": [],
        "tree_regions": [],
        "utility_regions": [],
        "north_arrow_region": None,
        "title_block_region": None,
        "dimension_regions": [],
    }

    for d in detections:
        bbox = d["bbox"]
        name = d["class_name"]
        conf = d["confidence"]

        region = {
            "bbox": bbox,
            "confidence": conf,
            "normalised": {
                "x1": bbox[0] / image_width,
                "y1": bbox[1] / image_height,
                "x2": bbox[2] / image_width,
                "y2": bbox[3] / image_height,
            },
        }

        if name == "crossover" and (not hints["crossover_region"] or conf > hints["crossover_region"]["confidence"]):
            hints["crossover_region"] = region
        elif name == "road_edge" and (not hints["road_region"] or conf > hints["road_region"]["confidence"]):
            hints["road_region"] = region
        elif name == "building" and (not hints["building_region"] or conf > hints["building_region"]["confidence"]):
            hints["building_region"] = region
        elif name == "garage" and (not hints["garage_region"] or conf > hints["garage_region"]["confidence"]):
            hints["garage_region"] = region
        elif name == "fence":
            hints["fence_regions"].append(region)
        elif name == "tree":
            hints["tree_regions"].append(region)
        elif name == "utility":
            hints["utility_regions"].append(region)
        elif name == "north_arrow" and (not hints["north_arrow_region"] or conf > hints["north_arrow_region"]["confidence"]):
            hints["north_arrow_region"] = region
        elif name == "title_block" and (not hints["title_block_region"] or conf > hints["title_block_region"]["confidence"]):
            hints["title_block_region"] = region
        elif name == "dimension_line":
            hints["dimension_regions"].append(region)

    return hints


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train YOLO model for site plan detection")
    parser.add_argument("--data", required=True, help="Path to dataset.yaml")
    parser.add_argument("--model", default="yolov8n.pt", help="Base model (yolov8n/s/m/l/x)")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--device", default="", help="Device: '' auto, 'cpu', '0' GPU")
    parser.add_argument("--output", default=None, help="Output directory")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)
    result = train_model(
        dataset_yaml=args.data,
        model_base=args.model,
        epochs=args.epochs,
        batch_size=args.batch,
        image_size=args.imgsz,
        output_dir=args.output,
        device=args.device,
    )
    print(json.dumps(result, indent=2))
    import json
