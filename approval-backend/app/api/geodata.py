"""
GeoData API — Fetch GeoJSON from Data WA (SLIP) public services

Endpoints:
  GET /api/geodata/lots          — Cadastre Address lots for the council LGA
  GET /api/geodata/roads         — MRWA Road Network centrelines for the council LGA
  GET /api/geodata/speed-limits  — Legal speed limits for the council LGA
  POST /api/geodata/refresh      — Re-fetch all layers from Data WA (admin only)
  GET /api/geodata/status        — Last refresh timestamps and feature counts

Data sources (free, no auth required):
  Lots:   SLIP Places_and_Addresses/MapServer/4  (Cadastre Address LGATE-002)
  Roads:  SLIP Transport_WFS/MapServer/3          (Roads Simplified LGATE-195)
  Speed:  MRWA Road Network via catalogue.data.wa.gov.au (has gazetted speed limits)

All queries use the ArcGIS REST API JSON/GeoJSON query interface with a spatial
bounding box filter, plus attribute filters for the council LGA where possible.
"""

import asyncio
import hashlib
import json
import logging
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query

router = APIRouter(prefix="/geodata", tags=["geodata"])
logger = logging.getLogger("cams.geodata")

# ─── Configuration ────────────────────────────────────────────────────────────

# Council LGA bounding box (EPSG:7844 — GDA2020 geographic)
# Covers Kalamunda LGA: Kalamunda, High Wycombe, Forrestfield, Maida Vale, etc.
COUNCIL_BBOX = os.getenv("COUNCIL_BBOX", "115.95,-32.10,116.15,-31.87")
COUNCIL_LGA_NAME = os.getenv("COUNCIL_LGA_NAME", "Kalamunda")
COUNCIL_LGA_NO = os.getenv("COUNCIL_LGA_NO", "102")

COUNCIL_LOCALITIES = {
    "BICKLEY", "CANNING MILLS", "CARMEL", "FORRESTFIELD",
    "GOOSEBERRY HILL", "HACKETTS GULLY", "HIGH WYCOMBE",
    "KALAMUNDA", "LESMURDIE", "MAIDA VALE", "PAULLS VALLEY",
    "PICKERING BROOK", "PIESSE BROOK", "WALLISTON", "WATTLE GROVE",
}

# SLIP ArcGIS REST endpoints (public, no API key needed)
SLIP_BASE = "https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services"

LAYERS = {
    "lots": {
        "url": f"{SLIP_BASE}/Places_and_Addresses/MapServer/4/query",
        "max_record_count": 1000,
        "where": f"locality IN ({','.join(repr(l) for l in sorted(COUNCIL_LOCALITIES))})",
        "out_fields": "land_id,road_number_type,road_number_1,road_number_2,lot_number,road_name,road_type,road_suffix,locality,view_scale",
        "output_file": "lot.geojson",
        "description": "Cadastre Address (LGATE-002) — lot boundaries with address",
    },
    "roads": {
        "url": f"{SLIP_BASE}/Transport_WFS/MapServer/3/query",
        "max_record_count": 50000,
        "where": "1=1",  # bbox filter handles spatial, this layer doesn't have LGA field
        "out_fields": "road_name,mapclassification,roadsurface,fcsubtype",
        "output_file": "Road_Network.geojson",
        "description": "Roads Simplified (LGATE-195) — road centrelines with classification",
    },
    "contours": {
        "url": "https://services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Terrain/MapServer/0/query",
        "max_record_count": 5000,
        "where": "1=1",
        "out_fields": "elevation_m",
        "output_file": "Contours_2m.geojson",
        "description": "DPIRD-072 — LiDAR-derived 2m contour lines for 3D sight analysis",
    },
    "urban_forest": {
        "url": f"{SLIP_BASE}/Environment/MapServer/125/query",
        "max_record_count": 2000,
        "where": "1=1",
        "out_fields": "tree3to8m,tree8to15m,tree15mplus,tree0to3m,grass,totalcover,totalpcent,totalrange",
        "output_file": "Urban_Forest.geojson",
        "description": "DPLH-109 — Urban Forest tree canopy height strata per parcel",
    },
    "drainage_pipes": {
        "url": "https://mrgis.mainroads.wa.gov.au/arcgis/rest/services/OpenData/Drainage_DataPortal/MapServer/2/query",
        "max_record_count": 2000,
        "where": "1=1",
        "out_fields": "Pipe_Type,Length,Diameter_Width,Asset_Owner,Asset_Status",
        "output_file": "Drainage_Pipes.geojson",
        "description": "MRWA — Drainage pipes, culverts, open drains",
        "in_sr": "4283",
    },
    "drainage_pits": {
        "url": "https://mrgis.mainroads.wa.gov.au/arcgis/rest/services/OpenData/Drainage_DataPortal/MapServer/0/query",
        "max_record_count": 2000,
        "where": "1=1",
        "out_fields": "Pit_Type,FSL,Depth,Asset_Owner,Asset_Status",
        "output_file": "Drainage_Pits.geojson",
        "description": "MRWA — Street gullies, soak wells, junction pits",
        "in_sr": "4283",
    },
    "water_pipes": {
        "url": f"{SLIP_BASE}/Infrastructure_and_Utilities/MapServer/20/query",
        "max_record_count": 5000,
        "where": "1=1",
        "out_fields": "*",
        "output_file": "Water_Pipes.geojson",
        "description": "WaterCorp (WCORP-002) — Water main locations",
    },
}

