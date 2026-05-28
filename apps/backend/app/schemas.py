from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, EmailStr, Field


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: str = Field(min_length=2, max_length=255)
    phone: str | None = None
    active_mode: str = "worker"


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class WorkerProfileIn(BaseModel):
    categories: str | None = None
    experience: str | None = None
    lat: Decimal | None = None
    lng: Decimal | None = None
    default_radius_km: int = Field(default=10, ge=1, le=500)


class EmployerProfileIn(BaseModel):
    company_name: str | None = None
    address: str | None = None
    inn: str | None = None
    bank_details: str | None = None


class ProfilePatchIn(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=255)
    phone: str | None = None
    avatar_url: str | None = None
    bio: str | None = None
    active_mode: str | None = None
    worker: WorkerProfileIn | None = None
    employer: EmployerProfileIn | None = None


class WorkerProfileOut(WorkerProfileIn):
    pass


class EmployerProfileOut(EmployerProfileIn):
    pass


class UserOut(BaseModel):
    id: str
    email: EmailStr
    phone: str | None
    full_name: str
    active_mode: str
    is_worker_enabled: bool
    is_employer_enabled: bool
    avatar_url: str | None
    bio: str | None
    rating_avg: Decimal
    reviews_count: int
    completed_orders: int
    posted_orders: int
    balance: Decimal
    is_admin: bool
    worker: WorkerProfileOut | None = None
    employer: EmployerProfileOut | None = None

    class Config:
        from_attributes = True


class OrderCreateIn(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    description: str | None = None
    category: str = Field(min_length=2, max_length=120)
    price: Decimal = Field(gt=0)
    address: str = Field(min_length=3, max_length=500)
    lat: Decimal | None = None
    lng: Decimal | None = None
    scheduled_at: datetime | None = None


class OrderPatchIn(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=255)
    description: str | None = None
    category: str | None = Field(default=None, min_length=2, max_length=120)
    price: Decimal | None = Field(default=None, gt=0)
    address: str | None = Field(default=None, min_length=3, max_length=500)
    lat: Decimal | None = None
    lng: Decimal | None = None
    scheduled_at: datetime | None = None


class OrderOut(BaseModel):
    id: str
    employer_id: str
    assigned_worker_id: str | None
    title: str
    description: str | None
    category: str
    price: Decimal
    address: str
    lat: Decimal
    lng: Decimal
    scheduled_at: datetime | None
    status: str
    escrow_amount: Decimal
    created_at: datetime
    distance_km: float | None = None
    employer_name: str | None = None
    employer_rating_avg: Decimal | None = None
    employer_reviews_count: int | None = None

    class Config:
        from_attributes = True


class ResponseCreateIn(BaseModel):
    comment: str | None = Field(default=None, max_length=1000)


class ResponseOut(BaseModel):
    id: str
    order_id: str
    worker_id: str
    comment: str | None
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class AssignWorkerIn(BaseModel):
    response_id: str


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


class MessageOut(BaseModel):
    id: str
    order_id: str
    author_id: str
    text: str
    created_at: datetime

    class Config:
        from_attributes = True


class TopUpIn(BaseModel):
    amount: Decimal = Field(gt=0)


class WalletOut(BaseModel):
    balance: Decimal


class TransactionOut(BaseModel):
    id: str
    user_id: str
    order_id: str | None
    tx_type: str
    amount: Decimal
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class ReviewIn(BaseModel):
    recipient_id: str
    rating: int = Field(ge=1, le=5)
    text: str | None = Field(default=None, max_length=2000)


class ReviewOut(BaseModel):
    id: str
    order_id: str
    author_id: str
    recipient_id: str
    rating: int
    text: str | None
    created_at: datetime

    class Config:
        from_attributes = True
