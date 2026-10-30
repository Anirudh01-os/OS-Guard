# Person 3 – Barath Sornaraj (24BCE2599)
**Block:** simulator code → Simulator page → Experiment lab → Analytics → Audit center → tests → conclusion. **Target ≈ 7:55** (times below are relative to the start of your block). Start only after Person 2 has finished their whole block (≈ 9:15 into the video), and close the video.

**Starting state:** scoring at defaults (Person 2 reset it); fleet seed 2026; browser on `#/simulator`. VS Code tabs: `backend/osguard/simulator.py`, `backend/osguard/analytics.py`. PowerShell in `backend/`.

---
### +0:00 – Introduction (≈ 10 s)
**Say:** "I am Barath Sornaraj, 24BCE2599. I will show how OSGuard rolls an update out in stages, what happens when something fails, and how we measure the result."

### +0:10 – simulator.py (≈ 60 s)
**Do:** open `simulator.py`.
**Point at:** `failure_model`, `plan_rollout`, `advance`, `ALLOWED_TRANSITIONS`.
**Say:** "`failure_model` is the simulation's hidden truth: each machine fails with a probability built from its evidence – a failed driver check adds 55 percent, a failed application check 45 percent, and so on – compared with a value hashed from the seed, machine and patch. So staged and baseline strategies face **identical** outcomes. `plan_rollout` defers machines that are not ready and orders the rest by criticality, picking the canary round-robin across OS families. `advance` runs one batch: deploy, soak, health check. It halts if the canary has any unhealthy machine or more than 10 percent of a batch is unhealthy. The rollout is a state machine – planned, running, completed, halted or aborted – and illegal moves raise an error."

### +1:10 – Simulator page: the controls (≈ 60 s)
**Do:** browser, **Rollout simulator**.
**Point at:** each control as you name it.
**Say:** "Scenario picks one of six reproducible situations. Outcome seed makes it repeatable. Soak is the wait before the health check. The batch boxes are percentages of eligible machines – canary then stages; plus and minus add or remove a batch and Rebalance makes them total 100."
**Do:** change one batch to 10 so the total shows red; **Point at:** "Σ …%" and the red error; the buttons disable. Press **Rebalance to 100**.
**Say:** "Invalid batch plans are blocked."
**Say:** "Thresholds: maximum latency ratio 1.5 times baseline, maximum error rate 3 percent, batch tolerance 10 percent. The toggles: halt on any canary failure, fail closed without telemetry, and include 'ready with caution'. Fault injection adds a simulated fault – kind, probability, target OS and minimum criticality."
**Do:** press **+ Add fault**, show the four fields, then press ✕ to remove it.

### +2:10 – Demo 1: successful rollout (≈ 60 s)
**Do:** scenario **Healthy update** → **Plan rollout** → press **Advance next batch** four times, pausing on each batch card.
**Point at:** batch cards Canary 5, Stage 1 19, Stage 2 32, Stage 3 38 turning green; the metrics tiles.
**Say:** "Each batch passes its health check, then the next starts. Final result: 94 of 102 machines patched, blast radius zero, no safety violations. 8 machines were deferred – these are industrial systems that need manual approval, rule B6."
**Point at:** the timeline chart and **Recorded decisions** (toggle **Decisions / Everything**).
**Say:** "Every step is recorded with its rule."

### +3:10 – Demo 2: injected failure and safety halt (≈ 75 s)
**Do:** scenario **Injected fault (bad build)** → **Plan & run to end**.
**Point at:** Canary and Stage 1 green, **Stage 2 FAILED – 3 unhealthy, 18 %**, **Stage 3 SKIPPED**, red text "Stopped: Unhealthy fraction 18% exceeds tolerance 10%."
**Say:** "Now 60 percent of Windows Server hosts get a bad build that recorded evidence cannot predict. The canary passes, but in Stage 2 three of seventeen machines are unhealthy – 18 percent, above our 10 percent tolerance – so the rollout **halts automatically**. The 19 machines in Stage 3 are never touched."
**Do:** press **Compare with all-at-once**.
**Point at:** "baseline 32" under Blast radius, baseline 80 under Safety violations, dashed lines in the chart.
**Say:** "The baseline deploys everywhere at once: a blast radius of 32 instead of 5, with 80 safety-rule violations and no way to halt. The price: staged takes longer and leaves more machines unpatched."

