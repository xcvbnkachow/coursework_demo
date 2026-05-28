from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.config import settings
from app.enums import OrderStatus, ResponseStatus, TransactionStatus, TransactionType
from app.geo import detect_region, haversine_km
from app.geocoding import address_has_house_number, geocode_address
from app.models import EmployerProfile, Message, Order, OrderResponse, Review, Transaction, User, WorkerProfile
from app.schemas import EmployerProfileIn, OrderCreateIn, OrderPatchIn, ProfilePatchIn, RegisterIn, WorkerProfileIn
from app.security import create_access_token, hash_password, verify_password


def to_money(value: Decimal) -> Decimal:
    return Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def serialize_user(user: User) -> dict:
    worker = None
    if user.worker_profile:
        worker = {
            "categories": user.worker_profile.categories,
            "experience": user.worker_profile.experience,
            "lat": user.worker_profile.lat,
            "lng": user.worker_profile.lng,
            "default_radius_km": user.worker_profile.default_radius_km,
        }
    employer = None
    if user.employer_profile:
        employer = {
            "company_name": user.employer_profile.company_name,
            "address": user.employer_profile.address,
            "inn": user.employer_profile.inn,
            "bank_details": user.employer_profile.bank_details,
        }
    return {
        "id": user.id,
        "email": user.email,
        "phone": user.phone,
        "full_name": user.full_name,
        "active_mode": user.active_mode,
        "is_worker_enabled": user.is_worker_enabled,
        "is_employer_enabled": user.is_employer_enabled,
        "avatar_url": user.avatar_url,
        "bio": user.bio,
        "rating_avg": user.rating_avg,
        "reviews_count": user.reviews_count,
        "completed_orders": user.completed_orders,
        "posted_orders": user.posted_orders,
        "balance": user.balance,
        "is_admin": user.is_admin,
        "worker": worker,
        "employer": employer,
    }


