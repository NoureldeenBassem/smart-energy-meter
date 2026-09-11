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

class UserOut(BaseModel):
    user_id: UUID
    email: EmailStr

# Appliance Schemas
class ApplianceCreate(BaseModel):
    name: str
    rated_power_w: float
    priority: Literal["High", "Medium", "Low"] = "Medium"
    # Hard protection: the allocator reserves this appliance's full runtime before
    # allocating anything else and never trims it, in any mode. Distinct from
    # priority, which only orders the NON-essential appliances. Defaults to False
    # so protection is always an explicit choice.
    is_essential: bool = False
    desired_daily_hours: float = 2.0

class ApplianceOut(BaseModel):
    appliance_id: UUID
    name: str
    rated_power_w: float
    priority: str
    is_essential: bool
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
    is_essential: bool          # frontend renders these locked / non-adjustable
    recommended_runtime_hours: float
    estimated_kwh: float
    status: str                 # essential | optimal | constrained | shed | away
    action_note: str

class BudgetAlertOut(BaseModel):
    pct_of_budget_used: float
    alert_threshold_pct: int
    alert_triggered: bool
    message: Optional[str] = None

class RecommendationDashboardOut(BaseModel):
    active_mode: str
    target_bill_egp: float
    days_remaining_in_month: int
    daily_kwh_allowance: float          # what this plan targets = essential + discretionary
    budget_daily_kwh: float             # the even daily share of the remaining budget
    essential_kwh: float                # reserved before allocation, never reducible
    discretionary_kwh_allowance: float  # what the greedy loop had to spend
    total_allocated_kwh: float
    within_budget: bool                 # total_allocated_kwh <= budget_daily_kwh
    budget_note: Optional[str] = None   # set only when within_budget is False
    allocations: List[ApplianceAllocation]
    alert: BudgetAlertOut

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


# ---------------------------------------------------------------------------
# Telemetry ingestion (POST /telemetry)
#
# Field-level validation lives in app/services/telemetry/ingest.py so the MQTT
# worker enforces exactly the same rules. This schema is deliberately permissive
# about types and defers the real checks there, rather than having two
# validators that can disagree about what a valid reading is.
# ---------------------------------------------------------------------------
class TelemetryIngestIn(BaseModel):
    device_id: str                          # external id, e.g. "esp32_meter_01"
    energy_wh_delta: float                  # Wh since previous reading, NOT cumulative
    timestamp: Optional[datetime] = None    # when the DEVICE measured it
    voltage_rms: Optional[float] = None
    current_rms: Optional[float] = None
    power_w: Optional[float] = None
    power_factor: Optional[float] = None
    is_backfilled: bool = False             # replayed from the device's local buffer


class TelemetryIngestOut(BaseModel):
    accepted: bool
    stored: bool                            # False => duplicate reading, ignored
    duplicate: bool
    device_id: UUID
    ts: datetime
    timestamp_source: str                   # "device" | "arrival"


class DeviceLiveOut(BaseModel):
    device_id: UUID
    external_id: Optional[str]
    is_online: bool
    last_seen_at: Optional[datetime]
    seconds_since_last_seen: Optional[float]
    voltage_rms: Optional[float]
    current_rms: Optional[float]
    power_w: Optional[float]
    power_factor: Optional[float]
    reading_ts: Optional[datetime]
    today_energy_kwh: float
    month_energy_kwh: float
    reading_is_backfilled: Optional[bool]

# NILM Schemas
class ApplianceActivityOut(BaseModel):
    appliance_id: UUID
    name: str
    is_essential: bool
    on_events: int
    estimated_runtime_hours: float
    estimated_energy_kwh: float


class NilmBreakdownOut(BaseModel):
    window_start: datetime
    window_end: datetime
    sample_count: int
    total_events: int
    matched_events: int
    unmatched_events: int    # step change no registered appliance's wattage explains
    ambiguous_events: int    # step change more than one registered appliance could explain
    appliances: List[ApplianceActivityOut]
