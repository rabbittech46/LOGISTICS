#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# 00-bootstrap.sh — Enable required extensions before the main schema runs.
# The postgis/postgis image already creates PostGIS, but we need pgcrypto
# and btree_gist for the logistics schema.
# ─────────────────────────────────────────────────────────────────────────────
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS postgis;
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE EXTENSION IF NOT EXISTS btree_gist;
EOSQL

echo "Bootstrap: Extensions created successfully"
