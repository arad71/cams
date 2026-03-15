# app/models/sight_distance.py
from sqlalchemy import Column, Integer
from sqlalchemy.orm import declarative_base

from app.core.database import Base  # you already have a Base in core.database

class SightDistance(Base):
    __tablename__ = "sight_distances"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    # speed bucket (km/h) — typically 40..110
    speed = Column(Integer, nullable=False, unique=True, index=True)
    # AS 2890.1 absolute minimum (m)
    abs_min = Column(Integer, nullable=False)
    # Stopping sight distance minimum (m)
    ssd_min = Column(Integer, nullable=False)
