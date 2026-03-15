#!/usr/bin/env python3
"""
Run database migrations from the migrations/ directory.
Uses DATABASE_URL env var. Each .sql file is executed once; applied names are stored in schema_migrations.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

import psycopg
from psycopg import Connection

MIGRATIONS_DIR: Path = Path(__file__).resolve().parent / "migrations"
DATABASE_URL: str | None = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    print("Set DATABASE_URL", file=sys.stderr)
    sys.exit(1)
assert DATABASE_URL is not None  # For type checker: we exit above if None


def ensure_schema_migrations(conn: Connection[Any]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                name TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ DEFAULT now()
            )
            """
        )
    conn.commit()


def applied_migrations(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT name FROM schema_migrations")
        return {row[0] for row in cur.fetchall()}


def main() -> None:
    sql_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not sql_files:
        print("No .sql files in migrations/", file=sys.stderr)
        sys.exit(1)

    conn = psycopg.connect(DATABASE_URL)
    try:
        ensure_schema_migrations(conn)
        applied = applied_migrations(conn)

        for path in sql_files:
            name = path.name.split(".")[0]
            if name in applied:
                print(f"Skip (already applied): {name}")
                continue
            print(f"Applying: {name}")
            sql = path.read_text()
            with conn.cursor() as cur:
                cur.execute(sql)
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO schema_migrations (name) VALUES (%s)",
                    (name,),
                )
            conn.commit()
            print(f"Done: {name}")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
