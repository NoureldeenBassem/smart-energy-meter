#!/usr/bin/env bash
#
# Run Postgres and Mosquitto in WSL instead of Docker.
#
#     wsl -d Ubuntu -u root -- bash "/mnt/c/.../backend/scripts/setup_wsl_services.sh"
#
# Runs as root, so no password prompt.
#
# WHY THIS EXISTS
# ===============
# Docker Desktop on this machine recreates its socket files but never boots its
# WSL VM, so the engine pipe (\\.\pipe\dockerDesktopLinuxEngine) never appears
# and `docker compose up` cannot run. Docker was only ever providing two
# services; WSL can provide both directly.
#
# The ports match backend/.env and docker-compose.yml exactly, so nothing in the
# application changes:
#
#     Postgres    15432   (docker-compose maps 15432:5432)
#     Mosquitto    1883
#
# WSL2 forwards listening ports to Windows localhost, so the backend on Windows
# reaches both at localhost with no further configuration.
#
# Safe to re-run: every step is idempotent.

set -euo pipefail

echo "==> installing postgresql and mosquitto"
apt-get update -qq
apt-get install -y -qq postgresql mosquitto mosquitto-clients

# ---------------------------------------------------------------------------
# Postgres on 15432
# ---------------------------------------------------------------------------
PGVER="$(ls /etc/postgresql | sort -V | tail -1)"
CONF="/etc/postgresql/${PGVER}/main/postgresql.conf"
echo "==> configuring postgres ${PGVER} on port 15432"

sed -i "s/^#\?port *=.*/port = 15432/" "$CONF"
sed -i "s/^#\?listen_addresses *=.*/listen_addresses = 'localhost'/" "$CONF"
service postgresql restart
sleep 3

echo "==> creating role and database"
su postgres -c "psql -p 15432 -v ON_ERROR_STOP=1" <<'SQL'
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'smart_meter_user') THEN
        CREATE ROLE smart_meter_user LOGIN PASSWORD 'smart_meter_pass';
    END IF;
END
$$;
SQL

if ! su postgres -c "psql -p 15432 -tAc \"SELECT 1 FROM pg_database WHERE datname='smart_meter'\"" | grep -q 1; then
    su postgres -c "createdb -p 15432 -O smart_meter_user smart_meter"
fi

# schema.sql opens with CREATE EXTENSION pgcrypto for gen_random_uuid(), which
# an unprivileged role cannot install. Doing it here as postgres means the app's
# own role never needs superuser.
su postgres -c "psql -p 15432 -d smart_meter -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;'"

# ---------------------------------------------------------------------------
# Mosquitto on 1883
# ---------------------------------------------------------------------------
# 0.0.0.0 rather than localhost: the ESP32 connects from the LAN, not from this
# machine. Anonymous access matches backend/mosquitto.conf — fine on a home
# network, not fine on anything exposed to the internet.
echo "==> configuring mosquitto on port 1883"
tee /etc/mosquitto/conf.d/wattwise.conf >/dev/null <<'EOF'
listener 1883 0.0.0.0
allow_anonymous true
EOF
service mosquitto restart
sleep 2

# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------
echo
echo "==> verifying"
pg_isready -h localhost -p 15432 && echo "    postgres: listening on 15432"
if mosquitto_pub -h localhost -p 1883 -t 'wattwise/selftest' -m 'ok' 2>/dev/null; then
    echo "    mosquitto: accepting publishes on 1883"
else
    echo "    mosquitto: NOT accepting publishes -- check 'service mosquitto status'"
fi

echo
echo "Done. Both services are up inside WSL and reachable from Windows on"
echo "localhost:15432 and localhost:1883."
echo
echo "They do NOT survive a reboot. Bring them back with:"
echo "    wsl -d Ubuntu -- service postgresql start"
echo "    wsl -d Ubuntu -- service mosquitto start"
