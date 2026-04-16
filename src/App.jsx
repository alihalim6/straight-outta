import { useState, useEffect, useLayoutEffect, useRef, useMemo, Fragment } from "react";
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

const REGION_SWITCHER_ABBR = {
  West: "W",
  Midwest: "MW",
  South: "S",
  East: "E",
};
const TUNER_ALIGNMENT_THRESHOLD = 0.045;
const STATION_LABEL_EDGE_INSET = 0.03;
/** Lower = slower, smoother slide toward 0/1 while a paddle is held. */
const TUNER_HOLD_APPROACH_PER_S = 2.5;
const TUNER_KEYBOARD_NUDGE = 0.012;

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

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function stationPositions(count) {
  if (count <= 1) return [0.5];
  return Array.from({ length: count }, (_, i) => i / (count - 1));
}

function nearestStationIndex(position, points) {
  return points.reduce((best, point, index) => {
    const distance = Math.abs(point - position);
    if (distance < best.distance) return { index, distance };
    return best;
  }, { index: 0, distance: Number.POSITIVE_INFINITY });
}

function stationLabel(name) {
  return String(name || "")
    .toUpperCase()
    .replace(/\s+/g, "");
}

function stationLabelStyle(point) {
  const clampedPoint = clamp01(point);
  if (clampedPoint <= 0) {
    return { left: `${STATION_LABEL_EDGE_INSET * 100}%`, transform: "translate(0, -50%)" };
  }
  if (clampedPoint >= 1) {
    return { left: `${(1 - STATION_LABEL_EDGE_INSET) * 100}%`, transform: "translate(-100%, -50%)" };
  }
  return { left: `${clampedPoint * 100}%`, transform: "translate(-50%, -50%)" };
}

/** Horizontal spans between adjacent station positions (for triple-line dial marks). */
function dialGapsFromTuning(tuningPoints) {
  if (tuningPoints.length < 2) return [];
  const out = [];
  for (let i = 0; i < tuningPoints.length - 1; i += 1) {
    out.push({
      left: tuningPoints[i],
      width: tuningPoints[i + 1] - tuningPoints[i],
    });
  }
  return out;
}

