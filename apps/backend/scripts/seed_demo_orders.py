# -*- coding: utf-8 -*-
import sqlite3
import sys
import uuid
from datetime import datetime
from pathlib import Path


sys.path.append(str(Path(__file__).resolve().parents[1]))

import app.models  # noqa: F401
from app.database import Base, engine
from app.geocoding import geocode_address


DB_PATH = Path(__file__).resolve().parents[1] / "mvp.db"
DEMO_EMPLOYER_ID = "demo-employer"

ORDERS = [
    (
        "Уборка квартиры",
        "Уборка квартир",
        "Нужно убрать квартиру 45 м². Требуется влажная уборка, пыль, полы и кухня.",
        "Дзержинск, проспект Циолковского, 21",
        "6750.00",
    ),
    (
        "Мытьё окон",
        "Мытьё окон",
        "Помыть 4 створки окон. Инвентарь желательно взять с собой.",
        "Нижний Новгород, Большая Покровская улица, 1",
        "1600.00",
    ),
    (
        "Сборка мебели",
        "Сборка / разборка мебели",
        "Собрать шкаф и письменный стол. Детали и инструкция на месте.",
        "Бор, улица Ленина, 97",
        "2100.00",
    ),
    (
        "Прополка грядок",
        "Копка грядок / прополка",
        "Прополка участка на 3 часа. Инструменты предоставим.",
        "Кстово, площадь Ленина, 4",
        "1500.00",
    ),
    (
        "Разгрузить машину",
        "Погрузочно-разгрузочные работы",
        "Разгрузить коробки после переезда. Работа примерно на 3 часа.",
        "Богородск, улица Ленина, 184",
        "1800.00",
    ),
    (
        "Починить кран",
        "Мелкий ремонт сантехники",
        "Подтекает смеситель на кухне. Нужно проверить и заменить прокладку.",
        "Павлово, улица Коммунистическая, 10",
        "1000.00",
    ),
    (
        "Починить микроволновку",
        "Мелкий ремонт бытовой техники",
        "Микроволновка включается, но не греет. Нужна диагностика.",
        "Арзамас, Соборная площадь, 1",
        "1000.00",
    ),
    (
        "Выгул собаки",
        "Выгул собак",
        "Погулять с собакой вечером. Собака спокойная, поводок есть.",
        "Москва, Тверская улица, 7",
        "400.00",
    ),
    (
        "Уборка снега",
        "Уборка снега",
        "Расчистить дорожку у дома и входную зону.",
        "Санкт-Петербург, Невский проспект, 28",
        "1000.00",
    ),
    (
        "Помощь по дому",
        "Помощь в быту (почасовая)",
        "Помочь разобрать вещи и вынести мусор. Работа примерно на 2 часа.",
        "Казань, улица Баумана, 51",
        "1000.00",
    ),
    (
        "Генеральная уборка после ремонта",
        "Уборка квартир",
        "Нужна аккуратная генеральная уборка двухкомнатной квартиры после небольшого ремонта. Нужно убрать строительную пыль, вымыть полы, протереть поверхности, кухонный гарнитур и санузел. Инвентарь и базовая химия есть на месте, но можно принести свои средства. Желательно выполнить работу в первой половине дня, чтобы успеть проветрить квартиру.",
        "Санкт-Петербург, Московский проспект, 143",
        "9000.00",
    ),
]


def ensure_tables() -> None:
    Base.metadata.create_all(bind=engine)


def ensure_demo_employer(cur):
    now = datetime.utcnow().isoformat()
    cur.execute("SELECT id FROM users WHERE id = ?", (DEMO_EMPLOYER_ID,))
    if cur.fetchone():
        return

    cur.execute(
        """
        INSERT INTO users (
            id, email, phone, password_hash, full_name, active_mode,
            is_worker_enabled, is_employer_enabled, avatar_url, bio,
            rating_avg, reviews_count, completed_orders, posted_orders,
            balance, is_admin, is_active, created_at, updated_at
        )
        VALUES (?, ?, NULL, ?, ?, ?, 1, 1, NULL, NULL, ?, ?, ?, ?, ?, 0, 1, ?, ?)
        """,
        (
            DEMO_EMPLOYER_ID,
            "demo-employer@example.com",
            "seeded-password-hash",
            "Демо Работодатель",
            "employer",
            "4.90",
            38,
            0,
            0,
            "100000.00",
            now,
            now,
        ),
    )
    cur.execute(
        "INSERT OR IGNORE INTO employer_profiles (user_id, company_name, address, inn, bank_details) VALUES (?, ?, ?, NULL, NULL)",
        (DEMO_EMPLOYER_ID, "Демо Компания", "Нижний Новгород"),
    )
    cur.execute(
        "INSERT OR IGNORE INTO worker_profiles (user_id, categories, experience, lat, lng, default_radius_km) VALUES (?, NULL, NULL, NULL, NULL, 10)",
        (DEMO_EMPLOYER_ID,),
    )


def main():
    ensure_tables()

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    ensure_demo_employer(cur)

    now = datetime.utcnow().isoformat()
    inserted = 0
    failed = []
    for title, category, description, address, price in ORDERS:
        cur.execute("SELECT id FROM orders WHERE title = ? AND address = ?", (title, address))
        if cur.fetchone():
            continue

        try:
            lat, lng = geocode_address(address)
        except Exception as exc:
            failed.append((title, str(exc)))
            continue

        cur.execute(
            """
            INSERT INTO orders (
                id, employer_id, assigned_worker_id, title, description, category,
                price, address, lat, lng, scheduled_at, status, escrow_amount,
                created_at, updated_at
            )
            VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, 'published', '0.00', ?, ?)
            """,
            (
                str(uuid.uuid4()),
                DEMO_EMPLOYER_ID,
                title,
                description,
                category,
                price,
                address,
                str(lat),
                str(lng),
                now,
                now,
            ),
        )
        inserted += 1

    conn.commit()
    conn.close()

    print(f"Добавлено заказов: {inserted}")
    if failed:
        print("Не удалось геокодировать:")
        for title, error in failed:
            print(f"- {title}: {error}")
    print(f"База: {DB_PATH}")


if __name__ == "__main__":
    main()
