"""
Assessment API:
  - Master categories & items (admin can CRUD, all can read)
  - Per-case assessment results (AI assess, officer decision, notes)
  - Bulk operations (auto-assess all, auto-decide remaining)
  - Summary stats per application
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload, contains_eager

from app.core.database import get_db
from app.core.auth import get_current_user, require_role
from app.models.user import User
from app.models.application import Application
from app.models.assessment import AssessmentCategory, AssessmentItem, AssessmentRule, CaseAssessment
from app.schemas import (
    AssessmentCategoryOut, AssessmentCategoryCreate, AssessmentCategoryUpdate,
    AssessmentItemOut, AssessmentItemCreate, AssessmentItemUpdate,
    AssessmentRuleOut, AssessmentRuleCreate, AssessmentRuleUpdate,
    CaseAssessmentOut, CaseAssessmentUpdate,
    BulkAIAssessRequest, BulkOfficerDecisionRequest, CaseAssessmentSummary,
)

router = APIRouter(tags=["Assessments"])


# ═══════════════════════════════════════════════════════════
#  MASTER DATA — Categories & Items
# ═══════════════════════════════════════════════════════════

@router.get("/assessment/categories", response_model=list[AssessmentCategoryOut])
def list_categories(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Get all categories with their items."""
    return (
        db.query(AssessmentCategory)
        .options(joinedload(AssessmentCategory.items))
        .order_by(AssessmentCategory.sort_order)
        .all()
    )


