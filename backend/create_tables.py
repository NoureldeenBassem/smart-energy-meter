"""
One-time (or repeatable) script to create all tables defined in models.py.
Run from the backend/ directory with your virtual environment active:

    python create_tables.py

Safe to re-run: SQLAlchemy's create_all() only creates tables that don't
already exist — it won't touch or drop existing ones.
"""

from app.core.database import Base, engine
from app.models import models  # noqa: F401 — import ensures all model classes register with Base

def main():
    print("[*] Creating tables from models.py ...")
    Base.metadata.create_all(bind=engine)
    print("[✓] Done. Tables created:")
    for table_name in Base.metadata.tables.keys():
        print(f"    - {table_name}")

if __name__ == "__main__":
    main()