from __future__ import annotations

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.security import TokenValidationError, decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    try:
        payload = decode_access_token(token)
    except TokenValidationError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user_id = payload.get("sub")
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admins only")
    return user


def require_worker(user: User = Depends(get_current_user)) -> User:
    if not user.is_worker_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Worker mode is disabled")
    return user


def require_employer(user: User = Depends(get_current_user)) -> User:
    if not user.is_employer_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Employer mode is disabled")
    return user
