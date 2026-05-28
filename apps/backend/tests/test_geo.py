from app.geo import haversine_km


def test_haversine_moscow_to_spb_distance_is_reasonable():
    distance = haversine_km(55.751244, 37.618423, 59.93863, 30.31413)

    assert 630 <= distance <= 650

