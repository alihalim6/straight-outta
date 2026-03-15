import { useState } from "react";
import {
  redirectToSpotifyLogin,
  getAccessToken,
  clearAccessToken,
} from "../lib/spotifyAuth";

const API_URL = import.meta.env.VITE_API_URL || "";

export default function Refresh() {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const token = getAccessToken();

  async function handleRefresh() {
    if (!token) {
      setStatus("Log in with Spotify first.");
      return;
    }
    if (!API_URL) {
      setStatus("Set VITE_API_URL to your refresh API endpoint.");
      return;
    }
    setLoading(true);
    setStatus("");
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const text = await res.text();
      if (res.ok) {
        setStatus(`Success (${res.status}). ${text || "Playlists refreshed."}`);
      } else {
        setStatus(`Error ${res.status}: ${text || res.statusText}`);
      }
    } catch (e) {
      setStatus(`Request failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: "2rem", maxWidth: "400px" }}>
      <h1>Refresh playlists</h1>
      <p style={{ color: "#666", marginBottom: "1.5rem" }}>
        Temporary page: log in with Spotify (PKCE), then call the API to refresh playlists.
      </p>

      {!token ? (
        <button
          type="button"
          onClick={redirectToSpotifyLogin}
          style={{ marginRight: "0.5rem", marginBottom: "0.5rem" }}
        >
          Log in with Spotify
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            style={{ marginRight: "0.5rem", marginBottom: "0.5rem" }}
          >
            {loading ? "Calling API…" : "Refresh playlists"}
          </button>
          <button
            type="button"
            onClick={() => {
              clearAccessToken();
              setStatus("Logged out.");
            }}
            style={{ marginBottom: "0.5rem" }}
          >
            Log out
          </button>
        </>
      )}

      {status && (
        <p style={{ marginTop: "1rem", whiteSpace: "pre-wrap" }}>{status}</p>
      )}
    </div>
  );
}
