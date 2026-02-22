"""Spotify API helpers: auth, search, playlist create/update."""

import random
import time

import requests

import config

TOKEN_URL = "https://accounts.spotify.com/api/token"
API_BASE = "https://api.spotify.com/v1"

_cached_token = None
_cached_token_expires_at = 0


def get_access_token():
    """
    Obtain a bearer token via client_credentials; cache for warm Lambda invocations.
    """
    global _cached_token, _cached_token_expires_at
    now = time.time()
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


def _request_with_retry(method, url, **kwargs):
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


def search_tracks(artists, limit_tracks):
    """
    Search for tracks by a random subset of artists. Returns list of track URIs (spotify:track:id).
    """
    if not artists:
        return []
    n = min(config.ARTISTS_PER_QUERY, len(artists))
    sample = random.sample(artists, n)
    q = ",".join(sample)
    params = {
        "type": "track",
        "q": q,
        "limit": min(50, limit_tracks),
        "market": config.SPOTIFY_MARKET,
    }
    token = get_access_token()
    resp = _request_with_retry(
        "GET",
        f"{API_BASE}/search",
        params=params,
        headers={"Authorization": f"Bearer {token}"},
    )
    resp.raise_for_status()
    data = resp.json()
    tracks = data.get("tracks", {}).get("items", [])
    uris = []
    for t in tracks:
        uri = t.get("uri")
        if uri and uri.startswith("spotify:track:"):
            uris.append(uri)
        if len(uris) >= limit_tracks:
            break
    return uris[:limit_tracks]


def create_playlist(name):
    """
    Create a public playlist for the current user (token owner). Returns playlist ID.
    """
    token = get_access_token()
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


def replace_playlist_items(playlist_id, track_uris):
    """Replace all items in a playlist with the given track URIs."""
    token = get_access_token()
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


def add_playlist_items(playlist_id, track_uris):
    """Add track URIs to a playlist (e.g. right after create)."""
    token = get_access_token()
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
