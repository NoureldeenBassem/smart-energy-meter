from uuid import UUID
from datetime import datetime, date
from typing import Optional, List, Literal
from pydantic import BaseModel, EmailStr

# Auth Schemas
class UserCreate(BaseModel):
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"

# Appliance Schemas
class ApplianceCreate(BaseModel):
    name: str
    rated_power_w: float
    priority: Literal["High", "Medium", "Low"] = "Medium"
    desired_daily_hours: float = 2.0

class ApplianceOut(BaseModel):
    appliance_id: UUID
    name: str
    rated_power_w: float
    priority: str
    desired_daily_hours: float

    class Config:
        from_attributes = True


# Device Schemas
class DeviceCreate(BaseModel):
    external_id: str
    device_label: str = "Main Energy Meter"

class DeviceOut(BaseModel):
    device_id: UUID
    external_id: str
    device_label: str

    class Config:
        from_attributes = True

# Budget & Recommendation Schemas
class BudgetCreate(BaseModel):
    target_bill_egp: float
    alert_threshold_pct: Optional[int] = 85

class BudgetOut(BaseModel):
    budget_id: UUID
    target_bill_egp: float
    alert_threshold_pct: int

    class Config:
        from_attributes = True

class ApplianceAllocation(BaseModel):
    appliance_id: str
    name: str
    rated_power_w: float
    priority: str
    recommended_runtime_hours: float
    status: str
    action_note: str

class RecommendationDashboardOut(BaseModel):
    active_mode: str
    target_bill_egp: float
    days_remaining_in_month: int
    daily_kwh_allowance: float
    allocations: List[ApplianceAllocation]

# Telemetry Schemas
class TelemetryDashboardOut(BaseModel):
    device_id: UUID
    voltage: float
    current: float
    active_power: float
    power_factor: float
    today_energy_kwh: float
    month_energy_kwh: float
    last_updated: datetime

class HourlyBucket(BaseModel):
    bucket_start: datetime
    avg_power_w: float
    total_energy_kwh: float

class DailyBucket(BaseModel):
    bucket_start: date
    total_energy_kwh: float
    avg_power_w: Optional[float]
    peak_power_w: Optional[float]