"""
Seed the applicant database with reference data and sample records.
Run: python -m app.seed
"""
from datetime import datetime, timezone
from app.core.database import SessionLocal, engine, Base
from app.core.auth import hash_password
from app.models.applicant import Applicant
from app.models.application import CrossoverApplication, ApplicationDocument, StatusHistory
from app.models.reference import (
    RoadType, SurfaceMaterial, LotType, DocumentCategory,
    DrainageType, ValidationRule, FeeSchedule,
)

Base.metadata.create_all(bind=engine)
db = SessionLocal()

try:
    # ═══ Reference Data ══════════════════════════════════
    if db.query(RoadType).count() == 0:
        db.add_all([
            RoadType(code="local", label="Local Road (City managed)", sort_order=0),
            RoadType(code="red", label="Primary Regional Road (Red Road — Main Roads WA)", requires_referral="MRWA", sort_order=1),
            RoadType(code="blue", label="Other Regional Road (Blue Road — DPLH)", requires_referral="DPLH", sort_order=2),
            RoadType(code="rav", label="Restricted Access Vehicle Route", sort_order=3),
            RoadType(code="mrwa", label="Main Roads WA Managed Road", requires_referral="MRWA", sort_order=4),
        ])
        print("✅ Road types")

    if db.query(SurfaceMaterial).count() == 0:
        db.add_all([
            SurfaceMaterial(code="asphalt", label="Asphalt (25mm min)", min_thickness_mm=25, sort_order=0),
            SurfaceMaterial(code="concrete", label="Concrete (100mm min, 32MPa)", min_thickness_mm=100, sort_order=1),
            SurfaceMaterial(code="brick_paver", label="Brick / Block Paving", min_thickness_mm=60, sort_order=2),
            SurfaceMaterial(code="chip_seal", label="Two-coat Chip Seal", sort_order=3),
        ])
        print("✅ Surface materials")

    if db.query(LotType).count() == 0:
        db.add_all([
            LotType(code="res_urban_green", label="Residential Urban — Green Title", sort_order=0),
            LotType(code="res_urban_strata", label="Residential Urban — Strata", sort_order=1),
            LotType(code="res_urban_battleaxe", label="Residential Urban — Battleaxe", sort_order=2),
            LotType(code="res_rural_green", label="Residential Rural/Semi-Rural — Green Title", sort_order=3),
            LotType(code="res_rural_strata", label="Residential Rural/Semi-Rural — Strata", sort_order=4),
            LotType(code="commercial_urban", label="Commercial Urban", sort_order=5),
            LotType(code="commercial_rural", label="Commercial Rural/Semi-Rural", sort_order=6),
        ])
        print("✅ Lot types")

    if db.query(DrainageType).count() == 0:
        db.add_all([
            DrainageType(code="swale", label="Swale / Table Drain", sort_order=0),
            DrainageType(code="soakwell", label="Soakwell", sort_order=1),
            DrainageType(code="piped", label="Piped to Road Drainage", sort_order=2),
            DrainageType(code="culvert", label="Culvert / Pipe", sort_order=3),
            DrainageType(code="detention_basin", label="Detention Basin", sort_order=4),
        ])
        print("✅ Drainage types")

    if db.query(DocumentCategory).count() == 0:
        db.add_all([
            DocumentCategory(code="site_plan", label="📐 Scaled Site Plan", is_required=True,
                             hint="Showing lot, trees, buildings, existing and proposed crossover with dimensions",
                             accepted_types="pdf,jpg,png,dwg", sort_order=0),
            DocumentCategory(code="certificate_title", label="📜 Certificate of Title", is_required=True,
                             hint="Current copy from Landgate showing lot ownership",
                             accepted_types="pdf", sort_order=1),
            DocumentCategory(code="arborist_report", label="🌳 Arborist Report",
                             hint="Required if trees within 3m of proposed crossover",
                             accepted_types="pdf", sort_order=2),
            DocumentCategory(code="photos_existing", label="📸 Site Photographs",
                             hint="Photos of the verge, road frontage and any existing crossover",
                             accepted_types="jpg,png,pdf", sort_order=3),
            DocumentCategory(code="engineering_drawing", label="📏 Engineering Drawing",
                             hint="Detailed construction drawing if non-standard design",
                             accepted_types="pdf,dwg,dxf", sort_order=4),
            DocumentCategory(code="stormwater_plan", label="💧 Stormwater Management Plan",
                             hint="Required if lot drainage crosses the crossover",
                             accepted_types="pdf", sort_order=5),
            DocumentCategory(code="da_approval", label="🏗️ Development Approval",
                             hint="If crossover relates to a Development Application",
                             accepted_types="pdf", sort_order=6),
            DocumentCategory(code="contractor_quote", label="💰 Contractor Quote / Estimate",
                             hint="For crossover contribution assessment",
                             accepted_types="pdf,jpg,png", sort_order=7),
            DocumentCategory(code="dial_before_dig", label="📞 Dial Before You Dig Results",
                             hint="Underground services search from 1100.com.au",
                             accepted_types="pdf", sort_order=8),
            DocumentCategory(code="other", label="📄 Other Supporting Document",
                             hint="Any other relevant documentation",
                             accepted_types="pdf,jpg,png,doc,docx", sort_order=9),
        ])
        print("✅ Document categories")

    if db.query(ValidationRule).count() == 0:
        db.add_all([
            ValidationRule(field="owner_name", rule_type="required", message="Owner name is required"),
            ValidationRule(field="owner_phone", rule_type="required", message="Phone number is required"),
            ValidationRule(field="owner_email", rule_type="required", message="Email is required"),
            ValidationRule(field="owner_email", rule_type="regex", value=r"\S+@\S+\.\S+", message="Invalid email format"),
            ValidationRule(field="property_address", rule_type="required", message="Property address is required"),
            ValidationRule(field="lot_frontage", rule_type="required", message="Lot frontage is required"),
            ValidationRule(field="lot_frontage", rule_type="min", value="0.1", message="Frontage must be > 0"),
            ValidationRule(field="crossover_width", rule_type="min", value="3.0", message="Min crossover width is 3.0m"),
            ValidationRule(field="crossover_width", rule_type="max", value="6.0", message="Max crossover width is 6.0m"),
            ValidationRule(field="estimated_date", rule_type="required", message="Estimated date is required"),
            ValidationRule(field="number_of_crossovers", rule_type="max", value="2", message="Max 2 crossovers"),
            ValidationRule(field="tree_protection_plan", rule_type="required", message="Tree protection plan required if trees nearby",
                           depends_field="has_trees_nearby", depends_value="true"),
        ])
        print("✅ Validation rules")

    if db.query(FeeSchedule).count() == 0:
        db.add_all([
            FeeSchedule(fee_type="application_fee", description="Standard crossover application fee",
                        amount=0, effective_from=datetime(2026, 1, 1, tzinfo=timezone.utc)),
            FeeSchedule(fee_type="contribution", description="Council contribution — first crossover (max $474 or 50% of cost)",
                        amount=474, conditions="first_crossover_only",
                        effective_from=datetime(2026, 1, 1, tzinfo=timezone.utc)),
        ])
        print("✅ Fee schedule")

    db.commit()

    # ═══ Sample Applicants ═══════════════════════════════
    if db.query(Applicant).count() == 0:
        applicants = [
            Applicant(full_name="Sarah Mitchell", email="sarah.m@email.com", phone="0412 345 678",
                      postal_address="22 Canning Rd, Council Area WA 6076",
                      hashed_password=hash_password("applicant123")),
            Applicant(full_name="David Foster", email="d.foster@outlook.com", phone="0423 456 789",
                      postal_address="107 Welshpool Rd East, Wattle Grove WA 6107",
                      hashed_password=hash_password("applicant123")),
            Applicant(full_name="Andrew Nair", email="a.nair@email.com", phone="0467 890 123",
                      postal_address="10 Ruck St, Wattle Grove WA 6107",
                      hashed_password=hash_password("applicant123")),
        ]
        db.add_all(applicants)
        db.commit()
        print(f"✅ Created {len(applicants)} applicants (password: applicant123)")
    else:
        print(f"⏭️  Applicants already exist ({db.query(Applicant).count()})")

    # ═══ Sample Applications ═════════════════════════════
    if db.query(CrossoverApplication).count() == 0:
        sarah = db.query(Applicant).filter(Applicant.email == "sarah.m@email.com").first()
        david = db.query(Applicant).filter(Applicant.email == "d.foster@outlook.com").first()
        andrew = db.query(Applicant).filter(Applicant.email == "a.nair@email.com").first()

        apps = [
            CrossoverApplication(
                ref_number="CX-2026-0041", applicant_id=sarah.id, status="submitted", current_step=7,
                owner_name="Sarah Mitchell", owner_phone="0412 345 678", owner_email="sarah.m@email.com",
                owner_postal_address="22 Canning Rd, Council Area WA 6076",
                property_address="22 Canning Rd, Council Area WA 6076",
                lot_number="Lot 156", plan_number="P034521", lot_type="res_urban_green",
                lot_frontage=18.5, road_type="local", road_name="Canning Road",
                crossover_width=4.5, number_of_crossovers=1, surface_material="concrete",
                estimated_date="2026-04-15", has_trees_nearby=True,
                tree_protection_plan="Two mature Jarrah trees at 4.2m and 5.1m from proposed crossover.",
                drainage_type="soakwell", declaration_accepted=True,
                submitted_at=datetime(2026, 2, 10, tzinfo=timezone.utc),
                contribution_eligible=True, contribution_amount=474,
            ),
            CrossoverApplication(
                ref_number="CX-2026-0043", applicant_id=andrew.id, status="draft", current_step=3,
                owner_name="Andrew & Priya Nair", owner_phone="0467 890 123", owner_email="a.nair@email.com",
                property_address="10 Ruck St, Wattle Grove WA 6107",
                lot_number="Lot 312", plan_number="P041290",
                lot_frontage=15.0, road_type="local", road_name="Ruck Street",
                crossover_width=4.5, surface_material="concrete",
                has_trees_nearby=True, drainage_type="soakwell",
            ),
            CrossoverApplication(
                ref_number="CX-2026-0040", applicant_id=david.id, status="submitted", current_step=7,
                owner_name="David & Emma Foster", owner_phone="0423 456 789", owner_email="d.foster@outlook.com",
                property_address="107 Welshpool Rd East, Wattle Grove WA 6107",
                lot_number="Lot 89", plan_number="P028734", lot_type="res_urban_strata",
                lot_frontage=12.0, road_type="red", road_name="Welshpool Rd East",
                crossover_width=5.0, number_of_crossovers=1, surface_material="asphalt",
                estimated_date="2026-03-20", da_number="DA2025/0892",
                drainage_type="piped", declaration_accepted=True,
                submitted_at=datetime(2026, 2, 8, tzinfo=timezone.utc),
                contribution_eligible=False, contribution_amount=0,
            ),
        ]
        db.add_all(apps)
        db.flush()

        # Status history
        for a in apps:
            db.add(StatusHistory(application_id=a.id, old_status=None, new_status="draft",
                                 changed_by=f"applicant:{a.owner_email}"))
            if a.status == "submitted":
                db.add(StatusHistory(application_id=a.id, old_status="draft", new_status="submitted",
                                     changed_by=f"applicant:{a.owner_email}"))

        # Sample documents for submitted apps
        for a in [apps[0], apps[2]]:
            db.add(ApplicationDocument(application_id=a.id, category="site_plan", category_label="Scaled Site Plan",
                                       original_filename="site_plan.pdf", stored_filename=f"{a.ref_number}_siteplan.pdf",
                                       file_type="application/pdf", file_size=3800000))
            db.add(ApplicationDocument(application_id=a.id, category="certificate_title", category_label="Certificate of Title",
                                       original_filename="title.pdf", stored_filename=f"{a.ref_number}_title.pdf",
                                       file_type="application/pdf", file_size=1200000))

        db.commit()
        print(f"✅ Created {len(apps)} applications with documents and status history")
    else:
        print(f"⏭️  Applications already exist ({db.query(CrossoverApplication).count()})")

    print("\n🎉 Applicant backend seed complete!")

finally:
    db.close()
