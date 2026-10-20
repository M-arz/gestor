#!/bin/bash
# Crea una base y un usuario por servicio. Ningún usuario puede conectarse
# a la base de otro (se revoca CONNECT a PUBLIC).
set -euo pipefail

create_db() {
  local name="$1" password="$2"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE ${name}_user LOGIN PASSWORD '${password}';
CREATE DATABASE ${name}_db OWNER ${name}_user;
REVOKE ALL ON DATABASE ${name}_db FROM PUBLIC;
SQL
}

create_db auth          "$AUTH_DB_PASSWORD"
create_db teams         "$TEAMS_DB_PASSWORD"
create_db matches       "$MATCHES_DB_PASSWORD"
create_db discipline    "$DISCIPLINE_DB_PASSWORD"
create_db notifications "$NOTIFICATIONS_DB_PASSWORD"
