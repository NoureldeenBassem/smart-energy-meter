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
        Appliance(
            user_id=user.user_id, name="Refrigerator", rated_power_w=150,
            priority="High", desired_daily_hours=24,
        ),
        Appliance(
            user_id=user.user_id, name="Air Conditioner", rated_power_w=1500,
            priority="Medium", desired_daily_hours=5,
        ),
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