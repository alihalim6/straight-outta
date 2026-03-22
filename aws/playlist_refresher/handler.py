"""Lambda entrypoint: refresh or create one Spotify playlist per location."""

from __future__ import annotations

import json
import logging
from typing import Any

import config
import db
import spotify

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Map DB location name -> playlist-title friendly name (fill in rest as needed)
LOCATION_DISPLAY_NAMES = {
    "LA": "LA",
    "BAY AREA": "Bay Area",
    "ATL": "Atlanta",
}


def _playlist_display_name(db_name: str) -> str:
    return LOCATION_DISPLAY_NAMES.get(db_name, db_name)


def _get_bearer_token(event):
    """
    Extract Bearer token from HTTP API event (e.g. API Gateway HTTP API).
    Expects Authorization: Bearer <token>.
    For local runs, token can also be set via SPOTIFY_ACCESS_TOKEN env var.
    """
    headers = event.get("headers") or {}
    auth = headers.get("authorization") or headers.get("Authorization") or ""
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    # Local/testing: allow token from env
    return config.SPOTIFY_ACCESS_TOKEN or None


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    For each location with artists: search tracks, then create or update playlist.
    Skips locations with fewer than 25 artists.
    Expects a user OAuth token via Authorization: Bearer <token> (e.g. from PKCE flow).
    """
    token = _get_bearer_token(event)
    if not token:
        return {"statusCode": 401, "body": "Missing or invalid Authorization header"}

    conn = db.get_connection()
    try:

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

                playlist_name = f"{_playlist_display_name(location_name)} {config.PLAYLIST_NAME_SUFFFIX}"
                existing_playlist_id = db.get_playlist_for_location(
                    conn, location_id
                )

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
            except Exception as e:
                logger.exception(
                    "Failed for location %s (%s): %s",
                    location_name,
                    location_id,
                    e,
                )
                # Continue with other locations
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"locations_processed": len(locations)}),
        }
    finally:
        conn.close()
