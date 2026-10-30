"""Deterministic synthetic fleet and patch-catalog generator.

All machines, patches and CVSS-like scores are invented. They do not describe any real
product release, vulnerability or organisation.
"""
from __future__ import annotations

import random

from .models import ALL_CHECKS, Health, Machine, Patch

DEFAULT_SEED = 2026
DEFAULT_FLEET_SIZE = 120

# family -> (weight, versions, roles, baseline latency range ms)
FAMILIES: dict[str, tuple[int, list[str], list[str], tuple[float, float]]] = {
    "Windows Server": (20, ["2019", "2022", "2025"], ["web", "api", "database", "file-share", "domain-controller"], (18, 90)),
    "Windows 11": (20, ["23H2", "24H2"], ["workstation", "kiosk", "developer-box"], (8, 30)),
    "Ubuntu": (18, ["22.04", "24.04"], ["web", "api", "batch", "cache"], (12, 60)),
    "RHEL": (14, ["8.10", "9.4"], ["database", "api", "batch", "message-queue"], (15, 80)),
    "Amazon Linux": (10, ["2023"], ["web", "api", "worker"], (10, 55)),
    "macOS": (10, ["14", "15"], ["workstation", "build-agent"], (8, 28)),
    "ICS/Embedded": (8, ["RTOS 4.2", "HMI 7.1"], ["plc-gateway", "hmi", "historian"], (5, 40)),
}

PATCHES: list[Patch] = [
    Patch(id="SYN-WS-2026-10", title="Synthetic Windows Server cumulative update", os_family="Windows Server",
          cvss=8.1, known_exploited=True, released_days_ago=14, requires_restart=True),
    Patch(id="SYN-W11-2026-10", title="Synthetic Windows 11 cumulative update", os_family="Windows 11",
          cvss=7.5, known_exploited=False, released_days_ago=14, requires_restart=True,
          hold_versions=["24H2"],
          hold_reason="Synthetic safeguard hold: simulated incompatibility with some storage drivers on 24H2."),
    Patch(id="SYN-UBU-2026-41", title="Synthetic Ubuntu kernel security update", os_family="Ubuntu",
          cvss=7.8, known_exploited=False, released_days_ago=21, requires_restart=True),
    Patch(id="SYN-RHEL-2026-17", title="Synthetic RHEL remote-code-execution fix", os_family="RHEL",
          cvss=9.8, known_exploited=True, released_days_ago=9, requires_restart=True),
    Patch(id="SYN-AL-2026-08", title="Synthetic Amazon Linux live-patchable fix", os_family="Amazon Linux",
          cvss=6.5, known_exploited=False, released_days_ago=17, requires_restart=False),
    Patch(id="SYN-MAC-2026-05", title="Synthetic macOS security update", os_family="macOS",
          cvss=5.3, known_exploited=False, released_days_ago=30, requires_restart=True),
    Patch(id="SYN-ICS-2026-02", title="Synthetic ICS gateway firmware update", os_family="ICS/Embedded",
          cvss=8.8, known_exploited=False, released_days_ago=45, requires_restart=True),
]
PATCH_BY_FAMILY = {p.os_family: p for p in PATCHES}


def _pick_status(rng: random.Random, p_pass: float, p_fail: float) -> str:
    r = rng.random()
    if r < p_pass:
        return "pass"
    if r < p_pass + p_fail:
        return "fail"
    return "unknown"


def generate_fleet(seed: int = DEFAULT_SEED, size: int = DEFAULT_FLEET_SIZE) -> list[Machine]:
    """Return `size` synthetic machines. Same (seed, size) always yields identical output."""
    if size < 1:
        raise ValueError("size must be >= 1")
    rng = random.Random(seed)
    names = list(FAMILIES)
    weights = [FAMILIES[n][0] for n in names]
    machines: list[Machine] = []
    for i in range(size):
        family = rng.choices(names, weights)[0]
        _, versions, roles, (lat_lo, lat_hi) = FAMILIES[family]
        version = rng.choice(versions)
        role = rng.choice(roles)
        # exposure correlates loosely with role
        if family == "ICS/Embedded":
            exposure = rng.choices(["isolated", "internal"], [0.75, 0.25])[0]
        elif role in ("web", "api", "kiosk"):
            exposure = rng.choices(["internet", "internal"], [0.6, 0.4])[0]
        else:
            exposure = rng.choices(["internet", "internal", "isolated"], [0.05, 0.75, 0.20])[0]
        crit_weights = [1, 2, 4, 3, 2] if family != "ICS/Embedded" else [0, 0, 1, 3, 4]
        criticality = rng.choices([1, 2, 3, 4, 5], crit_weights)[0]
        if role in ("database", "domain-controller", "plc-gateway", "historian"):
            criticality = max(criticality, 4)

        # 24H2 + Windows 11 and old RHEL have more negative compatibility evidence (by design).
        driver_fail = 0.04 + (0.10 if (family == "Windows 11" and version == "24H2") else 0.0)
        checks = {
            "driver_compat": _pick_status(rng, 0.88 - driver_fail + 0.04, driver_fail),
            "app_compat": _pick_status(rng, 0.86, 0.06),
            "backup_verified": _pick_status(rng, 0.90, 0.05),
            "agent_compat": _pick_status(rng, 0.93, 0.03),
            "disk_space": _pick_status(rng, 0.95, 0.05),
        }
        checks = {k: checks[k] for k in ALL_CHECKS}  # type: ignore[misc]

        base_lat = rng.uniform(lat_lo, lat_hi)
        degraded = rng.random() < 0.06
        latency = base_lat * (rng.uniform(1.7, 2.6) if degraded else rng.uniform(0.9, 1.15))
        error = rng.uniform(0.001, 0.012) if not degraded else rng.uniform(0.035, 0.08)
        health = Health(
            cpu_pct=round(rng.uniform(8, 78), 1),
            mem_pct=round(rng.uniform(25, 88), 1),
            latency_ms=round(latency, 2),
            baseline_latency_ms=round(base_lat, 2),
            error_rate=round(error, 4),
        )
        patch = PATCH_BY_FAMILY[family]
        compliant = rng.random() < 0.12
        machines.append(
            Machine(
                id=f"vm-{i + 1:03d}",
                hostname=f"{family.split()[0].lower().replace('/', '')}-{role[:4]}-{i + 1:03d}.synthetic.invalid",
                os_family=family,
                os_version=version,
                role=role,
                exposure=exposure,
                criticality=criticality,
                patch_id=patch.id,
                patch_status="compliant" if compliant else "pending",
                checks=checks,  # type: ignore[arg-type]
                restart_required=patch.requires_restart,
                telemetry_present=rng.random() > 0.05,
                health=health,
                days_since_last_patch=rng.randint(patch.released_days_ago, patch.released_days_ago + 120),
            )
        )
    return machines
