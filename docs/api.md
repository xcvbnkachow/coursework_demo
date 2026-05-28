# API Summary

## Auth

- `POST /auth/register`
- `POST /auth/login`
- `GET /profile`
- `PATCH /profile`

## Orders

- `POST /orders`
- `GET /orders/nearby`
- `GET /orders/my`
- `GET /orders/{order_id}`
- `PATCH /orders/{order_id}`
- `POST /orders/{order_id}/responses`
- `POST /orders/{order_id}/assign`
- `POST /orders/{order_id}/start`
- `POST /orders/{order_id}/complete`
- `POST /orders/{order_id}/cancel`
- `GET /orders/{order_id}/messages`
- `WS /orders/{order_id}/chat`

## Wallet

- `GET /wallet`
- `POST /wallet/top-up`
- `GET /transactions`

## Reviews

- `POST /orders/{order_id}/reviews`
- `GET /users/{user_id}/reviews`

## Admin

- `GET /admin/users`
- `GET /admin/orders`
- `GET /admin/transactions`

