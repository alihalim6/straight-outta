"""Lambda entrypoint: refresh or create one Spotify playlist per location."""

import logging

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


def _playlist_display_name(db_name):
    return LOCATION_DISPLAY_NAMES.get(db_name, db_name)


def lambda_handler(event, context):
    """
    For each location with artists: search tracks, then create or update playlist.
    Skips locations with fewer than 25 artists.
    """
    conn = db.get_connection()
    try:
        token = spotify.get_access_token()
        if not token:
            raise RuntimeError("Failed to obtain Spotify access token")

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
                    artists, config.TRACKS_PER_PLAYLIST
                )
                if not track_uris:
                    logger.warning("No tracks for %s, skipping", location_name)
                    continue

                playlist_name = f"{config.PLAYLIST_NAME_PREFIX}{_playlist_display_name(location_name)}"
                existing_playlist_id = db.get_playlist_for_location(
                    conn, location_id
                )

                if existing_playlist_id:
                    spotify.replace_playlist_items(
                        existing_playlist_id, track_uris
                    )
                    logger.info(
                        "Updated %s: %s (%d tracks)",
                        location_name,
                        existing_playlist_id,
                        len(track_uris),
                    )
                else:
                    new_playlist_id = spotify.create_playlist(playlist_name)
                    spotify.add_playlist_items(new_playlist_id, track_uris)
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
        return {"statusCode": 200, "locations_processed": len(locations)}
    finally:
        conn.close()
