# Person 2 – Kalivarapu Prabhas (24BCE2279)
**Block:** scoring code → Risk engine page → Research page → native C harness and GDB. **Target ≈ 5:15** (times below are relative to the start of your block). Start only after Person 1 has finished their whole block (≈ 4:00 into the video).

**Starting state:** browser on `#/risk`; scoring configuration at defaults. VS Code tabs: `backend/osguard/scoring.py`, `native/rollout_gate.c`, `native/gdb_session.log`. A WSL Ubuntu terminal open in `native/` (optional live GDB).
**You MUST press "Reset to defaults" before you hand over** (Person 3's numbers depend on it).

---
### +0:00 – Introduction (≈ 10 s)
**Say:** "I am Kalivarapu Prabhas, 24BCE2279. I will explain how OSGuard decides how urgent a patch is and whether a machine is safe to update."

### +0:10 – scoring.py: urgency (≈ 50 s)
**Do:** open `scoring.py`, scroll to `compute_urgency`.
**Point at:** the four factors `sev`, `exp`, `crit`, `age` and the weights.
**Say:** "Urgency is a number from 0 to 100: severity from the CVSS-style score plus a bonus if exploited, exposure – internet, internal or isolated – criticality from 1 to 5, and patch age. Weights are 40, 25, 15 and 20 percent by default and are normalised. Every factor's points are returned, so the result is fully explainable. Bands are critical 70 and above, high 55, medium 35."

### +1:00 – scoring.py: risk, uncertainty and rules (≈ 55 s)
**Do:** scroll to `compute_compat` then `assess_machine`.
**Point at:** the `B1`…`B6` blocker codes and the precedence block `if negative … elif missing …`.
**Say:** "We keep three things separate. **Compatibility risk** is failed evidence. **Uncertainty** is missing evidence – unknown checks or no telemetry. And urgency. The rules: B1 a mandatory check failed, B2 a mandatory check has no result, B3 no telemetry, B4 a vendor hold, B5 the machine is already unhealthy, B6 needs manual approval. Precedence is: negative evidence gives *blocked*; otherwise missing evidence gives *insufficient evidence*; then needs approval; then ready with caution; then ready. The key safety idea: **missing or failed mandatory evidence can never make a machine look ready.**"

### +1:55 – Risk engine page: controls (≈ 60 s)
**Do:** switch to the browser on **Risk engine**.
**Point at:** each slider as you name it.
**Say:** "These sliders edit the same configuration: the four urgency weights with their normalised percentages, the known-exploited bonus, patch-age saturation at 60 days, the three band thresholds, the pre-update latency and error limits that trigger rule B5, the caution threshold, and the switch that requires telemetry."
**Do:** drag **Medium band** to the far right.
**Point at:** the red validation message "Bands must satisfy medium ≤ high ≤ critical" and the disabled **Save & recompute** button.
**Say:** "Invalid settings are rejected both in the browser and by the API."
**Do:** put Medium band back to 35. Drag **Security severity** weight to 0.00 and press **Save & recompute**; read the green message.
**Say:** "Saving recomputes every assessment and writes a configuration event to the audit log."

### +2:55 – Explain a machine (≈ 55 s)
**Do:** scroll to **Explain a machine**; choose **vm-081**.
**Say:** "vm-081 is ready; notice its urgency is now lower because we removed the severity weight."
**Do:** choose **vm-003**. **Point at:** Blocked badge, Driver Compat \*: fail, compat risk 25 %, uncertainty 0 %, reason line B1.
**Say:** "vm-003 is blocked: its mandatory driver check failed, rule B1. Compatibility risk is 1 of 4 weight units, 25 percent. The action is 'resolve blockers'."
**Do:** choose **vm-002**. **Say:** "vm-002 has unknown mandatory results – insufficient evidence, rule B2 – not treated as safe."
**Do:** choose **vm-012**. **Say:** "vm-012 has no telemetry – rule B3 – so we could not verify its health after an update."
**Do:** press **Reset to defaults** (the green "Defaults restored." appears). **Say:** "Now I restore the defaults."

### +3:50 – Research and sources page (≈ 35 s)
**Do:** click **Research** in the sidebar.
**Point at:** the verification note, one vendor card (Microsoft), then the comparison table.
**Say:** "This page compares Microsoft safeguard holds, AWS Patch Manager and Amazon Linux live patching, Google Kubernetes Engine upgrades, Apple deployment and CISA industrial guidance. On 26 October we fetched each page and checked every statement; Apple and CISA were checked at index level only, and our own comparisons are labelled 'Our observation'. OSGuard does not replace these products."

### +4:25 – Native C harness and GDB (≈ 50 s)
**Do:** open `native/rollout_gate.c`, point at `assess_readiness` and `should_halt`; then open `native/gdb_session.log`.
**Say:** "GDB debugs native programs, and OSGuard itself is Python, so we wrote a small C harness. It is **not** part of the app, not a kernel and not xv6. It re-implements the readiness rules and the halt rule and checks all 120 Python verdicts: **120 machines, 0 mismatches**."
**Point at (log):** 1) conditional breakpoint on `vm-003`; 2) `bt` and `print *m` showing `driver = CHK_FAIL`; 3) the watchpoint on `blockers` going 0 → 1 at line 57; 4) `finish` → `Value returned is R_BLOCKED`.
**Say:** "We ran this in GDB 17.1 on WSL2 Ubuntu. The session shows the same verdict as the Python engine – blocked by rule B1."
**Optional live run (WSL):** `gdb -q -batch -x gdb_session.gdb --args /tmp/rollout_gate fleet_export.csv`.

### +5:15 – Hand-off
**Say:** "That is how a machine is judged ready or blocked. Barath will now show what happens when those machines are rolled out, and how we measure it."
**Leave the browser on:** Research or Risk page (scoring at defaults). Hand over the mic.

---
**Questions you may get:** Why three separate measures? What happens with a missing mandatory check? (B2 → insufficient evidence → deferred.) Does GDB debug the Python? (No – only the C harness.) Why did you add the C harness? (To give the safety rules an independent native cross-check and a genuine GDB demonstration.) What does a vendor hold represent? (A synthetic stand-in for a safeguard hold.)
