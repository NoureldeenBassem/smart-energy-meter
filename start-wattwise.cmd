@echo off
REM ===========================================================================
REM  Wattwise - start the whole project
REM
REM  Double-click this file. It opens four windows, one per service, and waits
REM  until each is actually answering before saying so.
REM
REM  Docker is NOT used. Postgres and Mosquitto run inside WSL Ubuntu on the
REM  same ports docker-compose used (15432 and 1883), so nothing in the app
REM  changes. See backend/scripts/setup_wsl_services.sh.
REM
REM  Closing any of the four windows stops that service. The WSL window is the
REM  one people forget: WSL shuts a distro down when its last process exits, so
REM  that window holds it open with `sleep infinity`.
REM ===========================================================================

setlocal enabledelayedexpansion
title Wattwise launcher
cd /d "%~dp0"

echo.
echo   ================================================
echo     Wattwise - starting the whole project
echo   ================================================
echo.

REM ---------------------------------------------------------------------------
REM  1. Postgres + Mosquitto (inside WSL)
REM ---------------------------------------------------------------------------
echo   [1/4] Postgres + Mosquitto (WSL)...
start "Wattwise - WSL services (KEEP OPEN)" cmd /k wsl -d Ubuntu -u root -- bash -c "service postgresql start; service mosquitto start; echo; echo '  Postgres :15432   Mosquitto :1883'; echo '  KEEP THIS WINDOW OPEN - closing it stops both services.'; echo; sleep infinity"

echo         waiting for Postgres to accept connections...
set /a _tries=0
:waitpg
wsl -d Ubuntu -u root -- pg_isready -h 127.0.0.1 -p 15432 >nul 2>&1
if not errorlevel 1 goto pgready
set /a _tries+=1
if !_tries! gtr 60 (
    echo         [X] Postgres did not come up after 2 minutes.
    echo             Check the "WSL services" window for errors.
    goto :fail
)
ping -n 3 127.0.0.1 >nul
goto waitpg
:pgready
echo         [OK] Postgres ready on 15432.

REM  First run after a database loss: rebuild the schema rather than letting the
REM  backend start against an empty database and fail on every request.
for /f %%T in ('backend\venv\Scripts\python.exe backend\scripts\check_schema.py 2^>nul') do set TABLES=%%T
if "%TABLES%"=="" set TABLES=0
if %TABLES% LSS 10 (
    echo         schema missing ^(%TABLES%/10 tables^) - applying schema.sql...
    pushd backend
    venv\Scripts\python.exe create_tables.py
    popd
) else (
    echo         [OK] schema present ^(10 tables^).
)

REM ---------------------------------------------------------------------------
REM  2. Backend API
REM ---------------------------------------------------------------------------
echo   [2/4] backend API...
start "Wattwise - backend :8000" cmd /k "cd /d "%~dp0backend" && venv\Scripts\python.exe -m uvicorn app.main:app --port 8000 --host 127.0.0.1"

REM ---------------------------------------------------------------------------
REM  3. Telemetry worker (MQTT -> database)
REM ---------------------------------------------------------------------------
echo   [3/4] telemetry worker...
start "Wattwise - telemetry worker" cmd /k "cd /d "%~dp0backend" && venv\Scripts\python.exe -m app.workers.telemetry_worker"

REM ---------------------------------------------------------------------------
REM  4. Frontend
REM ---------------------------------------------------------------------------
REM  npm.cmd, not npm: the bare name resolves to a .ps1 shim that this machine's
REM  execution policy blocks.
echo   [4/4] frontend...
start "Wattwise - frontend :3000" cmd /k "cd /d "%~dp0frontend" && npm.cmd start"

REM ---------------------------------------------------------------------------
REM  Wait until both HTTP services actually answer
REM ---------------------------------------------------------------------------
echo.
echo         waiting for the API and the app to answer...
set /a _tries=0
:waithttp
curl -s -o nul http://localhost:8000/docs 2>nul
if errorlevel 1 goto httpretry
curl -s -o nul http://localhost:3000/auth 2>nul
if not errorlevel 1 goto httpready
:httpretry
set /a _tries+=1
if !_tries! gtr 60 (
    echo         [X] Services did not answer after 2 minutes.
    echo             Check the backend and frontend windows.
    goto :fail
)
ping -n 3 127.0.0.1 >nul
goto waithttp
:httpready

REM ---------------------------------------------------------------------------
REM  Report
REM ---------------------------------------------------------------------------
for /f %%i in ('backend\venv\Scripts\python.exe backend\scripts\lan_ip.py 2^>nul') do set LANIP=%%i

for /f "tokens=2 delims==" %%i in ('findstr /b "MQTT_BROKER_HOST" firmware\config.py') do set CFGIP=%%i
set CFGIP=%CFGIP:"=%
set CFGIP=%CFGIP: =%

echo.
echo   ================================================
echo     Everything is up.
echo   ================================================
echo.
echo     Open:  http://localhost:3000
echo     Login: demo@example.com  /  DemoPass123^^!
echo.
echo     Postgres   127.0.0.1:15432
echo     Mosquitto  127.0.0.1:1883
echo     Backend    127.0.0.1:8000
echo     Frontend   0.0.0.0:3000
echo.
echo     This PC on the LAN: %LANIP%
echo     firmware/config.py points at: %CFGIP%
if not "%LANIP%"=="%CFGIP%" (
    echo.
    echo     [^^!] THESE DO NOT MATCH. The ESP32 will not find the broker.
    echo         Edit firmware/config.py, set MQTT_BROKER_HOST = "%LANIP%"
    echo         and copy it to the board again.
)
echo.
echo     Leave the four windows open. Closing one stops that service.
echo     Do NOT run scripts/mock_esp32.py - the board is the data source now.
echo.
goto :done

:fail
echo.
echo   Startup did not complete. The windows that opened are still running;
echo   close them before trying again.
echo.

:done
echo   Press any key to close this launcher window.
echo   ^(The four service windows stay open.^)
pause >nul
endlocal
