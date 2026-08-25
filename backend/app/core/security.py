import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from jose import jwt, JWTError
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# JWT signing key.
#
# THERE IS NO HARDCODED FALLBACK, DELIBERATELY.
# This previously read `os.getenv("SECRET_KEY", "smart_meter_super_secret_...")`,
# which meant the real signing key of any deployment that had not set the
# environment variable was sitting in the repository. Anyone reading the source
# could mint a token for any user id and the API would accept it — the
# ownership checks in every route filter on the token's subject, so a forged
# subject is a full account takeover.
#
# Instead an ephemeral key is generated per process when SECRET_KEY is unset.
# Consequences, both intended:
#   * tests and a fresh `uvicorn` still run with no configuration;
#   * tokens do not survive a restart, which is a visible nuisance in
#     development and the correct outcome in anything else — it makes an unset
#     key impossible to ignore rather than silently insecure.
# Set SECRET_KEY in backend/.env for a key that persists (see .env.example).
# ---------------------------------------------------------------------------
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    SECRET_KEY = secrets.token_urlsafe(48)
    logger.warning(
        "SECRET_KEY is not set - generated an ephemeral signing key for this "
        "process. Tokens will be invalidated on restart. Set SECRET_KEY in "
        "backend/.env before any real deployment."
    )

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 365  # 1-year long-lived token

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict, expires_delta: timedelta = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user_id(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
        return user_id
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate credentials")