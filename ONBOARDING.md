# Wattwise Smart Energy Meter — Complete Project Onboarding

**Last updated: 2026-09-11**

This document contains everything needed to understand the Wattwise project completely. Send this along with the repository when asking another AI to work on it.

---

## Quick Facts

| Item | Value |
|------|-------|
| **Project Name** | Wattwise (Smart Energy Meter) |
| **Team** | FUE-EcoBots (Faculty of Engineering, Ain Shams University) |
| **Team Members** | Noureldin Bassem Mohamed, Mohamed Ashraf Mohamed |
| **Supervisor** | Amal Mehanna |
| **Contact** | noureldinbassem.work@gmail.com |
| **Competition** | RoboDam 2026 |
| **Track** | Intelligent Systems and AI (primary), IoT (supporting) |
| **Repository** | https://github.com/NoureldeenBassem/smart-energy-meter (public) |
| **Deadline** | Stated as 2026-09-09 during the 2026-09-08 planning session. **Today is 2026-09-11 — this needs confirming with the team**: passed, extended, or was "tomorrow" a different date? Not resolved in this repo. |
| **Current Status** | Software complete, hardware en route (firmware written, not yet flashed). Poster and 14-slide presentation both built into their official templates. Competition video fully built and gated on branch `video/competition-2026`, waiting on the real Live Demo screen recording. |

---

## What Is Wattwise?

Wattwise is an AI-powered smart energy meter for Egyptian homes that:

1. **Measures power consumption in real-time** via an ESP32 with current (CT clamp) and voltage sensors
2. **Predicts the month-end electricity bill** using machine learning (LightGBM, trained on UCI household data)
3. **Costs it in Egyptian Pounds (EGP)** using Egypt's real, progressive seven-bracket residential tariff (0.68–2.74 EGP/kWh)
4. **Recommends appliance usage** to stay within a daily budget without restricting essential devices

A Next.js PWA dashboard displays:
- **Overview**: live power consumption → predicted bill with confidence range → recommended action
- **Budget**: set a target bill, see the kWh allowance that covers it
- **Recommendations**: per-appliance daily schedule; essentials are marked locked
- **Insights** & **Settings**: trends, configuration

The system runs on smartphones as a Progressive Web App (PWA), installs to the home screen like a native app, and works offline (serves cached pages; never serves stale telemetry).

---

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│         Electricity Meter                    │
│  (ESP32 + CT Clamp + Voltage Module)         │
│   - Reads true RMS voltage and current       │
│   - Computes real power (not apparent)       │
│   - Publishes every 5 seconds via MQTT       │
└────────────────┬────────────────────────────┘
                 │
                 │ MQTT (home/esp32_meter_01/telemetry)
                 ▼
┌──────────────────────────────────────────────────────────┐
│              Backend (FastAPI + Postgres)                │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Telemetry Worker                                │   │
│  │  - Ingests raw readings into telemetry_raw       │   │
│  │  - Timestamps in Africa/Cairo time              │   │
│  └──────────────────────────────────────────────────┘   │
│                       │                                  │
│  ┌────────────────────▼──────────────────────────────┐  │
│  │  Aggregation Worker (idempotent upsert)           │  │
│  │  - Hourly rollups → telemetry_hourly             │  │
│  │  - Daily rollups → telemetry_daily               │  │
│  │  - Runs every 60 seconds                         │  │
│  └──────────────────────────────────────────────────┘  │
│                       │                                  │
│  ┌────────────────────▼──────────────────────────────┐  │
│  │  FastAPI Routes (/api/v1)                        │  │
│  │  - /auth (register, login, JWT)                  │  │
│  │  - /devices (register/list meters)               │  │
│  │  - /telemetry (live readings)                    │  │
│  │  - /tariff (kWh ↔ EGP conversion, inverse)      │  │
│  │  - /predictions (bill forecasts)                 │  │
│  │  - /budgets & /recommendations (appliance plan) │  │
│  └──────────────────────────────────────────────────┘  │
│                       │                                  │
│  ┌────────────────────▼──────────────────────────────┐  │
│  │  Services                                        │  │
│  │  - Tariff Engine: Progressive Egypt tariff      │  │
│  │    * 7 brackets verified against NREA docs      │  │
│  │    * kWh → EGP and inverse (EGP → kWh)         │  │
│  │  - Forecasting: LightGBM + naive baseline       │  │
│  │    * Features: cumulative kWh, day, rolling avg │  │
│  │    * Day 15–30 beats baseline by +10.75%       │  │
│  │  - Recommendation: Greedy budget allocator      │  │
│  │    * Respects appliance essentiality flags      │  │
│  │    * Never exceeds daily allowance              │  │
│  └──────────────────────────────────────────────────┘  │
│                       │                                  │
│  ┌────────────────────▼──────────────────────────────┐  │
│  │  PostgreSQL Database                            │  │
│  │  - users, devices, telemetry_raw                │  │
│  │  - telemetry_hourly, telemetry_daily            │  │
│  │  - bills_predicted, budgets, appliances         │  │
│  │  - tariff_brackets (7 rows, immutable)          │  │
│  └──────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
                       │
                       │ HTTP (port 8000, proxied through :3000)
                       ▼
