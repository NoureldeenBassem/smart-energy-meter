"""
Device registration routes. A "device" here represents one physical
ESP32 smart meter unit, identified externally by external_id (the string
the firmware/simulator sends in its MQTT payload, e.g. "esp32_meter_01").
"""

from uuid import UUID
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user_id
from app.models.models import Device
from app.api.schemas import DeviceCreate, DeviceOut

router = APIRouter(prefix="/devices", tags=["devices"])


@router.post("", response_model=DeviceOut, status_code=status.HTTP_201_CREATED)
def register_device(
    payload: DeviceCreate,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    existing = db.query(Device).filter(Device.external_id == payload.external_id).first()

    if existing:
        if str(existing.user_id) == user_id:
            # Already registered by this same user — treat as success,
            # not an error (idempotent pairing: re-running "Connect" is fine).
            return existing

        # Registered to a DIFFERENT user. In a real multi-tenant deployment
        # this should stay a hard error. For this project (single physical
        # demo device, re-paired across test accounts during development),
        # we re-home the device to the new user instead of blocking pairing —
        # this mirrors the real-world case of a device being reset and
        # re-paired to a new owner.
        existing.user_id = UUID(user_id)
        existing.device_label = payload.device_label
        db.commit()
        db.refresh(existing)
        return existing

    device = Device(
        user_id=UUID(user_id),
        external_id=payload.external_id,
        device_label=payload.device_label,
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    return device


@router.get("", response_model=List[DeviceOut])
def list_devices(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    return db.query(Device).filter(Device.user_id == UUID(user_id)).all()