@router.post("/assessment/categories", response_model=AssessmentCategoryOut, status_code=201)
def create_category(data: AssessmentCategoryCreate, db: Session = Depends(get_db),
                    current_user: User = Depends(require_role("admin"))):
    if db.query(AssessmentCategory).filter(AssessmentCategory.code == data.code).first():
        raise HTTPException(400, "Category code already exists")
    cat = AssessmentCategory(**data.model_dump())
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@router.patch("/assessment/categories/{cat_id}", response_model=AssessmentCategoryOut)
def update_category(cat_id: int, data: AssessmentCategoryUpdate, db: Session = Depends(get_db),
                    current_user: User = Depends(require_role("admin"))):
    cat = db.query(AssessmentCategory).filter(AssessmentCategory.id == cat_id).first()
    if not cat:
        raise HTTPException(404, "Category not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(cat, k, v)
    db.commit()
    db.refresh(cat)
    return cat


@router.post("/assessment/categories/{cat_id}/items", response_model=AssessmentItemOut, status_code=201)
def create_item(cat_id: int, data: AssessmentItemCreate, db: Session = Depends(get_db),
                current_user: User = Depends(require_role("admin"))):
    cat = db.query(AssessmentCategory).filter(AssessmentCategory.id == cat_id).first()
    if not cat:
        raise HTTPException(404, "Category not found")
    if db.query(AssessmentItem).filter(AssessmentItem.code == data.code).first():
        raise HTTPException(400, "Item code already exists")
    item = AssessmentItem(category_id=cat_id, **data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/assessment/items/{item_id}", response_model=AssessmentItemOut)
def update_item(item_id: int, data: AssessmentItemUpdate, db: Session = Depends(get_db),
                current_user: User = Depends(require_role("admin"))):
    item = db.query(AssessmentItem).filter(AssessmentItem.id == item_id).first()
    if not item:
        raise HTTPException(404, "Item not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item


# ═══════════════════════════════════════════════════════════
#  CASE ASSESSMENTS — Per-application results
# ═══════════════════════════════════════════════════════════

def _ensure_case_rows(db: Session, application_id: int):
    """Ensure a CaseAssessment row exists for every active item for this application."""
    existing_item_ids = {
        ca.item_id
        for ca in db.query(CaseAssessment.item_id).filter(CaseAssessment.application_id == application_id).all()
    }
    items = db.query(AssessmentItem).filter(AssessmentItem.is_active == True).all()
    new_rows = []
    for item in items:
        if item.id not in existing_item_ids:
            new_rows.append(CaseAssessment(application_id=application_id, item_id=item.id))
    if new_rows:
        db.add_all(new_rows)
        db.commit()


def _build_case_out(ca: CaseAssessment) -> CaseAssessmentOut:
    return CaseAssessmentOut(
        id=ca.id,
        application_id=ca.application_id,
        item_id=ca.item_id,
        item_code=ca.item.code if ca.item else None,
        item_label=ca.item.label if ca.item else None,
        category_code=ca.item.category.code if ca.item and ca.item.category else None,
        ai_result=ca.ai_result,
        ai_confidence=ca.ai_confidence,
        ai_reason=ca.ai_reason,
        ai_assessed_at=ca.ai_assessed_at,
        officer_result=ca.officer_result,
        officer_name=ca.officer.name if ca.officer else None,
        officer_assessed_at=ca.officer_assessed_at,
        status=ca.status,
        note=ca.note,
        note_by_name=ca.note_by.name if ca.note_by else None,
        note_at=ca.note_at,
        updated_at=ca.updated_at,
    )


@router.get("/applications/{app_id}/assessments", response_model=list[CaseAssessmentOut])
def list_case_assessments(app_id: int, db: Session = Depends(get_db),
                          current_user: User = Depends(get_current_user)):
    """Get all assessment results for an application. Auto-creates rows if missing."""
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(404, "Application not found")
    if current_user.role == "engineer" and app.officer_id != current_user.id:
        raise HTTPException(403, "Not assigned to this case")

    _ensure_case_rows(db, app_id)

    results = (
        db.query(CaseAssessment)
        .filter(CaseAssessment.application_id == app_id)
        .options(
            joinedload(CaseAssessment.item).joinedload(AssessmentItem.category),
            joinedload(CaseAssessment.officer),
            joinedload(CaseAssessment.note_by),
        )
        .all()
    )
    # Sort by category sort_order, then item sort_order
    results.sort(key=lambda ca: (
        ca.item.category.sort_order if ca.item and ca.item.category else 999,
        ca.item.sort_order if ca.item else 999,
    ))
    return [_build_case_out(ca) for ca in results]


@router.patch("/applications/{app_id}/assessments/{item_id}", response_model=CaseAssessmentOut)
def update_case_assessment(app_id: int, item_id: int, data: CaseAssessmentUpdate,
                           db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Update a single assessment result (AI or officer or note)."""
    ca = (
        db.query(CaseAssessment)
        .filter(CaseAssessment.application_id == app_id, CaseAssessment.item_id == item_id)
        .options(
            joinedload(CaseAssessment.item).joinedload(AssessmentItem.category),
            joinedload(CaseAssessment.officer),
            joinedload(CaseAssessment.note_by),
        )
        .first()
    )
    if not ca:
        raise HTTPException(404, "Assessment result not found")

    now = datetime.now(timezone.utc)
    update = data.model_dump(exclude_unset=True)

    if "ai_result" in update:
        ca.ai_result = update["ai_result"]
        ca.ai_assessed_at = now
    if "ai_confidence" in update:
        ca.ai_confidence = update["ai_confidence"]
    if "ai_reason" in update:
        ca.ai_reason = update["ai_reason"]
    if "officer_result" in update:
        ca.officer_result = update["officer_result"]
        ca.officer_id = current_user.id
        ca.officer_assessed_at = now
    if "status" in update:
        ca.status = update["status"]
        ca.status_changed_by_id = current_user.id
        ca.status_changed_at = now
    if "note" in update:
        ca.note = update["note"]
        ca.note_by_id = current_user.id
        ca.note_at = now

    db.commit()
    db.refresh(ca)

    # Audit log for officer decisions
    if "officer_result" in update or "note" in update:
        from app.services.audit import log_audit
        app = db.query(Application).filter(Application.id == app_id).first()
        item_label = ca.item.label if ca.item else f"item_{item_id}"
        desc_parts = []
        if "officer_result" in update:
            desc_parts.append(f"officer decision: {update['officer_result']}")
        if "note" in update:
            desc_parts.append(f"note added")
        log_audit(db=db, action="assess", entity_type="assessment", user=current_user, entity_id=str(ca.id), entity_ref=app.ref_number if app else None, description=f"{item_label} — {', '.join(desc_parts)}", field_changes=update)

    return _build_case_out(ca)


# ═══════════════════════════════════════════════════════════
#  BULK OPERATIONS
# ═══════════════════════════════════════════════════════════

@router.post("/applications/{app_id}/assessments/ai-assess", response_model=list[CaseAssessmentOut])
def run_ai_assessment(app_id: int, db: Session = Depends(get_db),
                      current_user: User = Depends(get_current_user)):
    """
    Run AI auto-assessment on all items for an application.
    Uses application data to evaluate each checklist item.
    """
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(404, "Application not found")

    _ensure_case_rows(db, app_id)

    results = (
        db.query(CaseAssessment)
        .filter(CaseAssessment.application_id == app_id)
        .options(joinedload(CaseAssessment.item).joinedload(AssessmentItem.category))
        .all()
    )

    now = datetime.now(timezone.utc)
    for ca in results:
        ai_result, confidence, reason = _auto_assess_item(ca.item.code, app, db)
        ca.ai_result = ai_result
        ca.ai_confidence = confidence
        ca.ai_reason = reason
        ca.ai_assessed_at = now

    db.commit()

    # Re-fetch with all relationships
    return list_case_assessments(app_id, db, current_user)


@router.post("/applications/{app_id}/assessments/bulk-officer", response_model=list[CaseAssessmentOut])
def bulk_officer_decision(app_id: int, data: BulkOfficerDecisionRequest,
                          db: Session = Depends(get_db),
                          current_user: User = Depends(require_role("admin", "manager", "engineer"))):
    """
    Bulk officer decision: approve/reject all items matching a given AI result.
    e.g. auto-approve all AI "pass" items, auto-reject all AI "fail" items.
    """
    now = datetime.now(timezone.utc)
    results = (
        db.query(CaseAssessment)
        .filter(
            CaseAssessment.application_id == app_id,
            CaseAssessment.ai_result == data.ai_result_filter,
            CaseAssessment.officer_result == None,  # only unreviewed
        )
        .all()
    )
    for ca in results:
        ca.officer_result = data.officer_decision
        ca.officer_id = current_user.id
        ca.officer_assessed_at = now
        # Auto-set status
        ca.status = "pass" if data.officer_decision == "approved" else "fail"
        ca.status_changed_by_id = current_user.id
        ca.status_changed_at = now

    db.commit()
    if results:
        from app.services.audit import log_audit
        app = db.query(Application).filter(Application.id == app_id).first()
        log_audit(db=db, action="bulk_assess", entity_type="assessment", user=current_user, entity_id=str(app_id), entity_ref=app.ref_number if app else None, description=f"Bulk {data.officer_decision} on {len(results)} items (AI={data.ai_result_filter})")
    return list_case_assessments(app_id, db, current_user)


@router.get("/applications/{app_id}/assessments/summary", response_model=CaseAssessmentSummary)
def get_assessment_summary(app_id: int, db: Session = Depends(get_db),
                           current_user: User = Depends(get_current_user)):
    """Get aggregate statistics for an application's assessment."""
    _ensure_case_rows(db, app_id)
    results = db.query(CaseAssessment).filter(CaseAssessment.application_id == app_id).all()
    total = len(results)
    if total == 0:
        return CaseAssessmentSummary()

    ai_pass = sum(1 for r in results if r.ai_result == "pass")
    ai_review = sum(1 for r in results if r.ai_result == "review")
    ai_fail = sum(1 for r in results if r.ai_result == "fail")
    off_approved = sum(1 for r in results if r.officer_result == "approved")
    off_rejected = sum(1 for r in results if r.officer_result == "rejected")
    off_pending = total - off_approved - off_rejected
    st_pass = sum(1 for r in results if r.status == "pass")
    st_fail = sum(1 for r in results if r.status == "fail")
    st_pending = sum(1 for r in results if r.status == "pending")

    return CaseAssessmentSummary(
        total=total,
        ai_pass=ai_pass, ai_review=ai_review, ai_fail=ai_fail,
        officer_approved=off_approved, officer_rejected=off_rejected, officer_pending=off_pending,
        status_pass=st_pass, status_fail=st_fail, status_pending=st_pending,
        score_pct=round(st_pass / total * 100, 1) if total > 0 else 0,
    )


# ═══════════════════════════════════════════════════════════
#  DATABASE-DRIVEN AUTO-ASSESS ENGINE
# ═══════════════════════════════════════════════════════════

def _resolve_field_value(source: str, field: str, app: Application):
    """
    Resolve a field value from app data or site_plan_data.
    source: "app" → application column, "sp" → site_plan_data.extraction nested path
    field: dot-separated path, e.g. "crossover_width" or "crossover_dimensions.width_at_boundary_m"
    Returns the resolved value or None.
    """
    if source == "app":
        return getattr(app, field, None)
    elif source == "sp":
        # Read from corrected data first, fall back to original
        spd = app.cor_site_plan_data or app.site_plan_data or {}
        ext = spd.get("extraction", {})
        # Walk dot-separated path
        obj = ext
        for part in field.split("."):
            if isinstance(obj, dict):
                obj = obj.get(part)
            else:
                return None
            if obj is None:
                return None
        return obj
    elif source == "doc":
        # Check uploaded documents by category
        from app.models.application import Document
        from app.core.database import SessionLocal
        db_sess = SessionLocal()
        try:
            doc = (
                db_sess.query(Document)
                .filter(Document.application_id == app.id, Document.category == field)
                .first()
            )
            if doc:
                return doc.status or "received"
            return None
        except Exception as e:
            import logging
            logging.warning(f"Doc source query error for app {app.id}, category '{field}': {e}")
            return None
        finally:
            db_sess.close()
    elif source == "compound":
        # Compound rules are handled by _evaluate_compound, not here
        return None
    return None


def _cast_value(val_str: str, target_val):
    """Cast a string threshold to match the type of the target value."""
    if val_str is None:
        return None
    if isinstance(target_val, bool):
        return val_str.lower() in ("true", "1", "yes")
    if isinstance(target_val, (int, float)):
        try:
            return float(val_str)
        except (ValueError, TypeError):
            return None
    return val_str


def _evaluate_condition(field_value, operator: str, threshold_str: str) -> bool:
    """Evaluate a single condition: field_value <operator> threshold."""
    if operator == "exists":
        return field_value is not None and field_value != "" and field_value != 0
    if operator == "not_exists":
        return field_value is None or field_value == "" or field_value == 0
    if operator == "true":
        return bool(field_value) is True
    if operator == "false":
        return not bool(field_value)

    if field_value is None:
        return False

    threshold = _cast_value(threshold_str, field_value)

    # Numeric comparisons — safely convert both sides
    if operator in ("gte", "lte", "gt", "lt"):
        try:
            fv = float(field_value)
            tv = float(threshold) if threshold is not None else None
            if tv is None:
                return False
        except (ValueError, TypeError):
            return False  # Non-numeric field can't be compared numerically
        if operator == "gte":
            return fv >= tv
        if operator == "lte":
            return fv <= tv
        if operator == "gt":
            return fv > tv
        if operator == "lt":
            return fv < tv
    if operator == "eq":
        return str(field_value).lower() == str(threshold).lower()
    if operator == "neq":
        return str(field_value).lower() != str(threshold).lower()
    if operator == "contains":
        return str(threshold).lower() in str(field_value).lower() if threshold else False
    if operator == "not_contains":
        return str(threshold).lower() not in str(field_value).lower() if threshold else True

    return False


def _render_reason(template: str, field_value, threshold_str: str, field_values: dict = None) -> str:
    """Fill in {field_value}, {threshold}, and {field_values.xxx} placeholders in reason template."""
    result = template
    result = result.replace("{field_value}", str(field_value) if field_value is not None else "N/A")
    result = result.replace("{threshold}", str(threshold_str) if threshold_str is not None else "")
    # Replace {field_values} with summary of all resolved values
    if field_values:
        summary = ", ".join(f"{k}={v}" for k, v in field_values.items() if v is not None)
        result = result.replace("{field_values}", summary)
        # Also replace individual {field_values.xxx} patterns
        for k, v in field_values.items():
            result = result.replace("{" + k + "}", str(v) if v is not None else "N/A")
    return result


def _evaluate_compound(conditions: dict, app: Application) -> tuple[bool, dict]:
    """
    Evaluate a compound condition with AND/OR logic.
    
    conditions format:
    {
      "logic": "and" | "or",
      "checks": [
        {"source": "app", "field": "crossover_width", "operator": "gte", "value": "3.0"},
        {"source": "sp", "field": "crossover_dimensions.width_at_boundary_m", "operator": "gte", "value": "3.0"}
      ]
    }
    
    Returns (matched: bool, field_values: dict) where field_values maps field names to resolved values.
    """
    logic = conditions.get("logic", "and").lower()
    checks = conditions.get("checks", [])
    if not checks:
        return False, {}

    field_values = {}
    results = []

    for check in checks:
        src = check.get("source", "app")
        fld = check.get("field", "")
        op = check.get("operator", "exists")
        val = check.get("value")

        try:
            fv = _resolve_field_value(src, fld, app)
            field_values[f"{src}.{fld}"] = fv
            matched = _evaluate_condition(fv, op, val)
            results.append(matched)
        except Exception:
            results.append(False)
            field_values[f"{src}.{fld}"] = None

    if logic == "or":
        return any(results), field_values
    else:  # "and"
        return all(results), field_values


def _auto_assess_item(item_code: str, app: Application, db: Session) -> tuple[str, float, str]:
    """
    Evaluate a checklist item using database-driven rules.
    Rules are loaded from assessment_rules table, evaluated in priority order.
    First matching rule wins. If no rules match, returns "review" with low confidence.
    
    Supports both simple rules (single source/field/operator/value) and
    compound rules (conditions JSON with AND/OR logic over multiple fields).
    """
    # Load rules for this item code
    item = db.query(AssessmentItem).filter(AssessmentItem.code == item_code).first()
    if not item:
        return ("review", 0.3, f"Unknown assessment item: {item_code}")

    rules = (
        db.query(AssessmentRule)
        .filter(AssessmentRule.item_id == item.id, AssessmentRule.is_active == True)
        .order_by(AssessmentRule.priority)
        .all()
    )

    if not rules:
        return ("review", 0.3, f"No assessment rules defined for {item_code}")

    # Evaluate rules in priority order — first match wins
    for rule in rules:
        try:
            # Check if this is a compound rule
            if rule.conditions and isinstance(rule.conditions, dict) and rule.conditions.get("checks"):
                matched, field_values = _evaluate_compound(rule.conditions, app)
                if matched:
                    # Use first field value for {field_value} placeholder
                    first_fv = next((v for v in field_values.values() if v is not None), None)
                    reason = _render_reason(rule.reason_template, first_fv, rule.value, field_values)
                    return (rule.result, rule.confidence, reason)
            else:
                # Simple single-field rule (backwards compatible)
                field_value = _resolve_field_value(rule.source, rule.field, app)
                matched = _evaluate_condition(field_value, rule.operator, rule.value)
                if matched:
                    reason = _render_reason(rule.reason_template, field_value, rule.value)
                    return (rule.result, rule.confidence, reason)
        except Exception as e:
            # Log broken rules for debugging
            import logging
            logging.warning(f"Assessment rule error: item={item_code} rule_id={rule.id} source={rule.source} field={rule.field} op={rule.operator}: {e}")
            continue

    # No rule matched — return the default fallback
    return ("review", 0.4, f"No matching rule for {item_code} — manual review required")


# ═══════════════════════════════════════════════════════════
#  ASSESSMENT RULES CRUD (Admin only)
# ═══════════════════════════════════════════════════════════

@router.get("/assessment/rules", response_model=list[AssessmentRuleOut])
def list_rules(item_code: str = None, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user)):
    """List all rules, optionally filtered by item code."""
    if item_code:
        q = (db.query(AssessmentRule)
             .join(AssessmentItem, AssessmentRule.item_id == AssessmentItem.id)
             .options(contains_eager(AssessmentRule.item))
             .filter(AssessmentItem.code == item_code))
    else:
        q = db.query(AssessmentRule).options(joinedload(AssessmentRule.item))
    rules = q.order_by(AssessmentRule.item_id, AssessmentRule.priority).all()
    return [
        AssessmentRuleOut(
            **{c.name: getattr(r, c.name) for c in r.__table__.columns},
            item_code=r.item.code if r.item else None,
        )
        for r in rules
    ]


@router.post("/assessment/rules", response_model=AssessmentRuleOut, status_code=201)
def create_rule(data: AssessmentRuleCreate, db: Session = Depends(get_db),
                current_user: User = Depends(require_role("admin"))):
    item = db.query(AssessmentItem).filter(AssessmentItem.id == data.item_id).first()
    if not item:
        raise HTTPException(404, "Assessment item not found")
    rule = AssessmentRule(**data.model_dump())
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return AssessmentRuleOut(
        **{c.name: getattr(rule, c.name) for c in rule.__table__.columns},
        item_code=item.code,
    )


@router.patch("/assessment/rules/{rule_id}", response_model=AssessmentRuleOut)
def update_rule(rule_id: int, data: AssessmentRuleUpdate, db: Session = Depends(get_db),
                current_user: User = Depends(require_role("admin"))):
    rule = db.query(AssessmentRule).options(joinedload(AssessmentRule.item)).filter(AssessmentRule.id == rule_id).first()
    if not rule:
        raise HTTPException(404, "Rule not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(rule, k, v)
    db.commit()
    db.refresh(rule)
    return AssessmentRuleOut(
        **{c.name: getattr(rule, c.name) for c in rule.__table__.columns},
        item_code=rule.item.code if rule.item else None,
    )


@router.delete("/assessment/rules/{rule_id}", status_code=204)
def delete_rule(rule_id: int, db: Session = Depends(get_db),
                current_user: User = Depends(require_role("admin"))):
    rule = db.query(AssessmentRule).filter(AssessmentRule.id == rule_id).first()
    if not rule:
        raise HTTPException(404, "Rule not found")
    db.delete(rule)
    db.commit()


@router.post("/assessment/reset-rules")
def reset_rules_only(db: Session = Depends(get_db),
                     current_user: User = Depends(require_role("admin"))):
    """Delete all assessment rules and re-seed from latest code. Keeps applications and assessments intact."""
    from app.services.audit import log_audit
    from sqlalchemy import text

    old_rules = db.query(AssessmentRule).count()

    # Delete rules only
    try:
        db.execute(text("DELETE FROM assessment_rules"))
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Failed to delete rules: {e}")

    # Re-seed rules from latest code
    from app.core.database import SessionLocal
    from app.models.assessment import AssessmentCategory, AssessmentItem
    seed_db = SessionLocal()
    try:
        # Need categories and items to exist
        if seed_db.query(AssessmentItem).count() == 0:
            # Categories/items don't exist — run full seed
            import importlib, app.seed as seed_module
            importlib.reload(seed_module)
            seed_module.run_seed()
        else:
            # Items exist — just create rules
            item_map = {i.code: i.id for i in seed_db.query(AssessmentItem).all()}
            from app.models.assessment import AssessmentRule as AR

            def R(code, priority, source, field, operator, value, result, confidence, reason):
                iid = item_map.get(code)
                if not iid: return
                seed_db.add(AR(item_id=iid, priority=priority, source=source, field=field,
                              operator=operator, value=value, result=result,
                              confidence=confidence, reason_template=reason))

            def RC(code, priority, logic, checks, result, confidence, reason):
                iid = item_map.get(code)
                if not iid: return
                conditions = {"logic": logic, "checks": [
                    {"source": c[0], "field": c[1], "operator": c[2], "value": c[3] if len(c) > 3 else None}
                    for c in checks
                ]}
                seed_db.add(AR(item_id=iid, priority=priority, source="compound", field="compound",
                              operator="compound", value=None, conditions=conditions,
                              result=result, confidence=confidence, reason_template=reason))

            # Import and execute the rule definitions from seed
            import importlib, app.seed as seed_module
            importlib.reload(seed_module)
            # Execute seed but only the rules section by calling run_seed
            # which will skip existing categories/items/users but create rules
            seed_module.run_seed()

        seed_db.commit()
    except Exception as e:
        print(f"Rule reseed error: {e}")
        seed_db.rollback()
    finally:
        seed_db.close()

    new_rules = db.query(AssessmentRule).count()
    log_audit(db=db, action="reset_rules", entity_type="assessment", user=current_user,
              description=f"Rules reset: {old_rules} deleted, {new_rules} new rules from latest code")
    return {"message": f"Rules reset: {old_rules} → {new_rules} rules (applications preserved)"}


@router.post("/assessment/reseed-rules")
def reseed_rules(db: Session = Depends(get_db),
                 current_user: User = Depends(require_role("admin"))):
    """Delete all applications, assessments, rules and re-seed from latest code. Admin only."""
    from app.services.audit import log_audit
    from sqlalchemy import text

    old_rules = db.query(AssessmentRule).count()
    old_apps = db.query(Application).count()

    # Delete in dependency order — resilient to missing tables
    tables = [
        "ai_training_corrections", "ai_training_samples",
        "case_assessments", "sight_distances",
        "reports", "inspections", "application_notes",
        "documents", "applications",
        "assessment_rules", "assessment_items", "assessment_categories",
    ]
    for t in tables:
        try:
            db.execute(text(f"DELETE FROM {t}"))
        except Exception:
            db.rollback()
    db.commit()

    # Re-seed everything from latest code
    import importlib
    import app.seed as seed_module
    importlib.reload(seed_module)

    from app.core.database import SessionLocal
    seed_db = SessionLocal()
    try:
        seed_module.run_seed()
    except Exception as e:
        print(f"Reseed error: {e}")
    finally:
        seed_db.close()

    new_rules = db.query(AssessmentRule).count()
    new_apps = db.query(Application).count()
    log_audit(db=db, action="reseed_rules", entity_type="assessment", user=current_user,
              description=f"Full reseed: {old_apps} apps deleted, {old_rules} old rules deleted, {new_rules} new rules + {new_apps} sample apps created")
    return {"message": f"Full reseed complete: {old_apps} applications removed, {old_rules}→{new_rules} rules, {new_apps} sample apps created"}


# ─── RULE BACKUP / RESTORE ───────────────────────────

@router.get("/assessment/rules/export")
def export_rules(db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user)):
    """Export all assessment rules as JSON for backup."""
    rules = (
        db.query(AssessmentRule)
        .options(joinedload(AssessmentRule.item))
        .order_by(AssessmentRule.item_id, AssessmentRule.priority)
        .all()
    )
    exported = []
    for r in rules:
        exported.append({
            "item_code": r.item.code if r.item else None,
            "priority": r.priority,
            "is_active": r.is_active,
            "source": r.source,
            "field": r.field,
            "operator": r.operator,
            "value": r.value,
            "conditions": r.conditions,
            "result": r.result,
            "confidence": r.confidence,
            "reason_template": r.reason_template,
        })
    return {
        "version": "1.0",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "exported_by": current_user.name,
        "rule_count": len(exported),
        "rules": exported,
    }


@router.post("/assessment/rules/import")
def import_rules(data: dict, mode: str = "replace",
                 db: Session = Depends(get_db),
                 current_user: User = Depends(require_role("admin"))):
    """
    Import assessment rules from JSON backup.
    mode: 'replace' (delete all existing then import) or 'merge' (add to existing).
    Body: { "rules": [ { item_code, priority, source, field, operator, value, conditions, result, confidence, reason_template } ] }
    """
    from app.services.audit import log_audit
    from sqlalchemy import text

    rules_data = data.get("rules", [])
    if not rules_data:
        raise HTTPException(400, "No rules in import data")

    # Build item_code → item_id map
    item_map = {i.code: i.id for i in db.query(AssessmentItem).all()}

    old_count = db.query(AssessmentRule).count()

    if mode == "replace":
        try:
            db.execute(text("DELETE FROM assessment_rules"))
            db.commit()
        except Exception as e:
            db.rollback()
            raise HTTPException(500, f"Failed to clear existing rules: {e}")

    imported = 0
    skipped = 0
    for rd in rules_data:
        item_code = rd.get("item_code")
        iid = item_map.get(item_code)
        if not iid:
            skipped += 1
            continue
        rule = AssessmentRule(
            item_id=iid,
            priority=rd.get("priority", 0),
            is_active=rd.get("is_active", True),
            source=rd.get("source", "app"),
            field=rd.get("field", ""),
            operator=rd.get("operator", "exists"),
            value=rd.get("value"),
            conditions=rd.get("conditions"),
            result=rd.get("result", "review"),
            confidence=rd.get("confidence", 0.8),
            reason_template=rd.get("reason_template", ""),
        )
        db.add(rule)
        imported += 1

    db.commit()
    new_count = db.query(AssessmentRule).count()

    log_audit(db=db, action="import_rules", entity_type="assessment", user=current_user,
              description=f"Rules imported ({mode}): {imported} imported, {skipped} skipped, {old_count}→{new_count}")

    return {"message": f"Imported {imported} rules ({skipped} skipped — unknown item codes)", "old_count": old_count, "new_count": new_count}