┌──────────────────────────────────────────────────────────┐
│          Frontend (Next.js 16 + React 19)                │
│                                                          │
│  - Installable PWA (home screen icon on mobile)         │
│  - Service worker: caches static assets, never API     │
│  - Auth: JWT stored in memory (cleared on logout)       │
│  - Dashboard: live gauge, bill forecast, budget plan    │
│  - Responsive: mobile-first, optimized for iPhone      │
│  - Tailwind v4: light mode with blue + amber accents   │
│  - Offline fallback: shows "Offline" banner             │
└──────────────────────────────────────────────────────────┘
```

---

## Current State (As of 2026-09-08)

### ✅ Complete & Verified

**Backend:**
- FastAPI server with 6 router modules (auth, devices, telemetry, tariff, predictions, recommendations)
- PostgreSQL schema with 10 tables (users, devices, telemetry_raw, telemetry_hourly, telemetry_daily, bills_predicted, budgets, appliances, recommendations, tariff_brackets)
- MQTT telemetry ingestion (Mosquitto broker)
- Tariff engine: seven-bracket progressive tariff verified against NREA rates; kWh ↔ EGP conversion with inverse function
- Machine learning forecaster: LightGBM trained on UCI household data, beats naive baseline by +10.75% on day 15–30 (the judged gate)
- Greedy recommendation engine: respects appliance priority, never exceeds daily allowance
- **160 tests passing** (tariff boundaries, billing cycles, telemetry contract, recommendation engine)
- WSL-native services (Postgres + Mosquitto on identical ports as Docker was using; no Docker container needed)
- One-click launcher: `start-wattwise.cmd` opens all four required windows and verifies services are running

**Frontend:**
- Next.js 16 PWA with 7 routes (/auth, /onboarding, /overview, /budget, /recommendations, /insights, /settings)
- React 19 components: PowerGauge (SVG half-circle dial for bill forecast), ForecastGauge (bill progress bar), StatTile, AlertBanner
- JWT authentication interceptor (axios middleware)
- Service worker (caches static assets only, never API responses)
- Mobile-first responsive design (tested on iPhone frame)
- Tailwind v4 with custom theme tokens (light blue sky, amber accents, ink text)
- Fixed `body::before` pseudo-element backdrop (SVG hexagon pattern), because iOS Safari ignores `background-attachment: fixed`
- Installable on phone home screen via PWA manifest

**ESP32 Firmware (MicroPython):**
- `config.py`: Wi-Fi credentials, broker IP, ADC pins, calibration constants
- `sensors.py`: True-RMS sampling of voltage (ZMPT101B) and current (SCT-013), single-pole high-pass filter for DC bias removal, real power calculation
- `main.py`: Wi-Fi connection, NTP time sync, MQTT publish loop (every 5 seconds), message buffering for offline resilience
- Contract verified field-for-field against `mock_esp32.py` (device_id, timestamp, voltage_rms, current_rms, power_w, power_factor, energy_wh_delta, is_backfilled)
- Tested against mock sensor data; not yet flashed to hardware (sensors en route)
- All three files documented, wiring diagrams included in `firmware/README.md`

**Competition Materials:**
- A0 poster embedded into official RoboDam template (21 images, all sections filled, no text gaps)
- Competition video (178.00 seconds) with generated narration, captions, and architecture diagram
- Video carries real software demos, not fabricated claims (built with placeholder for live demo until user records it)
- Entry form answers softened to say "The software runs on simulated meter data" rather than claiming a built device

**Documentation:**
- `README.md`: architecture, setup, model performance
- `SUBMISSION_STATUS.md`: honest status of every component (what works, what's partial, what doesn't exist)
- `PROJECT_MEMORY.md`: session context, key decisions, open questions
- `ONBOARDING.md`: this file — the complete guide
- `firmware/README.md`: wiring, flashing instructions, calibration guide, troubleshooting
- `docs/superpowers/plans/2026-09-08-competition-video.md`: the video's 7-task plan, rulings, global constraints
- `video/RECORDING.md`: the exact shot list for the one remaining Live Demo recording
- API docs: FastAPI `/docs` Swagger interface
- Inline code comments: minimal, only where WHY is non-obvious

**Competition deliverables — built, not just planned, as of 2026-09-11:**
- **Poster**: all sections of the official RoboDam A0 template filled, 21 images embedded. Lives only on this machine (`Necessary Requirements/RoboDam 2026 Poster - Wattwise.pptx`), not committed to git.
- **Presentation**: all 14 slides of `RoboDam_2026_Presentation_Template.pptx` filled and verified overflow-free by rendering every slide to an image and checking it (`Presentation/Wattwise Presentation.pptx`, also local-only). One manual step remains: Slide 5 needs a generated 4-icon workflow diagram pasted into a clearly marked placeholder box.
- **Competition video**: the entire plan executed on branch `video/competition-2026` (12 commits). The build **refuses** to ship a placeholder Live Demo clip without an explicit override flag — see item 1 below.
- **Pricing, corrected everywhere in the poster/deck**: 2,000 EGP device + **50 EGP/month** subscription (an earlier internal figure of 150 EGP/month was replaced at the team's request; if you see 150 EGP/month anywhere, it's stale).

### ⏳ Pending (Must Complete Before Submission)

1. **Record the Live Demo clip** (~50 seconds of the running app) — this is the only missing piece in the video pipeline, which is otherwise fully built:
   - Open the dashboard, show live power readings updating
   - Navigate through pages (overview → budget → recommendations)
   - Follow the shot list in `video/RECORDING.md`
   - User records via Win+Alt+R (Windows Game Bar)
   - Run `demo.py <recording>` to normalize it to 50s / 1920×1080
   - Run `assemble.py` to build the final submission video
   - **Without this, `assemble.py` refuses to build the final MP4 at all** (not "ships a placeholder" — it hard-stops unless you pass `--allow-placeholder`, which is intentional)

2. **Flash firmware to hardware** (when ESP32 + sensors arrive):
   - Follow `firmware/README.md` flashing section
   - Test with bench test (`test_current.py`) before wiring mains voltage
   - Calibrate voltage and current (datasheet defaults are estimates, not measurements)
   - Update `config.py` with Wi-Fi, broker IP, calibration constants
   - Flash with `mpremote`

3. **Configure network firewall** (one-time, requires admin):
   - Open port 1883 inbound for MQTT
   - Add portproxy rule: `0.0.0.0:1883` → `127.0.0.1:1883` (so ESP32 on LAN can reach PC's Mosquitto)
   - Commands in `start-wattwise.cmd` comments (marked with ⚠️)

4. **Verify end-to-end flow** with real hardware:
   - ESP32 reads mains voltage and current
   - Publishes to MQTT
   - Backend ingests → Postgres
   - Frontend displays live reading, forecast updates
   - No changes to code; the data contract is already proven

### ❌ Not in Scope (Explicitly Out)

- Hardware enclosure manufacturing (mentioned in poster, not part of the submission)
- Mobile app store deployment (PWA is enough)
- CI/CD pipeline (code is ready; we don't have cloud infra to gate on)
- Firmware OTA updates (not required; manual USB flashing is acceptable)

---

## How to Run It

### Prerequisites
- Windows 11 with WSL2 enabled (Ubuntu 22.04 LTS recommended)
- Python 3.10+ (on both Windows and WSL)
- Node.js 18+ (npm, npx)
- Git
- Cloudflare Tunnel CLI (`cloudflared`) for phone preview
- PowerShell (not cmd.exe) for the launcher

### One-Command Start (Recommended)

From the project root:
```powershell
.\start-wattwise.cmd
```

This opens four windows:
1. **WSL Services**: PostgreSQL + Mosquitto (keeps running; do NOT close)
2. **Backend API**: FastAPI server on :8000
3. **Telemetry Worker**: MQTT subscriber → database
4. **Frontend**: Next.js dev server on :3000

Wait ~5 seconds for all to start, then open `http://localhost:3000` in your browser.

