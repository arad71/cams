import json
import re
from pathlib import Path
from typing import Optional, Dict, Any, Tuple

# --- helpers to normalise strings ------------------------------------------------

# common abbreviations you may encounter; adjust as needed (Aust. road types)
ROAD_TYPE_NORMALISATION = {
    "RD": "RD",
    "ROAD": "RD",
    "CR": "CR",
    "CRES": "CR",
    "CRESCENT": "CR",
    "ST": "ST",
    "STREET": "ST",
    "AVE": "AV",
    "AV": "AV",
    "AVENUE": "AV",
    "HWY": "HWY",
    "HIGHWAY": "HWY",
    "DR": "DR",
    "DRIVE": "DR",
    "CT": "CT",
    "COURT": "CT",
}

def normalise_text(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip().upper())

def normalise_road_type(s: str) -> str:
    s = normalise_text(s)
    return ROAD_TYPE_NORMALISATION.get(s, s)

def split_address(addr: str) -> Dict[str, str]:
    """
    Very lightweight parser for formats like:
      '54 Stirling Cr, High Wycombe'
      '54 Stirling Crescent High Wycombe'
      '54 STIRLING CR HIGH WYCOMBE'
    Returns dict with number, name, type, locality (best-effort).
    """
    a = normalise_text(addr)
    # replace commas with spaces, collapse whitespace
    a = a.replace(",", " ")
    tokens = a.split()

    # find leading street number (may include ranges like '54-56' -> take first)
    if not tokens:
        raise ValueError("Address is empty")

    m = re.match(r"^(\d+)", tokens[0])
    if not m:
        raise ValueError("Address should start with a street number, e.g. '54 ...'")
    number = m.group(1)
    tokens = tokens[1:]

    if not tokens:
        raise ValueError("Missing street name and locality")

    # heuristic: last 1–3 tokens likely locality; we’ll try to detect road type first
    # scan tokens to find a token that matches a known road type
    road_type_idx = None
    for i, t in enumerate(tokens):
        if normalise_road_type(t) in ROAD_TYPE_NORMALISATION.values():
            road_type_idx = i
            break

    if road_type_idx is None:
        raise ValueError("Could not detect road type in address (e.g. ST, RD, CR, AV)")

    name_tokens = tokens[:road_type_idx]
    if not name_tokens:
        raise ValueError("Missing road name before the road type")

    road_name = " ".join(name_tokens)             # may be multi-word
    road_type_raw = tokens[road_type_idx]
    road_type = normalise_road_type(road_type_raw)

    locality_tokens = tokens[road_type_idx + 1 :]
    if not locality_tokens:
        raise ValueError("Missing locality (suburb/town) after the road type")

    locality = " ".join(locality_tokens)

    return {
        "road_number_1": number,
        "road_name": road_name,
        "road_type": road_type,
        "locality": locality,
    }

# --- matching --------------------------------------------------------------------

def property_matches(props: Dict[str, Any], query: Dict[str, str]) -> bool:
    """
    Compares a feature's properties to the parsed address fields.
    Uses case-insensitive comparisons and normalises road type & name spacing.
    """
    # Extract & normalise from properties
    p_num = str(props.get("road_number_1", "")).strip()
    p_name = normalise_text(props.get("road_name", ""))
    p_type = normalise_road_type(str(props.get("road_type", "")))
    p_loc  = normalise_text(props.get("locality", ""))

    # Extract & normalise from query
    q_num  = str(query["road_number_1"]).strip()
    q_name = normalise_text(query["road_name"])
    q_type = normalise_road_type(query["road_type"])
    q_loc  = normalise_text(query["locality"])

    # Some datasets put abbreviations; allow partial match for names (e.g., "STIRLING")
    # but still require exact number, type, and locality.
    name_match = (p_name == q_name)

    return (p_num == q_num) and name_match and (p_type == q_type) and (p_loc == q_loc)

# --- main API --------------------------------------------------------------------

def find_lot_geometry_for_address(geojson_path: Path, address: str) -> Optional[Dict[str, Any]]:
    """
    Load a GeoJSON FeatureCollection and return the 'geometry' of the first feature
    that matches the given address.
    Returns None if no match is found.
    """
    query = split_address(address)

    with open(geojson_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    features = data.get("features", [])
    for feat in features:
        props = feat.get("properties", {})
        if property_matches(props, query):
            # Return geometry as-is (GeoJSON geometry)
            return feat.get("geometry")

    return None

# --- convenience: wrap geometry as a single-feature GeoJSON, if you want ----------
def geometry_to_feature(geometry: Dict[str, Any], properties: Dict[str, Any] = None) -> Dict[str, Any]:
    return {
        "type": "Feature",
        "properties": properties or {},
        "geometry": geometry,
    }

def geometry_to_feature_collection(geometry: Dict[str, Any], crs: Dict[str, Any] = None) -> Dict[str, Any]:
    fc = {
        "type": "FeatureCollection",
        "features": [geometry_to_feature(geometry)],
    }
    if crs:
        fc["crs"] = crs
    return fc

# # --- demo ------------------------------------------------------------------------

# if __name__ == "__main__":
#     # Path to your local GeoJSON file (the sample you pasted)
#     path = Path("landgate_sample.geojson")

#     # Example queries that should match your sample rows:
#     # - "54 Stirling Cr High Wycombe"
#     # - "54 Stirling Crescent, High Wycombe"
#     # - "2 Maud Rd Maida Vale"
#     for addr in [
#         "54 Stirling Cr, High Wycombe",
#         "2 Maud Rd, Maida Vale",
#     ]:
#         try:
#             geom = find_lot_geometry_for_address(path, addr)
#             if geom:
#                 print(f"Address: {addr}")
#                 print("Lot geometry (GeoJSON):")
#                 print(json.dumps(geom, indent=2))
#                 print("-" * 60)
#             else:
#                 print(f"No match found for: {addr}")
#         except Exception as e:
#             print(f"Error parsing/searching '{addr}': {e}")