/**
 * Spotify PKCE auth helpers.
 * Requires VITE_SPOTIFY_CLIENT_ID. Redirect URI must match Spotify app settings.
 */

const SPOTIFY_AUTH = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN = "https://accounts.spotify.com/api/token";
const SCOPES = "playlist-modify-public playlist-modify-private";

const STORAGE_ACCESS_TOKEN = "spotify_access_token";
const STORAGE_EXPIRES_AT = "spotify_expires_at";
const STORAGE_REFRESH_TOKEN = "spotify_refresh_token";

/** Treat token as expired this many seconds before Spotify’s expiry (clock skew + margin). */
const EXPIRY_SKEW_SEC = 60;

function getClientId() {
  const id = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
  if (!id) throw new Error("VITE_SPOTIFY_CLIENT_ID is not set");
  return id;
}

/**
 * Spotify no longer allows the hostname "localhost" in redirect URIs; use loopback IPs
 * (e.g. 127.0.0.1). See https://developer.spotify.com/documentation/web-api/concepts/redirect_uri
 */
function normalizeSpotifyRedirectUri(uri) {
  const trimmed = uri.trim().replace(/\/$/, "");
  try {
    const u = new URL(trimmed);
    if (u.hostname === "localhost") {
      u.hostname = "127.0.0.1";
      return u.toString().replace(/\/$/, "");
    }
  } catch {
    /* keep trimmed */
  }
  return trimmed;
}

/**
 * Must match a Redirect URI in the Spotify app settings exactly (scheme, host, port, path).
 * Set VITE_SPOTIFY_REDIRECT_URI to override (e.g. https://your.domain/callback in production).
 */
function getRedirectUri() {
  const explicit = import.meta.env.VITE_SPOTIFY_REDIRECT_URI?.trim();
  if (explicit) {
    return normalizeSpotifyRedirectUri(explicit);
  }
  const base = (import.meta.env.VITE_APP_URL || window.location.origin).replace(/\/$/, "");
  return normalizeSpotifyRedirectUri(`${base}/callback`);
}

/** Generate a random code_verifier (43–128 chars). */
export function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Compute code_challenge = base64url(sha256(verifier)). */
export async function getCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const STORAGE_VERIFIER = "spotify_code_verifier";

export function storeCodeVerifier(verifier) {
  sessionStorage.setItem(STORAGE_VERIFIER, verifier);
}

function takeCodeVerifier() {
  const v = sessionStorage.getItem(STORAGE_VERIFIER);
  sessionStorage.removeItem(STORAGE_VERIFIER);
  return v;
}

/** Redirect the user to Spotify authorization (PKCE). */
export async function redirectToSpotifyLogin() {
  const clientId = getClientId();
  const redirectUri = getRedirectUri();
  const verifier = generateCodeVerifier();
  storeCodeVerifier(verifier);
  const challenge = await getCodeChallenge(verifier);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  window.location.href = `${SPOTIFY_AUTH}?${params.toString()}`;
}

/** Exchange authorization code for tokens. Returns { access_token, expires_in, refresh_token? }. */
export async function exchangeCodeForToken(code) {
  const verifier = takeCodeVerifier();
  if (!verifier) throw new Error("No code_verifier in session; restart login from the app.");

  const clientId = getClientId();
  const redirectUri = getRedirectUri();

  const res = await fetch(SPOTIFY_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }
  return res.json();
}

function getExpiresAtMsFromStorage() {
  const raw = sessionStorage.getItem(STORAGE_EXPIRES_AT);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Persist access token, expiry, and optional refresh token from a Spotify token response. */
export function saveAuthFromSpotifyTokenResponse(data) {
  const { access_token, expires_in, refresh_token } = data;
  if (!access_token) return;

  sessionStorage.setItem(STORAGE_ACCESS_TOKEN, access_token);
  if (typeof expires_in === "number" && expires_in > 0) {
    sessionStorage.setItem(STORAGE_EXPIRES_AT, String(Date.now() + expires_in * 1000));
  }
  if (refresh_token) {
    sessionStorage.setItem(STORAGE_REFRESH_TOKEN, refresh_token);
  }
}

/** Whether the stored access token is missing or past the skew-adjusted expiry (sync only; no refresh). */
export function isAccessTokenExpiredSync() {
  const at = sessionStorage.getItem(STORAGE_ACCESS_TOKEN);
  if (!at) return true;
  const exp = getExpiresAtMsFromStorage();
  if (exp == null) return true;
  return Date.now() >= exp - EXPIRY_SKEW_SEC * 1000;
}

/**
 * Sync read: returns the access token only if present and not expired by local clock.
 * Does not attempt refresh — use ensureValidAccessToken() when a fresh token may be needed.
 */
export function getAccessToken() {
  if (isAccessTokenExpiredSync()) return null;
  return sessionStorage.getItem(STORAGE_ACCESS_TOKEN);
}

export function clearAccessToken() {
  sessionStorage.removeItem(STORAGE_ACCESS_TOKEN);
  sessionStorage.removeItem(STORAGE_EXPIRES_AT);
  sessionStorage.removeItem(STORAGE_REFRESH_TOKEN);
}

async function refreshWithStoredRefreshToken() {
  const rt = sessionStorage.getItem(STORAGE_REFRESH_TOKEN);
  if (!rt) return null;

  let clientId;
  try {
    clientId = getClientId();
  } catch {
    clearAccessToken();
    return null;
  }

  let res;
  try {
    res = await fetch(SPOTIFY_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: rt,
        client_id: clientId,
      }),
    });
  } catch {
    return null;
  }

  if (!res.ok) {
    clearAccessToken();
    return null;
  }

  const data = await res.json();
  saveAuthFromSpotifyTokenResponse({
    ...data,
    refresh_token: data.refresh_token || rt,
  });
  return data.access_token ?? null;
}

/**
 * Returns a usable access token: uses the stored token if still valid, otherwise tries
 * refresh_token with Spotify. Returns null if the user must log in again.
 * On expired access token with no refresh path, clears stale session storage.
 */
export async function ensureValidAccessToken() {
  const at = sessionStorage.getItem(STORAGE_ACCESS_TOKEN);
  if (!at) return null;
  if (!isAccessTokenExpiredSync()) return at;

  const refreshed = await refreshWithStoredRefreshToken();
  if (refreshed) return refreshed;

  if (!sessionStorage.getItem(STORAGE_REFRESH_TOKEN)) {
    clearAccessToken();
  }
  return null;
}
