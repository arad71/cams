"""Reference data endpoints — drive the frontend form dropdowns and validation rules."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.reference import (
    RoadType, SurfaceMaterial, LotType, DocumentCategory,
    DrainageType, ValidationRule, FeeSchedule,
)
from app.schemas import RefItemOut, DocumentCategoryOut, ValidationRuleOut, FeeScheduleOut

router = APIRouter(prefix="/reference", tags=["Reference Data"])


@router.get("/road-types", response_model=list[RefItemOut])
def get_road_types(db: Session = Depends(get_db)):
    return db.query(RoadType).filter(RoadType.is_active == True).order_by(RoadType.sort_order).all()


@router.get("/surface-materials", response_model=list[RefItemOut])
def get_surface_materials(db: Session = Depends(get_db)):
    return db.query(SurfaceMaterial).filter(SurfaceMaterial.is_active == True).order_by(SurfaceMaterial.sort_order).all()


@router.get("/lot-types", response_model=list[RefItemOut])
def get_lot_types(db: Session = Depends(get_db)):
    return db.query(LotType).filter(LotType.is_active == True).order_by(LotType.sort_order).all()


@router.get("/drainage-types", response_model=list[RefItemOut])
def get_drainage_types(db: Session = Depends(get_db)):
    return db.query(DrainageType).filter(DrainageType.is_active == True).order_by(DrainageType.sort_order).all()


@router.get("/document-categories", response_model=list[DocumentCategoryOut])
def get_document_categories(db: Session = Depends(get_db)):
    return db.query(DocumentCategory).filter(DocumentCategory.is_active == True).order_by(DocumentCategory.sort_order).all()


@router.get("/validation-rules", response_model=list[ValidationRuleOut])
def get_validation_rules(db: Session = Depends(get_db)):
    return db.query(ValidationRule).filter(ValidationRule.is_active == True).all()


@router.get("/fees", response_model=list[FeeScheduleOut])
def get_fee_schedule(db: Session = Depends(get_db)):
    return db.query(FeeSchedule).filter(FeeSchedule.is_active == True).all()
