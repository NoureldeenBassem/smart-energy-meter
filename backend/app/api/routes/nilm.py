"""
NILM routes: expose event-based appliance disaggregation over a device's
telemetry. See app/services/nilm/ for the algorithm and why it works without
training data.
"""
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user_id
from app.models.models import Device
from app.services.nilm.disaggregation import disaggregate
from app.api.schemas import NilmBreakdownOut

router = APIRouter(prefix="/nilm", tags=["nilm"])


def _verify_device_ownership(device_id: UUID, user_id: str, db: Session) -> Device:
    device = (
        db.query(Device)
        .filter(Device.device_id == device_id, Device.user_id == UUID(user_id))
        .first()
    )
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


@router.get("/breakdown/{device_id}", response_model=NilmBreakdownOut)
def get_nilm_breakdown(
    device_id: UUID,
    hours: int = Query(24, ge=1, le=168, description="Lookback window in hours"),
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """
    Estimated per-appliance runtime and energy over the last `hours`, inferred
    from step changes in the aggregate power signal alone — see
    app/services/nilm/disaggregation.py. Returns unmatched_event_count and
    ambiguous_event_count so the caller can show how much of the window's
    activity NILM could actually explain, rather than presenting only the
    matched slice as if it were the whole picture.
    """
    device = _verify_device_ownership(device_id, user_id, db)
    window_end = datetime.now(timezone.utc)
    window_start = window_end - timedelta(hours=hours)

    result = disaggregate(
        db=db,
        device_id=device.device_id,
        user_id=UUID(user_id),
        window_start=window_start,
        window_end=window_end,
    )

    return NilmBreakdownOut(
        window_start=result.window_start,
        window_end=result.window_end,
        sample_count=result.sample_count,
        total_events=len(result.events),
        matched_events=len(result.events) - result.unmatched_event_count - result.ambiguous_event_count,
        unmatched_events=result.unmatched_event_count,
        ambiguous_events=result.ambiguous_event_count,
        appliances=[
            {
                "appliance_id": a.appliance_id,
                "name": a.name,
                "is_essential": a.is_essential,
                "on_events": a.on_events,
                "estimated_runtime_hours": a.estimated_runtime_hours,
                "estimated_energy_kwh": a.estimated_energy_kwh,
            }
            for a in result.per_appliance
        ],
    )
