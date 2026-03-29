#!/usr/bin/env python3
"""
Lot GeoJSON Weekly Updater — Council Cadastral Data

Fetches lot boundary data from WA Landgate's public WFS service,
filters to the Council LGA, and replaces lot.geojson.

Data source: Landgate SLIP (Shared Location Information Platform)
  WFS endpoint: https://services.slip.wa.gov.au/public/services/SLIP_Public_Services/MapServer/WFSServer
  Layer: Address (with lot polygons)
  CRS: EPSG:7844 (GDA2020)

Usage:
  # Manual run
  python scripts/update_lots.py

  # Cron (weekly Sunday 2am)
  0 2 * * 0 cd /opt/cams && python scripts/update_lots.py >> /var/log/cams/lot_update.log 2>&1

  # Docker
  docker compose exec approval-api python scripts/update_lots.py

Environment variables:
  LANDGATE_WFS_URL  — override WFS endpoint (optional)
  LOT_GEOJSON_PATH  — output path (default: approval-frontend/public/lot.geojson)
  COUNCIL_BBOX    — bounding box override (default: Council LGA)
"""

import json
import os
import sys
import shutil
import time
import hashlib
from datetime import datetime
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.parse import urlencode
from urllib.error import URLError, HTTPError

# ─── Configuration ────────────────────────────────────────

# Landgate SLIP Public WFS
WFS_URL = os.getenv(
    "LANDGATE_WFS_URL",
    "https://services.slip.wa.gov.au/public/services/SLIP_Public_Services/MapServer/WFSServer"
)

# Output path (relative to repo root)
SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent
OUTPUT_PATH = Path(os.getenv(
    "LOT_GEOJSON_PATH",
    str(REPO_ROOT / "approval-frontend" / "public" / "lot.geojson")
))
BACKUP_DIR = REPO_ROOT / "backups" / "lot_geojson"

# Council bounding box (EPSG:7844 — GDA2020 geographic)
# Covers: Kalamunda, High Wycombe, Forrestfield, Maida Vale, Lesmurdie,
#         Gooseberry Hill, Bickley, Carmel, Walliston, Wattle Grove, etc.
BBOX = os.getenv("COUNCIL_BBOX", "115.95,-32.10,116.15,-31.87")

# Council LGA localities for filtering
COUNCIL_LOCALITIES = {
    "BICKLEY", "CANNING MILLS", "CARMEL", "FORRESTFIELD",
    "GOOSEBERRY HILL", "HACKETTS GULLY", "HIGH WYCOMBE",
    "KALAMUNDA", "LESMURDIE", "MAIDA VALE", "PAULLS VALLEY",
    "PICKERING BROOK", "PIESSE BROOK", "WALLISTON", "WATTLE GROVE",
}

# WFS paging (Landgate limits to 1000 features per request)
PAGE_SIZE = 1000
MAX_PAGES = 30  # Safety limit: 30 * 1000 = 30,000 features max


# ─── WFS Fetch ────────────────────────────────────────────

def fetch_wfs_page(start_index=0):
    """Fetch one page of features from Landgate WFS."""
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": "SLIP_Public_Services:Address",
        "outputFormat": "geojson",
        "srsName": "EPSG:7844",
        "bbox": BBOX + ",EPSG:7844",
        "count": str(PAGE_SIZE),
        "startIndex": str(start_index),
    }

    url = f"{WFS_URL}?{urlencode(params)}"
    print(f"  Fetching page {start_index // PAGE_SIZE + 1} (startIndex={start_index})...")

    req = Request(url, headers={
        "User-Agent": "CAMS-LotUpdater/1.0 (Council)",
        "Accept": "application/json",
    })

    try:
        with urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            features = data.get("features", [])
            print(f"    → {len(features)} features")
            return features
    except (URLError, HTTPError) as e:
        print(f"    ✕ WFS error: {e}")
        return None


def fetch_all_features():
    """Fetch all lot features via paginated WFS requests."""
    all_features = []
    for page in range(MAX_PAGES):
        features = fetch_wfs_page(start_index=page * PAGE_SIZE)
        if features is None:
            print("  ⚠ WFS request failed — using cached data")
            return None
        all_features.extend(features)
        if len(features) < PAGE_SIZE:
            break  # Last page
        time.sleep(1)  # Be polite to the server
    return all_features


# ─── Alternative: Local File Source ───────────────────────

def fetch_from_local_source():
    """
    Fallback: If WFS is unavailable, check for a manually downloaded file.
    Download from: https://catalogue.data.wa.gov.au/dataset/address
    Place as: backups/lot_geojson/landgate_address_latest.geojson
    """
    local_path = BACKUP_DIR / "landgate_address_latest.geojson"
    if local_path.exists():
        print(f"  Using local file: {local_path}")
        with open(local_path) as f:
            data = json.load(f)
        return data.get("features", [])
    return None


# ─── Processing ───────────────────────────────────────────

def filter_council(features):
    """Filter features to Council localities only."""
    filtered = []
    for f in features:
        props = f.get("properties", {})
        locality = (props.get("locality") or "").upper().strip()
        if locality in COUNCIL_LOCALITIES:
            filtered.append(f)
    print(f"  Filtered: {len(filtered)} Council lots from {len(features)} total")
    return filtered


