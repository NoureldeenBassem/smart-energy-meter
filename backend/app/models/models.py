import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, Integer, Boolean, Date, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.core.database import Base


class User(Base):
    __tablename__ = "users"
    user_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    devices = relationship("Device", back_populates="user", cascade="all, delete-orphan")
    appliances = relationship("Appliance", back_populates="user", cascade="all, delete-orphan")
    budgets = relationship("Budget", back_populates="user", cascade="all, delete-orphan")


class Device(Base):
    __tablename__ = "devices"
    device_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)

    # FIX 1: required by telemetry_worker.py to match incoming MQTT packets
    # (payload's "device_id" field, e.g. "esp32_meter_01") against a device row.
    external_id = Column(String(100), unique=True, nullable=False, index=True)

    device_label = Column(String(100), default="Main Energy Meter")

    # FIX 1: heartbeat timestamp, updated by the worker on every ingested packet.
    # Used by the dashboard to compute is_online.
    last_seen_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="devices")
    telemetry_raw = relationship("TelemetryRaw", back_populates="device", cascade="all, delete-orphan")
    telemetry_hourly = relationship("TelemetryHourly", back_populates="device", cascade="all, delete-orphan")
    telemetry_daily = relationship("TelemetryDaily", back_populates="device", cascade="all, delete-orphan")
    bills_predicted = relationship("BillPredicted", back_populates="device", cascade="all, delete-orphan")


class Appliance(Base):
    """
    A household appliance the user wants included in the daily load plan.

    is_essential AND priority ARE NOT THE SAME THING
    ------------------------------------------------
    is_essential is a HARD constraint: the allocator reserves the appliance's full
    desired runtime before it allocates anything else, and never reduces it — in
    any mode, including "away". A fridge, a medical device, or a water pump belongs
    here. Marking something essential is a claim that switching it off causes real
    harm, not merely inconvenience.

    priority is a SOFT ordering used only to decide which NON-essential appliances
    get the remaining allowance first. A high-priority non-essential still gets
    trimmed or shed when the budget runs out.

    Conflating the two was a real bug: "High priority" was read as "essential", so
    the fridge was protected only by accident — it kept its full 24 h whenever it
    happened to fit inside the allowance, and was cut to 9.8 h (or shut off
    entirely in away mode) whenever it did not.
    """
    __tablename__ = "appliances"
    appliance_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    rated_power_w = Column(Float, nullable=False)
    priority = Column(String(20), default="Medium")  # High, Medium, Low — soft ordering only
    is_essential = Column(Boolean, nullable=False, default=False)  # hard: never restricted
    desired_daily_hours = Column(Float, default=2.0)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="appliances")


class Budget(Base):
    __tablename__ = "budgets"
    budget_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    target_bill_egp = Column(Float, nullable=False, default=500.0)
    alert_threshold_pct = Column(Integer, default=85)  # kept — wired into Group 2 recommendation engine
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="budgets")


# ---------------------------------------------------------------------------
# FIX 2: Telemetry tables, now real ORM models instead of hand-written SQL
# only. This makes models.py the single source of truth for the schema.
# ---------------------------------------------------------------------------

class TelemetryRaw(Base):
    __tablename__ = "telemetry_raw"
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.device_id", ondelete="CASCADE"), primary_key=True)
    ts = Column(DateTime(timezone=True), primary_key=True)
    voltage_rms = Column(Float)
    current_rms = Column(Float)
    power_w = Column(Float)
    power_factor = Column(Float)
    energy_wh_delta = Column(Float, nullable=False)
    is_backfilled = Column(Boolean, nullable=False, default=False)
    received_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    device = relationship("Device", back_populates="telemetry_raw")


class TelemetryHourly(Base):
    __tablename__ = "telemetry_hourly"
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.device_id", ondelete="CASCADE"), primary_key=True)
    bucket_start = Column(DateTime(timezone=True), primary_key=True)
    total_energy_kwh = Column(Float, nullable=False)
    avg_power_w = Column(Float)
    peak_power_w = Column(Float)

    device = relationship("Device", back_populates="telemetry_hourly")