# MRWA Road Network — separate service with speed limits
MRWA_ROAD_NETWORK_URL = os.getenv(
    "MRWA_ROAD_NETWORK_URL",
    "https://services.slip.wa.gov.au/public/rest/services/MRWA_Public_Services/Road_Network/MapServer/0/query",
)
# Fallback: catalogue.data.wa.gov.au provides a WFS endpoint
MRWA_WFS_URL = os.getenv(
    "MRWA_WFS_URL",
    "https://services.slip.wa.gov.au/public/services/MRWA_Public_Services/Road_Network/MapServer/WFSServer",
)

# Output directory (frontend public folder served by nginx)
REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent  # cams/
OUTPUT_DIR = Path(os.getenv(
    "GEOJSON_OUTPUT_DIR",
    str(REPO_ROOT / "approval-frontend" / "public"),
))

# Refresh state
_refresh_status: dict = {
    "lots": {"last_refresh": None, "feature_count": 0, "error": None, "duration_s": 0},
    "roads": {"last_refresh": None, "feature_count": 0, "error": None, "duration_s": 0},
    "speed_limits": {"last_refresh": None, "feature_count": 0, "error": None, "duration_s": 0},
    "contours": {"last_refresh": None, "feature_count": 0, "error": None, "duration_s": 0},
    "urban_forest": {"last_refresh": None, "feature_count": 0, "error": None, "duration_s": 0},
    "drainage_pipes": {"last_refresh": None, "feature_count": 0, "error": None, "duration_s": 0},
    "drainage_pits": {"last_refresh": None, "feature_count": 0, "error": None, "duration_s": 0},
    "water_pipes": {"last_refresh": None, "feature_count": 0, "error": None, "duration_s": 0},
}
_refresh_lock = asyncio.Lock()

# HTTP client timeout
QUERY_TIMEOUT = 120  # seconds per request


# ─── ArcGIS REST Query Helper ────────────────────────────────────────────────

def _bbox_to_envelope(bbox_str: str) -> dict:
    """Convert 'xmin,ymin,xmax,ymax' string to ArcGIS geometry envelope."""
    parts = [float(x.strip()) for x in bbox_str.split(",")]
    return {
        "xmin": parts[0], "ymin": parts[1],
        "xmax": parts[2], "ymax": parts[3],
        "spatialReference": {"wkid": 7844},
    }


