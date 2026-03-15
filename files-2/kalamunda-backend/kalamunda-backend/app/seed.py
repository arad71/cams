"""
Seed the database with initial users and sample applications.
Run: python -m app.seed
"""
from datetime import datetime, timezone
from app.core.database import SessionLocal, engine, Base
from app.core.auth import hash_password
from app.models.user import User
from app.models.application import Application, ApplicationNote, Document
from app.models.assessment import AssessmentCategory, AssessmentItem

# Ensure tables exist
Base.metadata.create_all(bind=engine)

db = SessionLocal()

try:
    # ─── Users ───────────────────────────────────────────
    if db.query(User).count() == 0:
        users = [
            User(name="M. Thompson", email="m.thompson@kalamunda.wa.gov.au", initials="MT",
                 hashed_password=hash_password("admin123"), role="admin", department="Asset Services"),
            User(name="K. Williams", email="k.williams@kalamunda.wa.gov.au", initials="KW",
                 hashed_password=hash_password("manager123"), role="manager", department="Engineering"),
            User(name="S. Patel", email="s.patel@kalamunda.wa.gov.au", initials="SP",
                 hashed_password=hash_password("engineer123"), role="engineer", department="Engineering"),
            User(name="J. Morrison", email="j.morrison@kalamunda.wa.gov.au", initials="JM",
                 hashed_password=hash_password("engineer123"), role="engineer", department="Engineering"),
            User(name="R. Singh", email="r.singh@kalamunda.wa.gov.au", initials="RS",
                 hashed_password=hash_password("manager123"), role="manager", department="Planning"),
        ]
        db.add_all(users)
        db.commit()
        print(f"✅ Created {len(users)} users")
    else:
        print(f"⏭️  Users already exist ({db.query(User).count()})")

    # Fetch user IDs for assignment
    spatel = db.query(User).filter(User.email == "s.patel@kalamunda.wa.gov.au").first()
    jmorrison = db.query(User).filter(User.email == "j.morrison@kalamunda.wa.gov.au").first()

    # ─── Assessment Master Data ──────────────────────────
    if db.query(AssessmentCategory).count() == 0:
        MASTER = [
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
                ("min_width", "Crossover width ≥ 3.0m at property boundary", "§4.1"),
                ("max_width", "Width within max limit for frontage", "§4.1"),
                ("road_edge_width", "Road edge widening ≤ 6.0m (wings/splay)", "§4.2"),
                ("dual_crossover", "Second crossover only if frontage > 20m", "§4.3"),
                ("separation_dist", "Dual crossover separation adequate", "§4.3"),
                ("setback_boundary", "Offset from side boundary ≥ 0.5m", "§4.4"),
            ]),
            ("construction", "Construction & Materials", "🔨", [
                ("base_course", "Base course 150mm min, compacted 95% MDD", "§5.1"),
                ("surface_material", "Surface material compliant (concrete/asphalt/paver)", "§5.2"),
                ("concrete_joints", "Concrete jointing 1.8–2.0m, 2 expansion joints", "§5.3"),
                ("commercial_spec", "Commercial spec if commercial lot (150mm + F62)", "§5.4"),
                ("grade_alignment", "Crossover grade matches verge/road levels", "§5.5"),
                ("kerb_transition", "Kerb transition/cut appropriate", "§5.6"),
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
                ("intersection_dist", "Min distance from nearest intersection", "§8.1"),
                ("pedestrian_safety", "Pedestrian path continuity maintained", "§8.2"),
                ("vehicle_turning", "Vehicle turning path — no encroachment", "AS 2890.1"),
                ("driveway_grade", "Driveway gradient within limits (max 1:4)", "AS 2890.1"),
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
                ("first_crossover", "First crossover to lot (contribution eligible)", "§12.1"),
                ("contribution_calc", "Contribution: lesser of ½ cost or $474", "§12.2"),
                ("not_da_linked", "Not DA-linked (DA crossovers ineligible)", "§12.3"),
                ("receipts_info", "Receipts/invoices within 6 months", "§12.4"),
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
                officer_id=spatel.id if spatel else None,
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
                officer_id=jmorrison.id if jmorrison else None,
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
                officer_id=spatel.id if spatel else None,
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
        if spatel:
            note_app = db.query(Application).filter(Application.ref_number == "CX-2026-0044").first()
            if note_app:
                db.add(ApplicationNote(application_id=note_app.id, author_id=spatel.id,
                                       text="Dual crossover permitted — frontage 20.5m > 20m threshold."))
                db.add(ApplicationNote(application_id=note_app.id, author_id=spatel.id,
                                       text="Arborist report confirms 3.2m clearance to both Jarrah trees."))
                db.commit()
                print("✅ Created sample notes")
    else:
        print(f"⏭️  Applications already exist ({db.query(Application).count()})")

    print("\n🎉 Seed complete!")

finally:
    db.close()