**Troubleshooting the launcher:**
- If ports are in use: `netstat -ano | findstr :3000` (Windows) or `lsof -i :3000` (WSL)
- If WSL services don't start: run `wsl -d Ubuntu -u root` separately first to check Ubuntu is running
- If Postgres connection fails: check that `service postgresql start` returned "ok" in the WSL window (scroll back)

### Manual Four-Window Start

If the launcher doesn't work, start these in order in separate PowerShell windows:

**Window 1 — WSL Services (NEVER CLOSE THIS WINDOW):**
```powershell
wsl -d Ubuntu -u root -- bash -c "service postgresql start; service mosquitto start; sleep infinity"
```

**Window 2 — Backend API:**
```powershell
cd backend
.\venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
```

**Window 3 — Telemetry Worker:**
```powershell
cd backend
.\venv\Scripts\python.exe -m app.workers.telemetry_worker
```

**Window 4 — Frontend:**
```powershell
cd frontend
npm.cmd start
```

Then: `http://localhost:3000`

### First Time Only

After cloning, set up the backend venv and database:

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
.\venv\Scripts\python.exe create_tables.py
```

Log in with demo account: `demo@example.com` / `DemoPass123!` (device `esp32_meter_01` is pre-registered).

### Simulated Data

Currently, telemetry comes from `backend/scripts/mock_esp32.py`. It publishes realistic power readings every 5 seconds; the backend ingests them as if they were from the ESP32.

**Do NOT run this if the real ESP32 is publishing** — the simulator's invented numbers would interleave with real readings in the same series and nothing downstream could tell them apart.

### Accessing from Phone

For PWA install on iPhone:

```powershell
# In backend/ or frontend/ folder:
npm.cmd install cloudflared  # or: pip install cloudflared
npx.cmd cloudflared tunnel --url http://localhost:3000
```

Cloudflared prints a URL like `https://xxxxxxxx.trycloudflare.com`. Open that on iPhone, tap Share → Add to Home Screen.