def register_user(db: Session, payload: RegisterIn) -> tuple[User, str]:
    existing = db.execute(select(User).where(User.email == payload.email)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = User(
        email=str(payload.email),
        phone=payload.phone,
        full_name=payload.full_name.strip(),
        active_mode=payload.active_mode,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.flush()
    db.add(WorkerProfile(user_id=user.id))
    db.add(EmployerProfile(user_id=user.id))
    db.commit()
    db.refresh(user)
    return user, create_access_token(user.id)


def login_user(db: Session, email: str, password: str) -> tuple[User, str]:
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return user, create_access_token(user.id)


def _upsert_worker_profile(db: Session, user: User, payload: WorkerProfileIn) -> None:
    profile = user.worker_profile or WorkerProfile(user_id=user.id)
    profile.categories = payload.categories
    profile.experience = payload.experience
    profile.lat = payload.lat
    profile.lng = payload.lng
    profile.default_radius_km = payload.default_radius_km
    db.add(profile)


def _upsert_employer_profile(db: Session, user: User, payload: EmployerProfileIn) -> None:
    profile = user.employer_profile or EmployerProfile(user_id=user.id)
    profile.company_name = payload.company_name
    profile.address = payload.address
    profile.inn = payload.inn
    profile.bank_details = payload.bank_details
    db.add(profile)


def update_profile(db: Session, user: User, payload: ProfilePatchIn) -> User:
    if payload.full_name is not None:
        user.full_name = payload.full_name.strip()
    if payload.phone is not None:
        user.phone = payload.phone
    if payload.avatar_url is not None:
        user.avatar_url = payload.avatar_url
    if payload.bio is not None:
        user.bio = payload.bio
    if payload.active_mode is not None:
        if payload.active_mode not in {"worker", "employer"}:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid active_mode")
        user.active_mode = payload.active_mode
    if payload.worker is not None:
        _upsert_worker_profile(db, user, payload.worker)
    if payload.employer is not None:
        _upsert_employer_profile(db, user, payload.employer)

    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def create_order(db: Session, employer: User, payload: OrderCreateIn) -> Order:
    if not address_has_house_number(payload.address):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Адрес должен содержать номер дома")
    lat = payload.lat
    lng = payload.lng
    if lat is None or lng is None:
        lat, lng = geocode_address(payload.address)

    order = Order(
        employer_id=employer.id,
        title=payload.title.strip(),
        description=payload.description,
        category=payload.category.strip(),
        price=to_money(payload.price),
        address=payload.address.strip(),
        lat=lat,
        lng=lng,
        scheduled_at=payload.scheduled_at,
        status=OrderStatus.published.value,
    )
    employer.posted_orders += 1
    db.add(order)
    db.add(employer)
    db.commit()
    db.refresh(order)
    return order


def list_nearby_orders(
    db: Session,
    *,
    lat: Decimal,
    lng: Decimal,
    radius_km: int,
    category: str | None = None,
    min_price: Decimal | None = None,
    max_price: Decimal | None = None,
) -> list[tuple[Order, float]]:
    stmt = select(Order).where(Order.status.in_([OrderStatus.published.value, OrderStatus.responded.value]))
    if category:
        stmt = stmt.where(Order.category == category)
    if min_price is not None:
        stmt = stmt.where(Order.price >= min_price)
    if max_price is not None:
        stmt = stmt.where(Order.price <= max_price)

    rows = db.execute(stmt.order_by(Order.created_at.desc())).scalars().all()
    result: list[tuple[Order, float]] = []
    worker_region = detect_region(lat, lng)
    for order in rows:
        distance = haversine_km(lat, lng, order.lat, order.lng)
        order_region = detect_region(order.lat, order.lng)
        if worker_region and order_region and worker_region != order_region:
            continue
        result.append((order, round(distance, 2)))
    return sorted(result, key=lambda item: (item[1], item[0].created_at), reverse=False)


def list_my_orders(db: Session, user: User) -> list[Order]:
    stmt = select(Order).where(or_(Order.employer_id == user.id, Order.assigned_worker_id == user.id))
    return list(db.execute(stmt.order_by(Order.created_at.desc())).scalars().all())


def get_order_or_404(db: Session, order_id: str) -> Order:
    order = db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return order


def ensure_order_participant(order: Order, user: User) -> None:
    if user.is_admin:
        return
    if order.employer_id != user.id and order.assigned_worker_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


def update_order(db: Session, employer: User, order_id: str, payload: OrderPatchIn) -> Order:
    order = get_order_or_404(db, order_id)
    if order.employer_id != employer.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    if order.status not in {OrderStatus.published.value, OrderStatus.responded.value}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Order can no longer be edited")

    for field in ("title", "description", "category", "price", "address", "lat", "lng", "scheduled_at"):
        value = getattr(payload, field)
        if value is not None:
            setattr(order, field, to_money(value) if field == "price" else value)
    db.add(order)
    db.commit()
    db.refresh(order)
    return order


def respond_to_order(db: Session, worker: User, order_id: str, comment: str | None) -> OrderResponse:
    order = get_order_or_404(db, order_id)
    if order.employer_id == worker.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot respond to own order")
    if order.status not in {OrderStatus.published.value, OrderStatus.responded.value}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Order is not accepting responses")

    existing = db.execute(
        select(OrderResponse).where(OrderResponse.order_id == order_id, OrderResponse.worker_id == worker.id)
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already responded")

    response = OrderResponse(order_id=order_id, worker_id=worker.id, comment=comment)
    order.status = OrderStatus.responded.value
    db.add(response)
    db.add(order)
    db.commit()
    db.refresh(response)
    return response


def assign_worker(db: Session, employer: User, order_id: str, response_id: str) -> Order:
    order = get_order_or_404(db, order_id)
    if order.employer_id != employer.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    if order.status not in {OrderStatus.responded.value, OrderStatus.published.value}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Order can no longer be assigned")

    response = db.get(OrderResponse, response_id)
    if response is None or response.order_id != order_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Response not found")

    response.status = ResponseStatus.accepted.value
    order.assigned_worker_id = response.worker_id
    order.status = OrderStatus.assigned.value
    db.execute(
        select(OrderResponse).where(OrderResponse.order_id == order_id, OrderResponse.id != response_id)
    )
    for other in db.execute(select(OrderResponse).where(OrderResponse.order_id == order_id, OrderResponse.id != response_id)).scalars():
        other.status = ResponseStatus.rejected.value
        db.add(other)
    db.add(response)
    db.add(order)
    db.commit()
    db.refresh(order)
    return order


def add_transaction(db: Session, user_id: str, tx_type: TransactionType, amount: Decimal, order_id: str | None = None) -> None:
    db.add(
        Transaction(
            user_id=user_id,
            order_id=order_id,
            tx_type=tx_type.value,
            amount=to_money(amount),
            status=TransactionStatus.completed.value,
        )
    )


def top_up_wallet(db: Session, user: User, amount: Decimal) -> User:
    user.balance = to_money(user.balance + amount)
    add_transaction(db, user.id, TransactionType.top_up, amount)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def start_order(db: Session, employer: User, order_id: str) -> Order:
    order = get_order_or_404(db, order_id)
    if order.employer_id != employer.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    if order.status != OrderStatus.assigned.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only assigned orders can be started")

    employer_commission = to_money(order.price * Decimal(str(settings.PLATFORM_COMMISSION_PERCENT)) / Decimal("100"))
    hold_amount = to_money(order.price + employer_commission)
    if employer.balance < hold_amount:
        demo_top_up = to_money(hold_amount - employer.balance)
        employer.balance = to_money(employer.balance + demo_top_up)
        add_transaction(db, employer.id, TransactionType.top_up, demo_top_up, order.id)

    employer.balance = to_money(employer.balance - hold_amount)
    order.escrow_amount = hold_amount
    order.status = OrderStatus.in_progress.value
    add_transaction(db, employer.id, TransactionType.escrow_hold, order.price, order.id)
    add_transaction(db, employer.id, TransactionType.employer_commission, employer_commission, order.id)
    db.add(employer)
    db.add(order)
    db.commit()
    db.refresh(order)
    return order


def complete_order(db: Session, employer: User, order_id: str) -> Order:
    order = get_order_or_404(db, order_id)
    if order.employer_id != employer.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only employer can complete order")
    if order.status != OrderStatus.in_progress.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only in-progress orders can be completed")
    if not order.assigned_worker_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No assigned worker")

    worker = db.get(User, order.assigned_worker_id)
    if not worker:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Assigned worker missing")

    worker_commission = to_money(order.price * Decimal(str(settings.PLATFORM_COMMISSION_PERCENT)) / Decimal("100"))
    payout = to_money(order.price - worker_commission)
    worker.balance = to_money(worker.balance + payout)
    worker.completed_orders += 1
    order.status = OrderStatus.completed.value
    add_transaction(db, worker.id, TransactionType.worker_payout, payout, order.id)
    add_transaction(db, worker.id, TransactionType.worker_commission, worker_commission, order.id)
    db.add(worker)
    db.add(order)
    db.commit()
    db.refresh(order)
    return order


def cancel_order(db: Session, employer: User, order_id: str) -> Order:
    order = get_order_or_404(db, order_id)
    if order.employer_id != employer.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    if order.status in {OrderStatus.completed.value, OrderStatus.cancelled.value}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Order cannot be cancelled")
    if order.status == OrderStatus.in_progress.value and order.escrow_amount > 0:
        employer.balance = to_money(employer.balance + order.escrow_amount)
        add_transaction(db, employer.id, TransactionType.refund, order.escrow_amount, order.id)
        db.add(employer)
    order.status = OrderStatus.cancelled.value
    db.add(order)
    db.commit()
    db.refresh(order)
    return order


def create_message(db: Session, user: User, order_id: str, text: str) -> Message:
    order = get_order_or_404(db, order_id)
    ensure_order_participant(order, user)
    if order.status not in {OrderStatus.assigned.value, OrderStatus.in_progress.value}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Chat is not available for this order")
    message = Message(order_id=order_id, author_id=user.id, text=text)
    db.add(message)
    db.commit()
    db.refresh(message)
    return message


def list_messages(db: Session, user: User, order_id: str) -> list[Message]:
    order = get_order_or_404(db, order_id)
    ensure_order_participant(order, user)
    return list(db.execute(select(Message).where(Message.order_id == order_id).order_by(Message.created_at.asc())).scalars().all())


def create_review(db: Session, user: User, order_id: str, recipient_id: str, rating: int, text: str | None) -> Review:
    order = get_order_or_404(db, order_id)
    ensure_order_participant(order, user)
    if order.status != OrderStatus.completed.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Reviews are available only after completion")
    if recipient_id not in {order.employer_id, order.assigned_worker_id} or recipient_id == user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid review recipient")

    review = Review(order_id=order_id, author_id=user.id, recipient_id=recipient_id, rating=rating, text=text)
    db.add(review)
    recipient = db.get(User, recipient_id)
    if recipient:
        total = Decimal(recipient.rating_avg) * recipient.reviews_count + Decimal(rating)
        recipient.reviews_count += 1
        recipient.rating_avg = (total / Decimal(recipient.reviews_count)).quantize(Decimal("0.01"))
        db.add(recipient)
    db.commit()
    db.refresh(review)
    return review
