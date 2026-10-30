# Person 1 – Anirudh Koppuravuri (24BCE0490)
**Block:** introduction → OS used → architecture → Operations dashboard + 3D map → Fleet inventory. **Target 4:00.** You speak first and finish your whole block before Person 2 starts.

**Starting state:** server running, browser on `http://127.0.0.1:8000/#/dashboard`, VS Code open on the `OSGuard` folder.

---
### 0:00 – Introduction (≈ 40 s)
**Do:** show the dashboard page full screen. **Point at:** the yellow banner at the top.
**Say:** "Hello, we are Team NOVA from VIT. I am Anirudh Koppuravuri, 24BCE0490, with Kalivarapu Prabhas and Barath Sornaraj. Our project is **OSGuard – risk-aware operating-system update orchestration**. It is an **educational project**. The problem: OS updates close security holes, but they can also break drivers and applications. So how do we decide which machines to patch first, which are safe, and how to roll out in stages so one bad update is contained? OSGuard explains and simulates those decisions. As the banner says, **all data is synthetic and every result is simulated** – nothing real is ever patched."

### 0:40 – Which operating system? (≈ 30 s)
**Do:** open the terminal or the report's Section 3 table. **Point at:** "Windows 11 … 10.0.26300".
**Say:** "OSGuard runs on **Windows 11**, build 10.0.26300. To be clear and upfront: it is **not xv6**, it is **not a kernel modification**, and it is not a real patching agent. The operating-system names you will see – Windows Server, Ubuntu, RHEL, macOS and so on – are only **labels** on 120 made-up machines. No guest OS is installed or booted. The only other OS involved is WSL Ubuntu, which we used for a small C debugging demo that my teammate Prabhas will show."

### 1:10 – Architecture and repository tour (≈ 45 s)
**Do:** in VS Code expand `backend/osguard`, `frontend/src`, `native`, `docs`. Open `docs/ARCHITECTURE.md` (or report Figure 1).
**Point at:** the diagram boxes; then the folder names.
**Say:** "The browser UI is **React and TypeScript** built with Vite. It calls a **FastAPI** backend written in Python. The backend has pure engine modules – `scoring.py`, `simulator.py`, `analytics.py`, `scenarios.py` – that do no input/output, so they are easy to test. Results and the audit log are stored in **SQLite**. The `native` folder holds the C debugging harness, and `docs` holds our report and scripts. Versions: Python 3.14.7, FastAPI 0.143, React 18.3, Three.js 0.169 for the 3D view."

### 1:55 – Starting the app (≈ 10 s)
**Do:** show the PowerShell window with the line "OSGuard running at http://127.0.0.1:8000".
**Say:** "We start everything with one command, `.\start.ps1`, and open port 8000."

### 2:05 – Operations dashboard (≈ 55 s)
**Do:** back on the dashboard. Move the mouse slowly across the 3D map so it tilts; hover a node; click one node; click the **Urgency** toggle then back to **Readiness**.
**Point at:** the legend, the node size, the hover card, the "Inspecting vm-…" panel that opens below, then close it with **Close**.
**Say:** "This 3D map shows every machine as a node. Colour is readiness – green ready, yellow insufficient evidence, red blocked, blue needs approval. Size is business criticality. The scene tilts with the pointer and nodes near the cursor light up. Hovering shows the machine; clicking opens a full explanation. This toggle recolours by urgency instead. If WebGL is unavailable the app falls back to a 2D map."
**Do:** scroll to the stat cards.
**Point at:** each card. **Say:** "120 machines from seed 2026; 102 still need the patch and 18 are compliant; 48 are ready to deploy; 50 are blocked or lack evidence – we never treat those as safe; 6 have no telemetry; 14 are already degraded."
**Do:** scroll to the three charts.
**Say:** "OS distribution, deployment readiness, and urgency bands for pending machines."

### 3:00 – Dashboard lists (≈ 20 s)
**Do:** scroll to Outstanding patches, Priority queue, Urgent but stuck, Recent activity. Click one machine in the priority queue (the inspect panel opens), then **Close**.
**Say:** "Outstanding patches are the synthetic patch catalogue with CVSS scores. The priority queue lists deployable machines by urgency. 'Urgent but stuck' shows high-urgency machines that are not deployable – the right action there is to escalate and mitigate. Recent activity is read from the persisted audit log."

### 3:20 – Fleet inventory (≈ 40 s)
**Do:** click **Fleet** in the sidebar.
**Say / Do:** "The Fleet page lists all 120 machines." Type `vm-081` in **Search** → one row; click the row to expand it. **Point at:** Recommendation, Urgency breakdown, Compatibility evidence, Health snapshot, "Why this recommendation".
**Say:** "This machine is internet-facing with criticality 5, urgency 83.1 – critical – and all mandatory checks pass, so the action is 'deploy – expedited canary'. Every number is explained."
**Do:** clear search; open **OS family**, **Exposure**, **Readiness**, **Criticality** one after another and pick a value; change **Sort by** and press the **Ascending/Descending** button; press **Clear filters**; scroll and press **Show … more**.
**Say:** "Filters, sorting and paging are all live from the API."
**Do:** click **3D map** (top right of the panel), pick Readiness = Blocked – the other nodes dim.
**Say:** "In map view the filter dims non-matching machines."
**Do:** scroll to **Regenerate synthetic fleet**; keep Seed 2026; press **Regenerate (120 machines)**; note the green message.
**Say:** "The same seed always regenerates an identical fleet; this action is recorded in the audit log."

### 4:00 – Hand-off
**Say:** "That covers the platform and the fleet. Prabhas will now explain how the risk engine decides what is safe."
**Leave the browser on:** Fleet page. Hand over the mic.

---
**Questions you may get:** Is this xv6? (No – Windows 11 app.) Why 120 machines? (A deterministic synthetic fleet ≥100 for variety.) What does WebGL fallback do? (Shows an accessible 2D SVG map.) Is the data real? (No – synthetic, labelled everywhere.)