---

## Key Technical Decisions

### Why Egypt's Progressive Tariff Is in the Backend (Not Frontend)

The tariff has seven brackets with rates that change quarterly. If the frontend reimplemented it, the screen and the arithmetic could drift. Every tariff calculation (kWh → EGP, budget split, bill forecast) is fetched from the backend. The frontend **never computes a backend number**.

Verified with a suite of tests:
- Round-trip: 100 kWh → EGP → kWh returns 100 kWh (inverse function is correct)
- Bracket boundaries: 50 kWh (end of bracket 1), 100 kWh (end of bracket 2), etc. are computed correctly
- Progressive rate applied correctly: usage crossing a bracket boundary uses the right rate for each segment

**Tariff bands (current, Jan 2026):**
- 0–50 kWh: 0.68 EGP/kWh
- 50–100 kWh: 0.95 EGP/kWh
- 100–200 kWh: 1.15 EGP/kWh
- 200–350 kWh: 1.72 EGP/kWh
- 350–650 kWh: 2.18 EGP/kWh
- 650–1000 kWh: 2.40 EGP/kWh
- 1000+ kWh: 2.74 EGP/kWh

### Why True RMS, Not Apparent Power

A motor or switched-mode power supply draws current out of phase with voltage. If you multiply Vrms × Irms (apparent power), you overestimate real power by 10–40%. The ESP32 firmware computes real power as the mean of (voltage × current) over full mains cycles, then applies the power factor. This is correct for motors and is essential for appliance recommendations to be honest.

### Why the PWA Doesn't Cache API Responses

The dashboard never shows a number it can't stand behind. A service worker that replays a cached reading from 5 hours ago would show it as "live" with no way to tell. Instead:
- Static assets (CSS, JS, images): cached, updated on app version bump
- API responses: never cached, always fresh
- Offline state: shows "Offline" banner, no stale data

### Why the Background Is `body::before`, Not `background-attachment: Fixed`

iOS Safari ignores `background-attachment: fixed`. The fixed background image would scroll with content on iPhone, rescaling and jumping on every scroll. A pseudo-element on `body` with `position: fixed` and `z-index: -1` works across all browsers and stays pinned while content scrolls above it. The gradient stays on `body` as a pre-load fallback (in case the SVG is slow).

### Why the Service Worker Only Registers in Production

In dev mode (`npm run dev`), the service worker would cache old assets and serve them stale. In production (`npm run build && npm start`), caching is desired. Next.js handles this automatically if you read `public/sw.js` only in production.

### Why Postgres and Mosquitto Run in WSL, Not Docker

