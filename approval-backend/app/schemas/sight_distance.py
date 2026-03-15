# app/schemas/sight_distance.py
from pydantic import BaseModel, Field
from typing import Optional

class SightDistanceBase(BaseModel):
    speed: int = Field(..., ge=10, le=130)
    abs_min: int = Field(..., ge=0)
    ssd_min: int = Field(..., ge=0)

class SightDistanceCreate(SightDistanceBase):
    pass

class SightDistanceUpdate(BaseModel):
    speed: Optional[int] = Field(None, ge=10, le=130)
    abs_min: Optional[int] = Field(None, ge=0)
    ssd_min: Optional[int] = Field(None, ge=0)

class SightDistanceOut(SightDistanceBase):
    id: int

    class Config:
        from_attributes = True  # Pydantic v2: orm_mode replacement
