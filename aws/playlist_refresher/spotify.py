"""Spotify API helpers: auth, search, playlist create/update."""

from __future__ import annotations

import random
import time
from typing import Any
from urllib.parse import quote, urlencode

import requests

import config

TOKEN_URL = "https://accounts.spotify.com/api/token"
API_BASE = "https://api.spotify.com/v1"
MAX_URL_LENGTH = 250

_cached_token: str | None = None
_cached_token_expires_at: float = 0


def _spotify_quote(
    s: str,
    safe: str = "",
    encoding: str | None = None,
    errors: str | None = None,
) -> str:
    """Quote for Spotify search: spaces as %20, hyphens as %2D."""
    return quote(s, safe=(safe or ""))


def get_access_token() -> str:
    """
    Obtain a bearer token via client_credentials; cache for warm Lambda invocations.
    """
    global _cached_token, _cached_token_expires_at
    now = time.time()
    print(f"Cached token: {_cached_token}")
    print(f"Cached token expires at: {_cached_token_expires_at}")
    if _cached_token and _cached_token_expires_at > now + 60:
        return _cached_token
    resp = requests.post(
        TOKEN_URL,
        data={
            "grant_type": "client_credentials",
            "client_id": config.SPOTIFY_CLIENT_ID,
            "client_secret": config.SPOTIFY_CLIENT_SECRET,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    resp.raise_for_status()
    data = resp.json()
    _cached_token = data["access_token"]
    _cached_token_expires_at = now + data.get("expires_in", 3600)
    return _cached_token


def _request_with_retry(method: str, url: str, **kwargs: Any) -> requests.Response:
    """Run a request and retry on 429 with Retry-After."""
    max_retries = 5
    for attempt in range(max_retries):
        resp = requests.request(method, url, **kwargs)
        if resp.status_code == 429:
            retry_after = int(resp.headers.get("Retry-After", 1))
            time.sleep(retry_after)
            continue
        return resp
    return requests.request(method, url, **kwargs)


def search_tracks(
    artists: list[str],
    limit_tracks: int,
    *,
    access_token: str | None = None,
) -> list[str]:
    """
    Search for tracks: one call per artist (from a random sample of ARTISTS_PER_QUERY),
    gather all results (deduplicated), shuffle, then select up to limit_tracks.
    Returns list of track URIs (spotify:track:id).
    """
    if not artists:
        return []
    n = min(config.ARTISTS_PER_QUERY, len(artists))
    sample = random.sample(artists, n)
    token = access_token or get_access_token()
    seen: set[str] = set()
    uris: list[str] = []

    for artist in sample:
        escaped = artist.replace('"', '\\"')
        q = f'artist:"{escaped}"'
        print(f"Searching for {artist}...")
        params = {
            "type": "track",
            "q": q,
            "limit": 50,
            "market": config.SPOTIFY_MARKET,
        }
        query_string = urlencode(params, quote_via=_spotify_quote)
        resp = _request_with_retry(
            "GET",
            f"{API_BASE}/search?{query_string}"[:MAX_URL_LENGTH],
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        data = resp.json()
        tracks = data.get("tracks", {}).get("items", [])
        artist_lower = artist.lower().strip()
        for t in tracks:
            track_artists = {
                a.get("name", "").lower().strip() for a in t.get("artists", [])
            }
            if artist_lower not in track_artists:
                continue
            uri = t.get("uri")
            if uri and uri.startswith("spotify:track:") and uri not in seen:
                seen.add(uri)
                uris.append(uri)

    random.shuffle(uris)
    return uris[:limit_tracks]


def create_playlist(
    name: str,
    *,
    access_token: str | None = None,
) -> str:
    """
    Create a public playlist for the current user (token owner). Returns playlist ID.
    """
    token = access_token or get_access_token()
    resp = _request_with_retry(
        "POST",
        f"{API_BASE}/me/playlists",
        json={"name": name},
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    resp.raise_for_status()
    return resp.json()["id"]


def replace_playlist_items(
    playlist_id: str,
    track_uris: list[str],
    *,
    access_token: str | None = None,
) -> None:
    """Replace all items in a playlist with the given track URIs."""
    token = access_token or get_access_token()
    resp = _request_with_retry(
        "PUT",
        f"{API_BASE}/playlists/{playlist_id}/items",
        json={"uris": track_uris},
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    resp.raise_for_status()


def add_playlist_items(
    playlist_id: str,
    track_uris: list[str],
    *,
    access_token: str | None = None,
) -> None:
    """Add track URIs to a playlist (e.g. right after create)."""
    token = access_token or get_access_token()
    resp = _request_with_retry(
        "POST",
        f"{API_BASE}/playlists/{playlist_id}/items",
        json={"uris": track_uris},
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    resp.raise_for_status()
