#!/usr/bin/env python3
"""
GeoJSON Updater — Fetch lots, roads & speed limits from Data WA (SLIP)

Replaces the static GeoJSON files in approval-frontend/public/ with fresh
data from WA Landgate's public ArcGIS REST services.

Data sources (free, no API key):
  Lots:   SLIP Places_and_Addresses/MapServer/4  (Cadastre Address LGATE-002)
  Roads:  SLIP Transport_WFS/MapServer/3          (Roads Simplified LGATE-195)
  Speed:  MRWA Road_Network/MapServer/0            (has GAZETTED_SPEED_LIMIT)

Usage:
  python scripts/update_geodata.py                  # Refresh all layers
  python scripts/update_geodata.py --layer lots      # Only lots
  python scripts/update_geodata.py --layer roads     # Only roads
  python scripts/update_geodata.py --layer speed     # Only speed limits
  python scripts/update_geodata.py --dry-run         # Fetch but don't write

Cron (weekly Sunday 2am):
  0 2 * * 0 cd /opt/cams && python scripts/update_geodata.py >> /var/log/cams/geodata_update.log 2>&1

Docker:
  docker compose exec approval-api python scripts/update_geodata.py

Environment variables:
  COUNCIL_BBOX         — bounding box override (default: Kalamunda LGA)
  COUNCIL_LGA_NAME     — LGA name for MRWA filter (default: Kalamunda)
  GEOJSON_OUTPUT_DIR   — output path (default: approval-frontend/public/)
"""

import argparse
import hashlib
import json
import os
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

# ─── Configuration ────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent

COUNCIL_BBOX = os.getenv("COUNCIL_BBOX", "115.95,-32.10,116.15,-31.87")
COUNCIL_LGA_NAME = os.getenv("COUNCIL_LGA_NAME", "Kalamunda")

COUNCIL_LOCALITIES = {
    "BICKLEY", "CANNING MILLS", "CARMEL", "FORRESTFIELD",
    "GOOSEBERRY HILL", "HACKETTS GULLY", "HIGH WYCOMBE",
    "KALAMUNDA", "LESMURDIE", "MAIDA VALE", "PAULLS VALLEY",
    "PICKERING BROOK", "PIESSE BROOK", "WALLISTON", "WATTLE GROVE",
}

OUTPUT_DIR = Path(os.getenv(
    "GEOJSON_OUTPUT_DIR",
    str(REPO_ROOT / "approval-frontend" / "public"),
))
BACKUP_DIR = REPO_ROOT / "backups" / "geojson"

# SLIP ArcGIS REST endpoints
SLIP_BASE = "https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services"

LOTS_URL = f"{SLIP_BASE}/Places_and_Addresses/MapServer/4/query"
ROADS_URL = f"{SLIP_BASE}/Transport_WFS/MapServer/3/query"
MRWA_URL = os.getenv(
    "MRWA_ROAD_NETWORK_URL",
    "https://services.slip.wa.gov.au/public/rest/services/MRWA_Public_Services/Road_Network/MapServer/0/query",
)

HEADERS = {
    "User-Agent": "CAMS-GeoData/1.0 (Council)",
    "Accept": "application/json",
}


# ─── ArcGIS REST Query ───────────────────────────────────────────────────────

def bbox_envelope(bbox_str):
    parts = [float(x.strip()) for x in bbox_str.split(",")]
    return json.dumps({
        "xmin": parts[0], "ymin": parts[1],
        "xmax": parts[2], "ymax": parts[3],
        "spatialReference": {"wkid": 7844},
    })


def query_arcgis(url, where="1=1", out_fields="*", bbox=COUNCIL_BBOX,
                 max_records=1000, offset=0, timeout=120):
    """Query one page from an ArcGIS REST MapServer layer."""
    params = {
        "where": where,
        "outFields": out_fields,
        "geometry": bbox_envelope(bbox),
        "geometryType": "esriGeometryEnvelope",
        "inSR": "7844",
        "spatialRel": "esriSpatialRelIntersects",
        "outSR": "7844",
        "f": "geojson",
        "resultOffset": offset,
        "resultRecordCount": max_records,
        "returnGeometry": "true",
    }
    full_url = f"{url}?{urlencode(params)}"
    req = Request(full_url, headers=HEADERS)

    try:
        with urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if "error" in data:
                err = data["error"]
                print(f"    ✕ ArcGIS error {err.get('code')}: {err.get('message')}")
                return None
            return data.get("features", [])
    except (URLError, HTTPError) as e:
        print(f"    ✕ Request error: {e}")
        return None