class TelemetryDaily(Base):
    __tablename__ = "telemetry_daily"
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.device_id", ondelete="CASCADE"), primary_key=True)
    bucket_start = Column(Date, primary_key=True)
    total_energy_kwh = Column(Float, nullable=False)
    avg_power_w = Column(Float)
    peak_power_w = Column(Float)

    device = relationship("Device", back_populates="telemetry_daily")


class BillPredicted(Base):
    """
    An append-only LOG of bill forecasts, one row per snapshot.

    This is deliberately not an upsert-latest table. Each row records what the
    forecaster predicted at a point in time, so the history is preserved and two
    things become possible that a single overwritten row cannot support:

      1. showing how the forecast moved as the cycle progressed;
      2. measuring accuracy after the fact — once a cycle closes, the actual kWh
         is known and can be compared against what was predicted on day 5, day 12,
         day 20. That turns the accuracy claim into something checkable on this
         household's real data rather than only on the public UCI dataset.

    UNITS: confidence_low / confidence_high are in kWh, matching predicted_kwh,
    not EGP. The money band is derived by running those kWh bounds through the
    tariff engine (services/tariff.calculate_bill), so storing kWh loses nothing
    while storing EGP would lose the kWh. predicted_bill_egp is stored because it
    is the number the user was actually shown.

    model_version records what produced the number: the model version on a real
    model prediction, or "naive-baseline-v1" when the serving guards refused the
    model and the baseline was served instead. A fallback is therefore never
    logged as if a model had made it.
    """
    __tablename__ = "bills_predicted"
    prediction_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_id = Column(UUID(as_uuid=True), ForeignKey("devices.device_id", ondelete="CASCADE"), nullable=False)
    billing_period_start = Column(Date, nullable=False)
    billing_period_end = Column(Date, nullable=False)
    predicted_kwh = Column(Float, nullable=False)
    predicted_bill_egp = Column(Float, nullable=False)
    confidence_low = Column(Float)          # kWh
    confidence_high = Column(Float)         # kWh
    model_version = Column(String(50), nullable=False)
    generated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    device = relationship("Device", back_populates="bills_predicted")

class TariffBracketRow(Base):
    """
    The tariff schedule as stored in the database, for auditability and version
    history — which bracket set applied from which effective_date.

    NOT the authority for billing. `EGYPT_TARIFF_BRACKETS` in
    app/services/tariff_engine/calculator.py is the single canonical definition
    and is what every bill is actually computed from. This table is a record of
    it, so a future tariff change can be dated rather than silently repricing
    history.

    Named TariffBracketRow, not TariffBracket, because the calculator already
    exports a frozen dataclass by that name. Two types describing the same thing
    with the same name in one codebase is how the two quietly get swapped.

    It exists as an ORM model so that create_all() and schema.sql produce the
    same set of tables. Previously it had no model, so a database built from the
    ORM was missing it entirely — see SUBMISSION_STATUS.md §5.
    """
    __tablename__ = "tariff_brackets"
    tariff_version_id = Column(Integer, primary_key=True)
    bracket_order = Column(Integer, primary_key=True)
    kwh_from = Column(Float, nullable=False)
    kwh_to = Column(Float)                  # NULL = unbounded top bracket
    price_per_kwh = Column(Float, nullable=False)
    effective_date = Column(Date, nullable=False)


class Recommendation(Base):
    """
    A persisted daily appliance plan — one row per appliance per day, so a past
    day's plan can be shown exactly as it was given rather than recomputed
    against today's budget and today's consumption.

    Recomputing a past plan would silently rewrite history: the allocator divides
    the REMAINING budget over the REMAINING days, so replaying day 5's inputs on
    day 20 produces a different answer than the user actually saw.

    `status` mirrors the allocator's own vocabulary — essential / optimal /
    constrained / shed / away — so a stored row is readable without re-deriving
    why an appliance got the hours it got.
    """
    __tablename__ = "recommendations"
    recommendation_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    appliance_id = Column(UUID(as_uuid=True), ForeignKey("appliances.appliance_id", ondelete="CASCADE"), nullable=False)
    budget_id = Column(UUID(as_uuid=True), ForeignKey("budgets.budget_id", ondelete="SET NULL"))
    plan_date = Column(Date, nullable=False)
    recommended_daily_hours = Column(Float, nullable=False)
    status = Column(String(20))
    generated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
