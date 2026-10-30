import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient

from osguard.api import create_app
from osguard.fleet import PATCHES
from osguard.models import Health, Machine, ScoringConfig


@pytest.fixture
def patches():
    return {p.id: p.model_copy(deep=True) for p in PATCHES}


@pytest.fixture
def scoring():
    return ScoringConfig()


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(str(tmp_path / "t.db"))) as c:
        yield c


def make_machine(i=1, **kw) -> Machine:
    base = dict(
        id=f"vm-{i:03d}", hostname=f"h{i}.synthetic.invalid", os_family="Ubuntu", os_version="24.04", role="web",
        exposure="internal", criticality=2, patch_id="SYN-UBU-2026-41", patch_status="pending",
        checks={"driver_compat": "pass", "app_compat": "pass", "backup_verified": "pass", "agent_compat": "pass", "disk_space": "pass"},
        restart_required=True, telemetry_present=True,
        health=Health(cpu_pct=20, mem_pct=40, latency_ms=20, baseline_latency_ms=20, error_rate=0.002),
        days_since_last_patch=30,
    )
    base.update(kw)
    return Machine(**base)
