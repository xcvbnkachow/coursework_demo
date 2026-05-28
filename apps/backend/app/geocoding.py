from __future__ import annotations

import json
import re
from decimal import Decimal
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import HTTPException, status


NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_USER_AGENT = "WorkNearbyMVP/0.1 local-dev"


def address_has_house_number(address: str) -> bool:
    return bool(re.search(r"\d+", address))


def _request_nominatim(address: str) -> list[dict]:
    query = urlencode(
        {
            "q": address,
            "format": "json",
            "limit": "1",
            "addressdetails": "1",
            "accept-language": "ru",
        }
    )
    request = Request(
        f"{NOMINATIM_URL}?{query}",
        headers={"User-Agent": NOMINATIM_USER_AGENT},
    )

    with urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def geocode_address(address: str) -> tuple[Decimal, Decimal]:
    if not address_has_house_number(address):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Адрес должен содержать номер дома",
        )

    candidates = [address]
    if "россия" not in address.lower():
        candidates.append(f"{address}, Россия")

    for candidate in candidates:
        try:
            payload = _request_nominatim(candidate)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Не удалось выполнить геокодирование адреса через Nominatim",
            ) from exc

        if payload:
            result = payload[0]
            return Decimal(str(result["lat"])), Decimal(str(result["lon"]))

    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=f"Не удалось определить координаты адреса: {address}",
    )
