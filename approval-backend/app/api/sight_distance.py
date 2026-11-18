# app/api/sight_distance.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.core.auth import get_current_user, require_role
from app.models.sight_distance import SightDistance
from app.schemas.sight_distance import (
    SightDistanceCreate,
    SightDistanceUpdate,
    SightDistanceOut,
)

# All routes require login. These values decide whether a crossover passes,
# so only admins may create, change or delete them.
router = APIRouter(
    prefix="/sight-distances",
    tags=["sight-distances"],
    dependencies=[Depends(get_current_user)],
)
_admin = Depends(require_role("admin"))

@router.get("/", response_model=List[SightDistanceOut])
def list_all(db: Session = Depends(get_db)):
    return db.query(SightDistance).order_by(SightDistance.speed.asc()).all()

@router.post("/", response_model=SightDistanceOut, status_code=status.HTTP_201_CREATED)
def create_one(payload: SightDistanceCreate, db: Session = Depends(get_db), _user=_admin):
    exists = db.query(SightDistance).filter_by(speed=payload.speed).first()
    if exists:
        raise HTTPException(status_code=400, detail="Speed bucket already exists")
    row = SightDistance(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row

@router.patch("/{row_id}", response_model=SightDistanceOut)
def update_one(row_id: int, payload: SightDistanceUpdate, db: Session = Depends(get_db), _user=_admin):
    row = db.query(SightDistance).get(row_id)
    if not row:
        raise HTTPException(status_code=404, detail="Row not found")

    if payload.speed is not None:
        dup = (
            db.query(SightDistance)
            .filter(SightDistance.speed == payload.speed, SightDistance.id != row_id)
            .first()
        )
        if dup:
            raise HTTPException(status_code=400, detail="Another row already uses that speed")
        row.speed = payload.speed

    if payload.abs_min is not None:
        row.abs_min = payload.abs_min
    if payload.ssd_min is not None:
        row.ssd_min = payload.ssd_min

    db.commit()
    db.refresh(row)
    return row

@router.delete("/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_one(row_id: int, db: Session = Depends(get_db), _user=_admin):
    row = db.query(SightDistance).get(row_id)
    if not row:
        return  # idempotent
    db.delete(row)
    db.commit()

@router.get("/for-speed/{speed}", response_model=SightDistanceOut)
def get_for_speed(speed: int, db: Session = Depends(get_db)):
    """
    Return the row with matching or next higher speed bucket.
    If all rows are below requested speed, return the highest available.
    """
    row = (
        db.query(SightDistance)
        .filter(SightDistance.speed >= speed)
        .order_by(SightDistance.speed.asc())
        .first()
    )
    if not row:
        row = (
            db.query(SightDistance)
            .order_by(SightDistance.speed.desc())
            .first()
        )
    if not row:
        raise HTTPException(status_code=404, detail="No sight distance data configured")
    return row