"""
Application entry point. Wires together all routers, CORS, and
(optionally) table creation on startup for local development.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.database import Base, engine
from app.models import models  # noqa: F401 — registers all models with Base before create_all

from app.api.routes import auth, tariff, budgets, appliances, telemetry, devices, predictions


app = FastAPI(
    title="Smart Energy Meter API",
    version="1.0.0",
    description="IoT Smart Energy Meter backend — tariff engine, recommendation engine, telemetry ingestion.",
)

# CORS — restricted to the local Next.js dev server, not a wildcard.
# Wildcard origins ("*") don't work with allow_credentials=True anyway,
# and being explicit here is the correct default even for a dev project.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1")
app.include_router(tariff.router, prefix="/api/v1")
app.include_router(budgets.router, prefix="/api/v1")
app.include_router(appliances.router, prefix="/api/v1")
app.include_router(telemetry.router, prefix="/api/v1")
app.include_router(devices.router, prefix="/api/v1")
app.include_router(predictions.router, prefix="/api/v1")

@app.on_event("startup")
def on_startup():
    # Ensures tables exist even if create_tables.py was never run manually.
    # Safe to call every time — create_all() only creates missing tables,
    # never touches existing ones.
    Base.metadata.create_all(bind=engine)


@app.get("/health")
def health_check():
    return {"status": "healthy", "service": "smart-energy-meter-backend"}