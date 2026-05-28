from __future__ import annotations

from decimal import Decimal
from typing import List

from fastapi import Depends, FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import Base, SessionLocal, engine, get_db
from app.dependencies import get_current_user, require_admin, require_employer, require_worker
from app.models import Order, OrderResponse, Review, Transaction, User
from app.schemas import (
    AssignWorkerIn,
    LoginIn,
    MessageIn,
    MessageOut,
    OrderCreateIn,
    OrderOut,
    OrderPatchIn,
    ProfilePatchIn,
    RegisterIn,
    ResponseCreateIn,
    ResponseOut,
    ReviewIn,
    ReviewOut,
    TokenOut,
    TopUpIn,
    TransactionOut,
    UserOut,
    WalletOut,
)
from app.services import (
    assign_worker,
    cancel_order,
    complete_order,
    create_message,
    create_order,
    create_review,
    get_order_or_404,
    list_messages,
    list_my_orders,
    list_nearby_orders,
    login_user,
    register_user,
    respond_to_order,
    serialize_user,
    start_order,
    top_up_wallet,
    update_order,
    update_profile,
)

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Работа рядом всегда API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatHub:
    def __init__(self) -> None:
        self.rooms: dict[str, list[WebSocket]] = {}

    async def connect(self, order_id: str, websocket: WebSocket) -> None:
        self.rooms.setdefault(order_id, []).append(websocket)

    def disconnect(self, order_id: str, websocket: WebSocket) -> None:
        sockets = self.rooms.get(order_id, [])
        if websocket in sockets:
            sockets.remove(websocket)
        if not sockets and order_id in self.rooms:
            del self.rooms[order_id]

    async def broadcast(self, order_id: str, payload: dict) -> None:
        for socket in list(self.rooms.get(order_id, [])):
            await socket.send_json(payload)


chat_hub = ChatHub()


def order_out(order: Order, distance_km: float | None = None) -> OrderOut:
    data = OrderOut.model_validate(order)
    data.distance_km = distance_km
    db = SessionLocal()
    try:
        employer = db.get(User, order.employer_id)
        if employer:
            data.employer_name = employer.full_name
            data.employer_rating_avg = employer.rating_avg
            data.employer_reviews_count = employer.reviews_count
    finally:
        db.close()
    return data


@app.get("/")
def healthcheck():
    return {"status": "ok"}


@app.post("/auth/register", response_model=TokenOut)
def register(payload: RegisterIn, db: Session = Depends(get_db)):
    _, token = register_user(db, payload)
    return TokenOut(access_token=token)


@app.post("/auth/login", response_model=TokenOut)
def login(payload: LoginIn, db: Session = Depends(get_db)):
    _, token = login_user(db, str(payload.email), payload.password)
    return TokenOut(access_token=token)


@app.post("/auth/refresh", response_model=TokenOut)
def refresh(user: User = Depends(get_current_user)):
    from app.security import create_access_token

    return TokenOut(access_token=create_access_token(user.id))


@app.post("/auth/password-reset")
def password_reset():
    return {"message": "Password reset email is mocked for MVP"}


@app.get("/profile", response_model=UserOut)
def read_profile(user: User = Depends(get_current_user)):
    return serialize_user(user)


@app.patch("/profile", response_model=UserOut)
def patch_profile(payload: ProfilePatchIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    updated = update_profile(db, user, payload)
    return serialize_user(updated)


@app.post("/orders", response_model=OrderOut)
def post_order(payload: OrderCreateIn, db: Session = Depends(get_db), employer: User = Depends(require_employer)):
    return order_out(create_order(db, employer, payload))


@app.get("/orders/nearby", response_model=List[OrderOut])
def get_nearby_orders(
    lat: float = Query(...),
    lng: float = Query(...),
    radius_km: int = Query(20000, ge=1),
    category: str | None = None,
    min_price: float | None = Query(default=None),
    max_price: float | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_worker),
):
    pairs = list_nearby_orders(
        db,
        lat=lat,
        lng=lng,
        radius_km=radius_km,
        category=category,
        min_price=Decimal(str(min_price)) if min_price is not None else None,
        max_price=Decimal(str(max_price)) if max_price is not None else None,
    )
    return [order_out(order, distance) for order, distance in pairs]