def normalise_properties(features):
    """Normalise property names to match existing lot.geojson schema."""
    normalised = []
    for f in features:
        p = f.get("properties", {})
        # Map Landgate field names to our schema
        new_props = {
            "land_id": p.get("land_id") or p.get("LAND_ID") or p.get("objectid"),
            "road_number_type": p.get("road_number_type") or p.get("ROAD_NUMBER_TYPE") or "H",
            "road_number_1": str(p.get("road_number_1") or p.get("ROAD_NUMBER_1") or p.get("road_number") or ""),
            "road_number_2": p.get("road_number_2") or p.get("ROAD_NUMBER_2"),
            "lot_number": p.get("lot_number") or p.get("LOT_NUMBER"),
            "road_name": (p.get("road_name") or p.get("ROAD_NAME") or "").upper(),
            "road_type": (p.get("road_type") or p.get("ROAD_TYPE") or "").upper(),
            "road_suffix": p.get("road_suffix") or p.get("ROAD_SUFFIX"),
            "locality": (p.get("locality") or p.get("LOCALITY") or "").upper(),
            "view_scale": p.get("view_scale") or "16K",
            "st_area_shape_": p.get("st_area_shape_") or p.get("Shape__Area") or 0,
            "st_perimeter_shape_": p.get("st_perimeter_shape_") or p.get("Shape__Length") or 0,
        }
        normalised.append({
            "type": "Feature",
            "properties": new_props,
            "geometry": f.get("geometry"),
        })
    return normalised


def build_geojson(features):
    """Build the final GeoJSON FeatureCollection."""
    return {
        "type": "FeatureCollection",
        "crs": {
            "type": "name",
            "properties": {"name": "urn:ogc:def:crs:EPSG::7844"}
        },
        "features": features,
    }


# ─── File Management ─────────────────────────────────────

def backup_current():
    """Backup the current lot.geojson before replacing."""
    if not OUTPUT_PATH.exists():
        return
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = BACKUP_DIR / f"lot_{ts}.geojson"
    shutil.copy2(OUTPUT_PATH, backup_path)
    print(f"  Backed up: {backup_path}")

    # Keep only last 4 backups
    backups = sorted(BACKUP_DIR.glob("lot_*.geojson"), reverse=True)
    for old in backups[4:]:
        old.unlink()
        print(f"  Removed old backup: {old.name}")


def file_hash(path):
    """Get MD5 hash of a file."""
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def write_geojson(geojson):
    """Write GeoJSON to output path, skip if unchanged."""
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    # Write to temp file first
    tmp_path = OUTPUT_PATH.with_suffix(".tmp")
    with open(tmp_path, "w") as f:
        json.dump(geojson, f)

    # Check if content changed
    if OUTPUT_PATH.exists():
        old_hash = file_hash(OUTPUT_PATH)
        new_hash = file_hash(tmp_path)
        if old_hash == new_hash:
            tmp_path.unlink()
            print(f"  No changes — lot.geojson unchanged ({len(geojson['features'])} features)")
            return False

    # Backup and replace
    backup_current()
    shutil.move(str(tmp_path), str(OUTPUT_PATH))
    size_mb = OUTPUT_PATH.stat().st_size / 1048576
    print(f"  ✓ Updated: {OUTPUT_PATH} ({len(geojson['features'])} features, {size_mb:.1f} MB)")
    return True


# ─── Main ─────────────────────────────────────────────────

def main():
    print(f"{'='*60}")
    print(f"  CAMS Lot GeoJSON Updater — {datetime.now().isoformat()}")
    print(f"{'='*60}")
    print(f"  WFS: {WFS_URL}")
    print(f"  BBOX: {BBOX}")
    print(f"  Output: {OUTPUT_PATH}")
    print()

    # Try WFS first
    print("Step 1: Fetching from Landgate WFS...")
    features = fetch_all_features()

    # Fallback to local file
    if not features:
        print("Step 1b: Trying local file source...")
        features = fetch_from_local_source()

    if not features:
        print("  ✕ No data available — keeping existing file")
        sys.exit(1)

    # Filter to Council area
    print("\nStep 2: Filtering to Council...")
    features = filter_council(features)
    if len(features) < 1000:
        print(f"  ⚠ Warning: only {len(features)} features — expected ~23,000")
        print("  This might indicate a WFS query issue. Keeping existing file.")
        sys.exit(1)

    # Normalise
    print("\nStep 3: Normalising properties...")
    features = normalise_properties(features)

    # Build and write
    print("\nStep 4: Writing lot.geojson...")
    geojson = build_geojson(features)
    changed = write_geojson(geojson)

    # Summary
    localities = {}
    for f in features:
        loc = f["properties"].get("locality", "UNKNOWN")
        localities[loc] = localities.get(loc, 0) + 1

    print(f"\n  Summary:")
    print(f"  {'─'*40}")
    for loc in sorted(localities.keys()):
        print(f"  {loc:<25} {localities[loc]:>6} lots")
    print(f"  {'─'*40}")
    print(f"  {'TOTAL':<25} {len(features):>6} lots")
    print(f"\n  {'✓ Updated' if changed else '— No changes'}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
