"""Environment-variable configuration for the local playlist refresher."""

from __future__ import annotations

import os

DATABASE_URL: str = os.environ.get(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost/straight-outta"
)
PLAYLIST_NAME_SUFFFIX: str = os.environ.get("PLAYLIST_NAME_SUFFFIX", ": WAUX 91.7FM")
ARTISTS_PER_QUERY: int = int(os.environ.get("ARTISTS_PER_QUERY", "20"))
TRACKS_PER_PLAYLIST: int = int(os.environ.get("TRACKS_PER_PLAYLIST", "100"))
SPOTIFY_MARKET: str = os.environ.get("SPOTIFY_MARKET", "US")
