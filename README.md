# Parking Kiosk Management System

A full-cycle software project built the way a Programmer Analyst works in the real world: requirements first, design second, code third.

![Status](https://img.shields.io/badge/Pages-Live-success?style=flat-square)
![Stack](https://img.shields.io/badge/Stack-Three.js%20%7C%20ES%20modules%20%7C%20GitHub%20Pages-informational?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-lightgrey?style=flat-square)

---

## What this repository contains

**In the browser today:** a self-contained **3D parking kiosk demo** under `src/frontend/`. It uses [Three.js](https://threejs.org/) for the lot, entry and exit kiosks, gate booms, vegetation, and driveable vehicles. Kiosk logic (tickets, rates, tax, payments, gates, faults) runs in **`kioskEngine.js`** in memory, aligned with `docs/pseudocode.txt` and the business requirements document. There is **no network** and no server in this repo path; it is suitable for GitHub Pages and local static hosting.

**On paper / in diagrams:** requirements, pseudocode, flowcharts, UML, and sequence diagrams live in **`docs/`**. Those artifacts describe a fuller target system (API, database, hardware); the running demo implements the patron-facing flow in simplified form.

---

## Live demo (GitHub Pages)

The site is **successfully deployed** from this repository via the **Deploy GitHub Pages** workflow (`.github/workflows/deploy-pages.yml`). On each push to `main` (or a manual **workflow_dispatch** run), GitHub Actions publishes the contents of **`src/frontend/`** as the Pages site root.

Typical project URL:

`https://campbellsinvestment.github.io/parking-kiosk/`

(Replace with your fork’s `https://<user>.github.io/<repo>/` if different.)

If the URL 404s, ensure **Settings → Pages → Build and deployment → Source** is set to **GitHub Actions** (see [first-time setup](#github-pages-first-time-setup)).

---

## GitHub Pages (first-time setup)

1. On GitHub: **Settings → Pages**.
2. **Build and deployment → Source:** choose **GitHub Actions** (not “Deploy from a branch”).
3. Save. Open **Actions** and confirm the **Deploy GitHub Pages** workflow succeeds on `main`.

The workflow does not use `actions/configure-pages`, because that action calls the Pages API and returns **404** until Pages has been switched to GitHub Actions at least once.

---

## How the demo works

**Driving:** Click a vehicle to select it, then use the **arrow keys** to drive. A short on-screen hint (arrows + **V** for free camera) appears at the bottom; it auto-hides after a few seconds. A **settings (gear)** control in the top-right reopens those instructions. Press **V** to orbit / pan / zoom the view, **V** again to return to the chase camera behind the selected car.

**Entry:** Any **driveable** car in the entry booth zone can open the entry flow. Use **Get ticket** on the kiosk (or the pop-out). The sim prints a ticket, opens the gate, and you can **Take ticket** or drive in. Boom collision blocks the lane while the gate is down. Any driveable car reaching the **free patron stall** completes entry and closes the gate (not only the default patron car).

**Exit:** At an exit kiosk, **Exit / pay** → **Scan ticket** → pay if prompted. There is **no Done button**: after payment (or a free / booth-pay path), the exit gate opens and the session **ends automatically** when a vehicle drives **out past the connector toward the main road** (+X past the configured threshold). Pop-outs clear and cars stay where they are so you can re-enter with the same or another vehicle.

**Service:** From the entry idle screen, open **Svc** to toggle database, payments, paper, receipt, or **Random faults (demo)** for stress testing. **Reset** on the out-of-service screen or after a simulated fault still performs a **full** patron demo reset (car back to spawn).

---

## Rate schedule (same rules as `kioskEngine.js`)

| Duration | Rate |
|---|---|
| 0 to 30 minutes | Free |
| 31 to 60 minutes | $2.00 |
| 61 to 120 minutes | $4.00 |
| Each additional hour | $2.00 |

Default tax in the engine is **Ontario HST 13%** (`TAX_RATE` in `kioskEngine.js`).

---

## Error codes (demo engine)

| Code | Condition | Patron-facing behaviour (simplified) |
|---|---|---|
| ERR-001 | Ticket / print fault | Message, gate raised where applicable |
| ERR-003 | Invalid QR / ticket | Reject scan, staff message |
| ERR-004 | Card declined | Retries then escalate |
| ERR-005 | Gateway / timeout | Connection message, fail-safe gate where set |
| ERR-006 | Receipt printer | Payment may complete without slip |
| ERR-007 | Critical fault (sim) | Out of service |
| ERR-008 | Database offline at startup | Out of service |

---

## Repository structure

```
parking-kiosk/
├── .github/workflows/deploy-pages.yml   # Publishes src/frontend to GitHub Pages (on main)
├── docs/                                 # BRD, pseudocode, diagrams, flowcharts
├── src/frontend/
│   ├── index.html                        # Canvas, drive/camera hints, settings, overlays
│   ├── main.js                           # Three.js scene, input, UI painting, drive-out exit
│   ├── kioskEngine.js                    # Ticket, payment, gate state machine
│   └── styles.css                        # Hints, pop-out, celebration styling
└── README.md
```

---

## Local development

No build step. Any static file server from `src/frontend` works.

```bash
cd src/frontend
# e.g. Python 3
python3 -m http.server 8080
```

Open `http://localhost:8080`. Or open `index.html` via your editor’s live preview if relative module paths are supported.

The page loads **Three.js from jsDelivr** (see `importmap` in `index.html`).

---

## Future build to explore (ASP.NET & SQL)

The **`docs/`** folder and BRD describe a **production-style** stack that is **not implemented in this repository yet**—a natural next phase to explore:

- **ASP.NET Core** web API or minimal APIs for kiosk commands, payments, and gate hardware integration.
- **SQL Server** (or another relational store) for tickets, transactions, occupancy, and audit logs.
- Deployment targets such as **IIS** or container hosting, plus real payment gateway and device drivers.

The current **GitHub Pages** build is the static **Three.js + `kioskEngine.js`** slice: it validates flows, UX, and requirements in the browser while leaving ASP.NET, SQL, and server infrastructure as a **future build** aligned with the documentation.

---

## Why this project exists

Most developers start with code. A Programmer Analyst starts with the problem. This repo shows the lifecycle from requirements and diagrams through a **working browser demo** deployed on **GitHub Pages**, with room to grow into a full backend (ASP.NET, SQL Server, and related services) as described in the documentation.

Connect on [LinkedIn](https://linkedin.com/in/stepocampbell).

---

## License

MIT License.