async def _query_arcgis_layer(
    url: str,
    where: str = "1=1",
    out_fields: str = "*",
    bbox: str = COUNCIL_BBOX,
    max_record_count: int = 1000,
    result_offset: int = 0,
    client: httpx.AsyncClient = None,
    in_sr: str = "7844",
    max_retries: int = 3,
) -> dict:
    """
    Query a single page from an ArcGIS REST MapServer layer.
    Retries up to max_retries times on connection failure.
    Returns raw JSON response with 'features' array.
    """
    envelope = _bbox_to_envelope(bbox)
    params = {
        "where": where,
        "outFields": out_fields,
        "geometry": json.dumps(envelope),
        "geometryType": "esriGeometryEnvelope",
        "inSR": in_sr,
        "spatialRel": "esriSpatialRelIntersects",
        "outSR": "7844",
        "f": "geojson",
        "resultOffset": result_offset,
        "resultRecordCount": max_record_count,
        "returnGeometry": "true",
    }

    own_client = client is None
    if own_client:
        client = httpx.AsyncClient(timeout=QUERY_TIMEOUT)

    last_error = None
    try:
        for attempt in range(1, max_retries + 1):
            try:
                resp = await client.get(url, params=params, headers={
                    "User-Agent": "CAMS-GeoData/1.0 (Council)",
                    "Accept": "application/json",
                })
                resp.raise_for_status()
                data = resp.json()

                # ArcGIS error handling
                if "error" in data:
                    err = data["error"]
                    raise RuntimeError(f"ArcGIS error {err.get('code')}: {err.get('message')}")

                return data

            except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout,
                    httpx.RemoteProtocolError, httpx.PoolTimeout, ConnectionError, OSError) as e:
                last_error = e
                if attempt < max_retries:
                    wait = attempt * 3  # 3s, 6s, 9s
                    logger.warning(f"    Connection failed (attempt {attempt}/{max_retries}): {e}. Retrying in {wait}s...")
                    await asyncio.sleep(wait)
                else:
                    logger.error(f"    Connection failed after {max_retries} attempts: {e}")
                    raise RuntimeError(f"Connection failed after {max_retries} attempts: {e}") from e

            except httpx.HTTPStatusError as e:
                last_error = e
                if e.response.status_code in (502, 503, 504, 429) and attempt < max_retries:
                    wait = attempt * 5
                    logger.warning(f"    HTTP {e.response.status_code} (attempt {attempt}/{max_retries}). Retrying in {wait}s...")
                    await asyncio.sleep(wait)
                else:
                    raise

    finally:
        if own_client:
            await client.aclose()


async def _fetch_all_features(
    url: str,
    where: str = "1=1",
    out_fields: str = "*",
    bbox: str = COUNCIL_BBOX,
    max_record_count: int = 1000,
    max_pages: int = 50,
    in_sr: str = "7844",
) -> list[dict]:
    """Fetch all features from an ArcGIS REST layer with pagination."""
    all_features = []
    async with httpx.AsyncClient(timeout=QUERY_TIMEOUT) as client:
        for page in range(max_pages):
            offset = page * max_record_count
            logger.info(f"  Fetching page {page + 1} (offset={offset})...")

            data = await _query_arcgis_layer(
                url=url,
                where=where,
                out_fields=out_fields,
                bbox=bbox,
                max_record_count=max_record_count,
                result_offset=offset,
                client=client,
                in_sr=in_sr,
            )

            features = data.get("features", [])
            logger.info(f"    → {len(features)} features")
            all_features.extend(features)

            # Last page if fewer than max returned
            if len(features) < max_record_count:
                break

            # Be polite
            await asyncio.sleep(0.5)

    return all_features


# ─── Feature Processing ──────────────────────────────────────────────────────

def _normalise_lot_feature(feat: dict) -> dict:
    """Normalise lot feature properties to match existing schema."""
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


