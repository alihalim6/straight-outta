/**
 * Spotify PKCE auth helpers for the temporary refresh UI.
 * Requires VITE_SPOTIFY_CLIENT_ID. Redirect URI must match Spotify app settings.
 */

const SPOTIFY_AUTH = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN = "https://accounts.spotify.com/api/token";
const SCOPES = "playlist-modify-public playlist-modify-private";

function getClientId() {
  const id = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
  if (!id) throw new Error("VITE_SPOTIFY_CLIENT_ID is not set");
  return id;
}

function getRedirectUri() {
  const base = import.meta.env.VITE_APP_URL || window.location.origin;
  return `${base.replace(/\/$/, "")}/callback`;
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

/** Exchange authorization code for access token. Returns { access_token, expires_in, refresh_token? }. */
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

const STORAGE_ACCESS_TOKEN = "spotify_access_token";

export function saveAccessToken(token) {
  sessionStorage.setItem(STORAGE_ACCESS_TOKEN, token);
}

export function getAccessToken() {
  return sessionStorage.getItem(STORAGE_ACCESS_TOKEN);
}

export function clearAccessToken() {
  sessionStorage.removeItem(STORAGE_ACCESS_TOKEN);
}