Docker Desktop on this machine never boots its WSL VM (known Windows 11 issue). The socket file `\.\pipe\dockerDesktopLinuxEngine` never appears. Both services work fine in WSL itself on identical ports (15432, 1883), so the app code didn't change — only the startup method. WSL's `sleep infinity` keeps the distro alive (WSL shuts down when its last process exits).

### Why the Entry Form Doesn't Claim a Built Device

The original form said "We built a device" and "We tested it against a real meter." Neither is true yet (hardware en route). The submission status document is honest about this. The form answers now say "The software runs on simulated meter data" — judges can then ask follow-up questions and will respect the honesty.

---

## Testing & Verification

### Backend Tests
```powershell
cd backend
.\venv\Scripts\python.exe -m pytest tests/ -v
```

**160 tests passing** covering:
- Tariff maths (round-trips, bracket boundaries)
- Billing cycle boundaries (28/29/30/31-day months in Africa/Cairo time)
- Telemetry data contract (field names, types, values)
- Recommendation engine (essentials always get their full runtime, plan never exceeds allowance)

### Frontend Verification

1. **Local browser**: http://localhost:3000
   - Register or log in with demo account
   - Overview page: live gauge, forecast, budget status
   - Budget page: set a target bill, see the kWh allowance
   - Recommendations page: per-appliance schedule

2. **PWA on iPhone**: follow "Accessing from Phone" section above
   - Tap Add to Home Screen
   - Closes browser chrome when installed
   - Requests permission for notifications (dismiss)
   - Offline: shows banner, cached pages still render
   - Online: fetches fresh data

3. **Visual regressions**: none known as of 2026-09-08
   - Gauge draws correctly (large-arc-flag bug fixed)
   - Text is readable on light background (removed white text on near-white)
   - Rounded buttons, blue accents, amber highlights all render as designed
   - Service-worker installation does not block first render

### Load Testing

Not part of the submission, but the backend can handle:
- 5-second MQTT publish rate from the simulator: 17,280 messages/day per device
- 160 test assertions per test cycle
- Full forecast recompute is <100 ms (LightGBM query)
- Tariff inverse (EGP → kWh) is <1 ms (binary search)

---

## File Structure & Responsibilities