@app.get("/orders/my", response_model=List[OrderOut])
def get_my_orders(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return [order_out(order) for order in list_my_orders(db, user)]


@app.get("/orders/{order_id}", response_model=OrderOut)
def get_order(order_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    order = get_order_or_404(db, order_id)
    if not user.is_admin and order.employer_id != user.id and order.assigned_worker_id != user.id:
        can_view_public_order = order.status in {"published", "responded"}
        response = db.execute(select(OrderResponse).where(OrderResponse.order_id == order_id, OrderResponse.worker_id == user.id)).scalar_one_or_none()
        if response is None and not can_view_public_order:
            from fastapi import HTTPException, status

            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    return order_out(order)


@app.patch("/orders/{order_id}", response_model=OrderOut)
def patch_order(
    order_id: str,
    payload: OrderPatchIn,
    db: Session = Depends(get_db),
    employer: User = Depends(require_employer),
):
    return order_out(update_order(db, employer, order_id, payload))


@app.post("/orders/{order_id}/responses", response_model=ResponseOut)
def post_response(
    order_id: str,
    payload: ResponseCreateIn,
    db: Session = Depends(get_db),
    worker: User = Depends(require_worker),
):
    return respond_to_order(db, worker, order_id, payload.comment)


@app.get("/orders/{order_id}/responses", response_model=List[ResponseOut])
def get_responses(order_id: str, db: Session = Depends(get_db), employer: User = Depends(require_employer)):
    order = get_order_or_404(db, order_id)
    if order.employer_id != employer.id:
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    return list(db.execute(select(OrderResponse).where(OrderResponse.order_id == order_id)).scalars().all())


@app.post("/orders/{order_id}/assign", response_model=OrderOut)
def post_assign(
    order_id: str,
    payload: AssignWorkerIn,
    db: Session = Depends(get_db),
    employer: User = Depends(require_employer),
):
    return order_out(assign_worker(db, employer, order_id, payload.response_id))


@app.post("/orders/{order_id}/start", response_model=OrderOut)
def post_start(order_id: str, db: Session = Depends(get_db), employer: User = Depends(require_employer)):
    return order_out(start_order(db, employer, order_id))


@app.post("/orders/{order_id}/complete", response_model=OrderOut)
def post_complete(order_id: str, db: Session = Depends(get_db), employer: User = Depends(require_employer)):
    return order_out(complete_order(db, employer, order_id))


@app.post("/orders/{order_id}/cancel", response_model=OrderOut)
def post_cancel(order_id: str, db: Session = Depends(get_db), employer: User = Depends(require_employer)):
    return order_out(cancel_order(db, employer, order_id))


@app.get("/orders/{order_id}/messages", response_model=List[MessageOut])
def get_order_messages(order_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list_messages(db, user, order_id)


@app.post("/orders/{order_id}/messages", response_model=MessageOut)
async def post_order_message(
    order_id: str,
    payload: MessageIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    message = create_message(db, user, order_id, payload.text)
    data = MessageOut.model_validate(message).model_dump(mode="json")
    await chat_hub.broadcast(order_id, data)
    return message


@app.websocket("/orders/{order_id}/chat")
async def chat(websocket: WebSocket, order_id: str):
    await websocket.accept()
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=1008)
        return
    from app.security import TokenValidationError, decode_access_token

    db = next(get_db())
    try:
        payload = decode_access_token(token)
        user = db.get(User, payload.get("sub"))
        if user is None:
            await websocket.close(code=1008)
            return
        history = list_messages(db, user, order_id)
        for item in history:
            await websocket.send_json(MessageOut.model_validate(item).model_dump(mode="json"))
        await chat_hub.connect(order_id, websocket)
        while True:
            data = await websocket.receive_json()
            message = create_message(db, user, order_id, str(data.get("text", "")))
            await chat_hub.broadcast(order_id, MessageOut.model_validate(message).model_dump(mode="json"))
    except (TokenValidationError, WebSocketDisconnect):
        pass
    finally:
        chat_hub.disconnect(order_id, websocket)
        db.close()


@app.get("/wallet", response_model=WalletOut)
def get_wallet(user: User = Depends(get_current_user)):
    return WalletOut(balance=user.balance)


@app.post("/wallet/top-up", response_model=WalletOut)
def post_top_up(payload: TopUpIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    updated = top_up_wallet(db, user, payload.amount)
    return WalletOut(balance=updated.balance)


@app.get("/transactions", response_model=List[TransactionOut])
def get_transactions(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list(db.execute(select(Transaction).where(Transaction.user_id == user.id).order_by(Transaction.created_at.desc())).scalars().all())


@app.post("/orders/{order_id}/reviews", response_model=ReviewOut)
def post_review(order_id: str, payload: ReviewIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return create_review(db, user, order_id, payload.recipient_id, payload.rating, payload.text)


@app.get("/users/{user_id}/reviews", response_model=List[ReviewOut])
def get_user_reviews(user_id: str, db: Session = Depends(get_db)):
    return list(db.execute(select(Review).where(Review.recipient_id == user_id).order_by(Review.created_at.desc())).scalars().all())


@app.get("/admin/users", response_model=List[UserOut])
def admin_users(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return [serialize_user(user) for user in db.execute(select(User)).scalars().all()]


@app.get("/admin/orders", response_model=List[OrderOut])
def admin_orders(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return [order_out(order) for order in db.execute(select(Order).order_by(Order.created_at.desc())).scalars().all()]


@app.get("/admin/transactions", response_model=List[TransactionOut])
def admin_transactions(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return list(db.execute(select(Transaction).order_by(Transaction.created_at.desc())).scalars().all())


@app.post("/dev/seed-orders", response_model=List[OrderOut])
def seed_demo_orders(db: Session = Depends(get_db), employer: User = Depends(require_employer)):
    demo_orders = [
        ("Уборка квартиры", "Уборка квартир", "Нужно убрать квартиру 45 м²", "Дзержинск, проспект Циолковского, 21", "6750.00", "56.237604", "43.459941"),
        ("Мытьё окон", "Мытьё окон", "Помыть 4 створки окон", "Нижний Новгород, Большая Покровская улица, 1", "1600.00", "56.326887", "44.005986"),
        ("Сборка мебели", "Сборка / разборка мебели", "Собрать шкаф и письменный стол", "Бор, улица Ленина, 97", "2100.00", "56.356527", "44.064648"),
        ("Прополка грядок", "Копка грядок / прополка", "Прополка участка на 3 часа", "Кстово, площадь Ленина, 4", "1500.00", "56.150776", "44.195957"),
        ("Разгрузить машину", "Погрузочно-разгрузочные работы", "Разгрузить коробки после переезда", "Богородск, улица Ленина, 184", "1800.00", "56.101990", "43.513678"),
        ("Починить кран", "Мелкий ремонт сантехники", "Подтекает смеситель на кухне", "Павлово, улица Коммунистическая, 10", "1000.00", "55.964629", "43.064570"),
        ("Починить микроволновку", "Мелкий ремонт бытовой техники", "Микроволновка не греет", "Арзамас, Соборная площадь, 1", "1000.00", "55.394754", "43.839918"),
        ("Выгул собаки", "Выгул собак", "Погулять с собакой вечером", "Москва, Тверская улица, 7", "400.00", "55.762955", "37.605563"),
        ("Уборка снега", "Уборка снега", "Расчистить дорожку у дома", "Санкт-Петербург, Невский проспект, 28", "1000.00", "59.934280", "30.335099"),
        ("Помощь по дому", "Помощь в быту (почасовая)", "Помочь разобрать вещи и вынести мусор", "Казань, улица Баумана, 51", "1000.00", "55.796127", "49.106414"),
        (
            "Генеральная уборка после ремонта",
            "Уборка квартир",
            "Нужна аккуратная генеральная уборка двухкомнатной квартиры после небольшого ремонта. Нужно убрать строительную пыль, вымыть полы, протереть поверхности, кухонный гарнитур и санузел. Инвентарь и базовая химия есть на месте, но можно принести свои средства. Желательно выполнить работу в первой половине дня, чтобы успеть проветрить квартиру.",
            "Санкт-Петербург, Московский проспект, 143",
            "9000.00",
            "59.891940",
            "30.319833",
        ),
    ]

    created: list[Order] = []
    existing_titles = set(db.execute(select(Order.title).where(Order.employer_id == employer.id)).scalars().all())
    for title, category, description, address, price, lat, lng in demo_orders:
        if title in existing_titles:
            continue
        created.append(
            create_order(
                db,
                employer,
                OrderCreateIn(
                    title=title,
                    category=category,
                    description=description,
                    address=address,
                    price=Decimal(price),
                    lat=Decimal(lat),
                    lng=Decimal(lng),
                ),
            )
        )
    return [order_out(order) for order in created]