def _normalise_road_feature(feat: dict) -> dict:
    """Normalise road feature to match existing Road_Network.geojson schema."""
    p = feat.get("properties", {})
    road_name = p.get("road_name") or p.get("ROAD_NAME") or p.get("COMMON_USAGE_NAME") or ""
    network_type = p.get("mapclassification") or p.get("NETWORK_TYPE") or ""
    lg_name = p.get("lg_name") or p.get("LG_NAME") or ""

    return {
        "type": "Feature",
        "properties": {
            "ROAD_NAME": road_name,
            "COMMON_USAGE_NAME": road_name,
            "NETWORK_TYPE": network_type,
            "LG_NAME": lg_name,
            "ROAD_SURFACE": p.get("roadsurface") or p.get("ROAD_SURFACE") or "",
        },
        "geometry": feat.get("geometry"),
    }


def _normalise_speed_feature(feat: dict) -> dict:
    """Normalise speed limit feature to match existing Legal_Speed_Limits.geojson schema."""
    p = feat.get("properties", {})
    road_name = p.get("ROAD_NAME") or p.get("COMMON_USAGE_NAME") or p.get("road_name") or ""
    speed = p.get("GAZETTED_SPEED_LIMIT") or p.get("SPEED_LIMIT") or p.get("speed_limit") or 50
    network_type = p.get("NETWORK_TYPE") or p.get("network_type") or "Road"

    try:
        speed = int(speed)
    except (ValueError, TypeError):
        speed = 50

    return {
        "type": "Feature",
        "properties": {
            "rd": road_name,
            "sp": speed,
            "nt": network_type,
        },
        "geometry": feat.get("geometry"),
    }


def _build_geojson(features: list[dict], crs_epsg: int = 7844) -> dict:
    """Build a GeoJSON FeatureCollection."""
    return {
        "type": "FeatureCollection",
        "crs": {
            "type": "name",
            "properties": {"name": f"urn:ogc:def:crs:EPSG::{crs_epsg}"},
        },
        "features": features,
    }


def _write_geojson(geojson: dict, filename: str) -> tuple[bool, int]:
    """
    Write GeoJSON to output directory. Returns (changed, feature_count).
    Skips write if content is identical (MD5 check).
    """
    output_path = OUTPUT_DIR / filename
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    new_content = json.dumps(geojson, separators=(",", ":"))
    new_hash = hashlib.md5(new_content.encode()).hexdigest()

    if output_path.exists():
        old_hash = hashlib.md5(output_path.read_bytes()).hexdigest()
        if old_hash == new_hash:
            logger.info(f"  No changes — {filename} unchanged")
            return False, len(geojson.get("features", []))

    # Atomic write via temp file
    tmp_path = output_path.with_suffix(".tmp")
    tmp_path.write_text(new_content, encoding="utf-8")
    tmp_path.replace(output_path)

    count = len(geojson.get("features", []))
    size_mb = output_path.stat().st_size / 1048576
    logger.info(f"  ✓ Updated: {filename} ({count} features, {size_mb:.1f} MB)")
    return True, count


# ─── Refresh Logic ────────────────────────────────────────────────────────────

async def _refresh_lots() -> dict:
    """Fetch and write lot boundaries from Data WA."""
    t0 = time.time()
    layer = LAYERS["lots"]
    try:
        features = await _fetch_all_features(
            url=layer["url"],
            where=layer["where"],
            out_fields=layer["out_fields"],
            max_record_count=layer["max_record_count"],
        )

        if not features:
            raise RuntimeError("No features returned from Cadastre Address query")

        # Filter to council localities (belt-and-suspenders with the WHERE clause)
        features = [
            f for f in features
            if (f.get("properties", {}).get("locality") or "").upper().strip() in COUNCIL_LOCALITIES
        ]

        if len(features) < 500:
            raise RuntimeError(
                f"Only {len(features)} lot features returned — expected ~23,000. "
                "Possible query issue; keeping existing data."
            )

        normalised = [_normalise_lot_feature(f) for f in features]
        geojson = _build_geojson(normalised)
        changed, count = _write_geojson(geojson, layer["output_file"])

        duration = round(time.time() - t0, 1)
        return {"last_refresh": datetime.utcnow().isoformat(), "feature_count": count,
                "error": None, "duration_s": duration, "changed": changed}

    except Exception as e:
        duration = round(time.time() - t0, 1)
        logger.error(f"Lots refresh failed: {e}")
        return {"last_refresh": datetime.utcnow().isoformat(), "feature_count": 0,
                "error": str(e), "duration_s": duration, "changed": False, "last_failed": datetime.utcnow().isoformat()}


