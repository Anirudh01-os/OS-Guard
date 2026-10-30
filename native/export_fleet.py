"""Export the deterministic synthetic fleet (seed 2026, default ScoringConfig) plus the Python engine's
readiness verdicts to CSV, so native/rollout_gate.c can be cross-checked against them.

Run from backend/ (Windows):
    $env:PYTHONPATH = (Get-Location).Path
    .\\.venv\\Scripts\\python ..\\native\\export_fleet.py ..\\native\\fleet_export.csv
"""
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from osguard.fleet import PATCHES, generate_fleet  # noqa: E402
from osguard.models import ScoringConfig  # noqa: E402
from osguard.scoring import assess_fleet  # noqa: E402

out = Path(sys.argv[1])
patches = {p.id: p for p in PATCHES}
machines = generate_fleet(2026, 120)
asm = assess_fleet(machines, patches, ScoringConfig())
with out.open("w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["id", "family", "version", "driver", "app", "backup", "agent", "disk", "telemetry", "latency_ratio", "error_rate",
                "vendor_hold", "compliant", "expected"])
    for m in machines:
        p = patches[m.patch_id]
        w.writerow([m.id, m.os_family, m.os_version, m.checks["driver_compat"], m.checks["app_compat"], m.checks["backup_verified"],
                    m.checks["agent_compat"], m.checks["disk_space"], int(m.telemetry_present), f"{m.health.latency_ratio:.6f}",
                    f"{m.health.error_rate:.6f}", int(m.os_version in p.hold_versions), int(m.patch_status == "compliant"),
                    asm[m.id].readiness])
print("wrote", out, len(machines), "rows")
