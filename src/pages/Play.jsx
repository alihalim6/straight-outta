import { useState, useEffect, useRef } from "react";

export default function Play() {
  const [regions, setRegions] = useState([]);
  const [locations, setLocations] = useState([]);
  const [selectedRegion, setSelectedRegion] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("");
  const [playlistId, setPlaylistId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [embedMode, setEmbedMode] = useState("iframe");
  const apiRef = useRef(null);
  const controllerRef = useRef(null);
  const controllerHostRef = useRef(null);

  useEffect(() => {
    if (window.__SpotifyIframeAPI) {
      apiRef.current = window.__SpotifyIframeAPI;
      return;
    }

    let script = document.querySelector('script[src="https://open.spotify.com/embed/iframe-api/v1"]');
    if (!script) {
      script = document.createElement("script");
      script.src = "https://open.spotify.com/embed/iframe-api/v1";
      script.async = true;
      document.body.appendChild(script);
    }

    const previousHandler = window.onSpotifyIframeApiReady;
    window.onSpotifyIframeApiReady = (IFrameAPI) => {
      window.__SpotifyIframeAPI = IFrameAPI;
      apiRef.current = IFrameAPI;
      if (typeof previousHandler === "function") {
        previousHandler(IFrameAPI);
      }
    };
  }, []);

  useEffect(() => {
    fetch("/api/regions")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setRegions(data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedRegion) {
      setLocations([]);
      setSelectedLocation("");
      setPlaylistId(null);
      return;
    }
    setSelectedLocation("");
    setPlaylistId(null);
    fetch(`/api/locations?region_id=${selectedRegion}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setLocations(data);
      })
      .catch((e) => setError(e.message));
  }, [selectedRegion]);

  useEffect(() => {
    if (!selectedLocation) {
      setPlaylistId(null);
      return;
    }
    const loc = locations.find((l) => String(l.id) === selectedLocation);
    setPlaylistId(loc?.playlist_id || null);
  }, [selectedLocation, locations]);

  useEffect(() => {
    if (!playlistId || !controllerHostRef.current || !apiRef.current) {
      setEmbedMode("iframe");
      return;
    }

    setEmbedMode("controller");
    controllerRef.current?.destroy();
    controllerHostRef.current.innerHTML = "";
    const mount = document.createElement("div");
    controllerHostRef.current.appendChild(mount);

    try {
      apiRef.current.createController(
        mount,
        {
          uri: `spotify:playlist:${playlistId}`,
          width: 600,
          height: 380,
        },
        (controller) => {
          controllerRef.current = controller;
          controller.addListener("ready", () => {
            controller.play();
          });
        }
      );
    } catch {
      setEmbedMode("iframe");
    }

    const fallbackTimer = window.setTimeout(() => {
      if (!controllerRef.current) {
        setEmbedMode("iframe");
      }
    }, 2000);

    return () => {
      window.clearTimeout(fallbackTimer);
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
  }, [playlistId]);

  if (loading) return <div style={{ padding: "2rem" }}>Loading regions…</div>;
  if (error) return <div style={{ padding: "2rem", color: "#c00" }}>{error}</div>;

  const locationsWithPlaylists = locations.filter((l) => l.playlist_id);

  return (
    <div style={{ padding: "2rem", maxWidth: "600px", margin: "0 auto" }}>
      <h1>Play</h1>
      <p style={{ color: "#666", marginBottom: "1.5rem" }}>
        Choose a region, then a location. Only locations with playlists are shown.
      </p>

      <div style={{ marginBottom: "1rem" }}>
        <label htmlFor="region" style={{ display: "block", marginBottom: "0.25rem" }}>
          Region
        </label>
        <select
          id="region"
          value={selectedRegion}
          onChange={(e) => setSelectedRegion(e.target.value)}
          style={{ padding: "0.5rem", minWidth: "200px" }}
        >
          <option value="">— Select region —</option>
          {regions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label htmlFor="location" style={{ display: "block", marginBottom: "0.25rem" }}>
          Location
        </label>
        <select
          id="location"
          value={selectedLocation}
          onChange={(e) => setSelectedLocation(e.target.value)}
          style={{ padding: "0.5rem", minWidth: "200px" }}
          disabled={!selectedRegion}
        >
          <option value="">— Select location —</option>
          {locationsWithPlaylists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
          {selectedRegion && locationsWithPlaylists.length === 0 && (
            <option value="" disabled>
              No locations with playlists in this region
            </option>
          )}
        </select>
      </div>

      {playlistId && (
        <div style={{ marginTop: "2rem" }}>
          <div
            ref={controllerHostRef}
            style={{
              display: embedMode === "controller" ? "block" : "none",
              borderRadius: 12,
              overflow: "hidden",
            }}
          />
          {embedMode === "iframe" && (
            <iframe
              title="Spotify playlist"
              src={`https://open.spotify.com/embed/playlist/${playlistId}`}
              width="100%"
              height="380"
              frameBorder="0"
              allowFullScreen
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
              style={{ borderRadius: 12 }}
            />
          )}
        </div>
      )}
    </div>
  );
}
