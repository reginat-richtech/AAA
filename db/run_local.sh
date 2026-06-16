#!/usr/bin/env bash
# =====================================================================
# AAA_Database :: local dev database (PostgreSQL 16 in Docker)
# No host psql install needed. Data persists in a Docker volume.
#
#   ./db/run_local.sh            start (or reuse) the DB and apply migrations + seeds
#   ./db/run_local.sh psql       open an interactive SQL shell inside it
#   ./db/run_local.sh demo       run the usage walkthrough (sample data)
#   ./db/run_local.sh --reset    destroy and rebuild from scratch
# =====================================================================
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$HERE/migrations"; SEED="$HERE/seeds"
NAME=aaa_db; DB=aaa; VOL=aaa_db_data; PORT="${PORT:-}"   # set PORT=5433 (or any free port) to expose to host tools
cmd="${1:-up}"

if [ "$cmd" = "psql" ]; then exec docker exec -it "$NAME" psql -U postgres -d "$DB"; fi
if [ "$cmd" = "demo" ]; then exec docker exec -i "$NAME" psql -U postgres -d "$DB" < "$HERE/examples/usage_walkthrough.sql"; fi
if [ "$cmd" = "--reset" ]; then docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "$VOL" >/dev/null 2>&1 || true; fi

if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
    echo "==> starting existing container $NAME"; docker start "$NAME" >/dev/null
  else
    echo "==> creating container $NAME (volume $VOL${PORT:+, host port $PORT -> 5432})"
    if [ -n "$PORT" ]; then
      docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres \
        -p "$PORT:5432" -v "$VOL:/var/lib/postgresql/data" postgres:16 >/dev/null
    else
      docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres \
        -v "$VOL:/var/lib/postgresql/data" postgres:16 >/dev/null
    fi || { echo "ERROR: could not start container (Docker not running, or PORT $PORT in use)"; exit 2; }
  fi
fi

docker exec "$NAME" bash -c 'for i in $(seq 1 120); do pg_isready -U postgres -q && exit 0; sleep 0.5; done; exit 1' >/dev/null \
  || { echo "ERROR: postgres did not become ready"; exit 3; }

docker exec "$NAME" psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB'" | grep -q 1 \
  || docker exec "$NAME" psql -U postgres -c "CREATE DATABASE $DB" >/dev/null

echo "==> applying migrations + seeds to database '$DB'"
PSQL=(docker exec -e PGOPTIONS=--client-min-messages=warning "$NAME" psql -U postgres -d "$DB" -q -v ON_ERROR_STOP=1)
for f in "$MIG"/[0-9]*.sql "$SEED"/[0-9]*.sql; do
  base="$(basename "$f")"; docker cp "$f" "$NAME:/tmp/$base" >/dev/null
  if "${PSQL[@]}" -f "/tmp/$base"; then echo "  OK  $base"; else echo "  FAIL $base"; exit 4; fi
done

cat <<EOF

==> Local database is UP and ready.
      container : $NAME    db: $DB    user: postgres    password: postgres${PORT:+
      from host : localhost:$PORT  (for GUI tools like TablePlus/DBeaver)}

  Interactive SQL shell:        ./db/run_local.sh psql
  Run the store/read demo:      ./db/run_local.sh demo
  Stop (keep data):             docker stop $NAME
  Resume:                       docker start $NAME
  Wipe & rebuild:               ./db/run_local.sh --reset
EOF
