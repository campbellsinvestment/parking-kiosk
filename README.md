# Parking Kiosk Management System

A full-cycle software project built the way a Programmer Analyst works in the real world:
requirements first, design second, code third.

![Status](https://img.shields.io/badge/Status-In%20Development-blue?style=flat-square)
![Stack](https://img.shields.io/badge/Stack-.NET%208%20%7C%20Three.js%20%7C%20SQL%20Server-informational?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-lightgrey?style=flat-square)

---

## What This Project Is

This project simulates a parking facility kiosk system, the kind found at hospitals, airports, and shopping centres. A patron drives in, presses a button, receives a QR-coded ticket, and the gate opens. On exit, the QR is scanned, parking duration is calculated, taxes are applied, payment is collected, and the gate opens again. Every error condition, paper jams, machine faults, payment failures, is handled with a clear message and a fallback path.

The kiosk interface is a 3D scene rendered in the browser using Three.js. It is backed by an ASP.NET Core 8 REST API and a SQL Server database, hosted on Windows Server via IIS.

---

## Why This Project Exists

Most developers start with code. A Programmer Analyst starts with the problem. This project was built to demonstrate that full lifecycle, from understanding what needs to be built all the way through to a working deployed application.

| Phase | Deliverable | Tool |
|---|---|---|
| 1. Requirements | Business Requirements Document | Word |
| 2. Logic Design | Pseudocode | Markdown |
| 3. Process Design | Flowcharts | draw.io |
| 4. System Design | UML Diagrams | Visual Paradigm |
| 5. Implementation | ASP.NET Core API and Three.js Frontend | Cursor |
| 6. Data Layer | SQL Server schema and EF Core migrations | SSMS |
| 7. Deployment | IIS on Windows Server | Windows Server |

---

## How the System Works

**Entry**

The patron pulls up to the entry kiosk and presses the button. The system generates a unique ticket, encodes it as a QR code with a timestamp, prints and dispenses the ticket, and raises the gate bar. The vehicle enters.

**Exit**

The patron drives to the exit kiosk and scans the QR ticket. The system reads the ticket, calculates how long the vehicle was parked, applies the rate tiers, adds tax, and shows the total on screen. The patron pays by card. The receipt prints and the gate opens.

**When Something Goes Wrong**

If the system detects a fault, it logs the error, displays a plain-language message to the patron, raises the gate so no one is trapped, and alerts staff on the admin dashboard. The patron is directed to an indoor payment booth.

---

## Architecture

```
Browser (Kiosk Interface)
  Three.js 3D scene
  Entry kiosk, exit kiosk, error states, payment terminal
        |
        |  HTTPS / REST API / SignalR
        |
ASP.NET Core 8 Web API  (IIS on Windows Server)
  TicketController
  PaymentController
  GateController
  RateController
  AdminController
        |
        |  Entity Framework Core
        |
SQL Server Database
  Tickets, Transactions, Rates, Gates, ErrorLogs, AuditLogs
        |
External Services
  Payment Gateway (Stripe or Moneris)
  Hardware Layer (gate motor, scanner, printer via .NET serial/USB)
```

---

## Rate Schedule

| Duration | Rate |
|---|---|
| 0 to 30 minutes | Free |
| 31 to 60 minutes | $2.00 |
| 61 to 120 minutes | $4.00 |
| Each additional hour | $2.00 |

Tax rate is configurable in the admin panel. Default is Ontario HST at 13%.

---

## Error Handling

| Code | Condition | What the System Does |
|---|---|---|
| ERR-001 | Paper roll empty | Halts printing, raises gate, alerts staff |
| ERR-002 | QR scan fails 3 times | Shows manual entry option, alerts staff |
| ERR-003 | Invalid or expired QR | Rejects ticket, logs attempt, directs to staff |
| ERR-004 | Card declined | Allows 3 retries, then escalates to staff |
| ERR-005 | Payment gateway offline | Raises gate, routes patron to indoor payment |
| ERR-006 | Receipt paper out | Processes payment, skips receipt print |
| ERR-007 | Critical hardware fault | Raises gate as fail-safe, disables kiosk |
| ERR-008 | Network connection lost | Queues transaction locally, retries on reconnect |

---

## Tech Stack

**Frontend**
- Three.js for 3D kiosk rendering in the browser via WebGL
- Vanilla JavaScript with ES Modules
- Served as static files by ASP.NET Core

**Backend**
- ASP.NET Core 8 Web API
- Entity Framework Core 8
- SignalR for real-time gate status and admin updates
- JWT for admin authentication

**Database**
- Microsoft SQL Server
- Code-first migrations via EF Core

**Infrastructure**
- Windows Server with IIS
- HTTPS via TLS 1.2 or higher
- Stripe or Moneris for payment processing

**Dev Tools**
- Cursor for AI-assisted coding
- Visual Paradigm for UML diagrams
- draw.io for flowcharts
- GitHub for version control

---

## Repository Structure

```
parking-kiosk-system/
|
|-- README.md
|
|-- docs/
|   |-- PKS-BRD-001.docx             Business Requirements Document
|   |-- pseudocode.txt               Plain-language logic before code
|   |-- class_diagram.svg            UML class diagram
|   |-- erd_database_schema.html     Entity relationship diagram
|   |-- sequence_entry.svg           Sequence diagram for entry flow
|   |-- sequence_exit_payment.svg    Sequence diagram for exit/payment flow
|   |-- diagrams/
|       |-- flowchart-entry.drawio
|       |-- flowchart-exit.drawio
|       |-- flowchart-error.drawio
|
|-- src/
|   |-- backend/
|   |   |-- ParkingKiosk.API           ASP.NET Core Web API
|   |   |-- ParkingKiosk.Core          Domain models and interfaces
|   |   |-- ParkingKiosk.Infrastructure  EF Core, payment, hardware
|   |   |-- ParkingKiosk.Tests         Unit and integration tests
|   |
|   |-- frontend/
|       |-- index.html
|       |-- main.js                    Three.js entry point
|       |-- scenes/
|       |   |-- EntryKiosk.js
|       |   |-- ExitKiosk.js
|       |   |-- ErrorState.js
|       |-- api/
|           |-- kioskApi.js            Fetch wrapper for the .NET API
|
|-- database/
    |-- schema.sql                     Table definitions
    |-- seed.sql                       Rate schedule seed data
```

---

## Getting Started

**Prerequisites**
- .NET 8 SDK
- SQL Server Express
- Node.js
- Git

**Clone the repo**
```bash
git clone https://github.com/YOUR-USERNAME/parking-kiosk-system.git
cd parking-kiosk-system
```

**Set up the database**

Update the connection string in `src/backend/ParkingKiosk.API/appsettings.json`, then run:
```bash
cd src/backend/ParkingKiosk.API
dotnet ef database update
```

**Run the API**
```bash
dotnet run --project src/backend/ParkingKiosk.API
```
The API will be available at `https://localhost:7001`

**Open the frontend**

Open `src/frontend/index.html` in a browser, or use the Live Server extension in Cursor.

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | /api/tickets | Generate a new entry ticket and QR code |
| GET | /api/tickets/{id} | Retrieve a ticket by ID |
| POST | /api/tickets/{id}/scan | Scan QR at exit and calculate fee |
| POST | /api/payments | Process a card payment |
| GET | /api/rates | Get the current rate schedule |
| PUT | /api/rates | Update the rate schedule (admin) |
| POST | /api/gates/{id}/open | Manual gate override (admin) |
| GET | /api/admin/transactions | Pull transaction report (admin) |
| GET | /api/health | System health check |

---

## Security

- Card data is never stored in this application. All card handling goes through a PCI-DSS compliant payment gateway.
- Admin endpoints require a valid JWT Bearer token.
- All communication runs over HTTPS with TLS 1.2 or higher.
- All database queries use EF Core parameterized statements to prevent SQL injection.

---

## Running Tests

```bash
dotnet test src/backend/ParkingKiosk.Tests
```

Tests cover ticket generation, QR encoding, fee calculation across all rate tiers, tax calculation, error state transitions, and gate control logic.


---

## About This Project

This was built as a Programmer Analyst portfolio piece. The goal was not just to write code but to show the thinking that happens before code gets written. Every design decision in this repo has a requirement behind it, and every requirement came from understanding the problem first.

Connect on [LinkedIn](https://linkedin.com/in/stepocampbell).

---

## License

MIT License. See LICENSE for details.