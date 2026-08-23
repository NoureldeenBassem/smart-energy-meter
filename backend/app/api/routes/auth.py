"""
Auth routes: register and login. Issues a long-lived (1-year) JWT,
matching ACCESS_TOKEN_EXPIRE_MINUTES in core/security.py.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.models.models import Appliance
from app.core.database import get_db
from app.core.security import hash_password, verify_password, create_access_token
from app.models.models import User
from app.api.schemas import UserCreate, UserLogin, TokenOut

router = APIRouter(prefix="/auth", tags=["auth"])


# ---------------------------------------------------------------------------
# Starter appliances seeded on registration.
#
# is_essential IS SET EXPLICITLY ON EVERY ENTRY, AND MUST STAY THAT WAY.
#
# These two rows exist to demonstrate the distinction the whole allocator is
# built on: `is_essential` is a HARD protection flag, and `priority` is only a
# soft ordering among appliances that are NOT protected. A High priority does
# not imply protection.
#
# The refrigerator was previously seeded with priority="High" and no
# is_essential, so it defaulted to FALSE and the allocator was free to shed it —
# measured on the seeded account: cut to 5.7 h/day in eco mode and to 0.0 h in
# away mode. That is the same fake guarantee written up in SUBMISSION_STATUS.md
# §4. The engine was fixed there and existing rows were migrated, but THIS
# creation path was missed, so every newly registered account silently received
# an unprotected fridge while the demo account looked correct.
#
# Kept at module level, rather than inline in the handler, so the guarantee is
# unit-testable without a database. See tests/test_starter_appliances.py.
# ---------------------------------------------------------------------------
STARTER_APPLIANCE_SPECS = [
    {
        "name": "Refrigerator", "rated_power_w": 150,
        "is_essential": True,    # protected: never restricted, in any mode
        "priority": "High", "desired_daily_hours": 24,
    },
    {
        "name": "Air Conditioner", "rated_power_w": 1500,
        "is_essential": False,   # discretionary: trimmed to fit the budget
        "priority": "Medium", "desired_daily_hours": 5,
    },
]


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Seed sensible defaults so a brand-new account's dashboard isn't
    # empty on first view — real rows, not fake display data.
    starter_appliances = [
        Appliance(user_id=user.user_id, **spec) for spec in STARTER_APPLIANCE_SPECS
    ]
    db.add_all(starter_appliances)
    db.commit()

    token = create_access_token({"sub": str(user.user_id)})
    return TokenOut(access_token=token)


@router.post("/login", response_model=TokenOut)
def login(payload: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    token = create_access_token({"sub": str(user.user_id)})
    return TokenOut(access_token=token)