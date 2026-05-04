import { useState, useEffect, useLayoutEffect, useRef, useMemo, Fragment } from "react";
import "./App.css";
import { ensureValidAccessToken, redirectToSpotifyLogin } from "./lib/spotifyAuth";

/** Endpoint that invokes the playlist refresher; dev proxies /api/refresh → server/api.js. */
const REFRESH_API_URL = import.meta.env.VITE_API_URL || "/api/refresh";
/** How long the user must hold RESET before we fire the region refresh. */
const RESET_HOLD_MS = 3000;

/** Builds refresh URL with region_id query (handles absolute URLs and existing ?params). */
function buildRefreshRequestUrl(regionIdStr) {
  const base = REFRESH_API_URL || "/api/refresh";
  try {
    const resolved =
      base.startsWith("http://") || base.startsWith("https://")
        ? new URL(base)
        : new URL(base, window.location.origin);
    resolved.searchParams.set("region_id", regionIdStr);
    return resolved.toString();
  } catch {
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}region_id=${encodeURIComponent(regionIdStr)}`;
  }
}

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
const TUNER_HOLD_APPROACH_PER_S = 1.2;
/** Snap to exact 0/1 while holding when this close (exponential easing never fully arrives). */
const TUNER_HOLD_SNAP_EPS = 0.0035;
/** Floor on closing speed (full-span units per second) so the dial doesn't crawl at the end. */
const TUNER_HOLD_MIN_CLOSE_PER_S = 0.58;
const TUNER_KEYBOARD_NUDGE = 0.008;
const STATIC_AUDIO_SRC = "/static.m4a";
const STATIC_AUDIO_VOLUME = 0.36;

const LOADING_TRACE_TASKS = [
  "hydrate playlist cache",
  "sync station graph",
  "diff region manifests",
  "normalize artist seeds",
  "prime embed handoff",
  "verify playback grants",
  "warm edge transport",
  "merge station snapshots",
];

const LOADING_TRACE_SYMBOLS = [
  "refreshRegion()",
  "resolvePlaylist()",
  "hydrateLocations()",
  "embedHandshake()",
  "runAuthReplay()",
  "queueTunerFrame()",
];

function loadingTimestamp() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function buildLoadingTraceLine(seq) {
  const task = LOADING_TRACE_TASKS[seq % LOADING_TRACE_TASKS.length];
  const symbol = LOADING_TRACE_SYMBOLS[seq % LOADING_TRACE_SYMBOLS.length];
  const latency = 20 + ((seq * 37) % 180);
  const depth = 140 + (seq % 30);
  const column = 8 + ((seq * 3) % 44);
  const level = seq % 9 === 0 ? "WARN" : "INFO";
  const mode = seq % 4;
  const stamp = loadingTimestamp();

  if (mode === 0) {
    return `${stamp} [${level}] ${task} :: ${latency}ms`;
  }
  if (mode === 1) {
    return `${stamp} stack> at ${symbol} (App.jsx:${depth}:${column})`;
  }
  if (mode === 2) {
    return `${stamp} fetch /api/refresh?phase=bootstrap -> 200 (${latency}ms)`;
  }
  return `${stamp} trace#${String(seq).padStart(4, "0")} ${task} [ok]`;
}

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

