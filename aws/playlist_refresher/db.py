"""Postgres connection and queries for locations, artists, and playlists."""

import psycopg
from psycopg.rows import dict_row

import config


def get_connection():
    """Return a connection to the database using DATABASE_URL."""
    return psycopg.connect(config.DATABASE_URL)


def get_locations_with_artists(conn):
    """
    Return list of (location_id, location_name) for locations that have at least one artist.
    """
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT l.id, l.name
            FROM locations l
            WHERE EXISTS (
                SELECT 1 FROM artists a WHERE a.location_id = l.id
            )
            """
        )
        return [(row["id"], row["name"]) for row in cur.fetchall()]


def get_artists_for_location(conn, location_id):
    """Return list of artist names for the given location."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT name FROM artists WHERE location_id = %s",
            (location_id,),
        )
        return [row["name"] for row in cur.fetchall()]


def get_playlist_for_location(conn, location_id):
    """
    Return playlist_id for the location's existing playlist (years_id IS NULL), or None.
    """
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT playlist_id FROM playlists
            WHERE location_id = %s AND years_id IS NULL
            LIMIT 1
            """,
            (location_id,),
        )
        row = cur.fetchone()
        return row["playlist_id"] if row else None


def insert_playlist(conn, location_id, playlist_id):
    """Insert a new playlist row for the location (years_id = NULL)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO playlists (location_id, playlist_id, years_id)
            VALUES (%s, %s, NULL)
            """,
            (location_id, playlist_id),
        )
    conn.commit()