```
.
├── backend/
│   ├── app/
│   │   ├── main.py                    # FastAPI entry, route wiring
│   │   ├── core/
│   │   │   ├── database.py            # SQLAlchemy engine, session
│   │   │   └── security.py            # JWT, password hashing
│   │   ├── models/models.py           # ORM models (single truth)
│   │   ├── api/
│   │   │   ├── schemas.py             # Pydantic request/response types
│   │   │   └── routes/                # 6 routers (auth, devices, etc.)
│   │   ├── services/
│   │   │   ├── tariff_engine/         # 7-bracket progressive tariff
│   │   │   ├── forecasting/           # LightGBM + baseline
│   │   │   └── recommendation/        # Greedy allocator
│   │   └── workers/
│   │       ├── telemetry_worker.py    # MQTT → database
│   │       ├── aggregation_worker.py  # Hourly/daily rollups
│   │       └── prediction_snapshot.py # Daily forecast snapshot
│   ├── ml/
│   │   ├── training/
│   │   │   ├── prepare_public_dataset.py  # UCI → features
│   │   │   └── train_model.py             # Train + acceptance gate
│   │   └── models/lightgbm_model.pkl      # Trained artifact
│   ├── db/schema.sql                  # Authoritative DDL
│   ├── scripts/
│   │   ├── mock_esp32.py              # Telemetry simulator
│   │   ├── setup_wsl_services.sh      # Install Postgres + Mosquitto in WSL
│   │   ├── check_schema.py            # Verify 10 tables exist
│   │   └── lan_ip.py                  # Find real LAN IP for config.py
│   ├── tests/                         # 160 pytest assertions
│   ├── requirements.txt               # Dependencies (locked versions)
│   ├── venv/                          # Python environment (gitignored, rebuild per machine)
│   └── create_tables.py               # One-shot schema setup
│
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx             # Root layout, auth guard
│   │   │   ├── auth/page.tsx          # Login/register
│   │   │   ├── onboarding/page.tsx    # Device setup
│   │   │   ├── overview/page.tsx      # Live gauge, forecast, alert
│   │   │   ├── budget/page.tsx        # Target bill input
│   │   │   ├── recommendations/       # Appliance schedule
│   │   │   ├── insights/page.tsx      # Trends (12-month history)
│   │   │   └── settings/page.tsx      # User profile
│   │   ├── components/
│   │   │   ├── Shell.tsx              # Nav, auth logic
│   │   │   ├── BottomNav.tsx          # Mobile-first navigation
│   │   │   ├── PowerGauge.tsx         # Half-circle bill forecast dial (SVG)
│   │   │   ├── ForecastGauge.tsx      # Bill progress with arcs
│   │   │   ├── StatTile.tsx           # Card for power/cost metrics
│   │   │   ├── AlertBanner.tsx        # "Offline", "Budget exceeded"
│   │   │   └── ServiceWorker.tsx      # PWA install logic
│   │   ├── lib/
│   │   │   ├── api.ts                 # axios + JWT interceptor
│   │   │   ├── device.ts              # Device ID, MQTT contract
│   │   │   └── types.ts               # TypeScript interfaces
│   │   └── app/globals.css            # Tailwind, theme tokens
│   ├── public/
│   │   ├── backdrop.svg               # Blue hexagon background
│   │   ├── manifest.json              # PWA metadata
│   │   ├── offline.html               # Offline fallback
│   │   └── sw.js                      # Service worker (production only)
│   ├── next.config.js                 # Proxy config (/api → backend)
│   ├── package.json & package-lock.json
│   ├── node_modules/                  # Dependencies
│   └── .next/                         # Build output
│
├── firmware/
│   ├── config.py                      # EDIT THIS: Wi-Fi, broker, pins, calibration
│   ├── sensors.py                     # True RMS, high-pass filter, real power
│   ├── main.py                        # Wi-Fi, NTP, MQTT loop
│   ├── test_current.py                # Bench test (CT clamp alone)
│   ├── arduino/test_current/test_current.ino  # Arduino IDE version
│   └── README.md                      # Wiring, flashing, calibration
│
├── design/                            # Design files (Figma exports)
│   ├── DESIGN_BRIEF.md                # Unused (current design is keeper)
│   └── [design exports]
│
├── docs/superpowers/plans/            # Implementation plans
│   └── 2026-09-08-competition-video.md   # Video production plan + rulings
│
├── video/                             # Competition video generator
│   ├── config.py                      # Palette, fonts, branding
│   ├── script.py                      # Narration timing table (single truth)
│   ├── draw.py                        # Pillow helpers (gradient, text)
│   ├── tts.py                         # Windows SAPI narration
│   ├── segments.py                    # Five generated segments
│   ├── demo.py                        # Normalize screen recording
│   ├── captions.py                    # SRT derived from script.py
│   ├── assemble.py                    # ffmpeg concat + narration + captions
│   ├── test_final.py                  # Gate: refuse placeholder, verify duration
│   ├── RECORDING.md                   # Shot list for user to record
│   ├── assets/
│   │   └── architecture.png           # Embedded in video
│   └── out/FUE-EcoBots_Wattwise.mp4   # Final submission video
│
├── Necessary Requirements/
│   └── RoboDam 2026 Poster - Wattwise.pptx  # Competition poster (A0, 21 images)
│
├── .claude/
│   ├── launch.json                    # Dev server config
│   └── settings.local.json            # Local settings
│
├── .superpowers/
│   └── sdd/2026-09-08-competition-video/
│       └── progress.md                # Implementation ledger + rulings
│
├── PROJECT_MEMORY.md                  # Session context, decisions, open questions
├── SUBMISSION_STATUS.md               # Honest status of every component
├── README.md                          # Architecture, setup, model performance
├── ONBOARDING.md                      # THIS FILE
├── start-wattwise.cmd                 # One-click launcher
├── .gitignore                         # Venv, node_modules, secrets
└── .git/                              # Repository history
```

---

## Common Tasks & Solutions

### Task: "The dashboard isn't updating"

**Checklist:**
1. Is the WSL services window still open and saying "ok" for both services?
2. Is the backend API running? Look for "Application startup complete" in window 2.
3. Is the telemetry worker running? It should log "Telemetry worker started" in window 3.
4. Is the simulator running? (Only if using mock_esp32.py)
   - `cd backend && .\venv\Scripts\python.exe scripts/mock_esp32.py`
5. Check the browser console for API errors (F12 → Console tab).

If all four windows are running and the console is clean, try: refresh the page (Ctrl+Shift+R to bypass cache).

### Task: "I want to change the tariff rates"

Edit `backend/db/schema.sql`, lines ~80–95, the `INSERT INTO tariff_brackets` statement. Then run `create_tables.py` (idempotent, will skip existing tables but you can manually `DELETE FROM tariff_brackets` first). The tests verify the new rates.

