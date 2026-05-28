# Architecture

The backend is organized by domain:

- `api` exposes REST and WebSocket endpoints.
- `models` contains SQLAlchemy persistence models.
- `schemas` contains Pydantic request and response contracts.
- `services` owns business rules for auth, geo search, orders, ledger, reviews
  and chat.

The mobile app consumes the REST API over JSON and connects to
`/orders/{id}/chat` for realtime messages.

## Core Flow

1. Employer publishes an order.
2. Worker searches orders nearby by latitude, longitude and radius.
3. Worker responds to an order.
4. Employer assigns one response.
5. Employer starts the order, moving funds into escrow.
6. Participants chat while the order is active.
7. Employer completes the order, escrow is settled.
8. Both sides can leave reviews.

