#!/usr/bin/env bash
# Runs the migrations and the workflow test suite against a scratch Postgres database.
# Usage: supabase/tests/run.sh            (uses local `psql` as the postgres superuser)
#        PSQL="psql postgresql://..." supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."

DB=${TEST_DB:-inv_test}
PSQL=${PSQL:-"psql -U postgres -h localhost"}

$PSQL -q -c "drop database if exists $DB" -c "create database $DB"
run() { $PSQL -v ON_ERROR_STOP=1 -q -d "$DB" -f "$1"; }

run tests/auth_stub.sql
for f in migrations/*.sql; do run "$f"; done
$PSQL -q -d "$DB" -f tests/workflow_test.sql 2>&1 \
  | grep -E 'NOTICE|ERROR|PASSED|CONTEXT' | sed 's/^psql:[^:]*:[0-9]*: //; s/NOTICE:  //'