async def _refresh_roads() -> dict:
    """Fetch and write road network from Data WA."""
    t0 = time.time()
    layer = LAYERS["roads"]
    try:
        features = await _fetch_all_features(
            url=layer["url"],
            where=layer["where"],
            out_fields=layer["out_fields"],
            max_record_count=layer["max_record_count"],
        )

        if not features:
            raise RuntimeError("No features returned from Roads query")

        normalised = [_normalise_road_feature(f) for f in features]
        geojson = _build_geojson(normalised)
        changed, count = _write_geojson(geojson, layer["output_file"])

        duration = round(time.time() - t0, 1)
        return {"last_refresh": datetime.utcnow().isoformat(), "feature_count": count,
                "error": None, "duration_s": duration, "changed": changed}

    except Exception as e:
        duration = round(time.time() - t0, 1)
        logger.error(f"Roads refresh failed: {e}")
        return {"last_refresh": datetime.utcnow().isoformat(), "feature_count": 0,
                "error": str(e), "duration_s": duration, "changed": False, "last_failed": datetime.utcnow().isoformat()}


async def _refresh_speed_limits() -> dict:
    """
    Fetch speed limits from MRWA Road Network.
    This layer has GAZETTED_SPEED_LIMIT on road centrelines.
    Falls back to the existing speed roads file if the MRWA service is unavailable.
    """
    t0 = time.time()
    try:
        # Try MRWA ArcGIS REST endpoint first
        features = await _fetch_all_features(
            url=MRWA_ROAD_NETWORK_URL,
            where=f"LG_NAME='{COUNCIL_LGA_NAME}'",
            out_fields="ROAD,ROAD_NAME,COMMON_USAGE_NAME,NETWORK_TYPE,LG_NAME,GAZETTED_SPEED_LIMIT,CWY",
            max_record_count=5000,
            max_pages=10,
        )

        if not features:
            # Fallback: query from the Transport_WFS roads layer (no speed data,
            # but we can at least default to 50 for local roads)
            logger.warning("MRWA endpoint returned no features, trying Transport_WFS fallback")
            features = await _fetch_all_features(
                url=LAYERS["roads"]["url"],
                where="1=1",
                out_fields="road_name,mapclassification,roadsurface",
                max_record_count=50000,
            )

        if not features:
            raise RuntimeError("No features returned from speed limit query")

        # Only keep features that have a speed limit or assign defaults
        speed_features = []
        for f in features:
            p = f.get("properties", {})
            speed = p.get("GAZETTED_SPEED_LIMIT") or p.get("gazetted_speed_limit")
            if speed is None:
                # Default speed by road classification
                classification = (
                    p.get("NETWORK_TYPE") or p.get("mapclassification") or ""
                ).lower()
                if "highway" in classification or "freeway" in classification:
                    speed = 80
                elif "state" in classification or "arterial" in classification:
                    speed = 70
                elif "distributor" in classification:
                    speed = 60
                else:
                    speed = 50
            speed_features.append(f)

        normalised = [_normalise_speed_feature(f) for f in speed_features]
        geojson = _build_geojson(normalised)
        changed, count = _write_geojson(geojson, "Legal_Speed_Limits.geojson")

        duration = round(time.time() - t0, 1)
        return {"last_refresh": datetime.utcnow().isoformat(), "feature_count": count,
                "error": None, "duration_s": duration, "changed": changed}

    except Exception as e:
        duration = round(time.time() - t0, 1)
        logger.error(f"Speed limits refresh failed: {e}")
        return {"last_refresh": datetime.utcnow().isoformat(), "feature_count": 0,
                "error": str(e), "duration_s": duration, "changed": False, "last_failed": datetime.utcnow().isoformat()}


