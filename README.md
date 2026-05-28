# Работа рядом всегда

Monorepo for the MVP of a nearby short-term work marketplace.

The backend is a fresh FastAPI service inspired by the existing `sabit-it/diplom`
repository, but it follows the product specification directly:

- one account can work in worker or employer mode;
- employers publish orders;
- workers search nearby orders and respond;
- employers assign a worker;
- order chat is available through WebSocket;
- mock ledger holds funds in escrow and applies 10% commission to both sides;
- distance is calculated with the Haversine formula.

## Structure

```text
apps/
  backend/   FastAPI + SQLAlchemy MVP API
  mobile/    Expo React Native TypeScript starter
docs/        MVP, API, architecture and release notes
infra/       Local infrastructure placeholders
```

## Backend

```bash
cd apps/backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

By default the service uses SQLite for quick local development. Set
`DATABASE_URL` to PostgreSQL in production-like environments.

## Mobile

```bash
cd apps/mobile
npm install
npm run start
```

The mobile app is intentionally thin in this first scaffold: it contains typed
API helpers and the primary MVP screens so backend contracts can be exercised
early.

