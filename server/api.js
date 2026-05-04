/**
 * Local API server: regions, locations with playlist_id.
 * Run: node server/api.js (port 3001)
 */
import express from "express";
import pg from "pg";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const PORT = Number(process.env.API_PORT) || 3001;
const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost/straight-outta";
const execFileAsync = promisify(execFile);
/** Max time (ms) for the local Python refresher subprocess; override with REFRESH_EXEC_TIMEOUT_MS */
const REFRESH_EXEC_TIMEOUT_MS = Number(process.env.REFRESH_EXEC_TIMEOUT_MS) || 600000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const REFRESHER_DIR = path.join(PROJECT_ROOT, "backend", "playlist_refresher");
const ROOT_ENV_PATH = path.join(PROJECT_ROOT, ".env");
const REFRESHER_ENV_PATH = path.join(REFRESHER_DIR, ".env");
const DIST_DIR = path.resolve(__dirname, "..", "dist");
const DIST_INDEX = path.join(DIST_DIR, "index.html");
let cachedPythonExecutable = null;

function resolveRefresherDir() {
  // In packaged Electron, __dirname points inside app.asar. Python cannot chdir/import from
  // asar virtual paths, so prefer app.asar.unpacked for refresher sources.
  if (REFRESHER_DIR.includes(".asar")) {
    const unpacked = REFRESHER_DIR.replace(".asar", ".asar.unpacked");
    if (existsSync(unpacked)) return unpacked;
    return unpacked;
  }
  if (existsSync(REFRESHER_DIR)) return REFRESHER_DIR;
  return REFRESHER_DIR;
}

function detectBundledPythonVersion(refresherDir) {
  try {
    const psycopgBinaryDir = path.join(
      refresherDir,
      ".python_packages",
      "psycopg_binary"
    );
    if (!existsSync(psycopgBinaryDir)) return null;
    const files = readdirSync(psycopgBinaryDir);
    const tagged = files.find((name) => /^pq\.cpython-\d{2,3}.*\.so$/.test(name));
    if (!tagged) return null;
    const m = tagged.match(/^pq\.cpython-(\d)(\d{1,2})/);
    if (!m) return null;
    return `${m[1]}.${m[2]}`;
  } catch {
    return null;
  }
}

function getPythonVersion(executable) {
  try {
    return execFileSync(
      executable,
      ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"],
      { encoding: "utf8" }
    ).trim();
  } catch {
    return null;
  }
}

function resolvePythonExecutable(refresherDir) {
  if (cachedPythonExecutable) return cachedPythonExecutable;
  const targetVersion = detectBundledPythonVersion(refresherDir);
  const candidates = [
    process.env.PYTHON3_PATH,
    "/Library/Frameworks/Python.framework/Versions/3.7/bin/python3",
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3",
    "/usr/bin/python3",
    "python3",
  ].filter(Boolean);

  if (!targetVersion) {
    const first = candidates.find((c) => !!getPythonVersion(c)) || "python3";
    cachedPythonExecutable = first;
    return first;
  }

  const matched = candidates.find((candidate) => getPythonVersion(candidate) === targetVersion);
  if (matched) {
    cachedPythonExecutable = matched;
    return matched;
  }

  const fallback = candidates.find((c) => !!getPythonVersion(c)) || "python3";
  cachedPythonExecutable = fallback;
  return fallback;
}

function parseEnvFile(filePath) {
  try {
    const raw = readFileSync(filePath, "utf8");
    return raw.split(/\r?\n/).reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return acc;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) return acc;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (key) acc[key] = value;
      return acc;
    }, {});
  } catch {
    return {};
  }
}