async def _refresh_contours() -> dict:
    """Fetch 2m contour lines from SLIP Terrain service (DPIRD-072)."""
    t0 = time.time()
    layer = LAYERS["contours"]
    try:
        features = await _fetch_all_features(
            url=layer["url"],
            where=layer["where"],
            out_fields=layer["out_fields"],
            max_record_count=layer["max_record_count"],
            max_pages=100,
        )

        if not features:
            raise RuntimeError("No features returned from SLIP Terrain contour query")

        # Keep features with valid elevation
        normalised = []
        for f in features:
            p = f.get("properties", {})
            elev = p.get("elevation_m") or p.get("Elevation_m") or p.get("ELEVATION_M")
            if elev is None:
                continue
            try:
                elev = float(elev)
            except (ValueError, TypeError):
                continue
            normalised.append({
                "type": "Feature",
                "properties": {"elevation_m": elev},
                "geometry": f.get("geometry"),
            })

        if len(normalised) < 10:
            raise RuntimeError(f"Only {len(normalised)} contour features — expected many more")

        geojson = _build_geojson(normalised)
        changed, count = _write_geojson(geojson, layer["output_file"])

        elevs = [f["properties"]["elevation_m"] for f in normalised]
        logger.info(f"  Contours: {count} lines, {min(elevs):.0f}m–{max(elevs):.0f}m")

        duration = round(time.time() - t0, 1)
        return {"last_refresh": datetime.utcnow().isoformat(), "feature_count": count,
                "error": None, "duration_s": duration, "changed": changed}

    except Exception as e:
        duration = round(time.time() - t0, 1)
        logger.error(f"Contours refresh failed: {e}")
        return {"last_refresh": datetime.utcnow().isoformat(), "feature_count": 0,
                "error": str(e), "duration_s": duration, "changed": False, "last_failed": datetime.utcnow().isoformat()}


async def _refresh_generic_layer(layer_key: str) -> dict:
    """Generic refresh for layers that just need fetch + write (no special normalisation)."""
    t0 = time.time()
    layer = LAYERS.get(layer_key)
    if not layer:
        return {"last_refresh": datetime.utcnow().isoformat(), "feature_count": 0, "error": f"Unknown layer: {layer_key}", "duration_s": 0}
    try:
        in_sr = layer.get("in_sr", "7844")
        features = await _fetch_all_features(
            url=layer["url"],
            where=layer["where"],
            out_fields=layer["out_fields"],
            max_record_count=layer["max_record_count"],
            max_pages=100,
            in_sr=in_sr,
        )

        if not features:
            raise RuntimeError(f"No features returned for {layer_key}")

        # Keep features as-is (geometry + properties)
        geojson = _build_geojson(features)
        changed, count = _write_geojson(geojson, layer["output_file"])

        duration = round(time.time() - t0, 1)
        logger.info(f"  {layer_key}: {count} features, {duration}s")
        return {"last_refresh": datetime.utcnow().isoformat(), "feature_count": count,
                "error": None, "duration_s": duration, "changed": changed}

    except Exception as e:
        duration = round(time.time() - t0, 1)
        logger.error(f"{layer_key} refresh failed: {e}")
        return {"last_refresh": datetime.utcnow().isoformat(), "feature_count": 0,
                "error": str(e), "duration_s": duration, "changed": False, "last_failed": datetime.utcnow().isoformat()}


