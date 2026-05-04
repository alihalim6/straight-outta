"""Spotify API helpers: search, playlist create/update.

All requests use a user OAuth Bearer token supplied by the caller (PKCE flow).
"""

from __future__ import annotations

import random
import time
from typing import Any
from urllib.parse import quote, urlencode

import requests

import config

API_BASE = "https://api.spotify.com/v1"
MAX_URL_LENGTH = 250


def _spotify_quote(
    s: str,
    safe: str = "",
    encoding: str | None = None,
    errors: str | None = None,
) -> str:
    """Quote for Spotify search: spaces as %20, hyphens as %2D."""
    return quote(s, safe=(safe or ""))


def _request_with_retry(method: str, url: str, **kwargs: Any) -> requests.Response:
    """Run a request and retry on 429 with Retry-After."""
    max_retries = 5
    for _ in range(max_retries):
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
    access_token: str,
) -> list[str]:
    """
    Search for tracks: one call per artist (from a random sample of ARTISTS_PER_QUERY),
    gather all results (deduplicated), shuffle, then select up to limit_tracks.
    Only includes a track if the searched artist is the primary (first-listed) artist.
    Returns list of track URIs (spotify:track:id).
    """
    if not artists:
        return []
    n = min(config.ARTISTS_PER_QUERY, len(artists))
    sample = random.sample(artists, n)
    seen: set[str] = set()
    uris: list[str] = []

    for artist in sample:
        escaped = artist.replace('"', '\\"')
        q = f'artist:"{escaped}"'
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
            headers={"Authorization": f"Bearer {access_token}"},
        )
        resp.raise_for_status()
        data = resp.json()
        tracks = data.get("tracks", {}).get("items", [])
        artist_lower = artist.lower().strip()
        for t in tracks:
            artists_list = t.get("artists") or []
            if not artists_list:
                continue
            primary = artists_list[0].get("name", "").lower().strip()
            if primary != artist_lower:
                continue
            uri = t.get("uri")
            if uri and uri.startswith("spotify:track:") and uri not in seen:
                seen.add(uri)
                uris.append(uri)

    random.shuffle(uris)
    return uris[:limit_tracks]


def create_playlist(name: str, *, access_token: str) -> str:
    """
    Create a public playlist for the current user (token owner). Returns playlist ID.
    """
    resp = _request_with_retry(
        "POST",
        f"{API_BASE}/me/playlists",
        json={"name": name},
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
    )
    resp.raise_for_status()
    return resp.json()["id"]


def replace_playlist_items(
    playlist_id: str,
    track_uris: list[str],
    *,
    access_token: str,
) -> None:
    """Replace all items in a playlist with the given track URIs."""
    resp = _request_with_retry(
        "PUT",
        f"{API_BASE}/playlists/{playlist_id}/items",
        json={"uris": track_uris},
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
    )
    resp.raise_for_status()


def add_playlist_items(
    playlist_id: str,
    track_uris: list[str],
    *,
    access_token: str,
) -> None:
    """Add track URIs to a playlist (e.g. right after create)."""
    resp = _request_with_retry(
        "POST",
        f"{API_BASE}/playlists/{playlist_id}/items",
        json={"uris": track_uris},
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
    )
    resp.raise_for_status()