async function runLocalRefresher(req, res) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  const regionIdRaw =
    req.query.region_id ??
    (req.body && typeof req.body === "object" ? req.body.region_id : undefined);
  const regionId =
    regionIdRaw == null || regionIdRaw === "" ? "" : String(regionIdRaw);

  try {
    const refresherDir = resolveRefresherDir();
    const pythonExecutable = resolvePythonExecutable(refresherDir);
    const rootEnv = parseEnvFile(ROOT_ENV_PATH);
    const refresherEnv = parseEnvFile(path.join(refresherDir, ".env"));
    const refresherPyPkgDir = path.join(refresherDir, ".python_packages");
    const pythonCode = `
import json
import os
import sys
from pathlib import Path
pkg_dir = os.environ.get("REFRESHER_PY_PKG_DIR", "")
if pkg_dir:
    sys.path.insert(0, pkg_dir)
sys.path.insert(0, str(Path(os.environ["REFRESHER_PY_DIR"])))
from handler import run_refresh
qs = {}
region_id = os.environ.get("REFRESH_REGION_ID", "")
if region_id:
    qs["region_id"] = region_id
event = {
    "headers": {"Authorization": os.environ.get("REFRESH_AUTH_HEADER", "")},
    "queryStringParameters": qs or None,
}
result = run_refresh(event, None)
print("__REFRESH_RESULT__" + json.dumps(result))
`.trim();

    const { stdout, stderr } = await execFileAsync(pythonExecutable, ["-c", pythonCode], {
      // Use a real directory. In packaged apps, PROJECT_ROOT points at app.asar (a file),
      // which causes ENOTDIR when used as cwd.
      cwd: refresherDir,
      env: {
        ...rootEnv,
        ...refresherEnv,
        ...process.env,
        REFRESH_AUTH_HEADER: auth,
        REFRESH_REGION_ID: regionId,
        REFRESHER_PY_DIR: refresherDir,
        REFRESHER_PY_PKG_DIR: refresherPyPkgDir,
      },
      timeout: REFRESH_EXEC_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (stderr && stderr.trim()) {
      console.warn(stderr);
    }

    const resultLine = stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith("__REFRESH_RESULT__"));
    if (!resultLine) {
      throw new Error("No structured result found in refresher output");
    }
    const result = JSON.parse(resultLine.replace("__REFRESH_RESULT__", ""));
    const statusCode = Number(result.statusCode) || 200;
    const headers = result.headers || {};
    Object.entries(headers).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        res.set(key, String(value));
      }
    });

    return res.status(statusCode).send(result.body ?? "");
  } catch (e) {
    if (e && e.code === "ENOENT") {
      return res.status(500).json({
        error:
          "Local refresher failed: required executable or path not found " +
          `(${resolvePythonExecutable(resolveRefresherDir())} or ${resolveRefresherDir()})`,
      });
    }
    return res.status(500).json({ error: `Local refresher failed: ${e.message}` });
  }
}

export function createApiApp() {
  const app = express();

  app.use((req, res, next) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });

  app.use(express.json({ limit: "256kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/regions", async (_req, res) => {
    const client = new pg.Client({ connectionString: DATABASE_URL });
    try {
      await client.connect();
      const r = await client.query(
        "SELECT id, name FROM regions ORDER BY name"
      );
      res.json(r.rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    } finally {
      await client.end();
    }
  });

  app.get("/api/locations", async (req, res) => {
    const regionId = req.query.region_id;
    if (!regionId) {
      return res.status(400).json({ error: "region_id required" });
    }
    const client = new pg.Client({ connectionString: DATABASE_URL });
    try {
      await client.connect();
      const r = await client.query(
        `SELECT l.id, l.name, p.playlist_id
         FROM locations l
         LEFT JOIN playlists p ON p.location_id = l.id AND p.years_id IS NULL
         WHERE l.region_id = $1
         ORDER BY l.name`,
        [regionId]
      );
      res.json(r.rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    } finally {
      await client.end();
    }
  });

  app.post("/api/refresh", runLocalRefresher);

  // For desktop mode, serve built frontend from the same local server.
  if (existsSync(DIST_INDEX)) {
    app.use(express.static(DIST_DIR));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      return res.sendFile(DIST_INDEX);
    });
  }

  return app;
}

export function startApiServer({ port = PORT } = {}) {
  const app = createApiApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(port);
    const onError = (error) => {
      reject(error);
    };
    server.once("error", onError);
    server.once("listening", () => {
      server.off("error", onError);
      console.log(`API server on http://127.0.0.1:${port}`);
      resolve(server);
    });
  });
}

const isDirectRun =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  startApiServer();
}
