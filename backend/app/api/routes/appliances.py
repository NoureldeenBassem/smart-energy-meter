"""
Appliance CRUD routes. Straightforward — no business logic lives here,
just create/read/update/delete against the Appliance model.
"""

from uuid import UUID
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user_id
from app.models.models import Appliance
from app.api.schemas import ApplianceCreate, ApplianceOut

router = APIRouter(prefix="/appliances", tags=["appliances"])


@router.post("", response_model=ApplianceOut, status_code=status.HTTP_201_CREATED)
def create_appliance(
    payload: ApplianceCreate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    appliance = Appliance(
        user_id=UUID(user_id),
        name=payload.name,
        rated_power_w=payload.rated_power_w,
        priority=payload.priority,
        desired_daily_hours=payload.desired_daily_hours,
    )
    db.add(appliance)
    db.commit()
    db.refresh(appliance)
    return appliance


@router.get("", response_model=List[ApplianceOut])
def list_appliances(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    return (
        db.query(Appliance)
        .filter(Appliance.user_id == UUID(user_id))
        .order_by(Appliance.created_at.asc())
        .all()
    )


@router.put("/{appliance_id}", response_model=ApplianceOut)
def update_appliance(
    appliance_id: UUID,
    payload: ApplianceCreate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    appliance = (
        db.query(Appliance)
        .filter(Appliance.appliance_id == appliance_id, Appliance.user_id == UUID(user_id))
        .first()
    )
    if not appliance:
        raise HTTPException(status_code=404, detail="Appliance not found")

    appliance.name = payload.name
    appliance.rated_power_w = payload.rated_power_w
    appliance.priority = payload.priority
    appliance.desired_daily_hours = payload.desired_daily_hours

    db.commit()
    db.refresh(appliance)
    return appliance


@router.delete("/{appliance_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_appliance(
    appliance_id: UUID,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    appliance = (
        db.query(Appliance)
        .filter(Appliance.appliance_id == appliance_id, Appliance.user_id == UUID(user_id))
        .first()
    )
    if not appliance:
        raise HTTPException(status_code=404, detail="Appliance not found")

    db.delete(appliance)
    db.commit()