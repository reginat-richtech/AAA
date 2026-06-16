#!/usr/bin/env bash
# =====================================================================
# AAA_Database :: deploy schema + seeds + login roles to a cloud database
# ---------------------------------------------------------------------
# Reads .env.<environment>, then applies every migration, the seeds, and the
# application login roles to your managed PostgreSQL instance. Uses a
# throwaway dockerized psql client, so you do NOT need psql installed locally.
#
#   ./deploy/deploy.sh production       # reads .env.production
#   ./deploy/deploy.sh staging          # reads .env.staging
#
# Safe to re-run: every migration/seed/role step is idempotent.
# =====================================================================
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ENVNAME="${1:-}"
[ -n "$ENVNAME" ] || { echo "usage: ./deploy/deploy.sh <environment>   (e.g. 'production' -> reads .env.production)"; exit 1; }
ENVFILE="$ROOT/.env.$ENVNAME"; [ -f "$ENVFILE" ] || ENVFILE="$ROOT/.env"
[ -f "$ENVFILE" ] || { echo "ERROR: no env file found ($ROOT/.env.$ENVNAME). Copy .env.example and fill it in."; exit 1; }

echo "==> loading config from $(basename "$ENVFILE")"
set -a; . "$ENVFILE"; set +a

# Required values
missing=0
for v in PGHOST PGPORT PGDATABASE PGADMIN_USER PGADMIN_PASSWORD APP_RW_PASSWORD APP_RO_PASSWORD; do
    if [ -z "${!v:-}" ] || [ "${!v}" = "CHANGE_ME" ]; then echo "  ! missing/placeholder: $v"; missing=1; fi
done
[ "$missing" -eq 0 ] || { echo "ERROR: fill in the values above in $ENVFILE"; exit 1; }
: "${PGSSLMODE:=require}"

# Dockerized psql: mounts the repo so we can -f the SQL files (and the CA cert).
runpsql() {
    docker run --rm -i \
        -v "$ROOT:/work" -w /work \
        -e PGPASSWORD="$PGADMIN_PASSWORD" \
        -e PGSSLMODE="$PGSSLMODE" \
        ${PGSSLROOTCERT:+-e PGSSLROOTCERT="/work/$PGSSLROOTCERT"} \
        postgres:16 psql -h "$PGHOST" -p "$PGPORT" -U "$PGADMIN_USER" -d "$PGDATABASE" \
        -v ON_ERROR_STOP=1 -q "$@"
}

echo "==> testing connection to $PGHOST:$PGPORT/$PGDATABASE (sslmode=$PGSSLMODE)"
runpsql -c "SELECT 'connected to ' || current_database();" \
    || { echo "ERROR: could not connect. Check host/port/credentials/SSL and that your IP is allowed."; exit 2; }

echo "==> applying migrations + seeds"
for f in "$ROOT"/db/migrations/[0-9]*.sql "$ROOT"/db/seeds/[0-9]*.sql; do
    rel="${f#$ROOT/}"
    if runpsql -f "/work/$rel"; then echo "  OK  $rel"; else echo "  FAIL $rel"; exit 3; fi
done

echo "==> creating application login roles (app_rw, app_ro)"
runpsql -v app_rw_password="$APP_RW_PASSWORD" -v app_ro_password="$APP_RO_PASSWORD" \
        -f /work/deploy/roles.sql \
    && echo "  OK  deploy/roles.sql" || { echo "  FAIL deploy/roles.sql"; exit 4; }

cat <<EOF

==> DEPLOY COMPLETE for environment '$ENVNAME'
    Your application connects as 'app_rw' using APP_DATABASE_URL.
    Reminder: set the tenant context every request --
        SET app.current_organization_id = <org id>;
        SET app.current_user_id        = '<app_user public_id>';
    and inject app.enc_key / app.blind_index_key from your KMS when reading/writing encrypted columns.
    See docs/usage.md for query patterns.
EOF