async def _refresh_all():
    """Refresh all GeoJSON layers from Data WA."""
    global _refresh_status

    logger.info("=" * 60)
    logger.info(f"  GeoData Refresh — {datetime.utcnow().isoformat()}")
    logger.info("=" * 60)

    logger.info("\n[1/8] Refreshing lots...")
    _refresh_status["lots"] = await _refresh_lots()

    logger.info("\n[2/8] Refreshing roads...")
    _refresh_status["roads"] = await _refresh_roads()

    logger.info("\n[3/8] Refreshing speed limits...")
    _refresh_status["speed_limits"] = await _refresh_speed_limits()

    logger.info("\n[4/8] Refreshing 2m contours...")
    _refresh_status["contours"] = await _refresh_contours()

    logger.info("\n[5/8] Refreshing urban forest...")
    _refresh_status["urban_forest"] = await _refresh_generic_layer("urban_forest")

    logger.info("\n[6/8] Refreshing drainage pipes...")
    _refresh_status["drainage_pipes"] = await _refresh_generic_layer("drainage_pipes")

    logger.info("\n[7/8] Refreshing drainage pits...")
    _refresh_status["drainage_pits"] = await _refresh_generic_layer("drainage_pits")

    logger.info("\n[8/8] Refreshing water pipes...")
    _refresh_status["water_pipes"] = await _refresh_generic_layer("water_pipes")

    logger.info("\nRefresh complete.")
    return _refresh_status


# ─── API Endpoints ────────────────────────────────────────────────────────────

@router.get("/status")
async def geodata_status():
    """Return last refresh timestamps and feature counts for all layers."""
    # Also check what files exist on disk
    files = {}
    for name in ["lot.geojson", "Road_Network.geojson", "Legal_Speed_Limits.geojson", "Contours_2m.geojson", "Urban_Forest.geojson", "Drainage_Pipes.geojson", "Drainage_Pits.geojson", "Water_Pipes.geojson"]:
        path = OUTPUT_DIR / name
        if path.exists():
            stat = path.stat()
            files[name] = {
                "size_mb": round(stat.st_size / 1048576, 2),
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            }
        else:
            files[name] = None

    return {
        "layers": _refresh_status,
        "files": files,
        "config": {
            "bbox": COUNCIL_BBOX,
            "lga_name": COUNCIL_LGA_NAME,
            "localities": sorted(COUNCIL_LOCALITIES),
            "output_dir": str(OUTPUT_DIR),
        },
    }


@router.post("/refresh")
async def refresh_geodata(
    background_tasks: BackgroundTasks,
    layer: Optional[str] = Query(default=None, description="Refresh a specific layer: lots, roads, speed_limits, contours, urban_forest, drainage_pipes, drainage_pits, water_pipes, or all"),
    # current_user: dict = Depends(get_current_admin),  # ⟵ uncomment to protect
):
    """
    Trigger a refresh of GeoJSON data from Data WA SLIP public services.
    Runs in background — poll /api/geodata/status for progress.
    """
    if _refresh_lock.locked():
        raise HTTPException(status_code=409, detail="Refresh already in progress")

    async def _run():
        async with _refresh_lock:
            if layer and layer != "all":
                if layer == "lots":
                    _refresh_status["lots"] = await _refresh_lots()
                elif layer == "roads":
                    _refresh_status["roads"] = await _refresh_roads()
                elif layer == "speed_limits":
                    _refresh_status["speed_limits"] = await _refresh_speed_limits()
                elif layer == "contours":
                    _refresh_status["contours"] = await _refresh_contours()
                elif layer == "urban_forest":
                    _refresh_status["urban_forest"] = await _refresh_generic_layer("urban_forest")
                elif layer == "drainage_pipes":
                    _refresh_status["drainage_pipes"] = await _refresh_generic_layer("drainage_pipes")
                elif layer == "drainage_pits":
                    _refresh_status["drainage_pits"] = await _refresh_generic_layer("drainage_pits")
                elif layer == "water_pipes":
                    _refresh_status["water_pipes"] = await _refresh_generic_layer("water_pipes")
                else:
                    return  # unknown layer, silently ignore in background
            else:
                await _refresh_all()

    background_tasks.add_task(_run)
    return {"status": "refresh_started", "layer": layer or "all"}


