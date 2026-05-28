from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def _register(email: str, mode: str) -> str:
    response = client.post(
        "/auth/register",
        json={
            "email": email,
            "password": "password123",
            "full_name": email.split("@")[0],
            "active_mode": mode,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def test_order_response_assignment_and_escrow_flow():
    suffix = uuid4().hex
    employer_token = _register(f"employer-{suffix}@example.com", "employer")
    worker_token = _register(f"worker-{suffix}@example.com", "worker")

    employer_headers = {"Authorization": f"Bearer {employer_token}"}
    worker_headers = {"Authorization": f"Bearer {worker_token}"}

    top_up = client.post("/wallet/top-up", json={"amount": 2000}, headers=employer_headers)
    assert top_up.status_code == 200, top_up.text

    order = client.post(
        "/orders",
        json={
            "title": "Test task",
            "description": "Move boxes",
            "category": "moving",
            "price": "1000.00",
            "address": "Moscow",
            "lat": "55.751244",
            "lng": "37.618423",
        },
        headers=employer_headers,
    )
    assert order.status_code == 200, order.text
    order_id = order.json()["id"]

    nearby = client.get("/orders/nearby?lat=55.75&lng=37.61&radius_km=5", headers=worker_headers)
    assert nearby.status_code == 200, nearby.text
    assert nearby.json()[0]["id"] == order_id

    response = client.post(f"/orders/{order_id}/responses", json={"comment": "Ready"}, headers=worker_headers)
    assert response.status_code == 200, response.text
    response_id = response.json()["id"]

    assigned = client.post(f"/orders/{order_id}/assign", json={"response_id": response_id}, headers=employer_headers)
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["status"] == "assigned"

    started = client.post(f"/orders/{order_id}/start", headers=employer_headers)
    assert started.status_code == 200, started.text
    assert Decimal(started.json()["escrow_amount"]) == Decimal("1100.00")

    completed = client.post(f"/orders/{order_id}/complete", headers=employer_headers)
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "completed"
