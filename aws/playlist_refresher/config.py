"""Environment-variable configuration for the playlist refresher Lambda."""

import os

DATABASE_URL = os.environ.get("DATABASE_URL", "")
SPOTIFY_CLIENT_ID = os.environ.get("SPOTIFY_CLIENT_ID", "")
SPOTIFY_CLIENT_SECRET = os.environ.get("SPOTIFY_CLIENT_SECRET", "")
PLAYLIST_NAME_PREFIX = os.environ.get("PLAYLIST_NAME_PREFIX", "WAUX 91.7FM: ")
ARTISTS_PER_QUERY = int(os.environ.get("ARTISTS_PER_QUERY", "25"))
TRACKS_PER_PLAYLIST = int(os.environ.get("TRACKS_PER_PLAYLIST", "50"))
SPOTIFY_MARKET = os.environ.get("SPOTIFY_MARKET", "US")