@router.get("/lots")
async def get_lots(
    bbox: Optional[str] = Query(default=None, description="Override bounding box: xmin,ymin,xmax,ymax"),
    locality: Optional[str] = Query(default=None, description="Filter to a specific locality"),
    limit: int = Query(default=0, description="Limit number of features (0=all)"),
):
    """
    Return lot boundary GeoJSON. Serves from the cached file by default.
    Pass bbox or locality params to query Data WA directly (slower).
    """
    # If custom params, query live
    if bbox or locality:
        where = "1=1"
        if locality:
            where = f"locality='{locality.upper()}'"
        features = await _fetch_all_features(
            url=LAYERS["lots"]["url"],
            where=where,
            out_fields=LAYERS["lots"]["out_fields"],
            bbox=bbox or COUNCIL_BBOX,
            max_record_count=LAYERS["lots"]["max_record_count"],
        )
        normalised = [_normalise_lot_feature(f) for f in features]
        if limit > 0:
            normalised = normalised[:limit]
        return _build_geojson(normalised)

    # Serve cached file
    path = OUTPUT_DIR / LAYERS["lots"]["output_file"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="lot.geojson not found. Run POST /api/geodata/refresh first.")
    data = json.loads(path.read_text(encoding="utf-8"))
    if limit > 0:
        data["features"] = data["features"][:limit]
    return data


@router.get("/roads")
async def get_roads(
    bbox: Optional[str] = Query(default=None, description="Override bounding box"),
):
    """Return road network GeoJSON from cache or live query."""
    if bbox:
        features = await _fetch_all_features(
            url=LAYERS["roads"]["url"],
            where="1=1",
            out_fields=LAYERS["roads"]["out_fields"],
            bbox=bbox,
            max_record_count=LAYERS["roads"]["max_record_count"],
        )
        normalised = [_normalise_road_feature(f) for f in features]
        return _build_geojson(normalised)

    path = OUTPUT_DIR / LAYERS["roads"]["output_file"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="Road_Network.geojson not found. Run POST /api/geodata/refresh first.")
    return json.loads(path.read_text(encoding="utf-8"))


@router.get("/speed-limits")
async def get_speed_limits():
    """Return speed limit road network GeoJSON from cache."""
    path = OUTPUT_DIR / "Legal_Speed_Limits.geojson"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Legal_Speed_Limits.geojson not found.")
    return json.loads(path.read_text(encoding="utf-8"))


@router.get("/lookup-lot")
async def lookup_lot(
    address: str = Query(..., description="Street address, e.g. '54 Stirling Cr, High Wycombe'"),
):
    """
    Find a specific lot polygon by address.
    Queries the cached lot.geojson first, falls back to live Data WA query.
    """
    from app.services.address_to_geo import find_lot_geometry_for_address, split_address

    # Try cached file first
    path = OUTPUT_DIR / LAYERS["lots"]["output_file"]
    if path.exists():
        geom = find_lot_geometry_for_address(path, address)
        if geom:
            return {"type": "Feature", "properties": {"address": address, "source": "cache"}, "geometry": geom}

    # Live query — parse address to build a WHERE clause
    try:
        parsed = split_address(address)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    where = (
        f"road_number_1='{parsed['road_number_1']}' "
        f"AND UPPER(road_name)='{parsed['road_name']}' "
        f"AND UPPER(road_type)='{parsed['road_type']}' "
        f"AND UPPER(locality)='{parsed['locality']}'"
    )

    features = await _fetch_all_features(
        url=LAYERS["lots"]["url"],
        where=where,
        out_fields=LAYERS["lots"]["out_fields"],
        bbox=COUNCIL_BBOX,
        max_record_count=10,
        max_pages=1,
    )

    if features:
        feat = features[0]
        return {
            "type": "Feature",
            "properties": {**feat.get("properties", {}), "address": address, "source": "live"},
            "geometry": feat.get("geometry"),
        }

    raise HTTPException(status_code=404, detail=f"No lot found for address: {address}")
