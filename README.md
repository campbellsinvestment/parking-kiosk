# Parking Kiosk Management System

A full-cycle software project built the way a Programmer Analyst works in the real world: requirements first, design second, code third.

![Status](https://img.shields.io/badge/Status-In%20Development-blue?style=flat-square)
![Stack](https://img.shields.io/badge/Stack-Three.js%20%7C%20ES%20modules%20%7C%20GitHub%20Pages-informational?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-lightgrey?style=flat-square)

---

## What This Repository Contains

**In the browser today:** a self-contained **3D parking kiosk demo** under `src/frontend/`. It uses [Three.js](https://threejs.org/) for the lot, entry and exit kiosks, gate booms, and vehicles. Kiosk logic (tickets, rates, tax, payments, gates, faults) runs in **`kioskEngine.js`** in memory, aligned with `docs/pseudocode.txt` and the business requirements document. There is **no network** and no server in this repo path; it is suitable for GitHub Pages and local static hosting.

**On paper / in diagrams:** requirements, pseudocode, flowcharts, UML, and sequence diagrams live in **`docs/`**. Those artifacts describe a fuller target system (API, database, hardware); the running demo implements the patron-facing flow in simplified form.

---

## Live demo (GitHub Pages)

After [Pages is enabled](#github-pages-first-time-setup) for this repository, the site is published from the **`Deploy GitHub Pages`** workflow using the contents of **`src/frontend/`** as the site root.

Typical project URL:

`https://campbellsinvestment.github.io/parking-kiosk/`

(Replace with your fork’s `https://<user>.github.io/<repo>/` if different.)

---

## GitHub Pages (first-time setup)

1. On GitHub: **Settings → Pages**.
2. **Build and deployment → Source:** choose **GitHub Actions** (not “Deploy from a branch”).
3. Save. Open **Actions** and confirm the **Deploy GitHub Pages** workflow succeeds on `main`.

The workflow does not use `actions/configure-pages`, because that action calls the Pages API and returns **404** until Pages has been switched to GitHub Actions at least once.

---

## How the demo works

**Entry:** Drive the patron car to the entry zone, use **Get ticket** on the kiosk (or the pop-out). The sim prints a ticket, opens the gate, and you can **Take ticket** or drive in. Boom collision blocks the lane while the gate is down.

**Exit:** Use **Exit / pay** at an exit kiosk, **Scan ticket**, then pay if prompted. **Done** resets the scene and closes pop-outs.

**Service:** From the entry idle screen, open **Svc** to toggle database, payments, paper, receipt, or **Random faults (demo)** for stress testing.

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
├── .github/workflows/deploy-pages.yml   # Publishes src/frontend to GitHub Pages
├── docs/                                 # BRD, pseudocode, diagrams, flowcharts
├── src/frontend/
│   ├── index.html                        # Canvas + celebration overlay + kiosk pop-out
│   ├── main.js                           # Three.js scene, input, UI painting
│   ├── kioskEngine.js                    # Ticket, payment, gate state machine
│   └── styles.css                        # Pop-out and celebration styling
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

## Target production architecture (BRD / docs)

The **docs** folder describes a larger system: ASP.NET Core API, SQL Server, IIS, payment gateway, and hardware. That stack is **not** present in this repository yet; the frontend demo is the implemented slice you can run and share today.

---

## Why this project exists

Most developers start with code. A Programmer Analyst starts with the problem. This repo shows the lifecycle from requirements and diagrams through a **working browser demo**, with room to grow into the full backend described in the documentation.

Connect on [LinkedIn](https://linkedin.com/in/stepocampbell).

---

## License

MIT License.
