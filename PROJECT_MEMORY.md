# Project Memory — Smart Energy Meter (RoboDam 2026)

_Last updated: 2026-08-26_

> **New session? Read these three, in this order:**
> 1. This file — session context, decisions and open threads.
> 2. `SUBMISSION_STATUS.md` — the honest engineering account. What works, what
>    is partial, what is not built, with measured numbers and the method beside
>    each. It is the most valuable document here; do not duplicate it.
> 3. `README.md` — architecture, setup commands, model performance table.
>
> Repo: https://github.com/NoureldeenBassem/smart-energy-meter (public)

## Current State

An AI-powered smart energy meter for Egyptian homes. Working software, **no
hardware yet** — the ESP32 and sensors are on order, so all telemetry comes
from `backend/scripts/mock_esp32.py`. There is no firmware in the repo at all.

Backend (FastAPI + Postgres + Mosquitto, all in Docker) is complete: MQTT
ingestion, hourly/daily rollups on Africa/Cairo local days, a seven-bracket
progressive tariff engine with a verified inverse, a LightGBM month-end
forecaster with serving guards, and a greedy appliance allocator. **160 tests
pass.**

Frontend (Next.js 16, React 19, Tailwind v4) now has seven routes — `/auth`,
`/onboarding`, `/overview`, `/budget`, `/recommendations`, plus `/insights` and
`/settings` from the new design — and is installable as a PWA. A mobile-first
redesign has landed: floating `BottomNav`, minimal top bar, no scene layer.
Verified running on 2026-08-26 with live data flowing (12.7k raw readings, most
recent 1s old).

Competition track: **Intelligent Systems and AI** (primary), IoT (supporting).

**Next up:** `/insights` and `/settings` exist but are NOT in the nav — reachable
only by typing the URL. The entry-form answers about hardware still need
softening. No backup demo video. A from-scratch design brief sits at
`design/DESIGN_BRIEF.md`, unused so far — decide whether the current design is
the keeper before commissioning another.

## Key Decisions

- **2026-08-26** — The background is one SVG (`public/backdrop.svg`) on a fixed
  `body::before`, not `background-attachment: fixed`. _Why:_ iOS Safari ignores
  that property — the image rescales and jumps on every scroll, and this installs
  as a phone PWA. The `--sky-*` gradient stays on `body` as the pre-load fallback.
- **2026-08-26** — `SceneBackground` removed from all three call sites but the
  component kept on disk. _Why:_ the user asked for it gone; keeping the file
  makes it one import away if it is wanted back for judges. Its removal also
  killed a `fetchTelemetry` poll that ran every 5s purely to animate chrome.
- **2026-08-26** — PWA `theme_color`/`background_color` moved from `#0b1016` to
  `#aedcf8` and iOS `statusBarStyle` from `black-translucent` to `default`.
  _Why:_ both were tuned for a dark scene. Over a light background the splash
  flashed near-black and the iOS status bar drew white text on pale blue.
- **2026-08-25** — Proxy `/api/v1/*` through Next rather than calling the
  backend cross-origin. _Why:_ the browser then sees one origin, so CORS never
  applies, and installing the PWA needs one HTTPS tunnel instead of two plus a
  rebuild. `BACKEND_ORIGIN` retargets the proxy; `NEXT_PUBLIC_API_URL` still
  overrides for a genuinely separate deployment.
- **2026-08-25** — The service worker never caches `/api` responses. _Why:_ the
  whole app refuses to show numbers it cannot stand behind; a replayed cached
  reading would render last hour's watts as live with no way to tell.
- **2026-08-25** — PWA over Capacitor or React Native. _Why:_ installs to a
  phone home screen with zero rewrite, and the AI track scores the forecasting,
  not the packaging. React Native would mean discarding the entire frontend.
- **2026-08-25** — Repo made public with the known security gaps documented
  rather than hidden. _Why:_ that honesty is the project's strongest asset in
  front of judges. See `SUBMISSION_STATUS.md` §8.
- **2026-08-24** — Charts stay bar-shaped per the reference mockup; the
  cumulative-vs-ceiling `TrendChart` was removed. _Why:_ the brief asked for
  that layout. It is a better shape for a progressive tariff and is one revert
  away in git history if wanted.
- **2026-08-24** — The frontend never recomputes a backend number. The tariff
  inverse, budget split and confidence band are all fetched. _Why:_ a second
  implementation in TypeScript is exactly how the screen and the arithmetic
  start disagreeing. Stated in `src/lib/api.ts`; keep it true.
- **2026-08-24** — The accent (`#e3ec4a`) is a FILL, never text on a light
  surface — it measures 1.31:1 on white. `--accent-ink` carries accent-coloured
  labels. _Why:_ the obvious mistake here is invisible text.
- **2026-08-24** — Every scene animation is bound to `live`. When the meter
  stops reporting, the disc halts and the scene desaturates. _Why:_ a background
  that animates while no data arrives is a lie told in motion.
- **2026-08-24** — Track declared as Intelligent Systems and AI (primary), IoT
  (supporting). _Why:_ the forecasting, tariff inversion and allocator are the
  differentiator; sensors on a wire are commodity. Also survives the hardware
  not arriving.
- **2026-08-23** — `db/schema.sql` is the only authoritative DDL. The app no
  longer calls `create_all()` on startup; it verifies and reports. _Why:_ ORM
  creation produced tables without DB-level defaults, and
  `CREATE TABLE IF NOT EXISTS` then made that permanent by skipping them.

