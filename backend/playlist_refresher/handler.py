"""Local entrypoint: refresh or create one Spotify playlist per location."""

from __future__ import annotations

import json
import logging
from typing import Any

import config
import db
import spotify

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Map locations.name (DB code) -> playlist-title friendly name.
# Keys match FILE_TO_LOCATION_NAME values in .cursor/skills/seed-database/scripts/seed.js.
LOCATION_DISPLAY_NAMES = {
    # West
    "LA": "LA",
    "BAY": "Bay Area",
    "SAC": "Sacramento",
    "PNW": "Pacific Northwest",
    "SW": "Southwest (Desert/Rockies)",
    # Midwest
    "CHI": "Chicago/Illinois/Gary",
    "CLE": "Cleveland/Ohio",
    "DET": "Detroit/Michigan",
    "STL": "St. Louis/Lower Midwest",
    "MIL": "Milwaukee",
    # South
    "FL": "Florida",
    "ATL": "Atlanta",
    "HOU": "Houston",
    "DFW": "Dallas",
    "MISS": "Mississippi",
    "NO": "NOLA",
    "MEM": "Memphis/Tenn",
    # East
    "NY": "NY",
    "BUF": "Buffalo",
    "PHI": "Philly",
    "PITT": "Pittsburgh",
    "NE": "Boston/Northeast",
    "DMV/VA": "DMV/Virginia",
    "NC/SC": "Carolinas",
}


def _playlist_display_name(db_name: str) -> str:
    return LOCATION_DISPLAY_NAMES.get(db_name, db_name)


def _get_bearer_token(event: dict[str, Any]) -> str | None:
    """Extract `Bearer <token>` from the event's Authorization header."""
    headers = event.get("headers") or {}
    auth = headers.get("authorization") or headers.get("Authorization") or ""
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


def _get_region_id(event: dict[str, Any]) -> int | None:
    """Read region_id from queryStringParameters (set by server/api.js)."""
    qs = event.get("queryStringParameters") or {}
    raw = qs.get("region_id")
    if raw in (None, ""):
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def run_refresh(event: dict[str, Any], _context: Any = None) -> dict[str, Any]:
    """
    For each location with artists: search tracks, then create or update playlist.
    Skips locations with fewer than ARTISTS_PER_QUERY artists.
    Expects a user OAuth token via Authorization: Bearer <token> (PKCE flow).
    Optional `region_id` query param scopes the refresh to a single region.
    """
    token = _get_bearer_token(event)
    if not token:
        return {"statusCode": 401, "body": "Missing or invalid Authorization header"}

    region_id = _get_region_id(event)

    conn = db.get_connection()
    try:
        if region_id is not None:
            locations = db.get_locations_with_artists_by_region(conn, region_id)
            logger.info(
                "Found %d locations with artists in region %d",
                len(locations),
                region_id,
            )
        else:
            locations = db.get_locations_with_artists(conn)
            logger.info("Found %d locations with artists", len(locations))

        for location_id, location_name in locations:
            try:
                artists = db.get_artists_for_location(conn, location_id)
                if len(artists) < config.ARTISTS_PER_QUERY:
                    logger.info(
                        "Skipping %s: only %d artists (need %d)",
                        location_name,
                        len(artists),
                        config.ARTISTS_PER_QUERY,
                    )
                    continue

                track_uris = spotify.search_tracks(
                    artists, config.TRACKS_PER_PLAYLIST, access_token=token
                )
                if not track_uris:
                    logger.warning("No tracks for %s, skipping", location_name)
                    continue

                playlist_name = f"{_playlist_display_name(location_name)}{config.PLAYLIST_NAME_SUFFFIX}"
                existing_playlist_id = db.get_playlist_for_location(conn, location_id)

                if existing_playlist_id:
                    spotify.replace_playlist_items(
                        existing_playlist_id, track_uris, access_token=token
                    )
                    db.touch_playlist_updated(conn, location_id)
                    logger.info(
                        "Updated %s: %s (%d tracks)",
                        location_name,
                        existing_playlist_id,
                        len(track_uris),
                    )
                else:
                    new_playlist_id = spotify.create_playlist(
                        playlist_name, access_token=token
                    )
                    spotify.add_playlist_items(
                        new_playlist_id, track_uris, access_token=token
                    )
                    db.insert_playlist(conn, location_id, new_playlist_id)
                    logger.info(
                        "Created %s: %s (%d tracks)",
                        location_name,
                        new_playlist_id,
                        len(track_uris),
                    )
            except Exception as exc:
                logger.exception(
                    "Failed for location %s (%s): %s",
                    location_name,
                    location_id,
                    exc,
                )
                # Continue with other locations
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(
                {
                    "locations_processed": len(locations),
                    "region_id": region_id,
                }
            ),
        }
    finally:
        conn.close()