def fetch_all(url, where="1=1", out_fields="*", bbox=COUNCIL_BBOX,
              max_records=1000, max_pages=50):
    """Fetch all features with pagination."""
    all_features = []
    for page in range(max_pages):
        offset = page * max_records
        print(f"  Page {page + 1} (offset={offset})...", end=" ", flush=True)

        features = query_arcgis(url, where, out_fields, bbox, max_records, offset)
        if features is None:
            print("FAILED")
            return None

        print(f"→ {len(features)} features")
        all_features.extend(features)

        if len(features) < max_records:
            break
        time.sleep(1)

    return all_features


# ─── Normalisers ──────────────────────────────────────────────────────────────

def normalise_lot(feat):
    p = feat.get("properties", {})
    return {
        "type": "Feature",
        "properties": {
            "land_id": p.get("land_id") or p.get("LAND_ID") or p.get("objectid"),
            "road_number_type": p.get("road_number_type") or p.get("ROAD_NUMBER_TYPE") or "H",
            "road_number_1": str(p.get("road_number_1") or p.get("ROAD_NUMBER_1") or ""),
            "road_number_2": p.get("road_number_2") or p.get("ROAD_NUMBER_2"),
            "lot_number": p.get("lot_number") or p.get("LOT_NUMBER"),
            "road_name": (p.get("road_name") or p.get("ROAD_NAME") or "").upper(),
            "road_type": (p.get("road_type") or p.get("ROAD_TYPE") or "").upper(),
            "road_suffix": p.get("road_suffix") or p.get("ROAD_SUFFIX"),
            "locality": (p.get("locality") or p.get("LOCALITY") or "").upper(),
            "view_scale": p.get("view_scale") or "16K",
        },
        "geometry": feat.get("geometry"),
    }


def normalise_road(feat):
    p = feat.get("properties", {})
    road_name = p.get("road_name") or p.get("ROAD_NAME") or p.get("COMMON_USAGE_NAME") or ""
    return {
        "type": "Feature",
        "properties": {
            "ROAD_NAME": road_name,
            "COMMON_USAGE_NAME": road_name,
            "NETWORK_TYPE": p.get("mapclassification") or p.get("NETWORK_TYPE") or "",
            "LG_NAME": p.get("lg_name") or p.get("LG_NAME") or "",
            "ROAD_SURFACE": p.get("roadsurface") or p.get("ROAD_SURFACE") or "",
        },
        "geometry": feat.get("geometry"),
    }


def normalise_speed(feat):
    p = feat.get("properties", {})
    road_name = p.get("ROAD_NAME") or p.get("COMMON_USAGE_NAME") or p.get("road_name") or ""
    speed = p.get("GAZETTED_SPEED_LIMIT") or p.get("SPEED_LIMIT") or p.get("speed_limit")
    network_type = p.get("NETWORK_TYPE") or p.get("network_type") or "Road"

    if speed is None:
        classification = (p.get("NETWORK_TYPE") or p.get("mapclassification") or "").lower()
        if "highway" in classification or "freeway" in classification:
            speed = 80
        elif "state" in classification or "arterial" in classification:
            speed = 70
        elif "distributor" in classification:
            speed = 60
        else:
            speed = 50

    try:
        speed = int(speed)
    except (ValueError, TypeError):
        speed = 50

    return {
        "type": "Feature",
        "properties": {"rd": road_name, "sp": speed, "nt": network_type},
        "geometry": feat.get("geometry"),
    }


# ─── File I/O ─────────────────────────────────────────────────────────────────

def build_geojson(features, crs_epsg=7844):
    return {
        "type": "FeatureCollection",
        "crs": {"type": "name", "properties": {"name": f"urn:ogc:def:crs:EPSG::{crs_epsg}"}},
        "features": features,
    }