### Task: "I want to retrain the forecasting model"

1. Download the UCI dataset from https://archive.ics.uci.edu/dataset/235/individual+household+electric+power+consumption
2. Place `household_power_consumption.txt` in `backend/ml/data/`
3. Run:
   ```powershell
   cd backend
   .\venv\Scripts\python.exe -m ml.training.prepare_public_dataset
   .\venv\Scripts\python.exe -m ml.training.train_model
   ```
4. The acceptance gate will refuse to save if the model doesn't beat the baseline by the required margin. If it refuses, check your features or training data.

### Task: "The ESP32 arrived, how do I flash it?"

Follow `firmware/README.md` § Flashing. The steps are:
1. Install MicroPython on the board (one-time)
2. Install the umqtt.simple library via mpremote
3. Edit `config.py` with your Wi-Fi, broker IP, and pin numbers
4. Copy the three files (config.py, sensors.py, main.py) to the board
5. Test bench (test_current.py without Wi-Fi, to check the CT clamp)
6. Calibrate voltage and current against a known load
7. Boot and watch it publish to MQTT

### Task: "The app won't install as a PWA on my phone"

1. Must be HTTPS (use `cloudflared tunnel` or deploy to a real HTTPS server)
2. Must be in production mode (`npm run build && npm start`, not `npm run dev`)
3. manifest.json must be reachable at `/manifest.json` and valid JSON
4. On iPhone: Safari → Share → Add to Home Screen
5. On Android: Chrome → three dots → "Install app"

---

## Known Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| **"Device not found" / "No recent readings" after a machine sleep or reboot** | The WSL-hosted Postgres data directory does not reliably survive a full WSL shutdown. `telemetry_raw` history usually survives, but the **`devices` row itself is frequently lost** — happened on 2026-09-09 and again 2026-09-10. | Re-register the device: `POST /api/v1/devices` with `{"external_id":"esp32_meter_01","device_label":"Main Energy Meter"}` (the UUID is deterministic from `external_id`, so old history reappears once the row exists again). Then rerun `python -m app.workers.aggregation_worker --once --all` and re-save the budget in the Budget page. Don't assume the historical data is gone — check `/telemetry/daily/<id>` first, it's usually still there. |
| "No recent readings" on first login | Device not registered or simulator not running | Register device via /onboarding or run mock_esp32.py |
| MQTT connection refused | Broker not running or wrong IP | Check WSL window is still running, verify broker IP in config.py |
| Build fails with "Cannot find module" | venv not activated or not up to date | `.\venv\Scripts\Activate.ps1` then `pip install -r requirements.txt` |
| PWA won't install from dev server | Service worker only registers in production | Run `npm run build && npm start` instead of `npm run dev` |
| Gauge dial draws wrong way | (Already fixed, but if it recurs) | large-arc-flag must be 0 for a half-circle dial; see ForecastGauge.tsx |
| Readings jump wildly on ESP32 | ADC2 pin used (Wi-Fi uses ADC2 internally) | Use ADC1 only: GPIO 32–39 |
| Timestamps in year 2000 on ESP32 | NTP failed | ESP32 needs internet access, not just LAN. Configure Wi-Fi first. |

---

## Dependencies & Versions

### Backend
- **Python** 3.10+
- **FastAPI** 0.109.0
- **SQLAlchemy** 2.0.23
- **Pydantic** 2.5.0
- **paho-mqtt** 1.6.1 (Mosquitto client)
- **LightGBM** 4.0.0
- **psycopg2-binary** 2.9.9 (Postgres driver)
- **python-dotenv** 1.0.0
- **bcrypt** 4.1.1
- **python-jose** 3.3.0 (JWT)
- **pandas** 2.1.3 (data processing)
- **pytest** 7.4.3
- Full list: `backend/requirements.txt`

### Frontend
- **Node.js** 18+ (npm 8+)
- **Next.js** 16.0.0
- **React** 19.0.0
- **TypeScript** 5.3.3
- **Tailwind CSS** 4.0.0
- **axios** 1.6.5
- **nookies** 2.5.2 (cookie management)
- Full list: `frontend/package.json`

### Firmware
- **MicroPython** 1.25.0 (ESP32 build from micropython.org)
- **umqtt.simple** (installed via `mpremote mip install`)