function App() {
  const [regions, setRegions] = useState([]);
  const [locations, setLocations] = useState([]);
  const [selectedRegion, setSelectedRegion] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("");
  const [activePlaylistId, setActivePlaylistId] = useState(null);
  const [embedSettling, setEmbedSettling] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [embedMode, setEmbedMode] = useState("iframe");
  const [tunerMounted, setTunerMounted] = useState(true);
  const [tunerFadeOut, setTunerFadeOut] = useState(false);
  const [tunerPosition, setTunerPosition] = useState(0.5);
  const apiRef = useRef(null);
  const controllerRef = useRef(null);
  const controllerHostRef = useRef(null);
  const tunerPressedRef = useRef(null);
  const tunerRafRef = useRef(null);
  const tunerRafTimeRef = useRef(0);
  const shouldPauseEmbedRef = useRef(false);
  const regionsRef = useRef(regions);
  regionsRef.current = regions;
  const selectedRegionRef = useRef(selectedRegion);
  selectedRegionRef.current = selectedRegion;

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
      setActivePlaylistId(null);
      return;
    }

    const ac = new AbortController();
    const regionId = selectedRegion;

    fetch(`/api/locations?region_id=${regionId}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        if (String(selectedRegionRef.current) !== regionId) return;
        setLocations(data);
        const rname =
          regionsRef.current.find((x) => String(x.id) === regionId)?.name ?? "";
        const locId = defaultLocationId(data, rname);
        setSelectedLocation(locId);
        const locationIndex = data
          .filter((l) => l.playlist_id)
          .findIndex((l) => String(l.id) === locId);
        if (locationIndex >= 0) {
          const points = stationPositions(data.filter((l) => l.playlist_id).length);
          setTunerPosition(points[locationIndex] ?? 0.5);
        } else {
          setTunerPosition(0.5);
        }
      })
      .catch((e) => {
        if (e.name === "AbortError") return;
        setError(e.message);
      });

    return () => ac.abort();
  }, [selectedRegion]);

  useEffect(() => {
    if (!selectedLocation) {
      return;
    }
    const loc = locations.find((l) => String(l.id) === selectedLocation);
    if (loc?.playlist_id) {
      setActivePlaylistId(loc.playlist_id);
    }
  }, [selectedLocation, locations]);

  useEffect(() => {
    if (!activePlaylistId) {
      setEmbedSettling(false);
      return;
    }
    setEmbedSettling(true);
  }, [activePlaylistId]);

  useEffect(() => {
    if (!embedSettling) return;
    const id = window.setTimeout(() => setEmbedSettling(false), 4500);
    return () => window.clearTimeout(id);
  }, [activePlaylistId, embedSettling]);

  const playableLocations = useMemo(
    () => locations.filter((l) => l.playlist_id),
    [locations]
  );
  const tuningPoints = useMemo(
    () => stationPositions(playableLocations.length),
    [playableLocations.length]
  );
  const dialGaps = useMemo(() => dialGapsFromTuning(tuningPoints), [tuningPoints]);
  const nearest = nearestStationIndex(tunerPosition, tuningPoints);
  const nearestLocation = playableLocations[nearest.index] ?? null;
  const alignmentThreshold = playableLocations.length <= 1 ? 1 : TUNER_ALIGNMENT_THRESHOLD;
  const isAligned = nearest.distance <= alignmentThreshold;
  const betweenStations = Boolean(activePlaylistId && selectedRegion && playableLocations.length && !isAligned);

  const regionPickerRegions = sortRegionsForPicker(regions);
  const postDiamondReveal = !selectedRegion || !tunerMounted;
  const showEmbed = Boolean(activePlaylistId && postDiamondReveal);
  const showRegionSwitcher = Boolean(selectedRegion && postDiamondReveal);
  const showLocationTuner = Boolean(
    selectedRegion && playableLocations.length && postDiamondReveal
  );

  useEffect(() => {
    if (
      !activePlaylistId ||
      !showEmbed ||
      !controllerHostRef.current ||
      !apiRef.current
    ) {
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
          uri: `spotify:playlist:${activePlaylistId}`,
          width: '100%',
          height: 380,
        },
        (controller) => {
          controllerRef.current = controller;
          controller.addListener("ready", () => {
            setEmbedSettling(false);
            if (shouldPauseEmbedRef.current) {
              controller.pause?.();
            } else {
              controller.play();
            }
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
  }, [activePlaylistId, showEmbed]);

  useEffect(() => {
    if (!isAligned || !nearestLocation) return;
    const alignedId = String(nearestLocation.id);
    if (alignedId !== selectedLocation) {
      setSelectedLocation(alignedId);
    }
  }, [isAligned, nearestLocation, selectedLocation]);

  useEffect(() => {
    shouldPauseEmbedRef.current = betweenStations;
    const controller = controllerRef.current;
    if (!controller) return;
    try {
      if (betweenStations) {
        controller.pause?.();
      } else {
        controller.play?.();
      }
    } catch {
      /* ignore unsupported controller methods */
    }
  }, [betweenStations]);

  const stopTunerRaf = () => {
    if (tunerRafRef.current != null) {
      cancelAnimationFrame(tunerRafRef.current);
      tunerRafRef.current = null;
    }
    tunerRafTimeRef.current = 0;
  };

  useEffect(() => () => stopTunerRaf(), []);

  const beginTunerRaf = () => {
    if (tunerRafRef.current != null) return;
    const step = (time) => {
      const pressed = tunerPressedRef.current;
      if (!pressed) {
        stopTunerRaf();
        return;
      }
      const prev = tunerRafTimeRef.current;
      tunerRafTimeRef.current = time;
      const dt =
        prev === 0 ? 1 / 60 : Math.min(0.032, (time - prev) / 1000);
      const target = pressed === "left" ? 0 : 1;
      const k = 1 - Math.exp(-TUNER_HOLD_APPROACH_PER_S * dt);
      setTunerPosition((p) => clamp01(p + (target - p) * k));
      tunerRafRef.current = requestAnimationFrame(step);
    };
    tunerRafRef.current = requestAnimationFrame(step);
  };

  function handleTunerHalfDown(side, e) {
    if (e.button === 2) return;
    e.preventDefault();
    tunerPressedRef.current = side;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    beginTunerRaf();
  }

  function handleTunerHalfEnd(e) {
    tunerPressedRef.current = null;
    stopTunerRaf();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (tunerRafRef.current != null) {
      cancelAnimationFrame(tunerRafRef.current);
      tunerRafRef.current = null;
    }
    tunerRafTimeRef.current = 0;
    tunerPressedRef.current = null;
  }, [selectedRegion, showLocationTuner]);

  useLayoutEffect(() => {
    if (!selectedRegion) {
      setTunerMounted(true);
      setTunerFadeOut(false);
      return;
    }
    if (tunerMounted) {
      setTunerFadeOut(true);
    }
  }, [selectedRegion, tunerMounted]);

  useEffect(() => {
    if (!tunerFadeOut || !tunerMounted) return;
    const id = window.setTimeout(() => setTunerMounted(false), 500);
    return () => window.clearTimeout(id);
  }, [tunerFadeOut, tunerMounted]);

  const stationEntries = playableLocations.map((location, index) => ({ location, index }));
  const topStationEntries = stationEntries.filter((_, index) => index % 2 === 0);
  const bottomStationEntries = stationEntries.filter((_, index) => index % 2 === 1);

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
            <div className={`embed-wrap${betweenStations ? " embed-wrap--paused" : ""}`}>
              <div className={`embed-media${embedSettling ? " embed-media--settling" : ""}`}>
                <div
                  ref={controllerHostRef}
                  className="embed-controller-host"
                  style={{ display: embedMode === "controller" ? "block" : "none" }}
                />
                {embedMode === "iframe" && (
                  <iframe
                    title="Spotify playlist"
                    src={`https://open.spotify.com/embed/playlist/${activePlaylistId}?autoplay=true`}
                    width="100%"
                    height="380"
                    allowFullScreen
                    allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                    loading="lazy"
                    className="embed-iframe"
                    onLoad={() => setEmbedSettling(false)}
                  />
                )}
              </div>
              {betweenStations && (
                <div
                  className="embed-pixelate-overlay"
                  aria-hidden="true"
                />
              )}
            </div>
          )}

          {showLocationTuner && (
            <section className="location-tuner" aria-label="Location tuner">
              <div
                className="station-window"
                role="presentation"
                style={{ "--tuner-position": tunerPosition }}
              >
                <div className="station-window-bar station-window-bar--top">
                  <div className="station-window-dial-marks" aria-hidden="true">
                    {dialGaps.map((gap, i) => (
                      <div
                        key={`dial-top-${i}`}
                        className="station-window-dial-gap"
                        style={{
                          left: `${gap.left * 100}%`,
                          width: `${gap.width * 100}%`,
                        }}
                      >
                        <span className="station-window-dial-line" />
                        <span className="station-window-dial-line" />
                        <span className="station-window-dial-line" />
                      </div>
                    ))}
                  </div>
                  <div className="station-window-track">
                    {topStationEntries.map(({ location, index }) => {
                      const point = tuningPoints[index] ?? 0;
                      return (
                        <div
                          key={location.id}
                          className={`station-bar-label${String(location.id) === selectedLocation ? " station-bar-label--active" : ""}`}
                          style={stationLabelStyle(point)}
                        >
                          {stationLabel(location.name)}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="station-window-gap">
                  <div className="station-marker" aria-hidden="true" />
                </div>
                <div className="station-window-bar station-window-bar--bottom">
                  <div className="station-window-dial-marks" aria-hidden="true">
                    {dialGaps.map((gap, i) => (
                      <div
                        key={`dial-bottom-${i}`}
                        className="station-window-dial-gap"
                        style={{
                          left: `${gap.left * 100}%`,
                          width: `${gap.width * 100}%`,
                        }}
                      >
                        <span className="station-window-dial-line" />
                        <span className="station-window-dial-line" />
                        <span className="station-window-dial-line" />
                      </div>
                    ))}
                  </div>
                  <div className="station-window-track">
                    {bottomStationEntries.map(({ location, index }) => {
                      const point = tuningPoints[index] ?? 0;
                      return (
                        <div
                          key={location.id}
                          className={`station-bar-label${String(location.id) === selectedLocation ? " station-bar-label--active" : ""}`}
                          style={stationLabelStyle(point)}
                        >
                          {stationLabel(location.name)}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div
                className="light-switch"
                role="group"
                tabIndex={0}
                aria-valuemin={0}
                aria-valuemax={1000}
                aria-valuenow={Math.round(tunerPosition * 1000)}
                aria-label="Tune location"
                aria-valuetext={
                  nearestLocation?.name
                    ? `${nearestLocation.name}${isAligned ? "" : " (between stations)"}`
                    : undefined
                }
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                    e.preventDefault();
                    const delta =
                      e.key === "ArrowLeft" ? -TUNER_KEYBOARD_NUDGE : TUNER_KEYBOARD_NUDGE;
                    setTunerPosition((p) => clamp01(p + delta));
                  } else if (e.key === "Home") {
                    e.preventDefault();
                    setTunerPosition(0);
                  } else if (e.key === "End") {
                    e.preventDefault();
                    setTunerPosition(1);
                  }
                }}
              >
                <span className="light-switch__paddle">
                  <button
                    type="button"
                    className="light-switch__half light-switch__half--left"
                    aria-label="Tune toward previous stations, press and hold"
                    tabIndex={-1}
                    onPointerDown={(e) => handleTunerHalfDown("left", e)}
                    onPointerUp={handleTunerHalfEnd}
                    onPointerCancel={handleTunerHalfEnd}
                  >
                    <span className="light-switch__screw light-switch__screw--edge-tl" aria-hidden="true" />
                    <span className="light-switch__screw light-switch__screw--edge-bl" aria-hidden="true" />
                  </button>
                </span>
                <div className="light-switch__gap" aria-hidden="true" />
                <span className="light-switch__paddle">
                  <button
                    type="button"
                    className="light-switch__half light-switch__half--right"
                    aria-label="Tune toward next stations, press and hold"
                    tabIndex={-1}
                    onPointerDown={(e) => handleTunerHalfDown("right", e)}
                    onPointerUp={handleTunerHalfEnd}
                    onPointerCancel={handleTunerHalfEnd}
                  >
                    <span className="light-switch__screw light-switch__screw--edge-tr" aria-hidden="true" />
                    <span className="light-switch__screw light-switch__screw--edge-br" aria-hidden="true" />
                  </button>
                </span>
              </div>
            </section>
          )}

          {showRegionSwitcher && (
            <div
              className="region-switcher"
              role="radiogroup"
              aria-label="Region"
            >
              <div className="region-switcher-labels-row" aria-hidden="true">
                {regionPickerRegions.map((r, i) => (
                  <Fragment key={`abbr-${r.id}`}>
                    {i > 0 && (
                      <span className="region-switcher-connector-spacer" />
                    )}
                    <span className="region-switcher-abbr">
                      {REGION_SWITCHER_ABBR[r.name] ?? r.name}
                    </span>
                  </Fragment>
                ))}
              </div>
              <div className="region-switcher-knob-row">
                {regionPickerRegions.map((r, i) => (
                  <Fragment key={r.id}>
                    {i > 0 && (
                      <span className="region-switcher-connector" aria-hidden="true" />
                    )}
                    <div
                      className={`tuner-well tuner-well--switcher${
                        selectedRegion === String(r.id)
                          ? " tuner-well--region-active"
                          : ""
                      }`}
                    >
                      <button
                        type="button"
                        className="tuner-btn tuner-btn--switcher"
                        role="radio"
                        aria-checked={selectedRegion === String(r.id)}
                        aria-label={`${r.name} region`}
                        title={r.name}
                        onClick={() => setSelectedRegion(String(r.id))}
                      />
                    </div>
                  </Fragment>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
