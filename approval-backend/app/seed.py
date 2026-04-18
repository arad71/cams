"""
Seed the database with initial users and sample applications.
Run: python -m app.seed
"""
from datetime import datetime, timezone
from app.core.database import SessionLocal, engine, Base
from app.core.auth import hash_password
from app.models.user import User
from app.models.application import Application, ApplicationNote, Document
from app.models.assessment import AssessmentCategory, AssessmentItem, AssessmentRule
from app.models.lookup import Role, Department


def run_seed():
    # Ensure tables exist
    Base.metadata.create_all(bind=engine)

    # Add columns that may not exist on older deployments
    from sqlalchemy import text
    with engine.connect() as conn:
        for stmt in [
            "ALTER TABLE applications ADD COLUMN IF NOT EXISTS extraction_locked BOOLEAN DEFAULT FALSE",
            "ALTER TABLE applications ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE",
            "ALTER TABLE applications ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
            "ALTER TABLE applications ADD COLUMN IF NOT EXISTS deleted_by_id INTEGER",
            "ALTER TABLE applications ADD COLUMN IF NOT EXISTS delete_reason TEXT",
            "ALTER TABLE applications ADD COLUMN IF NOT EXISTS conditions JSONB DEFAULT NULL",
            "ALTER TABLE applications ADD COLUMN IF NOT EXISTS decision_note TEXT DEFAULT NULL",
            "ALTER TABLE applications ADD COLUMN IF NOT EXISTS georef_overlay JSONB DEFAULT NULL",
            "ALTER TABLE applications ADD COLUMN IF NOT EXISTS form_extraction_data JSONB DEFAULT NULL",
            "ALTER TABLE applications ADD COLUMN IF NOT EXISTS title_extraction_data JSONB DEFAULT NULL",
            "ALTER TABLE inspections ADD COLUMN IF NOT EXISTS completed_date TIMESTAMPTZ DEFAULT NULL",
            "ALTER TABLE inspections ADD COLUMN IF NOT EXISTS gps_lat DOUBLE PRECISION DEFAULT NULL",
            "ALTER TABLE inspections ADD COLUMN IF NOT EXISTS gps_lng DOUBLE PRECISION DEFAULT NULL",
            "ALTER TABLE inspections ADD COLUMN IF NOT EXISTS gps_accuracy_m DOUBLE PRECISION DEFAULT NULL",
            "ALTER TABLE inspections ADD COLUMN IF NOT EXISTS field_checklist JSONB DEFAULT NULL",
            "ALTER TABLE inspections ADD COLUMN IF NOT EXISTS photos JSONB DEFAULT NULL",
            "ALTER TABLE ai_training_samples ADD COLUMN IF NOT EXISTS image_width INTEGER DEFAULT NULL",
            "ALTER TABLE ai_training_samples ADD COLUMN IF NOT EXISTS image_height INTEGER DEFAULT NULL",
            "ALTER TABLE ai_training_samples ADD COLUMN IF NOT EXISTS document_type VARCHAR(50) DEFAULT NULL",
            "ALTER TABLE ai_training_samples ADD COLUMN IF NOT EXISTS drawing_scale VARCHAR(20) DEFAULT NULL",
            "ALTER TABLE ai_training_samples ADD COLUMN IF NOT EXISTS drawing_standard VARCHAR(50) DEFAULT NULL",
            "ALTER TABLE ai_training_samples ADD COLUMN IF NOT EXISTS crossover_road VARCHAR(200) DEFAULT NULL",
            "ALTER TABLE ai_training_samples ADD COLUMN IF NOT EXISTS constrained_side VARCHAR(20) DEFAULT NULL",
            "ALTER TABLE ai_training_samples ADD COLUMN IF NOT EXISTS is_corner_lot BOOLEAN DEFAULT NULL",
            "ALTER TABLE ai_training_samples ADD COLUMN IF NOT EXISTS garage_to_kerb DOUBLE PRECISION DEFAULT NULL",
            "ALTER TABLE ai_training_samples ADD COLUMN IF NOT EXISTS garage_nearest_boundary DOUBLE PRECISION DEFAULT NULL",
            "ALTER TABLE ai_training_samples ADD COLUMN IF NOT EXISTS left_boundary_dist DOUBLE PRECISION DEFAULT NULL",
            "ALTER TABLE ai_training_samples ADD COLUMN IF NOT EXISTS right_boundary_dist DOUBLE PRECISION DEFAULT NULL",
            "ALTER TABLE ai_training_samples ADD COLUMN IF NOT EXISTS fence_left_type VARCHAR(100) DEFAULT NULL",
            "ALTER TABLE ai_training_samples ADD COLUMN IF NOT EXISTS fence_right_type VARCHAR(100) DEFAULT NULL",
            "ALTER TABLE ai_training_samples ADD COLUMN IF NOT EXISTS quality_score DOUBLE PRECISION DEFAULT NULL",
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                conn.rollback()

    db = SessionLocal()

    try:
        # ─── Roles ──────────────────────────────────────────
        if db.query(Role).count() == 0:
            roles = [
                Role(code="admin", label="Administrator", icon="🛡️", color="#e74c3c",
                     permissions=["all"], sort_order=1),
                Role(code="manager", label="Manager", icon="👔", color="#2980b9",
                     permissions=["view_all", "assign", "approve", "refer", "reject", "report"], sort_order=2),
                Role(code="engineer", label="Engineer", icon="🔧", color="#27ae60",
                     permissions=["view_assigned", "assess", "note", "inspect"], sort_order=3),
                Role(code="inspector", label="Inspector", icon="🔍", color="#8e44ad",
                     permissions=["view_assigned", "inspect", "note", "photo"], sort_order=4),
                Role(code="viewer", label="Viewer", icon="👁", color="#7f8c8d",
                     permissions=["view_all"], sort_order=5),
            ]
            db.add_all(roles)
            db.commit()
            print(f"  ✓ Seeded {len(roles)} roles")

        # ─── Departments ────────────────────────────────────
        if db.query(Department).count() == 0:
            depts = [
                Department(code="asset_services", label="Asset Services", sort_order=1),
                Department(code="engineering", label="Engineering", sort_order=2),
                Department(code="planning", label="Planning & Development", sort_order=3),
                Department(code="parks", label="Parks & Environment", sort_order=4),
                Department(code="compliance", label="Compliance", sort_order=5),
                Department(code="customer_service", label="Customer Service", sort_order=6),
            ]
            db.add_all(depts)
            db.commit()
            print(f"  ✓ Seeded {len(depts)} departments")

        # ─── Users ───────────────────────────────────────────
        if db.query(User).count() == 0:
            users = [
                User(name="System Administrator", email="superadmin@council.wa.gov.au", initials="SA",
                     hashed_password=hash_password("superpassword123"), role="superadmin", department="IT"),
                User(name="Admin User", email="admin@council.wa.gov.au", initials="AU",
                     hashed_password=hash_password("admin123"), role="admin", department="Asset Services"),
                User(name="Manager User", email="manager@council.wa.gov.au", initials="MU",
                     hashed_password=hash_password("manager123"), role="manager", department="Engineering"),
                User(name="Engineer User", email="engineer@council.wa.gov.au", initials="EU",
                     hashed_password=hash_password("engineer123"), role="engineer", department="Engineering"),
                User(name="Engineer Two", email="engineer2@council.wa.gov.au", initials="E2",
                     hashed_password=hash_password("engineer123"), role="engineer", department="Engineering"),
                User(name="Viewer User", email="viewer@council.wa.gov.au", initials="VU",
                     hashed_password=hash_password("viewer123"), role="viewer", department="Planning"),
            ]
            db.add_all(users)
            db.commit()
            print(f"✅ Created {len(users)} users")
        else:
            print(f"⏭️  Users already exist ({db.query(User).count()})")

        # Fetch user IDs for assignment
        engineer_user = db.query(User).filter(User.email == "engineer@council.wa.gov.au").first()
        engineer2_user = db.query(User).filter(User.email == "engineer2@council.wa.gov.au").first()

        # ─── Assessment Master Data ──────────────────────────
        if db.query(AssessmentCategory).count() == 0:
            MASTER = [
                ("pathway", "Application Pathway", "🔀", [
                    ("da_pathway", "DA includes crossover design — no separate application needed", "R-014"),
                    ("standalone_required", "Standalone crossover application required", "R-015"),
                    ("bonding_eligibility", "Bonding: permitted for DA only, not subdivision/standalone", "R-032"),
                    ("subdivision_clearance", "Subdivision crossover — must complete before clearance", "R-031"),
                ]),
                ("ownership", "Ownership & Application", "👤", [
                    ("owner_verified", "Lot owner verified on Certificate of Title", "§2.1"),
                    ("contact_details", "Valid contact details (phone, email, postal)", "§2.1"),
                    ("application_complete", "Application form complete — no missing fields", "§2.2"),
                    ("fee_paid", "Application fee received", "LGA Sch 9.1"),
                    ("declaration_signed", "Owner declaration signed and dated", "§2.3"),
                ]),
                ("property", "Property & Lot", "📍", [
                    ("lot_identified", "Lot/Plan number matches Landgate records", "§3.1"),
                    ("zoning_confirmed", "Zoning permits crossover use", "TPS3"),
                    ("frontage_measured", "Lot frontage correctly stated and verified", "§3.2"),
                    ("existing_crossover", "Existing crossover status confirmed", "§3.3"),
                    ("battleaxe_check", "Battleaxe/rear lot access checked (if applicable)", "§3.4"),
                ]),
                ("dimensions", "Width & Dimensions", "📏", [
                    ("min_width", "Crossover width ≥ 3.0m at property boundary", "R-083"),
                    ("max_width", "Width within max limit for frontage", "R-084,R-086"),
                    ("road_edge_width", "Road edge widening ≤ 6.0m (wings/splay)", "R-083"),
                    ("alignment_90deg", "Crossover aligned at 90° to road centreline", "R-081"),
                    ("dual_crossover", "Second crossover only if frontage > 20m", "R-100"),
                    ("separation_dist", "Dual crossover separation adequate", "R-100"),
                    ("intersection_tangent", "Min 6.0m from intersection tangent point", "R-100"),
                    ("setback_boundary", "Offset from side boundary ≥ 0.5m", "§4.4"),
                    ("footpath_flush", "Footpath priority — flush join, delineation", "R-110,R-111"),
                ]),
                ("construction", "Construction & Materials", "🔨", [
                    ("construction_std_type", "Construction standard: Type [1] urban sealed or Type [2] rural", "R-030"),
                    ("base_course", "Base course 150mm min, compacted 95% MDD", "R-121,R-122"),
                    ("surface_material", "Surface material compliant (concrete/asphalt/paver)", "R-120"),
                    ("concrete_joints", "Concrete jointing 1.8–2.0m, min 2 expansion joints", "R-126"),
                    ("commercial_spec", "Commercial spec if commercial lot (150mm + F62)", "§5.4"),
                    ("grade_alignment", "Crossover grade matches verge/road levels", "§5.5"),
                    ("kerb_transition", "Kerb transition/cut appropriate — mountable preferred", "R-140,R-141"),
                    ("site_cleanliness", "Site left clean after construction", "R-150"),
                ]),
                ("vegetation", "Vegetation & Trees", "🌳", [
                    ("tree_clearance", "Min 3m clearance from all verge trees", "§6.1"),
                    ("tree_protection", "Tree protection plan per AS 4970", "§6.2"),
                    ("no_clearing", "No unauthorised vegetation clearing", "§6.3"),
                    ("dwer_permit", "DWER clearing permit (if clearing required)", "EP Act"),
                    ("arborist_report", "Arborist report (if trees within 3m)", "§6.4"),
                ]),
                ("drainage", "Drainage & Stormwater", "💧", [
                    ("drainage_type", "Drainage type appropriate", "§7.1"),
                    ("detention_ari", "Detention to 100-yr ARI (if applicable)", "§7.2"),
                    ("culvert_design", "Culvert/pipe design adequate", "§7.3"),
                    ("no_ponding", "No water ponding on road/verge/neighbour", "§7.4"),
                    ("stormwater_plan", "Stormwater plan provided (if needed)", "§7.5"),
                ]),
                ("sight_safety", "Sight Lines & Safety", "👁️", [
                    ("sight_triangle", "Sight triangle clear (AS 2890.1, 0.65–1.5m zone)", "AS 2890.1"),
                    ("sight_unobstructed", "Unobstructed sightlines for pedestrians and traffic", "R-082"),
                    ("intersection_dist", "Min distance from nearest intersection", "R-100"),
                    ("pedestrian_safety", "Pedestrian path continuity maintained", "R-110"),
                    ("vehicle_turning", "Vehicle turning path — no encroachment", "AS 2890.1"),
                    ("driveway_grade", "Driveway gradient within limits (max 1:4)", "AS 2890.1"),
                    ("corner_lot_sight", "Corner lot extended sight triangle requirements", "AS 2890.1 §3.2.4"),
                ]),
                ("road_referral", "Road & Referrals", "🛣️", [
                    ("road_class", "Road classification confirmed", "§9.1"),
                    ("mrwa_referral", "MRWA referral completed (if red road)", "§9.2"),
                    ("dplh_referral", "DPLH referral completed (if blue road)", "§9.3"),
                    ("rav_clearance", "RAV clearance (if applicable)", "§9.4"),
                    ("speed_zone", "Speed zone considered for sight distance", "§9.5"),
                ]),
                ("services", "Underground Services", "⚡", [
                    ("dbyd_completed", "Dial Before You Dig search completed", "§10.1"),
                    ("power_clear", "Power/electrical — no conflict", "§10.2"),
                    ("water_clear", "Water mains — no conflict", "§10.3"),
                    ("gas_clear", "Gas pipeline — no conflict", "§10.4"),
                    ("telco_clear", "Telco/NBN conduit — no conflict", "§10.5"),
                ]),
                ("documents_cat", "Documentation", "📎", [
                    ("site_plan", "Scaled site plan with dimensions", "§11.1"),
                    ("cert_title", "Certificate of Title attached", "§11.2"),
                    ("photos_provided", "Site photographs provided", "§11.3"),
                    ("da_attached", "Development Approval (if DA-linked)", "§11.4"),
                    ("engineering_dwg", "Engineering drawing (if non-standard)", "§11.5"),
                ]),
                ("contribution", "Financial & Contribution", "💰", [
                    ("first_crossover", "First crossover to lot (contribution eligible)", "R-163"),
                    ("contribution_calc", "Contribution: lesser of ½ cost or $474", "R-163"),
                    ("contribution_deadline", "Claim within 6 months of completion", "R-160"),
                    ("not_da_linked", "Not DA-linked (DA crossovers ineligible)", "R-166"),
                    ("not_subdivision", "Not subdivision-linked (ineligible)", "R-166"),
                    ("receipts_info", "Receipts/invoices required for claim", "R-160"),
                    ("compliance_enforcement", "Post-1 Jan 2018 compliance enforcement applies", "R-170"),
                ]),
            ]

            item_count = 0
            for cat_order, (code, label, icon, items) in enumerate(MASTER):
                cat = AssessmentCategory(code=code, label=label, icon=icon, sort_order=cat_order)
                db.add(cat)
                db.flush()  # get cat.id
                for item_order, (icode, ilabel, iref) in enumerate(items):
                    db.add(AssessmentItem(
                        category_id=cat.id, code=icode, label=ilabel,
                        reference=iref, sort_order=item_order,
                    ))
                    item_count += 1
            db.commit()
            print(f"✅ Created {len(MASTER)} assessment categories, {item_count} items")
        else:
            print(f"⏭️  Assessment master data already exists ({db.query(AssessmentCategory).count()} categories, {db.query(AssessmentItem).count()} items)")

        # ─── Assessment Rules (database-driven) ──────────────
        if db.query(AssessmentRule).count() == 0:
            # Helper to look up item id by code
            item_map = {i.code: i.id for i in db.query(AssessmentItem).all()}

            def R(code, priority, source, field, operator, value, result, confidence, reason):
                """Shorthand to create a simple rule."""
                iid = item_map.get(code)
                if not iid:
                    return
                db.add(AssessmentRule(
                    item_id=iid, priority=priority, source=source, field=field,
                    operator=operator, value=value, result=result,
                    confidence=confidence, reason_template=reason,
                ))

            def RC(code, priority, logic, checks, result, confidence, reason):
                """Shorthand to create a compound rule with AND/OR logic.
                checks = [("source", "field", "operator", "value"), ...]
                """
                iid = item_map.get(code)
                if not iid:
                    return
                conditions = {
                    "logic": logic,
                    "checks": [
                        {"source": c[0], "field": c[1], "operator": c[2], "value": c[3] if len(c) > 3 else None}
                        for c in checks
                    ]
                }
                db.add(AssessmentRule(
                    item_id=iid, priority=priority, source="compound", field="compound",
                    operator="compound", value=None, conditions=conditions,
                    result=result, confidence=confidence, reason_template=reason,
                ))

            # ── Ownership & Application ──
            R("owner_verified",      0, "app", "owner_name",       "exists", None,  "pass",   0.9,  "Owner name present on application")
            R("owner_verified",      9, "app", "owner_name",       "not_exists", None, "fail", 0.9,  "Owner name missing")
            R("contact_details",     0, "app", "owner_phone",      "exists", None,  "pass",   0.5,  "Phone provided")
            R("contact_details",     1, "app", "owner_email",      "exists", None,  "pass",   0.95, "Phone and email provided")
            R("contact_details",     9, "app", "owner_phone",      "not_exists", None, "review", 0.6, "Contact details incomplete")
            R("application_complete",0, "app", "owner_name",       "exists", None,  "pass",   0.3,  "Checking required fields...")
            R("application_complete",1, "app", "property_address", "exists", None,  "pass",   0.3,  "Property address provided")
            R("application_complete",2, "app", "crossover_width",  "exists", None,  "pass",   0.85, "All key fields populated — owner, address, crossover width")
            R("application_complete",3, "app", "crossover_width",  "not_exists", None, "fail", 0.9,  "Missing crossover width")
            R("application_complete",9, "app", "owner_name",       "not_exists", None, "fail", 0.95, "Owner name missing")
            R("fee_paid",            0, "app", "owner_name",       "exists", None,  "review", 0.5,  "Fee payment to be confirmed offline")
            R("declaration_signed",  0, "app", "declaration_signed", "true", None,  "pass",   0.95, "Owner declaration signed")
            R("declaration_signed",  1, "app", "date_signed",      "exists", None,  "pass",   0.8,  "Date signed present — signature likely")
            R("declaration_signed",  9, "app", "declaration_signed", "false", None,  "review", 0.7,  "Declaration signature not confirmed")

            # ── Property & Lot ──
            R("lot_identified",      0, "app", "lot_number",       "exists", None,  "pass",   0.9,  "Lot {field_value} present")
            R("lot_identified",      9, "app", "lot_number",       "not_exists", None, "review", 0.6, "Lot number not provided")
            R("zoning_confirmed",    0, "app", "lot_type",         "exists", None,  "review", 0.5,  "Zoning to be confirmed against TPS3")
            R("frontage_measured",   0, "app", "frontage",         "gt", "0",       "pass",   0.85, "Frontage stated as {field_value}m")
            R("frontage_measured",   5, "sp",  "siteplan_measurements.lot_frontage_m", "gt", "0", "pass", 0.95, "Frontage {field_value}m confirmed from site plan")
            R("frontage_measured",   9, "app", "frontage",         "not_exists", None, "fail", 0.9,  "Frontage not provided")
            R("existing_crossover",  0, "app", "owner_name",       "exists", None,  "review", 0.5,  "Existing crossover status to be verified on-site")
            R("existing_crossover",  5, "sp",  "siteplan_measurements.existing_driveway_width_m", "exists", None, "pass", 0.8, "Existing driveway {field_value}m identified on site plan")
            R("battleaxe_check",     0, "app", "frontage",         "gte", "10",     "pass",   0.8,  "Standard lot — frontage {field_value}m, not battleaxe")
            R("battleaxe_check",     5, "sp",  "siteplan_measurements.lot_frontage_m", "gte", "10", "pass", 0.85, "Site plan frontage {field_value}m — not battleaxe")
            R("battleaxe_check",     9, "app", "frontage",         "lt",  "10",     "review", 0.6,  "Narrow frontage {field_value}m — check for battleaxe")

            # ── Width & Dimensions ──
            R("min_width",           0, "app", "crossover_width",  "gte", "3.0",    "pass",   0.95, "Width {field_value}m ≥ 3.0m minimum")
            R("min_width",           1, "app", "crossover_width",  "lt",  "3.0",    "fail",   0.95, "Width {field_value}m < 3.0m minimum")
            # Compound: app and sp both confirm width ≥ 3.0m → highest confidence
            RC("min_width",          3, "and", [
                ("app", "crossover_width", "gte", "3.0"),
                ("sp", "crossover_dimensions.width_at_boundary_m", "gte", "3.0"),
            ], "pass", 0.99, "Width confirmed ≥ 3.0m by both application ({app.crossover_width}) and site plan ({sp.crossover_dimensions.width_at_boundary_m})")
            # Compound: app and sp disagree on width → review
            RC("min_width",          4, "and", [
                ("app", "crossover_width", "gte", "3.0"),
                ("sp", "crossover_dimensions.width_at_boundary_m", "lt", "3.0"),
            ], "review", 0.9, "Width conflict: application says {app.crossover_width}m but site plan shows {sp.crossover_dimensions.width_at_boundary_m}m — verify on-site")
            R("min_width",           5, "sp",  "crossover_dimensions.width_at_boundary_m", "gte", "3.0", "pass", 0.98, "Width {field_value}m ≥ 3.0m — confirmed from site plan")
            R("min_width",           6, "sp",  "crossover_dimensions.width_at_boundary_m", "lt",  "3.0", "fail", 0.98, "Width {field_value}m < 3.0m — from site plan")
            R("min_width",           9, "app", "crossover_width",  "not_exists", None, "review", 0.5, "Crossover width not provided")
            R("max_width",           0, "app", "crossover_width",  "lte", "6.0",    "pass",   0.95, "Width {field_value}m within max limit")
            R("max_width",           1, "app", "crossover_width",  "gt",  "6.0",    "fail",   0.95, "Width {field_value}m exceeds 6.0m maximum")
            R("max_width",           9, "app", "crossover_width",  "not_exists", None, "review", 0.5, "Width data not available")
            R("road_edge_width",     0, "app", "crossover_width",  "lte", "6.0",    "pass",   0.8,  "Road edge widening ≤ 6.0m")
            R("road_edge_width",     5, "sp",  "crossover_dimensions.total_width_at_road_m", "lte", "6.0", "pass", 0.95, "Total width at road {field_value}m ≤ 6.0m — site plan confirmed")
            R("road_edge_width",     6, "sp",  "crossover_dimensions.total_width_at_road_m", "gt",  "6.0", "fail", 0.95, "Total width at road {field_value}m > 6.0m — exceeds limit")
            R("road_edge_width",     9, "app", "crossover_width",  "gt",  "6.0",    "review", 0.7,  "Width may exceed road edge limit")
            R("dual_crossover",      0, "app", "crossover_count",  "lte", "1",      "pass",   0.9,  "Single crossover")
            R("dual_crossover",      1, "app", "frontage",         "gt",  "20",     "pass",   0.95, "Dual crossover: frontage {field_value}m > 20m")
            R("dual_crossover",      5, "sp",  "siteplan_measurements.lot_frontage_m", "gt", "20", "pass", 0.9, "Dual crossover: site plan frontage {field_value}m > 20m")
            R("dual_crossover",      6, "sp",  "siteplan_measurements.lot_frontage_m", "lte", "20", "fail", 0.9, "Dual crossover not permitted — site plan frontage ≤ 20m")
            R("dual_crossover",      9, "app", "frontage",         "lte", "20",     "fail",   0.95, "Dual crossover not permitted — frontage ≤ 20m")
            R("separation_dist",     0, "app", "crossover_count",  "lte", "1",      "pass",   0.9,  "N/A — single crossover")
            R("separation_dist",     5, "sp",  "siteplan_measurements.existing_driveway_width_m", "exists", None, "review", 0.6, "Existing driveway shown — separation distance to be verified")
            R("separation_dist",     9, "app", "crossover_count",  "gt",  "1",      "review", 0.5,  "Dual separation to be verified")
            R("setback_boundary",    0, "app", "offset_from_left", "gte", "0.5",    "pass",   0.8,  "Left boundary offset {field_value}m ≥ 0.5m — from application")
            R("setback_boundary",    1, "app", "offset_from_left", "lt",  "0.5",    "fail",   0.8,  "Left boundary offset {field_value}m < 0.5m — too close")
            # Compound: both boundary distances from site plan ≥ 0.5m → pass
            RC("setback_boundary",   3, "and", [
                ("sp", "crossover_dimensions.distance_to_left_boundary_m", "gte", "0.5"),
                ("sp", "crossover_dimensions.distance_to_right_boundary_m", "gte", "0.5"),
            ], "pass", 0.98, "Both boundaries clear: left {sp.crossover_dimensions.distance_to_left_boundary_m}m, right {sp.crossover_dimensions.distance_to_right_boundary_m}m — both ≥ 0.5m")
            # Compound: either boundary < 0.5m → fail
            RC("setback_boundary",   4, "or", [
                ("sp", "crossover_dimensions.distance_to_left_boundary_m", "lt", "0.5"),
                ("sp", "crossover_dimensions.distance_to_right_boundary_m", "lt", "0.5"),
            ], "fail", 0.95, "Boundary too close: left {sp.crossover_dimensions.distance_to_left_boundary_m}m, right {sp.crossover_dimensions.distance_to_right_boundary_m}m — minimum 0.5m required")
            R("setback_boundary",    9, "app", "owner_name",       "exists", None,  "review", 0.5,  "Boundary setback ≥ 0.5m to be confirmed on-site")

            # ── Construction & Materials ──
            R("base_course",         0, "app", "crossover_surface","exists", None,   "review", 0.5,  "Surface specified as {field_value} — base course to be confirmed")
            R("base_course",         5, "sp",  "construction.base_course_specified", "true", None, "pass", 0.9, "Base course specified on site plan")
            R("base_course",         9, "app", "owner_name",       "exists", None,  "review", 0.5,  "Base course spec to be verified at inspection")
            R("surface_material",    0, "app", "crossover_surface","exists", None,   "pass",   0.8,  "Surface: {field_value}")
            R("surface_material",    5, "sp",  "construction.material", "exists", None, "pass", 0.95, "Material: {field_value} — from site plan")
            R("surface_material",    9, "app", "crossover_surface","not_exists", None,"review", 0.5,  "Surface material not specified")
            R("concrete_joints",     0, "app", "crossover_surface","eq", "Concrete", "review", 0.6, "Concrete surface — expansion joints to be verified")
            R("concrete_joints",     5, "sp",  "construction.expansion_joints", "true", None, "pass", 0.9, "Expansion joints confirmed on site plan")
            R("concrete_joints",     6, "sp",  "construction.expansion_joints", "false", None, "fail", 0.85, "No expansion joints shown on site plan")
            R("concrete_joints",     7, "sp",  "construction.material", "neq", "Concrete", "pass", 0.8, "Non-concrete surface — expansion joints N/A")
            R("concrete_joints",     9, "app", "owner_name",       "exists", None,  "review", 0.5,  "Jointing to be verified at inspection")
            R("commercial_spec",     0, "app", "lot_type",         "eq",  "commercial", "review", 0.7, "Commercial lot — spec to be verified")
            R("commercial_spec",     9, "app", "lot_type",         "neq", "commercial", "pass",  0.8, "Residential lot — standard spec applies")
            R("grade_alignment",     0, "app", "owner_name",       "exists", None,  "review", 0.5,  "Grade alignment to be checked on-site")
            R("grade_alignment",     5, "sp",  "construction.kerb_type", "exists", None, "pass", 0.7, "Kerb type {field_value} specified — grade alignment to be confirmed")
            R("kerb_transition",     0, "app", "owner_name",       "exists", None,  "review", 0.5,  "Kerb transition type to be confirmed on-site")
            R("kerb_transition",     5, "sp",  "construction.kerb_type", "eq", "Mountable", "pass", 0.9, "Mountable kerb — standard transition")
            R("kerb_transition",     6, "sp",  "construction.kerb_type", "eq", "Semi-mountable", "pass", 0.85, "Semi-mountable kerb — appropriate transition")
            R("kerb_transition",     7, "sp",  "construction.kerb_type", "eq", "Barrier", "review", 0.8, "Barrier kerb — kerb cut required, check details")

            # ── Vegetation & Trees ──
            R("tree_clearance",      0, "app", "trees_nearby",     "false", None,   "pass",   0.9,  "No trees nearby")
            R("tree_clearance",      1, "app", "trees_nearby",     "true",  None,   "review", 0.6,  "Trees nearby — clearance to be verified")
            R("tree_clearance",      5, "sp",  "additional_findings.vegetation_on_verge", "false", None, "pass", 0.9, "No vegetation on verge per site plan")
            R("tree_clearance",      6, "sp",  "additional_findings.vegetation_on_verge", "true",  None, "review", 0.7, "Vegetation on verge — clearance to be verified")
            R("tree_protection",     0, "app", "trees_nearby",     "false", None,   "pass",   0.9,  "No tree protection needed")
            R("tree_protection",     1, "app", "trees_nearby",     "true",  None,   "review", 0.6,  "Tree protection plan may be required")
            R("tree_protection",     5, "sp",  "additional_findings.vegetation_on_verge", "false", None, "pass", 0.9, "No vegetation impact per site plan")
            R("no_clearing",         0, "app", "clearing",         "true",  None,   "fail",   0.95, "Clearing flagged — DWER permit required")
            R("no_clearing",         9, "app", "clearing",         "false", None,   "pass",   0.9,  "No clearing proposed")
            R("dwer_permit",         0, "app", "clearing",         "true",  None,   "fail",   0.9,  "DWER permit needed for clearing")
            R("dwer_permit",         9, "app", "clearing",         "false", None,   "pass",   0.9,  "No clearing — DWER not required")
            R("arborist_report",     0, "app", "trees_nearby",     "false", None,   "pass",   0.9,  "No arborist report needed")
            R("arborist_report",     1, "app", "trees_nearby",     "true",  None,   "review", 0.6,  "Arborist report may be required for nearby trees")
            R("arborist_report",     5, "sp",  "additional_findings.vegetation_on_verge", "true", None, "review", 0.7, "Vegetation on verge — arborist report may be needed")

            # ── Drainage & Stormwater ──
            R("drainage_type",       0, "app", "drainage_type",    "exists", None,  "pass",   0.75, "Drainage: {field_value}")
            R("drainage_type",       5, "sp",  "drainage.drainage_plan_included", "true", None, "pass", 0.9, "Drainage plan included on site plan")
            R("drainage_type",       9, "app", "drainage_type",    "not_exists", None, "review", 0.5, "Drainage type not specified")
            R("detention_ari",       0, "app", "owner_name",       "exists", None,  "review", 0.5,  "Detention design to be verified if applicable")
            R("detention_ari",       5, "sp",  "drainage.soakwells_proposed", "true", None, "pass", 0.85, "Soakwells shown on site plan")
            R("detention_ari",       6, "sp",  "drainage.storage_tanks_proposed", "true", None, "pass", 0.85, "Storage tanks shown on site plan")
            R("culvert_design",      0, "app", "culvert",          "false", None,   "pass",   0.85, "No culvert required")
            R("culvert_design",      1, "app", "culvert",          "true",  None,   "review", 0.6,  "Culvert design to be verified")
            R("culvert_design",      5, "sp",  "drainage.pipe_diameter_mm", "exists", None, "pass", 0.9, "Culvert pipe {field_value}mm specified on site plan")
            R("no_ponding",          0, "app", "owner_name",       "exists", None,  "review", 0.5,  "Ponding assessment to be done on-site")
            R("no_ponding",          5, "sp",  "drainage.drainage_plan_included", "true", None, "pass", 0.8, "Drainage plan addresses stormwater management")
            R("stormwater_plan",     0, "app", "owner_name",       "exists", None,  "review", 0.5,  "Stormwater plan to be reviewed if provided")
            R("stormwater_plan",     5, "sp",  "drainage.drainage_plan_included", "true", None, "pass", 0.9, "Stormwater plan included in site plan")

            # ── Sight Lines & Safety ──
            R("sight_triangle",      0, "app", "owner_name",       "exists", None,  "review", 0.5,  "Sight triangle to be verified via 3D analysis tool")
            R("sight_triangle",      5, "sp",  "property.is_corner_lot", "true", None, "review", 0.85, "Corner lot — extended sight triangle requirements apply")
            R("sight_triangle",      6, "sp",  "crossover_dimensions.verge_depth_m", "gte", "2.0", "pass", 0.7, "Verge depth {field_value}m — adequate for sight triangle")
            R("sight_triangle",      7, "sp",  "crossover_dimensions.verge_depth_m", "lt", "2.0", "review", 0.8, "Verge depth {field_value}m — shallow, sight triangle needs verification")
            R("intersection_dist",   0, "app", "owner_name",       "exists", None,  "review", 0.5,  "Intersection distance to be measured on map")
            R("intersection_dist",   5, "sp",  "crossover_dimensions.distance_to_nearest_lot_corner_m", "gte", "6.0", "pass", 0.8, "Driveway {field_value}m from nearest corner — adequate clearance")
            R("intersection_dist",   6, "sp",  "crossover_dimensions.distance_to_nearest_lot_corner_m", "lt", "6.0", "review", 0.8, "Driveway only {field_value}m from nearest corner — intersection proximity check needed")
            R("pedestrian_safety",   0, "app", "owner_name",       "exists", None,  "review", 0.5,  "Pedestrian path continuity to be confirmed on-site")
            R("pedestrian_safety",   5, "sp",  "construction.footpath_exists", "true", None, "pass", 0.8, "Footpath identified on site plan — pedestrian path maintained")
            R("pedestrian_safety",   6, "sp",  "construction.footpath_exists", "false", None, "review", 0.7, "No footpath shown — pedestrian continuity to be confirmed")
            R("vehicle_turning",     0, "app", "crossover_width",  "gte", "3.0",    "pass",   0.7,  "Width {field_value}m — adequate for vehicle turning")
            R("vehicle_turning",     1, "app", "crossover_width",  "lt",  "3.0",    "fail",   0.8,  "Width {field_value}m — may cause vehicle encroachment")
            R("vehicle_turning",     5, "sp",  "crossover_dimensions.width_at_boundary_m", "gte", "3.0", "pass", 0.8, "Site plan width {field_value}m — adequate for turning")
            R("vehicle_turning",     9, "app", "owner_name",       "exists", None,  "review", 0.5,  "Vehicle turning path to be checked")
            R("driveway_grade",      0, "app", "owner_name",       "exists", None,  "review", 0.5,  "Driveway grade to be measured on-site")
            R("driveway_grade",      5, "sp",  "crossover_dimensions.verge_depth_m", "exists", None, "review", 0.6, "Verge depth {field_value}m — gradient to be confirmed ≤ 1:4")

            # ── Road & Referrals ──
            R("road_class",          0, "app", "road_type",        "exists", None,  "pass",   0.85, "Road type: {field_value}")
            R("road_class",          5, "sp",  "siteplan_measurements.road_name", "exists", None, "pass", 0.8, "Road: {field_value} — identified from site plan")
            R("road_class",          9, "app", "road_type",        "not_exists", None, "review", 0.5, "Road classification not set")
            R("mrwa_referral",       0, "app", "road_type",        "eq",  "red",    "fail",   0.9,  "MRWA referral required for red road")
            R("mrwa_referral",       9, "app", "road_type",        "neq", "red",    "pass",   0.9,  "Not a red road — MRWA not required")
            R("dplh_referral",       0, "app", "road_type",        "eq",  "blue",   "fail",   0.9,  "DPLH referral required for blue road")
            R("dplh_referral",       9, "app", "road_type",        "neq", "blue",   "pass",   0.9,  "Not a blue road — DPLH not required")
            R("rav_clearance",       0, "app", "owner_name",       "exists", None,  "review", 0.5,  "RAV clearance to be checked if applicable")
            R("speed_zone",          0, "app", "road_width",       "gte", "7.0",    "review", 0.6,  "Road width {field_value}m — likely higher speed zone, verify")
            R("speed_zone",          5, "sp",  "siteplan_measurements.road_name", "exists", None, "review", 0.7, "Road {field_value} — speed zone to be confirmed from speed road data")
            R("speed_zone",          9, "app", "owner_name",       "exists", None,  "review", 0.5,  "Speed zone to be confirmed")

            # ── Underground Services ──
            R("dbyd_completed",      0, "doc", "Dial Before You Dig", "exists", None, "pass", 0.95, "DBYD report uploaded")
            R("dbyd_completed",      1, "doc", "Other Documents",   "exists", None, "pass",   0.6,  "Supporting documents uploaded — may include DBYD")
            R("dbyd_completed",      9, "app", "owner_name",       "exists", None,  "review", 0.5,  "DBYD search to be confirmed")
            R("power_clear",         0, "app", "owner_name",       "exists", None,  "review", 0.5,  "Power clearance to be verified on-site or via DBYD")
            R("power_clear",         5, "sp",  "utilities.power_conflict", "false", None, "pass", 0.9, "No power conflicts detected on site plan")
            R("power_clear",         6, "sp",  "utilities.power_conflict", "true", None, "fail", 0.9, "Power line/pole conflicts with crossover — {field_value}")
            R("power_clear",         7, "sp",  "utilities.power_line_shown", "false", None, "pass", 0.7, "No power infrastructure shown on site plan")
            R("water_clear",         0, "app", "owner_name",       "exists", None,  "review", 0.5,  "Water main clearance to be verified")
            R("water_clear",         5, "sp",  "utilities.water_conflict", "false", None, "pass", 0.9, "No water main conflicts on site plan")
            R("water_clear",         6, "sp",  "utilities.water_conflict", "true", None, "fail", 0.9, "Water main/meter conflicts with crossover")
            R("water_clear",         7, "sp",  "utilities.water_main_shown", "false", None, "pass", 0.7, "No water main shown on site plan")
            R("gas_clear",           0, "app", "owner_name",       "exists", None,  "review", 0.5,  "Gas pipeline clearance to be verified")
            R("gas_clear",           5, "sp",  "utilities.gas_conflict", "false", None, "pass", 0.9, "No gas pipeline conflicts on site plan")
            R("gas_clear",           6, "sp",  "utilities.gas_conflict", "true", None, "fail", 0.9, "Gas pipeline conflicts with crossover")
            R("gas_clear",           7, "sp",  "utilities.gas_main_shown", "false", None, "pass", 0.7, "No gas main shown on site plan")
            R("telco_clear",         0, "app", "owner_name",       "exists", None,  "review", 0.5,  "Telco/NBN clearance to be verified")
            R("telco_clear",         5, "sp",  "utilities.telco_conflict", "false", None, "pass", 0.9, "No telco/NBN conflicts on site plan")
            R("telco_clear",         6, "sp",  "utilities.telco_conflict", "true", None, "fail", 0.9, "Telco/NBN conflicts with crossover")
            R("telco_clear",         7, "sp",  "utilities.telco_shown", "false", None, "pass", 0.7, "No telco infrastructure shown on site plan")

            # ── Documentation — check uploaded documents first ──
            # source="doc", field=document category label, operator="exists" checks if uploaded
            # operator="eq" with value="verified" checks if document has been verified
            R("site_plan",           0, "doc", "Site Plan",          "exists", None, "pass",   0.9,  "Site plan document uploaded")
            R("site_plan",           1, "sp",  "crossover_dimensions.width_at_boundary_m", "exists", None, "pass", 0.95, "Site plan analysed — dimensions extracted by AI")
            R("site_plan",           9, "app", "owner_name",       "exists", None,  "review", 0.6,  "Site plan not uploaded — to be confirmed")

            R("cert_title",          0, "doc", "Certificate of Title", "exists", None, "pass",  0.9,  "Certificate of Title uploaded")
            R("cert_title",          1, "app", "lot_number",       "exists", None,  "pass",   0.8,  "Certificate of Title referenced via lot number")
            R("cert_title",          9, "app", "lot_number",       "not_exists", None, "review", 0.6, "Certificate of Title not uploaded")

            R("photos_provided",     0, "doc", "Site Photos",       "exists", None, "pass",   0.9,  "Site photos uploaded")
            R("photos_provided",     9, "app", "owner_name",       "exists", None,  "review", 0.6,  "Site photos not uploaded")

            R("da_attached",         0, "doc", "Other Documents",   "exists", None, "pass",   0.8,  "Supporting document uploaded")
            R("da_attached",         1, "app", "da_number",        "exists", None,  "pass",   0.85, "DA {field_value} referenced")
            R("da_attached",         9, "app", "da_number",        "not_exists", None, "pass", 0.9,  "No DA required")

            R("engineering_dwg",     0, "doc", "Site Plan",          "exists", None, "pass",   0.85, "Engineering drawing available via site plan upload")
            R("engineering_dwg",     1, "sp",  "crossover_dimensions.width_at_boundary_m", "exists", None, "pass", 0.85, "Engineering details extracted from site plan")
            R("engineering_dwg",     9, "app", "owner_name",       "exists", None,  "review", 0.5,  "Engineering drawing to be checked if non-standard")

            # ── Financial & Contribution ──
            R("first_crossover",     0, "app", "contribution_eligible", "true", None, "pass", 0.8, "First crossover — eligible for contribution")
            R("first_crossover",     1, "app", "crossover_count",  "gt", "1",     "fail",   0.9,  "Not first crossover — second crossover not eligible for contribution (R-165)")
            R("first_crossover",     9, "app", "contribution_eligible", "false", None, "review", 0.6, "Contribution eligibility to be confirmed")
            R("contribution_calc",   0, "app", "contribution_amount", "gt", "0",    "pass",   0.85, "Contribution: ${field_value} (max $474 or 50% of cost, R-163)")
            R("contribution_calc",   9, "app", "contribution_amount", "not_exists", None, "review", 0.5, "Contribution amount to be calculated — lesser of ½ cost or $474")
            R("contribution_deadline", 0, "app", "completion_date", "exists", None, "review", 0.7, "Completion date {field_value} — claim must be within 6 months (R-160)")
            R("contribution_deadline", 9, "app", "completion_date", "not_exists", None, "review", 0.5, "Completion date not recorded — 6-month deadline applies from completion")
            R("not_da_linked",       0, "app", "da_number",        "exists", None,  "fail",   0.9,  "DA-linked crossover — NOT eligible for financial contribution (R-166)")
            R("not_da_linked",       9, "app", "da_number",        "not_exists", None, "pass", 0.85, "Not DA-linked — contribution may apply")
            R("not_subdivision",     0, "app", "application_type", "eq", "subdivision", "fail", 0.9, "Subdivision crossover — NOT eligible for contribution (R-166)")
            R("not_subdivision",     1, "app", "application_type", "neq", "subdivision", "pass", 0.85, "Not subdivision-linked")
            R("not_subdivision",     9, "app", "application_type", "not_exists", None, "review", 0.5, "Application type not set — check subdivision status")
            R("receipts_info",       0, "app", "owner_name",       "exists", None,  "review", 0.5,  "Receipts/invoices to be collected within 6 months of completion (R-160)")
            R("compliance_enforcement", 0, "app", "submitted_date", "exists", None, "pass", 0.9, "Post-1 Jan 2018 — subject to compliance enforcement (R-170)")

            # ── Application Pathway (NEW) ──
            R("da_pathway",          0, "doc", "Building Application", "not_exists", None, "pass", 0.9, "No Building Application — standalone crossover application (R-014)")
            R("da_pathway",          1, "doc", "Site Plan",           "exists", None,  "pass",   0.85, "Building Application and Site Plan both present — DA pathway confirmed (R-014)")
            R("da_pathway",          9, "doc", "Building Application", "exists", None, "review", 0.7, "Building Application uploaded but no Site Plan — site plan required for assessment (R-014)")
            R("standalone_required", 0, "app", "da_number",        "not_exists", None, "pass", 0.9, "Standalone crossover — application form + site plan required (R-001 to R-003)")
            R("standalone_required", 1, "app", "da_number",        "exists", None,  "pass",   0.8,  "DA-linked — standalone may not be required if DA covers crossover design (R-014)")
            R("standalone_required", 9, "app", "owner_name",       "exists", None,  "review", 0.5,  "Application pathway to be confirmed")
            R("bonding_eligibility", 0, "app", "application_type", "eq", "da",      "pass",   0.9,  "DA crossover — outstanding works CAN be bonded (R-032)")
            R("bonding_eligibility", 1, "app", "application_type", "eq", "subdivision", "fail", 0.95, "Subdivision — bonding NOT permitted, must complete before clearance (R-031)")
            R("bonding_eligibility", 2, "app", "application_type", "eq", "standalone", "fail", 0.9, "Standalone — bonding not applicable")
            R("bonding_eligibility", 9, "app", "application_type", "not_exists", None, "review", 0.5, "Application type not set — bonding eligibility unknown")
            R("subdivision_clearance", 0, "app", "application_type", "eq", "subdivision", "review", 0.9, "Subdivision crossover — must be completed BEFORE clearance issued (R-031)")
            R("subdivision_clearance", 1, "app", "application_type", "neq", "subdivision", "pass", 0.9, "Not subdivision — clearance rule N/A")
            R("subdivision_clearance", 9, "app", "application_type", "not_exists", None, "review", 0.5, "Application type not set — check if subdivision")

            # ── New Dimension Rules ──
            R("alignment_90deg",     0, "sp",  "crossover_dimensions.alignment_degrees", "gte", "85", "pass", 0.9, "Crossover alignment {field_value}° — within 90° tolerance (R-081)")
            R("alignment_90deg",     1, "sp",  "crossover_dimensions.alignment_degrees", "lt", "85", "fail", 0.9, "Crossover alignment {field_value}° — not at 90° to road (R-081)")
            R("alignment_90deg",     9, "app", "owner_name",       "exists", None,  "review", 0.5,  "Crossover alignment to road at 90° to be confirmed on-site (R-081)")
            R("intersection_tangent", 0, "sp",  "crossover_dimensions.distance_to_intersection_tangent_m", "gte", "6.0", "pass", 0.95, "Distance to intersection tangent {field_value}m ≥ 6.0m (R-100)")
            R("intersection_tangent", 1, "sp",  "crossover_dimensions.distance_to_intersection_tangent_m", "lt", "6.0", "fail", 0.95, "Distance to intersection tangent {field_value}m < 6.0m — too close (R-100)")
            R("intersection_tangent", 2, "sp",  "crossover_dimensions.distance_to_nearest_lot_corner_m", "gte", "6.0", "pass", 0.8, "Distance to nearest corner {field_value}m ≥ 6.0m — adequate")
            R("intersection_tangent", 9, "app", "owner_name",       "exists", None,  "review", 0.5,  "Distance from intersection tangent point to be measured (min 6.0m, R-100)")
            R("footpath_flush",      0, "sp",  "construction.footpath_exists", "true", None, "review", 0.8, "Footpath present — must meet flush with crossover (R-110). Concrete must delineate path by colour/jointing (R-111)")
            R("footpath_flush",      1, "sp",  "construction.footpath_exists", "false", None, "pass", 0.8, "No footpath present at crossover location")
            R("footpath_flush",      9, "app", "owner_name",       "exists", None,  "review", 0.5,  "Footpath status to be confirmed — if present, must be flush join (R-110)")

            # ── New Construction Rules ──
            R("construction_std_type", 0, "app", "lot_type", "contains", "Urban", "pass", 0.85, "Urban lot — Type [1] standard: fully sealed and drained (asphalt, concrete, or paver) (R-030)")
            R("construction_std_type", 1, "app", "lot_type", "contains", "Rural", "pass", 0.85, "Rural lot — Type [2] standard: trafficable and drained (asphalt, concrete, paver, or chip seal) (R-030)")
            R("construction_std_type", 2, "app", "lot_type", "contains", "Semi", "pass", 0.8, "Semi-rural lot — Type [2] standard applies (R-030)")
            R("construction_std_type", 9, "app", "owner_name",     "exists", None,  "review", 0.5,  "Construction standard type to be determined from lot classification (R-030)")
            R("site_cleanliness",    0, "app", "status",           "eq", "completed", "review", 0.7, "Construction complete — site cleanliness inspection required (R-150)")
            R("site_cleanliness",    9, "app", "owner_name",       "exists", None,  "pass",   0.5,  "Site cleanliness to be confirmed at final inspection (R-150)")

            # ── New Sight Safety Rules ──
            R("sight_unobstructed",  0, "sp",  "additional_findings.vegetation_on_verge", "true", None, "review", 0.8, "Vegetation on verge — sightlines may be obstructed (R-082)")
            R("sight_unobstructed",  1, "sp",  "additional_findings.vegetation_on_verge", "false", None, "pass", 0.85, "No verge vegetation — sightlines likely clear (R-082)")
            R("sight_unobstructed",  9, "app", "owner_name",       "exists", None,  "review", 0.5,  "Unobstructed sightlines for pedestrians and traffic to be verified (R-082)")
            R("corner_lot_sight",    0, "sp",  "property.is_corner_lot", "true",  None, "review", 0.9, "Corner lot — extended sight triangle per AS 2890.1 §3.2.4. Curve radius and sight distance calculation required")
            R("corner_lot_sight",    1, "sp",  "property.is_corner_lot", "false", None, "pass",   0.9, "Not corner lot — standard sight triangle applies")
            R("corner_lot_sight",    9, "app", "owner_name",       "exists", None,  "review", 0.5,  "Corner lot status to be confirmed — if corner, extended sight requirements apply")

            # ── Strengthened Battleaxe Rules ──
            R("battleaxe_check",     1, "sp",  "property.is_battleaxe", "true", None, "review", 0.85, "Battleaxe lot — single: min 3.0m driveway + 0.5m garden bed (R-087). Adjoining: combined 6.0m (R-088)")

            # ── Strengthened Dual Crossover (all 4 conditions from R-100) ──
            R("dual_crossover",      2, "sp",  "crossover_dimensions.distance_to_intersection_tangent_m", "lt", "6.0", "fail", 0.95, "Second crossover: < 6.0m from intersection tangent — REFUSED (R-100)")
            R("dual_crossover",      3, "sp",  "additional_findings.vegetation_on_verge", "true", None, "review", 0.8, "Second crossover: tree/vegetation impact must be assessed (R-100 condition 4)")

            # ── Construction specification checks (from unused extraction fields) ──
            R("base_course",         1, "sp",  "construction.base_course_depth_mm", "gte", "150", "pass", 0.95, "Base course depth {field_value}mm ≥ 150mm (R-122)")
            R("base_course",         2, "sp",  "construction.base_course_depth_mm", "lt",  "150", "fail", 0.95, "Base course depth {field_value}mm < 150mm minimum (R-122)")
            R("base_course",         3, "sp",  "construction.compaction_mdd_pct", "gte", "95", "pass", 0.9, "Compaction {field_value}% ≥ 95% MDD (R-121)")
            R("base_course",         4, "sp",  "construction.compaction_mdd_pct", "lt", "95", "fail", 0.9, "Compaction {field_value}% < 95% MDD (R-121)")

            # ── Concrete thickness ──
            R("surface_material",    2, "sp",  "construction.thickness_mm", "gte", "100", "pass", 0.9, "Surface thickness {field_value}mm ≥ 100mm (R-120)")
            R("surface_material",    3, "sp",  "construction.thickness_mm", "lt", "100", "fail", 0.9, "Surface thickness {field_value}mm < 100mm minimum (R-120)")

            # ── Garage backing distance (garage to kerb ≥ 6m for safe reversing) ──
            R("driveway_grade",      0, "sp",  "siteplan_measurements.garage_to_kerb_m", "gte", "6.0", "pass", 0.9, "Garage to kerb {field_value}m ≥ 6.0m — adequate reversing distance")
            R("driveway_grade",      1, "sp",  "siteplan_measurements.garage_to_kerb_m", "lt", "6.0", "review", 0.85, "Garage to kerb {field_value}m < 6.0m — tight reversing distance, check turning path")
            R("driveway_grade",      9, "app", "owner_name",       "exists", None,  "review", 0.5,  "Driveway gradient and garage backing distance to be confirmed on-site")

            # ── Underground services — utility conflict checks ──
            R("power_clear",         0, "sp",  "utilities.power_conflict", "false", None, "pass", 0.9, "No power/electrical conflict per site plan")
            R("power_clear",         1, "sp",  "utilities.power_conflict", "true",  None, "fail", 0.95, "Power/electrical conflict identified on site plan — relocation may be required")
            R("power_clear",         9, "app", "owner_name",       "exists", None,  "review", 0.5,  "Power/electrical service clearance to be verified via DBYD")
            R("water_clear",         0, "sp",  "utilities.water_conflict", "false", None, "pass", 0.9, "No water main conflict per site plan")
            R("water_clear",         1, "sp",  "utilities.water_conflict", "true",  None, "fail", 0.95, "Water main conflict — meter/main may need relocation")
            R("water_clear",         9, "app", "owner_name",       "exists", None,  "review", 0.5,  "Water service clearance to be verified via DBYD")
            R("gas_clear",           0, "sp",  "utilities.gas_conflict", "false", None, "pass", 0.9, "No gas pipeline conflict per site plan")
            R("gas_clear",           1, "sp",  "utilities.gas_conflict", "true",  None, "fail", 0.95, "Gas pipeline conflict — ATCO clearance required")
            R("gas_clear",           9, "app", "owner_name",       "exists", None,  "review", 0.5,  "Gas clearance to be verified via DBYD")
            R("telco_clear",         0, "sp",  "utilities.telco_conflict", "false", None, "pass", 0.9, "No telco/NBN conflict per site plan")
            R("telco_clear",         1, "sp",  "utilities.telco_conflict", "true",  None, "fail", 0.9, "Telco/NBN conduit conflict — NBN Co clearance required")
            R("telco_clear",         9, "app", "owner_name",       "exists", None,  "review", 0.5,  "Telco clearance to be verified via DBYD")

            # ── DBYD check ──
            R("dbyd_completed",      0, "sp",  "utilities.utility_summary", "exists", None, "review", 0.7, "Utilities shown on plan — DBYD search recommended: {field_value}")
            R("dbyd_completed",      9, "app", "owner_name",       "exists", None,  "review", 0.5,  "Dial Before You Dig search to be completed before excavation")

            # ── Sight triangle — fence obstruction checks ──
            R("sight_triangle",      0, "sp",  "additional_findings.sight_obstruction_notes", "exists", None, "review", 0.9, "Sight obstruction noted: {field_value}")
            R("sight_triangle",      9, "app", "owner_name",       "exists", None,  "review", 0.5,  "Sight triangle clearance to be verified — no objects 0.65m–1.5m height within triangle (AS 2890.1)")

            # ── Drainage plan ──
            R("drainage_type",       1, "sp",  "drainage.soakwells_proposed", "true", None, "pass", 0.8, "Soakwells proposed on site plan — drainage addressed")
            R("drainage_type",       2, "sp",  "drainage.connection_to_council_drain", "true", None, "review", 0.8, "Connection to council drain proposed — council approval needed")
            R("drainage_type",       9, "app", "owner_name",       "exists", None,  "review", 0.5,  "Drainage plan and stormwater management to be confirmed")

            # ── Verge depth / crossover length ──
            R("pedestrian_safety",   0, "sp",  "crossover_dimensions.verge_depth_m", "exists", None, "pass", 0.7, "Verge depth {field_value}m — footpath/pedestrian path can be maintained")
            R("pedestrian_safety",   9, "app", "owner_name",       "exists", None,  "review", 0.5,  "Pedestrian path continuity to be maintained across crossover (R-110)")

            # ── Number of crossovers ──
            R("separation_dist",     1, "sp",  "siteplan_measurements.number_of_crossovers", "lte", "1", "pass", 0.9, "Single crossover — separation N/A")
            R("separation_dist",     2, "sp",  "siteplan_measurements.number_of_crossovers", "gt", "1", "review", 0.8, "Multiple crossovers ({field_value}) — separation distance to be checked")

            db.commit()
            rule_count = db.query(AssessmentRule).count()
            print(f"✅ Created {rule_count} assessment rules")
        else:
            print(f"⏭️  Assessment rules already exist ({db.query(AssessmentRule).count()} rules)")

        # ─── Applications ────────────────────────────────────
        if db.query(Application).count() == 0:
            apps = [
                Application(
                    ref_number="CX-2026-0041", status="pending_review",
                    submitted_date=datetime(2026, 2, 10, tzinfo=timezone.utc),
                    owner_name="Sarah Mitchell", owner_phone="0412 345 678",
                    owner_email="sarah.m@email.com",
                    owner_postal_address="22 Canning Rd, Kalamunda WA 6076",
                    property_address="22 Canning Rd, Kalamunda WA 6076",
                    lot_number="Lot 156", plan_number="P034521",
                    lot_type="Residential Urban — Green Title",
                    frontage=18.5, depth=40, road_name="Canning Road", road_type="local",
                    road_width=7.2, verge_width=4.5,
                    crossover_width=4.5, crossover_count=1,
                    crossover_surface="Concrete (100mm, 32MPa)",
                    offset_from_left=6.0,
                    trees_nearby=True,
                    tree_protection="Two mature Jarrah trees at 4.2m and 5.1m.",
                    drainage_type="Soakwell",
                    trees_data=[{"species": "Jarrah", "x": 3.2, "y": 2.1, "canopy": 3.0},
                                {"species": "Jarrah", "x": 14.5, "y": 1.8, "canopy": 2.5}],
                    contribution_eligible=True, contribution_amount=474,
                ),
                Application(
                    ref_number="CX-2026-0040", status="under_assessment",
                    submitted_date=datetime(2026, 2, 8, tzinfo=timezone.utc),
                    owner_name="David & Emma Foster", owner_phone="0423 456 789",
                    owner_email="d.foster@outlook.com",
                    property_address="107 Welshpool Rd East, Wattle Grove WA 6107",
                    lot_number="Lot 89", plan_number="P028734",
                    lot_type="Residential Urban — Survey-Strata",
                    frontage=12.0, depth=35, road_name="Welshpool Rd East",
                    road_type="red", road_width=10.2, verge_width=3.8,
                    crossover_width=5.0, crossover_count=1,
                    crossover_surface="Asphalt (40mm AC10)",
                    da_number="DA2025/0892",
                    offset_from_left=3.5,
                    trees_nearby=False, drainage_type="Piped to road drainage",
                    officer_id=engineer_user.id if engineer_user else None,
                    contribution_eligible=False, contribution_amount=0,
                ),
                Application(
                    ref_number="CX-2026-0039", status="approved",
                    submitted_date=datetime(2026, 2, 5, tzinfo=timezone.utc),
                    owner_name="James Thornton", owner_phone="0434 567 890",
                    owner_email="j.thornton@email.com",
                    property_address="15 Gavour Rd, Wattle Grove WA 6107",
                    lot_number="Lot 42", plan_number="P019876",
                    lot_type="Residential Urban — Green Title",
                    frontage=20.0, depth=45, road_name="Gavour Road",
                    road_type="local", road_width=7.0, verge_width=4.2,
                    crossover_width=3.5, crossover_count=1,
                    crossover_surface="Brick Paving (60mm, herringbone)",
                    offset_from_left=8.0,
                    trees_nearby=True,
                    tree_protection="One Marri tree at 3.8m clearance.",
                    drainage_type="Soakwell + overflow to verge",
                    contribution_eligible=True, contribution_amount=474,
                ),
                Application(
                    ref_number="CX-2026-0037", status="referral_pending",
                    submitted_date=datetime(2026, 1, 28, tzinfo=timezone.utc),
                    owner_name="Linda Park", owner_phone="0445 678 901",
                    owner_email="l.park@email.com",
                    property_address="234 Kalamunda Rd, Maida Vale WA 6057",
                    lot_number="Lot 7", plan_number="P045632",
                    lot_type="Residential Urban — Green Title",
                    frontage=15.0, depth=38, road_name="Kalamunda Road",
                    road_type="red", road_width=11.0, verge_width=5.0,
                    crossover_width=5.0, crossover_count=1,
                    crossover_surface="Concrete (125mm, heavy duty)",
                    offset_from_left=5.0,
                    trees_nearby=False, drainage_type="Existing culvert",
                    referral_authority="MRWA",
                    contribution_eligible=True, contribution_amount=474,
                ),
                Application(
                    ref_number="CX-2026-0035", status="inspection_required",
                    submitted_date=datetime(2026, 1, 22, tzinfo=timezone.utc),
                    owner_name="Michael & Anne Briggs", owner_phone="0456 789 012",
                    owner_email="m.briggs@email.com",
                    property_address="8 Mundaring Weir Rd, Kalamunda WA 6076",
                    lot_number="Lot 201", plan_number="P012345",
                    lot_type="Rural Composite",
                    frontage=25.0, depth=60, road_name="Mundaring Weir Road",
                    road_type="blue", road_width=8.5, verge_width=6.0,
                    crossover_width=6.0, crossover_count=1,
                    crossover_surface="Gravel (150mm compacted rubble)",
                    offset_from_left=10.0,
                    trees_nearby=True,
                    tree_protection="Multiple Jarrah/Marri within 10m — arborist assessment required.",
                    clearing=True,
                    drainage_type="Earthen table drain",
                    officer_id=engineer2_user.id if engineer2_user else None,
                    contribution_eligible=False, contribution_amount=0,
                ),
                Application(
                    ref_number="CX-2026-0043", status="pending_review",
                    submitted_date=datetime(2026, 2, 18, tzinfo=timezone.utc),
                    owner_name="Andrew & Priya Nair", owner_phone="0467 890 123",
                    owner_email="a.nair@email.com",
                    property_address="10 Ruck St, Wattle Grove WA 6107",
                    lot_number="Lot 312", plan_number="P041290",
                    frontage=15.0, depth=36, road_name="Ruck Street",
                    road_type="local", road_width=7.0, verge_width=4.2,
                    crossover_width=4.5, crossover_count=1,
                    crossover_surface="Concrete (100mm, 32MPa)",
                    offset_from_left=5.0,
                    trees_nearby=True,
                    tree_protection="Marri tree at 3.8m clearance.",
                    drainage_type="Soakwell",
                    lot_polygon=[[-31.993881,115.988115],[-31.994003,115.988257],[-31.99406,115.988325],
                                 [-31.994169,115.988197],[-31.99399,115.987987],[-31.993881,115.988115]],
                    contribution_eligible=True, contribution_amount=474,
                ),
                Application(
                    ref_number="CX-2026-0044", status="under_assessment",
                    submitted_date=datetime(2026, 2, 20, tzinfo=timezone.utc),
                    owner_name="Robert & Karen Tan", owner_phone="0478 901 234",
                    owner_email="r.tan@email.com",
                    property_address="45 St John Rd, Wattle Grove WA 6107",
                    lot_number="Lot 78", plan_number="D023456",
                    frontage=20.5, depth=42, road_name="St John Road",
                    road_type="local", road_width=7.5, verge_width=5.0,
                    crossover_width=5.5, crossover_count=2,
                    crossover_surface="Brick Paving (60mm)",
                    da_number="DA2026/0145",
                    offset_from_left=2.5, offset2_from_left=14.0,
                    trees_nearby=True,
                    tree_protection="2x Jarrah trees at 3.2m clearance.",
                    drainage_type="Detention basin + culvert",
                    culvert=True,
                    lot_polygon=[[-31.995169,115.98427],[-31.995169,115.98436],[-31.995354,115.984577],
                                 [-31.995463,115.984449],[-31.995239,115.984187],[-31.995169,115.98427]],
                    officer_id=engineer_user.id if engineer_user else None,
                    contribution_eligible=False, contribution_amount=0,
                ),
            ]
            db.add_all(apps)
            db.commit()
            print(f"✅ Created {len(apps)} applications")

            # ─── Documents for each application ──────────────
            doc_templates = {
                "CX-2026-0041": [
                    ("Application Form", "pdf", "245 KB", "Application", "received"),
                    ("Certificate of Title - Lot 156", "pdf", "1.2 MB", "Title", "verified"),
                    ("Site Plan - 22 Canning Rd", "pdf", "3.8 MB", "Site Plan", "received"),
                    ("Crossover Photos - Front", "jpg", "2.1 MB", "Photos", "received"),
                    ("Owner Declaration", "pdf", "180 KB", "Declaration", "verified"),
                ],
                "CX-2026-0043": [
                    ("Application Form", "pdf", "248 KB", "Application", "received"),
                    ("Certificate of Title - Lot 312", "pdf", "1.2 MB", "Title", "verified"),
                    ("Site Plan - 10 Ruck St", "pdf", "4.5 MB", "Site Plan", "received"),
                    ("Arborist Report - Marri Tree", "pdf", "2.6 MB", "Arborist", "received"),
                    ("Photos - Verge & Trees", "jpg", "4.8 MB", "Photos", "received"),
                    ("Stormwater Management Plan", "pdf", "1.9 MB", "Engineering", "received"),
                    ("Owner Declaration", "pdf", "185 KB", "Declaration", "verified"),
                ],
                "CX-2026-0044": [
                    ("Application Form", "pdf", "255 KB", "Application", "received"),
                    ("Certificate of Title - Lot 78", "pdf", "1.4 MB", "Title", "verified"),
                    ("Scaled Site Plan - 45 St John Rd", "pdf", "5.8 MB", "Site Plan", "received"),
                    ("Arborist Report - 2x Jarrah", "pdf", "3.2 MB", "Arborist", "received"),
                    ("DA Approval DA2026/0145", "pdf", "920 KB", "DA Approval", "verified"),
                    ("Engineering Drawing - Culvert", "pdf", "4.1 MB", "Engineering", "received"),
                    ("Photos - Dual Crossover", "jpg", "5.2 MB", "Photos", "received"),
                    ("Owner Declaration", "pdf", "190 KB", "Declaration", "verified"),
                ],
            }
            doc_count = 0
            for app in apps:
                templates = doc_templates.get(app.ref_number, [
                    ("Application Form", "pdf", "240 KB", "Application", "received"),
                    ("Certificate of Title", "pdf", "1.1 MB", "Title", "verified"),
                    ("Site Plan", "pdf", "3.5 MB", "Site Plan", "received"),
                    ("Owner Declaration", "pdf", "175 KB", "Declaration", "verified"),
                ])
                for name, ftype, fsize, cat, st in templates:
                    db.add(Document(
                        application_id=app.id, name=name, file_type=ftype,
                        file_size=fsize, category=cat, status=st
                    ))
                    doc_count += 1
            db.commit()
            print(f"✅ Created {doc_count} documents")

            # ─── Notes for assigned applications ─────────────
            if engineer_user:
                note_app = db.query(Application).filter(Application.ref_number == "CX-2026-0044").first()
                if note_app:
                    db.add(ApplicationNote(application_id=note_app.id, author_id=engineer_user.id,
                                           text="Dual crossover permitted — frontage 20.5m > 20m threshold."))
                    db.add(ApplicationNote(application_id=note_app.id, author_id=engineer_user.id,
                                           text="Arborist report confirms 3.2m clearance to both Jarrah trees."))
                    db.commit()
                    print("✅ Created sample notes")
        else:
            print(f"⏭️  Applications already exist ({db.query(Application).count()})")

        print("\n🎉 Seed complete!")

    finally:
        db.close()


if __name__ == '__main__':
    run_seed()
