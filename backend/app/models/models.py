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


class Appliance(Base):
    __tablename__ = "appliances"
    appliance_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    rated_power_w = Column(Float, nullable=False)
    priority = Column(String(20), default="Medium")  # High, Medium, Low
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