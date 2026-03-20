/**
 * Temporary API server: regions, locations with playlist_id.
 * Run: node server/api.js (port 3001)
 */
import express from "express";
import pg from "pg";

const app = express();
const PORT = process.env.API_PORT || 3001;
const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost/straight-outta";

app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
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

app.listen(PORT, () => {
  console.log(`API server on http://127.0.0.1:${PORT}`);
});