def file_hash(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def write_geojson(geojson, filename, dry_run=False):
    output_path = OUTPUT_DIR / filename
    count = len(geojson.get("features", []))

    if dry_run:
        size_est = len(json.dumps(geojson, separators=(",", ":"))) / 1048576
        print(f"  [DRY RUN] Would write {filename}: {count} features, ~{size_est:.1f} MB")
        return True

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = output_path.with_suffix(".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(geojson, f, separators=(",", ":"))

    if output_path.exists():
        old_h = file_hash(output_path)
        new_h = file_hash(tmp_path)
        if old_h == new_h:
            tmp_path.unlink()
            print(f"  No changes — {filename} unchanged ({count} features)")
            return False

    # Backup
    if output_path.exists():
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_name = f"{output_path.stem}_{ts}{output_path.suffix}"
        shutil.copy2(output_path, BACKUP_DIR / backup_name)
        # Keep only last 4 backups per layer
        prefix = output_path.stem
        backups = sorted(BACKUP_DIR.glob(f"{prefix}_*"), reverse=True)
        for old in backups[4:]:
            old.unlink()

    tmp_path.replace(output_path)
    size_mb = output_path.stat().st_size / 1048576
    print(f"  ✓ Updated: {filename} ({count} features, {size_mb:.1f} MB)")
    return True


# ─── Layer Refresh Functions ──────────────────────────────────────────────────

def refresh_lots(dry_run=False):
    print("\n[LOTS] Fetching Cadastre Address from SLIP...")
    where = f"locality IN ({','.join(repr(l) for l in sorted(COUNCIL_LOCALITIES))})"

    features = fetch_all(
        LOTS_URL,
        where=where,
        out_fields="land_id,road_number_type,road_number_1,road_number_2,lot_number,road_name,road_type,road_suffix,locality,view_scale",
        max_records=1000,
    )

    if features is None:
        print("  ✕ Failed to fetch lots from SLIP")
        return False

    # Belt-and-suspenders filter
    features = [
        f for f in features
        if (f.get("properties", {}).get("locality") or "").upper().strip() in COUNCIL_LOCALITIES
    ]

    if len(features) < 500:
        print(f"  ⚠ Only {len(features)} lots — expected ~23,000. Skipping write.")
        return False

    normalised = [normalise_lot(f) for f in features]
    geojson = build_geojson(normalised)
    write_geojson(geojson, "lot.geojson", dry_run)

    # Summary
    localities = {}
    for f in normalised:
        loc = f["properties"].get("locality", "UNKNOWN")
        localities[loc] = localities.get(loc, 0) + 1
    print(f"  Summary:")
    for loc in sorted(localities):
        print(f"    {loc:<25} {localities[loc]:>6} lots")
    print(f"    {'TOTAL':<25} {len(normalised):>6} lots")
    return True


def refresh_roads(dry_run=False):
    print("\n[ROADS] Fetching Roads (Simplified) from SLIP...")
    features = fetch_all(
        ROADS_URL,
        where="1=1",
        out_fields="road_name,mapclassification,roadsurface,fcsubtype",
        max_records=50000,
    )

    if features is None:
        print("  ✕ Failed to fetch roads from SLIP")
        return False

    if not features:
        print("  ⚠ No road features returned. Skipping.")
        return False

    normalised = [normalise_road(f) for f in features]
    geojson = build_geojson(normalised)
    write_geojson(geojson, "Road_Network.geojson", dry_run)
    print(f"  Total: {len(normalised)} road segments")
    return True


def refresh_speed_limits(dry_run=False):
    print("\n[SPEED] Fetching speed limits from MRWA Road Network...")

    features = fetch_all(
        MRWA_URL,
        where=f"LG_NAME='{COUNCIL_LGA_NAME}'",
        out_fields="ROAD,ROAD_NAME,COMMON_USAGE_NAME,NETWORK_TYPE,LG_NAME,GAZETTED_SPEED_LIMIT,CWY",
        max_records=5000,
        max_pages=10,
    )

    if features is None or not features:
        print("  ⚠ MRWA endpoint unavailable, falling back to Transport_WFS roads...")
        features = fetch_all(
            ROADS_URL,
            where="1=1",
            out_fields="road_name,mapclassification,roadsurface",
            max_records=50000,
        )

    if features is None or not features:
        print("  ✕ Failed to fetch speed limits from any source")
        return False

    normalised = [normalise_speed(f) for f in features]
    geojson = build_geojson(normalised)
    write_geojson(geojson, "Legal_Speed_Limits.geojson", dry_run)
    print(f"  Total: {len(normalised)} road segments with speed data")
    return True


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Refresh GeoJSON from Data WA SLIP")
    parser.add_argument("--layer", choices=["lots", "roads", "speed", "all"], default="all",
                        help="Which layer to refresh (default: all)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Fetch data but don't write files")
    args = parser.parse_args()

    print(f"{'=' * 60}")
    print(f"  CAMS GeoData Updater — {datetime.now().isoformat()}")
    print(f"{'=' * 60}")
    print(f"  BBOX:   {COUNCIL_BBOX}")
    print(f"  LGA:    {COUNCIL_LGA_NAME}")
    print(f"  Output: {OUTPUT_DIR}")
    if args.dry_run:
        print(f"  MODE:   DRY RUN (no files will be written)")
    print()

    results = {}
    t0 = time.time()

    if args.layer in ("lots", "all"):
        results["lots"] = refresh_lots(args.dry_run)

    if args.layer in ("roads", "all"):
        results["roads"] = refresh_roads(args.dry_run)

    if args.layer in ("speed", "all"):
        results["speed"] = refresh_speed_limits(args.dry_run)

    elapsed = round(time.time() - t0, 1)

    print(f"\n{'=' * 60}")
    print(f"  Results ({elapsed}s):")
    for layer, ok in results.items():
        print(f"    {layer:<15} {'✓ OK' if ok else '✕ FAILED'}")
    print(f"{'=' * 60}")

    if not all(results.values()):
        sys.exit(1)


if __name__ == "__main__":
    main()
