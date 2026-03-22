"""Environment-variable configuration for the playlist refresher Lambda."""

from __future__ import annotations

import os

DATABASE_URL: str = os.environ.get("DATABASE_URL", "")
SPOTIFY_CLIENT_ID: str = os.environ.get("SPOTIFY_CLIENT_ID", "")
SPOTIFY_CLIENT_SECRET: str = os.environ.get("SPOTIFY_CLIENT_SECRET", "")
# Optional: for local runs, pass a user token (e.g. from PKCE) instead of Authorization header
SPOTIFY_ACCESS_TOKEN: str = os.environ.get("SPOTIFY_ACCESS_TOKEN", "")
PLAYLIST_NAME_SUFFFIX: str = os.environ.get("PLAYLIST_NAME_SUFFFIX", ":WAUX 91.7FM")
ARTISTS_PER_QUERY: int = int(os.environ.get("ARTISTS_PER_QUERY", "20"))
TRACKS_PER_PLAYLIST: int = int(os.environ.get("TRACKS_PER_PLAYLIST", "100"))
SPOTIFY_MARKET: str = os.environ.get("SPOTIFY_MARKET", "US")