function RadioBrandHeader() {
  const MAX_TILT_DEG = 20;
  const [tiltActive, setTiltActive] = useState(false);
  const tiltShellRef = useRef(null);
  const tiltRafRef = useRef(null);
  const pointerPointRef = useRef({ x: 0, y: 0 });

  const applyLogoTilt = () => {
    tiltRafRef.current = null;
    const shell = tiltShellRef.current;
    if (!shell) return;
    const rect = shell.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const px = (pointerPointRef.current.x - rect.left) / rect.width;
    const py = (pointerPointRef.current.y - rect.top) / rect.height;
    const clampedX = clamp01(px);
    const clampedY = clamp01(py);
    shell.style.setProperty("--logo-tilt-x", `${((0.5 - clampedY) * (MAX_TILT_DEG * 2)).toFixed(2)}deg`);
    shell.style.setProperty("--logo-tilt-y", `${((clampedX - 0.5) * (MAX_TILT_DEG * 2)).toFixed(2)}deg`);
    shell.style.setProperty("--logo-glare-x", `${(clampedX * 100).toFixed(2)}%`);
    shell.style.setProperty("--logo-glare-y", `${(clampedY * 100).toFixed(2)}%`);
  };

  const queueLogoTiltUpdate = (clientX, clientY) => {
    pointerPointRef.current = { x: clientX, y: clientY };
    if (tiltRafRef.current != null) return;
    tiltRafRef.current = requestAnimationFrame(applyLogoTilt);
  };

  function handleLogoPointerMove(e) {
    queueLogoTiltUpdate(e.clientX, e.clientY);
  }

  function resetLogoTilt() {
    setTiltActive(false);
    if (tiltRafRef.current != null) {
      cancelAnimationFrame(tiltRafRef.current);
      tiltRafRef.current = null;
    }
    const shell = tiltShellRef.current;
    if (!shell) return;
    shell.style.setProperty("--logo-tilt-x", "0deg");
    shell.style.setProperty("--logo-tilt-y", "0deg");
    shell.style.setProperty("--logo-glare-x", "50%");
    shell.style.setProperty("--logo-glare-y", "42%");
  }

  useEffect(() => {
    if (!tiltActive) return;
    function handleWindowPointerMove(e) {
      queueLogoTiltUpdate(e.clientX, e.clientY);
    }
    window.addEventListener("pointermove", handleWindowPointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", handleWindowPointerMove);
  }, [tiltActive]);

  useEffect(() => () => {
    if (tiltRafRef.current != null) {
      cancelAnimationFrame(tiltRafRef.current);
    }
  }, []);

  return (
    <header className="radio-header">
      <div
        ref={tiltShellRef}
        className={`radio-brand-tilt-shell${tiltActive ? " radio-brand-tilt-shell--active" : ""}`}
        onPointerEnter={(e) => {
          setTiltActive(true);
          handleLogoPointerMove(e);
        }}
        onPointerMove={handleLogoPointerMove}
        onPointerLeave={resetLogoTilt}
        onPointerCancel={resetLogoTilt}
      >
        <div className="radio-brand-stack">
          <div className="radio-brand-line radio-brand-line--top" aria-hidden="true">
            {"WAUX".split("").map((ch, i) => (
              <span key={`waux-${i}`} className="radio-brand-glyph">
                {ch}
              </span>
            ))}
          </div>
          <div className="radio-logo-shell">
            <img className="radio-logo" src="/logo.jpg" alt="WAUX 91.7FM" />
          </div>
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
      </div>
    </header>
  );
}

function EmbedLoadingConsole({ headline = "Booting broadcast systems...", exiting = false }) {
  const visibleLineCount = 16;
  const lineHeightPx = 18;
  const [lines, setLines] = useState(() =>
    Array.from({ length: visibleLineCount + 4 }, (_, idx) => ({
      id: idx,
      text: buildLoadingTraceLine(idx),
    }))
  );

  useEffect(() => {
    let seq = visibleLineCount + 4;
    const timer = window.setInterval(() => {
      setLines((prev) => {
        const next = [...prev, { id: seq, text: buildLoadingTraceLine(seq) }];
        seq += 1;
        return next.slice(-64);
      });
    }, 85);
    return () => window.clearInterval(timer);
  }, []);

  const hiddenRows = Math.max(0, lines.length - visibleLineCount);

  return (
    <div
      className={`embed-loading-shell${exiting ? " embed-loading-shell--exiting" : ""}`}
      role="status"
      aria-live="polite"
      aria-label={headline}
    >
      <div className="embed-loading-header">{headline}</div>
      <div className="embed-loading-viewport" aria-hidden="true">
        <div
          className="embed-loading-track"
          style={{ transform: `translateY(-${hiddenRows * lineHeightPx}px)` }}
        >
          {lines.map((line) => (
            <div
              key={line.id}
              className={`embed-loading-line${line.text.includes("[WARN]") ? " embed-loading-line--warn" : ""}`}
            >
              {line.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [authPhase, setAuthPhase] = useState("pending");
  const [loginGateError, setLoginGateError] = useState("");
  const [regions, setRegions] = useState([]);
  const [locations, setLocations] = useState([]);
  const [selectedRegion, setSelectedRegion] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("");
  const [activePlaylistId, setActivePlaylistId] = useState(null);
  const [embedSettling, setEmbedSettling] = useState(false);
  const [loading, setLoading] = useState(false);
  const [authPendingExit, setAuthPendingExit] = useState(false);
  const [loadingExit, setLoadingExit] = useState(false);
  const [error, setError] = useState("");
  /** `controller` uses Iframe API play() for reliable autoplay; `iframe` is cache-busted fallback. */
  const [embedMode, setEmbedMode] = useState("iframe");
  /** Bumped when iframe-api/v1 loads so createController runs (apiRef alone does not re-render). */
  const [spotifyIframeApiGeneration, setSpotifyIframeApiGeneration] = useState(() =>
    typeof window !== "undefined" && window.__SpotifyIframeAPI ? 1 : 0
  );
  const [tunerMounted, setTunerMounted] = useState(true);
  const [tunerFadeOut, setTunerFadeOut] = useState(false);
  const [tunerPosition, setTunerPosition] = useState(0.5);
  const [resetCountdown, setResetCountdown] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [resettingRegionId, setResettingRegionId] = useState(null);
  const [resetMessage, setResetMessage] = useState("");
  /** Bumped after a successful region refresh to force the embed to reload fresh tracks. */
  const [playlistRefreshNonce, setPlaylistRefreshNonce] = useState(0);
  const resetTickRef = useRef(null);
  const resetTriggerRef = useRef(null);
  const resetMessageTimerRef = useRef(null);
  const apiRef = useRef(null);
  const controllerRef = useRef(null);
  const controllerHostRef = useRef(null);
  const staticAudioRef = useRef(null);
  const shouldPauseEmbedRef = useRef(false);
  const tunerPressedRef = useRef(null);
  const tunerRafRef = useRef(null);
  const tunerRafTimeRef = useRef(0);
  const regionsRef = useRef(regions);
  regionsRef.current = regions;
  const selectedRegionRef = useRef(selectedRegion);
  selectedRegionRef.current = selectedRegion;

  useEffect(() => {
    let cancelled = false;
    ensureValidAccessToken().then((token) => {
      if (cancelled) return;
      if (token) {
        setLoading(true);
        setAuthPhase("ok");
      } else {
        setAuthPhase("anon");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authPhase !== "ok") return;
    const id = window.setInterval(() => {
      ensureValidAccessToken().then((token) => {
        if (!token) setAuthPhase("anon");
      });
    }, 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [authPhase]);

  useEffect(() => {
    if (authPhase === "pending") {
      setAuthPendingExit(false);
      return;
    }
    setAuthPendingExit(true);
    const id = window.setTimeout(() => setAuthPendingExit(false), 220);
    return () => window.clearTimeout(id);
  }, [authPhase]);

  useEffect(() => {
    if (loading) {
      setLoadingExit(false);
      return;
    }
    if (authPhase !== "ok") return;
    setLoadingExit(true);
    const id = window.setTimeout(() => setLoadingExit(false), 220);
    return () => window.clearTimeout(id);
  }, [loading, authPhase]);

  useEffect(() => {
    if (authPhase !== "ok") return;
    function onVisibility() {
      if (document.visibilityState !== "visible") return;
      ensureValidAccessToken().then((token) => {
        if (!token) setAuthPhase("anon");
      });
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [authPhase]);

  useEffect(() => {
    if (window.__SpotifyIframeAPI) {
      apiRef.current = window.__SpotifyIframeAPI;
      setSpotifyIframeApiGeneration((n) => (n ? n : 1));
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
      setSpotifyIframeApiGeneration((n) => n + 1);
      if (typeof previousHandler === "function") {
        previousHandler(IFrameAPI);
      }
    };
  }, []);

  useEffect(() => {
    if (authPhase !== "ok") return;

    fetch("/api/regions")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setRegions(data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [authPhase]);

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
  }, [activePlaylistId, playlistRefreshNonce]);

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
  const shouldPlayStatic =
    authPhase === "pending" ||
    authPendingExit ||
    loading ||
    loadingExit ||
    embedSettling ||
    betweenStations;

  useEffect(() => {
    const audio = staticAudioRef.current;
    if (!audio) return;
    if (shouldPlayStatic) {
      audio.play().catch(() => {
        // Ignore autoplay restrictions until the user interacts.
      });
      return;
    }
    audio.pause();
    audio.currentTime = 0;
  }, [shouldPlayStatic]);

  const regionPickerRegions = sortRegionsForPicker(regions);
  const postDiamondReveal = !selectedRegion || !tunerMounted;
  const showEmbed = Boolean(activePlaylistId && postDiamondReveal);
  const showRegionSwitcher = Boolean(selectedRegion && postDiamondReveal);
  const showLocationTuner = Boolean(selectedRegion && postDiamondReveal);

  /** New timestamp whenever playlist or refresh nonce changes — busts Spotify embed CDN cache (same playlist id after replace_playlist_items). */
  const embedCacheBust = useMemo(
    () => Date.now(),
    [activePlaylistId, playlistRefreshNonce]
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
          width: "100%",
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
  }, [activePlaylistId, showEmbed, playlistRefreshNonce, spotifyIframeApiGeneration]);

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
      const minStep = TUNER_HOLD_MIN_CLOSE_PER_S * dt;
      setTunerPosition((p) => {
        const dist = Math.abs(target - p);
        if (dist <= TUNER_HOLD_SNAP_EPS) return target;
        let delta = (target - p) * k;
        if (Math.abs(delta) < minStep) {
          const toward = target > p ? 1 : -1;
          delta = toward * Math.min(dist, minStep);
        }
        return clamp01(p + delta);
      });
      tunerRafRef.current = requestAnimationFrame(step);
    };
    tunerRafRef.current = requestAnimationFrame(step);
  };

  function clearResetHoldTimers() {
    if (resetTickRef.current != null) {
      window.clearInterval(resetTickRef.current);
      resetTickRef.current = null;
    }
    if (resetTriggerRef.current != null) {
      window.clearTimeout(resetTriggerRef.current);
      resetTriggerRef.current = null;
    }
  }

  useEffect(() => () => {
    clearResetHoldTimers();
    if (resetMessageTimerRef.current != null) {
      window.clearTimeout(resetMessageTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const audio = new Audio(STATIC_AUDIO_SRC);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = STATIC_AUDIO_VOLUME;
    staticAudioRef.current = audio;
    return () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      staticAudioRef.current = null;
    };
  }, []);

  // Cancel any in-flight hold/countdown if user changes region.
  useEffect(() => {
    clearResetHoldTimers();
    setResetCountdown(null);
  }, [selectedRegion]);

  /**
   * Refetch /api/locations for the current region without resetting selectedLocation
   * or tunerPosition (so the user keeps their tuned station).
   */
  async function reloadLocationsForCurrentRegion() {
    const regionId = selectedRegionRef.current;
    if (!regionId) return;
    try {
      const res = await fetch(`/api/locations?region_id=${regionId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data?.error) return;
      if (String(selectedRegionRef.current) !== regionId) return;
      setLocations(data);
    } catch {
      /* ignore — embed reload below still forces fresh tracks for existing playlists */
    }
  }

  async function fireRegionRefresh(regionId) {
    const regionIdStr = String(regionId);
    setResetting(true);
    setResettingRegionId(regionIdStr);
    setResetMessage("");
    try {
      const token = await ensureValidAccessToken();
      if (!token) {
        setAuthPhase("anon");
        setResetMessage("Log in with Spotify to refresh.");
        return;
      }
      const url = buildRefreshRequestUrl(regionIdStr);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ region_id: Number(regionIdStr) }),
      });
      const text = await res.text();
      if (!res.ok) {
        setResetMessage(`Refresh failed (${res.status}): ${text || res.statusText}`);
        return;
      }
      setResetMessage("Region playlists refreshed.");
      // If the user is still on the region we just refreshed, pick up any new
      // playlist_ids and force the embed to reload (replace_playlist_items keeps
      // the same playlist id, so a plain re-render would otherwise show stale tracks).
      if (selectedRegionRef.current === regionIdStr) {
        await reloadLocationsForCurrentRegion();
        setPlaylistRefreshNonce((n) => n + 1);
      }
    } catch (e) {
      setResetMessage(`Refresh failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setResetting(false);
      setResettingRegionId(null);
      if (resetMessageTimerRef.current != null) {
        window.clearTimeout(resetMessageTimerRef.current);
      }
      resetMessageTimerRef.current = window.setTimeout(() => {
        setResetMessage("");
        resetMessageTimerRef.current = null;
      }, 4000);
    }
  }

  function handleResetDown(e) {
    if (e.button === 2) return;
    if (!selectedRegion || resetting || resetCountdown !== null) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    setResetMessage("");
    setResetCountdown(3);
    resetTickRef.current = window.setInterval(() => {
      setResetCountdown((c) => (c != null && c > 1 ? c - 1 : c));
    }, 1000);
    const regionId = selectedRegion;
    resetTriggerRef.current = window.setTimeout(() => {
      clearResetHoldTimers();
      setResetCountdown(null);
      fireRegionRefresh(regionId);
    }, RESET_HOLD_MS);
  }

  function handleResetCancel(e) {
    if (resetting) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (resetCountdown == null && resetTickRef.current == null) return;
    clearResetHoldTimers();
    setResetCountdown(null);
  }

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

  if (authPhase === "pending" || authPendingExit) {
    return (
      <div className="radio-app">
        <div className="radio-shell radio-shell--main">
          <RadioBrandHeader />
          <div className="radio-body">
            <div className="radio-shell radio-shell--loading" aria-busy="true">
              <EmbedLoadingConsole
                headline="Handshaking with Spotify..."
                exiting={authPhase !== "pending"}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (authPhase === "anon") {
    return (
      <div className="radio-app">
        <div className="radio-shell radio-shell--main">
          <RadioBrandHeader />
          <div className="radio-auth-gate">
            <button
              type="button"
              className="radio-auth-cta"
              onClick={() => {
                setLoginGateError("");
                redirectToSpotifyLogin().catch((e) =>
                  setLoginGateError(e instanceof Error ? e.message : String(e))
                );
              }}
            >
              Log in with Spotify
            </button>
            {loginGateError ? (
              <p className="radio-shell radio-shell--error radio-auth-error">{loginGateError}</p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (loading || loadingExit) {
    return (
      <div className="radio-app">
        <div className="radio-shell radio-shell--main">
          <RadioBrandHeader />
          <div className="radio-body">
            <div className="radio-shell radio-shell--loading" aria-busy="true">
              <EmbedLoadingConsole
                headline="Rebuilding regional playlists..."
                exiting={!loading}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="radio-app">
        <div className="radio-shell radio-shell--main">
          <RadioBrandHeader />
          <div className="radio-shell radio-shell--error">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="radio-app">
      <div className="radio-shell radio-shell--main">
        <RadioBrandHeader />

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
                    key={`${activePlaylistId}-${playlistRefreshNonce}-${embedCacheBust}`}
                    title="Spotify playlist"
                    src={`https://open.spotify.com/embed/playlist/${activePlaylistId}?autoplay=true&cb=${embedCacheBust}`}
                    width="100%"
                    height="380"
                    allowFullScreen
                    allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
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
                className="reset-countdown"
                aria-live="polite"
                data-visible={resetCountdown != null || resetMessage ? "true" : "false"}
              >
                {resetCountdown != null
                  ? `Resetting playlists for region in ${resetCountdown}…`
                  : resetMessage}
              </div>
              {playableLocations.length > 0 ? (
                <>
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
                  <div className="tuner-controls-row">
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

                    <div className="reset-control">
                      <span className="reset-label" aria-hidden="true">RESET</span>
                      <button
                        type="button"
                        className="reset-button"
                        aria-label="Reset playlists for current region (press and hold 3 seconds)"
                        aria-pressed={resetCountdown != null}
                        disabled={resetting}
                        onPointerDown={handleResetDown}
                        onPointerUp={handleResetCancel}
                        onPointerCancel={handleResetCancel}
                        onPointerLeave={handleResetCancel}
                        onContextMenu={(e) => e.preventDefault()}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="tuner-controls-row">
                  <div className="reset-control">
                    <span className="reset-label" aria-hidden="true">RESET</span>
                    <button
                      type="button"
                      className="reset-button"
                      aria-label="Reset playlists for current region (press and hold 3 seconds)"
                      aria-pressed={resetCountdown != null}
                      disabled={resetting}
                      onPointerDown={handleResetDown}
                      onPointerUp={handleResetCancel}
                      onPointerCancel={handleResetCancel}
                      onPointerLeave={handleResetCancel}
                      onContextMenu={(e) => e.preventDefault()}
                    />
                  </div>
                  <div className="radio-shell radio-shell--error">
                    No playlists in this region yet. Hold RESET to generate them.
                  </div>
                </div>
              )}
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
                      }${
                        resetting && resettingRegionId === String(r.id)
                          ? " tuner-well--refreshing"
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
