"""Research & sources: official documentation links and an honest comparison.

Vendor statements below were checked against the fetched text of each linked page on 2026-10-26.
Statements prefixed "Our observation" are OSGuard's own comparison, not vendor claims.
"""
from __future__ import annotations

VERIFICATION = (
    "On 2026-10-26 the text of each linked page was fetched and the vendor statements below were checked against it. "
    "Pages and PDFs that those pages link to were not read. Statements starting 'Our observation' are the project's own "
    "comparison, not vendor claims. The Apple and CISA entries are based on a table of contents / document index only."
)

SOURCES = [
    {
        "id": "microsoft",
        "vendor": "Microsoft Windows",
        "approach": "Microsoft uses quality and compatibility data to identify issues that could make a Windows client feature update fail or roll back, "
                    "and may apply safeguard holds so affected devices are not offered the update until a fix is found and verified.",
        "strengths": ["Holds are applied from vendor-side quality and compatibility data", "Windows Update for Business reports list active safeguard holds by identifier",
                      "Windows Autopatch-managed devices also benefit from holds on devices likely to be affected"],
        "limitations": ["Per the page, holds only affect devices that use the Windows Update service; admins using other channels (media, WSUS) must watch for known issues themselves",
                        "Our observation: a hold reflects vendor-known issues, not your own application and driver inventory"],
        "links": [
            {"title": "Safeguard holds for Windows (Microsoft Learn)", "url": "https://learn.microsoft.com/en-us/windows/deployment/update/safeguard-holds"},
        ],
    },
    {
        "id": "aws",
        "vendor": "AWS (Systems Manager Patch Manager, Amazon Linux 2023 live patching)",
        "approach": "Patch Manager automates patching of managed nodes using patch baselines (each for a supported OS type) and several methods: patch policies, "
                    "maintenance windows, or on-demand 'Patch now', with compliance reporting. Amazon Linux 2023 Kernel Live Patching applies specific security and "
                    "critical-bug patches to a running kernel without rebooting.",
        "strengths": ["Patch baselines define patching rules per OS type", "Multiple patching methods plus compliance reports",
                      "Live patching can improve availability while fixes are applied until the system can be rebooted"],
        "limitations": ["Per the live-patching page, some issues cannot be addressed by live patching and are only shipped in a full kernel update; it also lists functional limitations while a live patch is applied",
                        "Our observation: the Patch Manager page describes policy and scheduling, not per-machine compatibility evidence scoring"],
        "links": [
            {"title": "AWS Systems Manager Patch Manager", "url": "https://docs.aws.amazon.com/systems-manager/latest/userguide/patch-manager.html"},
            {"title": "Kernel Live Patching on AL2023", "url": "https://docs.aws.amazon.com/linux/al2023/ug/live-patching.html"},
        ],
    },
    {
        "id": "gcp",
        "vendor": "Google Cloud (GKE)",
        "approach": "The best-practices page covers release channels, maintenance windows and exclusions, node upgrade strategies (surge and blue-green), "
                    "Pod Disruption Budgets to set tolerance for disruption, supported control-plane/node version skew, and recommends testing changes in environments separate from production.",
        "strengths": ["Maintenance windows choose when upgrades may happen; exclusions block upgrades for chosen periods", "Explicit upgrade strategies and disruption tolerance settings",
                      "Recommends multiple environments so changes are tested apart from production"],
        "limitations": ["Scope is GKE clusters and node pools, not arbitrary machine fleets",
                        "Our observation: the guidance leaves workload-specific health validation and go/no-go decisions to the operator"],
        "links": [
            {"title": "GKE: best practices for upgrading clusters", "url": "https://docs.cloud.google.com/kubernetes-engine/docs/best-practices/upgrading-clusters"},
        ],
    },
    {
        "id": "apple",
        "vendor": "Apple device management",
        "approach": "Apple Platform Deployment has a 'Manage software updates' section whose topics include About software updates, the software update process, "
                    "installing and enforcing software updates, and testing updates with the AppleSeed for IT beta program.",
        "strengths": ["Dedicated documentation for enforcing updates and for testing updates before release"],
        "limitations": ["Only the guide's table of contents was checked; the detailed capabilities (for example deferrals) are on sub-pages that were not read",
                        "Our observation: nothing on the fetched page describes evidence-based risk scoring"],
        "links": [
            {"title": "Apple Platform Deployment (support.apple.com)", "url": "https://support.apple.com/guide/deployment/welcome/web"},
        ],
    },
    {
        "id": "ics",
        "vendor": "Industrial control systems (CISA)",
        "approach": "CISA's ICS Recommended Practices page indexes documents on ICS cybersecurity topics and their mitigation, including 'Recommended Practice for Patch Management of Control Systems' "
                    "and 'Improving Industrial Control System Cybersecurity with Defense-in-Depth Strategies'.",
        "strengths": ["A dedicated patch-management recommended practice exists for control systems", "Defence-in-depth guidance is indexed alongside it"],
        "limitations": ["Only the index page was read; the content of the linked PDFs was not reviewed",
                        "Our observation: these are guidance documents, not an update-orchestration tool"],
        "links": [
            {"title": "CISA: ICS Recommended Practices", "url": "https://www.cisa.gov/resources-tools/resources/ics-recommended-practices"},
        ],
    },
]

LIBRARIES = [
    {"name": "FastAPI", "license": "MIT"}, {"name": "Pydantic", "license": "MIT"}, {"name": "Uvicorn", "license": "BSD-3-Clause"},
    {"name": "pytest", "license": "MIT"}, {"name": "React", "license": "MIT"}, {"name": "Vite", "license": "MIT"},
    {"name": "Tailwind CSS", "license": "MIT"}, {"name": "Framer Motion", "license": "MIT"},
    {"name": "Three.js", "license": "MIT"}, {"name": "@react-three/fiber", "license": "MIT"},
    {"name": "Recharts", "license": "MIT"}, {"name": "Vitest", "license": "MIT"},
]