## Open Questions

- When does the hardware actually arrive, and is there time to calibrate before
  submission?
- The entry-form answers still claim *"We built a device"* and *"we tested it
  against a real meter"*. Neither is true yet — soften or hold them.
- An outsourced design is being produced in another tool. When it lands, it must
  import from `src/lib/api.ts` rather than redefining types, and must not
  reimplement the tariff in TypeScript.
- No backup demo video recorded yet, despite the plan document saying never to
  demo live without one.

## Bugs Fixed

- **2026-08-26** — `ForecastGauge` drew the red arc the wrong way round the dial
  once the bill passed the halfway mark. `arcPath` set the SVG large-arc-flag
  with `to - from > 0.5`, but the flag selects the path LONGER than 180 degrees
  and this dial is a half circle, so it must always be 0. At 815 of a 1120 scale
  the 131-degree arc rendered as the 229-degree reflex arc. _Fix:_ derive the
  flag from the actual sweep in degrees. Hidden until now because the dark
  remainder arc spans exactly 180 degrees, where both flag values look identical.
- **2026-08-26** — `insights/page.tsx` guarded with
  `prediction?.field !== null`, which is TRUE when `prediction` itself is null —
  so the branch ran and then dereferenced `prediction`. The page would throw
  before the first forecast arrived. _Fix:_ guard on `prediction` first. Same
  file rendered the literal string `"undefinedd cycle"`.
- **2026-08-26** — The dropped-in design did not compile: 34 type errors.
  `StatTile` was called with `note` (an alias of `sub`) and `className`;
  `SectionHeading` with `icon`; `settings/page.tsx` was missing five imports
  (`Link`, `ArrowRight`, `Target`, `Gauge`, `TrendingUp`) — a runtime crash, not
  just a type complaint. _Fix:_ widened the two components rather than rewriting
  ~12 call sites, added the imports. Whoever generated it never ran a build.
- **2026-08-25** — The app shipped under two names: `Logo.tsx` exported
  `PRODUCT_NAME = "Wattwise"` for the nav while `manifest.json`, the tab title,
  `offline.html`, the service-worker cache key and the design artboards all said
  "Metermind". _Fix:_ Wattwise everywhere, and `layout.tsx` now imports
  `PRODUCT_NAME` rather than repeating the string, so the metadata cannot drift
  from the nav again. `manifest.json` and `sw.js` are static files that cannot
  import, so those two remain the only hand-kept copies.
- **2026-08-25** — Scene callout labels slid under the card grid and clipped
  mid-word. _Fix:_ all four stack in the left column now; anything right of ~25%
  of that canvas is unsafe because the card grid starts near 42% and the scene
  crops its sides.
- **2026-08-25** — `security.py` shipped a hardcoded fallback JWT signing key,
  so anyone reading the source could mint a token for any user id. _Fix:_ no
  fallback; an ephemeral key is generated per process with a loud warning.
  Caught while scanning ahead of the first public push.
- **2026-08-25** — `requests` and `python-dotenv` were undeclared;
  `python-dotenv` only resolved as a `pydantic-settings` transitive. _Fix:_ both
  added to `requirements.txt`.
- **2026-08-24** — Frosted glass was never rendering. Tailwind v4's CSS pass
  silently dropped the raw `backdrop-filter` declarations. _Fix:_ routed through
  `@apply` so Tailwind's own generator emits it.
- **2026-08-24** — Registration seeded a starter refrigerator with
  `priority="High"` but no `is_essential`, so it defaulted FALSE and the
  allocator could shed it — the original §4 bug, alive for every newly
  registered account while the migrated demo account looked fine. _Fix:_
  `STARTER_APPLIANCE_SPECS` sets it explicitly, pinned by 9 tests. Engine tests
  had missed it because they all built their own fixtures.
- **2026-08-23** — The venv was copied from a teammate's machine and pointed at
  a Python path that does not exist here. _Fix:_ rebuilt locally. A venv is
  machine-specific and must never be copied.

## Things that look like bugs but are not

- **Dev-server noise.** `read ECONNRESET` on every telemetry proxy call, Google
  Fonts download failures, and `/_next/hmr` websocket errors through a tunnel
  all appear in `npm run dev` and are **absent from a production build**. Verify
  with `npm run build && npm start` before chasing any of them.
- **The service worker only registers in production.** `ServiceWorker.tsx`
  returns early in development, so the PWA cannot install from `npm run dev`.
- **"Offline" with no simulator running is correct.** So is a desaturated,
  motionless background scene.

## Running it (five windows, all must stay open)

From `backend/`, in PowerShell — note `npm.cmd` / `npx.cmd`, since bare names
hit blocked `.ps1` shims:

1. `docker compose up -d` then `venv\Scripts\python.exe -m uvicorn app.main:app --port 8000`
2. `venv\Scripts\python.exe -m app.workers.telemetry_worker`
3. `venv\Scripts\python.exe scripts\mock_esp32.py --interval 5`
4. From `frontend/`: `npm.cmd run build` then `npm.cmd start`
5. `npx.cmd cloudflared tunnel --url http://localhost:3000` — for phone/PWA only

Demo account on the dev database: `demo@example.com` / `DemoPass123!`.
