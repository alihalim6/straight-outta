/**
 * Temporary API server: regions, locations with playlist_id.
 * Run: node server/api.js (port 3001)
 */
import express from "express";
import pg from "pg";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const app = express();
const PORT = process.env.API_PORT || 3001;
const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost/straight-outta";
const execFileAsync = promisify(execFile);
/** Max time (ms) for the local Python refresher subprocess; override with REFRESH_EXEC_TIMEOUT_MS */
const REFRESH_EXEC_TIMEOUT_MS = Number(process.env.REFRESH_EXEC_TIMEOUT_MS) || 600000;

function parseEnvFile(path) {
  try {
    const raw = readFileSync(path, "utf8");
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

app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

app.get("/api/regions", async (req, res) => {
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

async function runLocalRefresher(req, res) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  try {
    const rootEnv = parseEnvFile(".env");
    const refresherEnv = parseEnvFile("aws/playlist_refresher/.env");
    const pythonCode = `
import json
import os
from handler import lambda_handler
event = {"headers": {"Authorization": os.environ.get("REFRESH_AUTH_HEADER", "")}}
result = lambda_handler(event, None)
print("__REFRESH_RESULT__" + json.dumps(result))
`.trim();

    const { stdout, stderr } = await execFileAsync("python3", ["-c", pythonCode], {
      cwd: "aws/playlist_refresher",
      env: {
        ...rootEnv,
        ...refresherEnv,
        ...process.env,
        REFRESH_AUTH_HEADER: auth,
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
    return res.status(500).json({ error: `Local refresher failed: ${e.message}` });
  }
}

app.post("/api/refresh", runLocalRefresher);

app.listen(PORT, () => {
  console.log(`API server on http://127.0.0.1:${PORT}`);
});
