from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(32), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    active_mode: Mapped[str] = mapped_column(String(32), default="worker", nullable=False)
    is_worker_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_employer_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(512))
    bio: Mapped[Optional[str]] = mapped_column(Text)
    rating_avg: Mapped[Decimal] = mapped_column(Numeric(3, 2), default=Decimal("0.00"), nullable=False)
    reviews_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    completed_orders: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    posted_orders: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    balance: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    worker_profile: Mapped["WorkerProfile"] = relationship(back_populates="user", uselist=False)
    employer_profile: Mapped["EmployerProfile"] = relationship(back_populates="user", uselist=False)


class WorkerProfile(Base):
    __tablename__ = "worker_profiles"

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), primary_key=True)
    categories: Mapped[Optional[str]] = mapped_column(Text)
    experience: Mapped[Optional[str]] = mapped_column(Text)
    lat: Mapped[Optional[Decimal]] = mapped_column(Numeric(9, 6))
    lng: Mapped[Optional[Decimal]] = mapped_column(Numeric(9, 6))
    default_radius_km: Mapped[int] = mapped_column(Integer, default=10, nullable=False)

    user: Mapped[User] = relationship(back_populates="worker_profile")


class EmployerProfile(Base):
    __tablename__ = "employer_profiles"

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), primary_key=True)
    company_name: Mapped[Optional[str]] = mapped_column(String(255))
    address: Mapped[Optional[str]] = mapped_column(String(500))
    inn: Mapped[Optional[str]] = mapped_column(String(32))
    bank_details: Mapped[Optional[str]] = mapped_column(Text)

    user: Mapped[User] = relationship(back_populates="employer_profile")


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    employer_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    assigned_worker_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(120), nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    address: Mapped[str] = mapped_column(String(500), nullable=False)
    lat: Mapped[Decimal] = mapped_column(Numeric(9, 6), nullable=False)
    lng: Mapped[Decimal] = mapped_column(Numeric(9, 6), nullable=False)
    scheduled_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String(32), default="published", nullable=False, index=True)
    escrow_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class OrderResponse(Base):
    __tablename__ = "order_responses"
    __table_args__ = (UniqueConstraint("order_id", "worker_id", name="uq_order_worker_response"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    order_id: Mapped[str] = mapped_column(String(36), ForeignKey("orders.id"), nullable=False)
    worker_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    comment: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    order_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("orders.id"))
    tx_type: Mapped[str] = mapped_column(String(32), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="completed", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class Review(Base):
    __tablename__ = "reviews"
    __table_args__ = (UniqueConstraint("order_id", "author_id", "recipient_id", name="uq_review_once"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    order_id: Mapped[str] = mapped_column(String(36), ForeignKey("orders.id"), nullable=False)
    author_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    recipient_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    order_id: Mapped[str] = mapped_column(String(36), ForeignKey("orders.id"), nullable=False, index=True)
    author_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
