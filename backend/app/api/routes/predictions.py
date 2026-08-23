"""
Bill prediction route. Thin wrapper — all forecasting logic lives in
app/services/forecasting/predict.py, all feature construction in ml/features.py.

BILLING CYCLE AND TIMEZONE
--------------------------
An Egyptian electricity bill runs over a local calendar month, so day boundaries
and the cycle start come from app/core/billing_time.py (Africa/Cairo), which is
also what the live/dashboard endpoints use. Bucketing telemetry by UTC day would
misattribute 2-3 hours of every day's consumption to the wrong day, shifting both
the daily series and the rolling average the model consumes — and would disagree
with the "today's kWh" figure shown next to it on the same screen.

The model tolerates 28/29/30/31-day cycles because it predicts a per-DAY rate
error which is then multiplied by however many days actually remain — see
ml/features.py. It was trained on 30-day cycles; nothing in the recipe assumes
that length at serving time.

MISSING DAYS
------------
Days inside the cycle with no telemetry are passed to the forecaster as 0.0 so
that list positions line up with calendar days, and counted in `data_quality`.
They are NOT interpolated: inventing consumption for a day the meter was offline
would make the prediction look better-founded than it is. Real gap handling with
an interpolated/real flag is requirement P3 #15 and is not built.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user_id
from app.models.models import Device
from app.services.forecasting.bill_forecast import build_forecast
from app.services.forecasting.predict import model_status

router = APIRouter(prefix="/predictions", tags=["predictions"])


# Declared BEFORE /{device_id} so the literal path wins; otherwise FastAPI would
# try to parse "model-status" as a UUID and 422.
@router.get("/model-status")
def get_model_status():
    """
    Reports whether the trained model is actually being served, with the
    validation metrics it was accepted on. Exposed so a reviewer can confirm the
    model is live without reading source, and so a silent fallback to the naive
    baseline can never masquerade as a working model.
    """
    return model_status()


@router.get("/{device_id}")
def get_bill_prediction(
    device_id: UUID,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """
    This cycle's bill forecast for one device.

    Read-only. Snapshots are logged to bills_predicted by
    app/workers/prediction_snapshot.py, not from here — the dashboard polls this
    endpoint, so writing on read would insert a row every few seconds and bury the
    useful daily signal.

    Scoping is enforced in the WHERE clause below, not by filtering the response:
    a device belonging to another user is not found at all, so there is no code
    path on which its data is fetched and then hidden.
    """
    device = (
        db.query(Device)
        .filter(Device.device_id == device_id, Device.user_id == UUID(user_id))
        .first()
    )
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    return build_forecast(db, device_id)
