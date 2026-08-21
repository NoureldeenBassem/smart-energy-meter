"""
Bill prediction route. Thin wrapper — all forecasting logic lives in
app/services/forecasting/predict.py.
"""

from datetime import datetime, timezone
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.database import get_db
from app.core.security import get_current_user_id
from app.models.models import Device
from app.services.forecasting.predict import predict_bill
from app.services.tariff_engine.calculator import calculate_bill

router = APIRouter(prefix="/predictions", tags=["predictions"])


@router.get("/{device_id}")
def get_bill_prediction(
    device_id: UUID,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    device = (
        db.query(Device)
        .filter(Device.device_id == device_id, Device.user_id == UUID(user_id))
        .first()
    )
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    now = datetime.now(timezone.utc)
    month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)

    cumulative_kwh_so_far = db.execute(
        text("""
            SELECT COALESCE(SUM(energy_wh_delta) / 1000.0, 0)
            FROM telemetry_raw
            WHERE device_id = :device_id AND ts >= :month_start
        """),
        {"device_id": str(device_id), "month_start": month_start},
    ).scalar() or 0.0

    seven_days_ago = now.replace(hour=0, minute=0, second=0, microsecond=0)
    rolling_avg_daily_kwh_7d = db.execute(
        text("""
            SELECT COALESCE(AVG(daily_total), 0) FROM (
                SELECT SUM(energy_wh_delta) / 1000.0 AS daily_total
                FROM telemetry_raw
                WHERE device_id = :device_id
                  AND ts >= :cutoff
                GROUP BY date_trunc('day', ts)
            ) sub
        """),
        {"device_id": str(device_id), "cutoff": now.replace(day=max(1, now.day - 7))},
    ).scalar() or 0.0

    earliest_reading = db.execute(
        text("SELECT MIN(ts) FROM telemetry_raw WHERE device_id = :device_id"),
        {"device_id": str(device_id)},
    ).scalar()
    days_history = (now - earliest_reading).days if earliest_reading else 0

    prediction = predict_bill(
        cumulative_kwh_so_far=float(cumulative_kwh_so_far),
        day_of_month=now.day,
        rolling_avg_daily_kwh_7d=float(rolling_avg_daily_kwh_7d),
        days_history=days_history,
    )

    prediction["predicted_bill_egp"] = calculate_bill(prediction["predicted_kwh"])
    return prediction