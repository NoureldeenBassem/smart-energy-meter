# Wattwise Quick Reference Card

**Print this or send to a teammate.**

---

## The Project in 30 Seconds

**Wattwise** = AI-powered smart electricity meter for Egyptian homes.  
**What it does**: Reads power consumption, predicts month-end bill, recommends appliance usage to stay within budget.  
**Status**: Software complete (160 tests passing). Hardware (ESP32 + sensors) en route, not yet in hand.  
**Deadline**: Tomorrow (2026-09-09).

---

## To Run It (One Command)

```powershell
.\start-wattwise.cmd
```

Then: `http://localhost:3000`

Logs in with `demo@example.com` / `DemoPass123!`

---

## The Four Windows That Must Stay Open

| Window | Command | Purpose |
|--------|---------|---------|
| 1 | `wsl -d Ubuntu -u root -- bash -c "service postgresql start; service mosquitto start; sleep infinity"` | Database + message broker |
| 2 | `cd backend && .\venv\Scripts\python.exe -m uvicorn app.main:app --port 8000` | FastAPI backend |
| 3 | `cd backend && .\venv\Scripts\python.exe -m app.workers.telemetry_worker` | MQTT subscriber |
| 4 | `cd frontend && npm.cmd start` | React dashboard |

**If any window closes, services stop.** Restart it.

---

## Project Structure

```
backend/              # FastAPI + Postgres + tariff engine + ML forecaster
  ├── app/           # Routes, services, workers
  ├── ml/            # LightGBM model (trained on UCI data)
  ├── db/schema.sql  # 10 tables, authoritative DDL
  └── tests/         # 160 pytest assertions (all passing)

frontend/             # Next.js 16 + React 19 + Tailwind
  ├── src/app/       # 7 pages: auth, overview, budget, etc.
  ├── src/components # Gauges, cards, nav
  └── public/        # PWA manifest, service worker, backdrop SVG

firmware/             # MicroPython ESP32 (not yet flashed)
  ├── config.py      # EDIT THIS: Wi-Fi, broker IP, calibration
  ├── sensors.py     # True RMS, real power
  └── main.py        # Wi-Fi, NTP, MQTT publish loop
```

---

## Critical Pending Tasks

- [ ] **Record live demo** (~50s of running app). See `video/RECORDING.md` for shot list.
- [ ] **Flash firmware** to ESP32 when hardware arrives. Follow `firmware/README.md` § Flashing.
- [ ] **Calibrate voltage & current** against known load (datasheet defaults are estimates).
- [ ] **Configure firewall** for inbound port 1883 (MQTT). Requires admin PowerShell.

**Without the live demo recording, the submission video ships with a PLACEHOLDER CARD visible to judges.**

---

## Key Commands

| Task | Command |
|------|---------|
| Run tests | `cd backend && .\venv\Scripts\python.exe -m pytest tests/ -v` |
| Setup (first time) | `cd backend && .\venv\Scripts\python.exe create_tables.py` |
| Retrain ML model | `cd backend && .\venv\Scripts\python.exe -m ml.training.train_model` |
| Build final video | `cd video && ..\backend\venv\Scripts\python.exe assemble.py` |
| PWA on phone | `cloudflared tunnel --url http://localhost:3000` (then scan QR) |
| Rebuild venv | `cd backend && python -m venv venv && .\venv\Scripts\Activate.ps1 && pip install -r requirements.txt` |

---

## The Stack

- **Backend**: FastAPI, SQLAlchemy, PostgreSQL, Mosquitto, LightGBM
- **Frontend**: Next.js, React, TypeScript, Tailwind CSS, Axios
- **Firmware**: MicroPython (ESP32), MQTT client, ADC sampling
- **Infrastructure**: WSL Ubuntu (Postgres + Mosquitto), Windows 11, Python 3.10+, Node 18+

---

## The Numbers

| Metric | Value |
|--------|-------|
| Backend tests passing | 160/160 |
| Tariff brackets | 7 (verified against NREA rates) |
| Forecast accuracy improvement | +10.75% over baseline (day 15–30) |
| Frontend routes | 7 (auth, overview, budget, recommendations, insights, settings) |
| Database tables | 10 |
| API response time (avg) | <100 ms |
| Tariff inverse (EGP → kWh) | <1 ms |
| PWA size | ~150 KB gzipped |

---

## What to Know Before Changing Code

1. **The tariff is authoritative in the backend.** Frontend never recomputes it (they'd drift). Every tariff value is fetched from `/api/v1/tariff/*`.
2. **The venv is machine-specific.** Never copy `backend/venv` between computers. Rebuild it.
3. **The service worker only works in production.** `npm run dev` doesn't install the PWA. Use `npm run build && npm start` to test PWA install.
4. **MQTT contract is fixed.** The firmware and simulator both publish the same 8 fields. Don't change the topic or schema without updating both.
5. **Tests verify behavior, not just happy paths.** They check bracket boundaries, leap days, essential appliance guarantees, budget limits.

---

## Honest Status

- **Built**: Backend (complete), Frontend (complete), Firmware (written, not flashed), Poster (complete), Video (complete, waiting for live demo clip)
- **Partial**: Entry form answers (softened from false claims)
- **Pending**: Live demo recording, hardware flash, network firewall config
- **Not in scope**: Hardware enclosure, app store deployment, CI/CD pipeline

**Read `SUBMISSION_STATUS.md` for detailed component-by-component status with evidence.**

---

## If Something Breaks

1. **Dashboard doesn't load** → Check that all 4 windows are running. Refresh page (Ctrl+Shift+R).
2. **"No recent readings"** → Device not registered OR simulator not running. Start `mock_esp32.py`.
3. **MQTT connection refused** → WSL services window closed. Restart it.
4. **Build fails** → Run `pip install -r requirements.txt` again (venv may be stale).
5. **PWA won't install** → Must be HTTPS + production mode. Use `cloudflared tunnel` or `npm run build && npm start`.

**See ONBOARDING.md § Known Issues & Solutions for a complete table.**

---

## Sharing This Project

1. **With another AI**: Send this card + `ONBOARDING.md` + the GitHub repo. They'll have complete context.
2. **With judges**: Send the poster + video + entry form answers + `SUBMISSION_STATUS.md` (proves honesty).
3. **With a teammate**: Send this card + `README.md` + point them to `start-wattwise.cmd`.

---

## Contact

- **Team Email**: noureldinbassem.work@gmail.com
- **Team**: Noureldin Bassem Mohamed, Mohamed Ashraf Mohamed
- **Supervisor**: Amal Mehanna
- **Repo**: https://github.com/NoureldeenBassem/smart-energy-meter

---

**Last updated: 2026-09-08** | **Competition deadline: 2026-09-09**