### +4:25 – Abort and invalid transitions (≈ 20 s)
**Do:** scenario **Healthy update** → **Plan rollout** → **Advance next batch** once → **Abort**.
**Point at:** status **aborted**; **Advance next batch** and **Abort** now disabled.
**Say:** "An operator can abort; after a rollout is aborted, completed or halted, the API refuses any further advance with HTTP 409."
**Do:** open **Previous rollouts** and load an earlier rollout. **Say:** "All rollouts are persisted in SQLite."

### +4:45 – Experiment lab (≈ 40 s)
**Do:** click **Experiment lab**.
**Point at:** the six scenario cards (description and expectation), Seed 2026, Trials 10.
**Do:** press **Run all scenarios**; wait for it to finish; scroll to **Stored experiments**; press **Open** on one.
**Say:** "Each run replays one scenario for both strategies over ten outcome seeds. The same inputs always give the same outputs. Results are stored."

### +5:25 – Analytics (≈ 55 s)
**Do:** click **Analytics**; select **Injected fault (bad build)** in the dropdown.
**Point at:** the three charts; the "STAGED BETTER / STAGED WORSE" tags; the exposure chart; the table.
**Say:** "Blast radius is 4.6 for staged versus 30.3 for all-at-once, and safety violations are zero versus 80. But staged is worse on unnecessary delays – 45 machines held back that would have succeeded – completion time, simulated exposure and fleet coverage. Gating costs time and exposure."
**Say (caveat – say it clearly):** "These are simulation results on synthetic data. Our failure model makes failures likelier on machines with bad evidence, so gating helps partly by construction. We do not claim real-world improvement."

### +6:20 – Audit center (≈ 35 s)
**Do:** click **Audit center**; type `ROLLOUT_HALTED` in **Search**; click the first row to expand it; clear the search; choose a **Category**; type a **Rollout #**; press **Export CSV** and **Export JSON**.
**Point at:** rule `AUTO_HALT`, the detail "HALT after Stage 2 … 19 machine(s) … NOT touched."
**Say:** "Every decision, triggered rule and experiment result is a timestamped record in SQLite. You can filter, search, page and export."

### +6:55 – Tests, bug fix, limits, conclusion (≈ 60 s)
**Do:** PowerShell in `backend`: `.\.venv\Scripts\python -m pytest -q` → **56 passed**; then `cd ..\frontend; npm test` → **12 passed**.
**Say:** "56 backend tests cover scoring, blockers, missing data, batch progression, health thresholds, halting, audit logging and metrics; 12 frontend tests cover validation and layout; the type-check and production build also pass. During verification we found an intermittent HTTP 500 where a database connection crossed threads; we fixed it and added a regression test that fails without the fix."
**Say (limits):** "Limitations: synthetic data, a failure model correlated with evidence, a coarse clock, no real telemetry, single-user SQLite."
**Say (closing):** "OSGuard is an **educational** prototype that shows, on a reproducible synthetic fleet, how separating urgency from failed and missing evidence, gating on explicit rules and rolling out in health-checked stages can contain a bad update. It does not modify a kernel and does not replace commercial tools. Thank you."

---
**Questions you may get:** Why does staged show higher exposure? What is a subtle regression? (Failure under the thresholds: latency 1.2–1.4×, errors 1.5–2.5 %; undetected.) How are experiments reproducible? What did you change after finding the bug? Why not machine learning? (Explainability and reproducibility.)
