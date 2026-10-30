from osguard.fleet import generate_fleet


def test_fleet_is_deterministic_and_large_enough():
    a, b = generate_fleet(2026, 120), generate_fleet(2026, 120)
    assert len(a) >= 100
    assert [m.model_dump() for m in a] == [m.model_dump() for m in b]


def test_different_seed_differs():
    assert [m.model_dump() for m in generate_fleet(1, 120)] != [m.model_dump() for m in generate_fleet(2, 120)]


def test_fleet_is_labelled_synthetic_and_diverse():
    fleet = generate_fleet()
    assert all(m.synthetic and m.hostname.endswith(".synthetic.invalid") for m in fleet)
    assert len({m.os_family for m in fleet}) >= 6
    assert {c for m in fleet for c in m.checks.values()} == {"pass", "fail", "unknown"}