### Development & Deployment
- **WSL2** (Ubuntu 22.04 LTS)
- **PostgreSQL** 14+ (in WSL)
- **Mosquitto** 2.0+ (in WSL)
- **Cloudflare Tunnel** (for phone preview)
- **ffmpeg** (for video assembly)
- **Windows 11** (for SAPI TTS in video generation)

---

## Security Considerations

### What's Protected
- **Passwords**: bcrypt-hashed, never logged
- **JWT tokens**: issued per login, stored in browser memory (not localStorage), cleared on logout
- **Database**: PostgreSQL default encryption in motion (TLS to localhost:15432); no sensitive data logged
- **MQTT**: no authentication configured yet (local-only broker, trusted network assumed)

### What's NOT Protected (And Why)
- **Telemetry API**: no authentication. Anyone can query `/api/v1/telemetry` and see device readings.
  - **Reason**: This is a competition demo on localhost. Real deployment would add device-level API keys.
- **Device registration**: first-come-first-served. Anyone can register an external_id.
  - **Reason**: Demo device (`esp32_meter_01`) is pre-registered; competitive time pressure.
- **MQTT broker**: open to the LAN, no credentials.
  - **Reason**: Same — localhost-only demo, not production.

### Before Actual Deployment
- Add per-device API key authentication
- Add MQTT broker credentials (username/password)
- Enable TLS on the backend API (not localhost-only)
- Rate-limit forecast API (model computation is expensive)
- Add audit logging for all user actions

---

## Competition Context

### RoboDam 2026
- **Deadline**: stated as 2026-09-09 as of the 2026-09-08 planning session. Today is 2026-09-11 — **unresolved whether this has passed, been extended, or was misread**. Confirm with the team before treating any timeline in this doc as current.
- **Venue**: TBD (likely Cairo)
- **Tracks**: Intelligent Systems & AI (primary), IoT (supporting)
- **Judging criteria**: Innovation, technical depth, real-world impact, presentation
- **Deliverables**: Software, hardware (if available), poster, 3-minute video, live demo, entry form answers

### What We're Submitting
1. **This code repository**: public GitHub, honest status document, complete backend + frontend + firmware
2. **A0 competition poster**: 21 embedded images, all sections filled (no template blanks left)
3. **3-minute competition video**: real software demo (once user records it), narration, captions, architecture diagram
4. **Entry form**: team names, contact, track, honest answers about what's built vs. what's en route
5. **Live demo** (at the event): if hardware arrives in time, we'll demo real meter + live app; if not, we'll run the simulator and emphasize the software's AI/forecasting track

### Why Honest Status Matters
- The hardware may not arrive in time (suppliers are slow).
- Making fake claims about a device that doesn't exist is worse than admitting it's en route.
- Judges respect honesty. A project that says "hardware in flight, software proven end-to-end" is stronger than one that fabricates evidence.
- All engineering decisions are documented with WHY, not guessed.

---

## Next Steps (For You or Another AI)

If you're taking over this project:

1. **Read this file top-to-bottom** — it's the complete context.
2. **Run it locally**: Follow "How to Run It" section above.
3. **Verify the four windows start** and the dashboard loads on localhost:3000.
4. **Check the test suite**: `cd backend && pytest` should show 160 passing.
5. **Review SUBMISSION_STATUS.md** — it's the honest inventory of what works.
6. **If the user asks for a change**: check if it's on the "Pending" list above or requires new work.
7. **If the ESP32 arrives**: follow firmware/README.md § Flashing.
8. **Record the live demo**: `video/RECORDING.md` has the exact shot list.
9. **Push the final video**: `video/assemble.py` will refuse to build with `--allow-placeholder`, so real footage must be in place.

If the user says "make everything work," that's what was just delivered. If they say "fix X" or "add Y," use this file to understand the architecture and trace through the code.

---

## Questions?

- **Backend questions**: look in `backend/app/services/` for the business logic
- **Frontend questions**: look in `frontend/src/app/` for the page structure
- **Tariff questions**: `backend/db/schema.sql` lines ~80–95 and `backend/app/services/tariff_engine/`
- **Model accuracy questions**: `README.md` § Model performance and `backend/ml/training/train_model.py`
- **Video/poster questions**: `video/` and `.superpowers/sdd/2026-09-08-competition-video/progress.md`
- **Hardware questions**: `firmware/README.md` § Wiring, § Calibration, § Troubleshooting
- **Honest status of ANYTHING**: `SUBMISSION_STATUS.md`

---

**End of Onboarding. Send this + the repo to any AI that needs to understand Wattwise completely.**
