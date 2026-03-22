import { useState, useEffect, useRef } from "react";
import "./App.css";

const DIAMOND_REGIONS = [
  { name: "Midwest", className: "region-slot region-slot--midwest" },
  { name: "West", className: "region-slot region-slot--west" },
  { name: "East", className: "region-slot region-slot--east" },
  { name: "South", className: "region-slot region-slot--south" },
];

/**
 * Default `locations.name` per region — same strings as DB / seed FILE_TO_LOCATION_NAME
 * (see .cursor/skills/seed-database/scripts/seed.js)
 */
const DEFAULT_LOCATION_NAME_BY_REGION = {
  West: "LA",
  East: "NY",
  Midwest: "Chicago",
  South: "ATL",
};

const REGION_PICKER_ORDER = ["West", "Midwest", "South", "East"];

function regionIdByName(regions, targetName) {
  const t = targetName.toLowerCase();
  const r = regions.find((x) => String(x.name).toLowerCase() === t);
  return r ? String(r.id) : "";
}

function sortRegionsForPicker(regions) {
  return [...regions].sort((a, b) => {
    const ia = REGION_PICKER_ORDER.indexOf(a.name);
    const ib = REGION_PICKER_ORDER.indexOf(b.name);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

function defaultLocationId(locations, regionName) {
  const code = DEFAULT_LOCATION_NAME_BY_REGION[regionName];
  const withPlaylist = locations.filter((l) => l.playlist_id);
  if (!withPlaylist.length) return "";
  if (!code) return String(withPlaylist[0].id);
  const found = withPlaylist.find((l) => l.name === code);
  if (found) return String(found.id);
  return String(withPlaylist[0].id);
}

function App() {
  const [regions, setRegions] = useState([]);
  const [locations, setLocations] = useState([]);
  const [selectedRegion, setSelectedRegion] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("");
  const [playlistId, setPlaylistId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [embedMode, setEmbedMode] = useState("iframe");
  const [tunerMounted, setTunerMounted] = useState(true);
  const [tunerFadeOut, setTunerFadeOut] = useState(false);
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

    setLocations([]);
    setSelectedLocation("");
    setPlaylistId(null);

    fetch(`/api/locations?region_id=${selectedRegion}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setLocations(data);
        const rname = regions.find((x) => String(x.id) === selectedRegion)?.name ?? "";
        const locId = defaultLocationId(data, rname);
        setSelectedLocation(locId);
      })
      .catch((e) => setError(e.message));
  }, [selectedRegion, regions]);

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
          width: '100%',
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

  useEffect(() => {
    if (!selectedRegion) {
      setTunerMounted(true);
      setTunerFadeOut(false);
      return;
    }
    setTunerFadeOut(true);
  }, [selectedRegion]);

  useEffect(() => {
    if (!tunerFadeOut || !tunerMounted) return;
    const id = window.setTimeout(() => setTunerMounted(false), 500);
    return () => window.clearTimeout(id);
  }, [tunerFadeOut, tunerMounted]);

  const regionPickerRegions = sortRegionsForPicker(regions);
  const showEmbed = Boolean(playlistId);
  const showRegionSwitcher = Boolean(selectedRegion);

  if (loading) {
    return (
      <div className="radio-app">
        <div className="radio-shell radio-shell--loading">Loading regions…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="radio-app">
        <div className="radio-shell radio-shell--error">{error}</div>
      </div>
    );
  }

  return (
    <div className="radio-app">
      <div className="radio-shell radio-shell--main">
        <header className="radio-header">
          <div className="radio-brand-stack">
            <div className="radio-brand-line radio-brand-line--top" aria-hidden="true">
              {"WAUX".split("").map((ch, i) => (
                <span key={`waux-${i}`} className="radio-brand-glyph">
                  {ch}
                </span>
              ))}
            </div>
            <img className="radio-logo" src="/logo.jpg" alt="WAUX 91.7FM" />
            <div className="radio-brand-line radio-brand-line--bottom" aria-hidden="true">
              {"91.7FM".split("").map((ch, i) => (
                <span
                  key={`fm-${i}`}
                  className={`radio-brand-glyph${ch === "." ? " radio-brand-glyph--dot" : ""}`}
                >
                  {ch}
                </span>
              ))}
            </div>
          </div>
        </header>

        <div className="radio-body">
          {tunerMounted && (
            <section
              className={`radio-tuner${tunerFadeOut ? " radio-tuner--faded" : ""}`}
              aria-label="Region"
              aria-hidden={tunerFadeOut}
              onTransitionEnd={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.propertyName !== "opacity") return;
                if (selectedRegion) setTunerMounted(false);
              }}
            >
              <div className="region-diamond">
                {DIAMOND_REGIONS.map(({ name, className }) => {
                  const id = regionIdByName(regions, name);
                  const selected = selectedRegion === id;
                  return (
                    <div key={name} className={className}>
                      <span className="region-label">{name.toUpperCase()}</span>
                      <div className="tuner-well">
                        <button
                          type="button"
                          className={`tuner-btn${selected ? " tuner-btn--active" : ""}`}
                          aria-pressed={selected}
                          aria-label={`${name} region`}
                          title={`Tune to ${name}`}
                          onClick={() => id && setSelectedRegion(id)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {showEmbed && (
            <div className="embed-wrap">
              <div
                ref={controllerHostRef}
                className="embed-controller-host"
                style={{ display: embedMode === "controller" ? "block" : "none" }}
              />
              {embedMode === "iframe" && (
                <iframe
                  title="Spotify playlist"
                  src={`https://open.spotify.com/embed/playlist/${playlistId}?autoplay=true`}
                  width="100%"
                  height="380"
                  allowFullScreen
                  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                  loading="lazy"
                  className="embed-iframe"
                />
              )}
            </div>
          )}
        </div>

        {showRegionSwitcher && (
          <div className="region-switcher">
            <label htmlFor="region-switch" className="region-switcher-label">
              Region
            </label>
            <select
              id="region-switch"
              className="region-switcher-select"
              value={selectedRegion}
              onChange={(e) => setSelectedRegion(e.target.value)}
            >
              {regionPickerRegions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
