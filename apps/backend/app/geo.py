from __future__ import annotations

from math import atan2, cos, radians, sin, sqrt
from decimal import Decimal


REGION_CENTERS = [
    ("Нижегородская область", 56.2604, 43.8467, 180),
    ("Москва и Московская область", 55.7558, 37.6173, 120),
    ("Санкт-Петербург и Ленинградская область", 59.9343, 30.3351, 140),
    ("Республика Татарстан", 55.7961, 49.1064, 180),
]


def haversine_km(lat1: Decimal | float, lng1: Decimal | float, lat2: Decimal | float, lng2: Decimal | float) -> float:
    earth_radius_km = 6371.0088
    lat1_f, lng1_f, lat2_f, lng2_f = map(float, (lat1, lng1, lat2, lng2))
    phi1 = radians(lat1_f)
    phi2 = radians(lat2_f)
    delta_phi = radians(lat2_f - lat1_f)
    delta_lambda = radians(lng2_f - lng1_f)
    a = sin(delta_phi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(delta_lambda / 2) ** 2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))
    return earth_radius_km * c


def detect_region(lat: Decimal | float, lng: Decimal | float) -> str | None:
    nearest_name: str | None = None
    nearest_distance: float | None = None
    nearest_radius: float | None = None

    for name, region_lat, region_lng, radius_km in REGION_CENTERS:
        distance = haversine_km(lat, lng, region_lat, region_lng)
        if nearest_distance is None or distance < nearest_distance:
            nearest_name = name
            nearest_distance = distance
            nearest_radius = radius_km

    if nearest_distance is not None and nearest_radius is not None and nearest_distance <= nearest_radius:
        return nearest_name
    return None
