/**
 * Seed regions, locations, and artists from .cursor/skills/seed-database/artist-regions.
 * Only locations that have a .txt file are created; artists are read from each file.
 *
 * Usage: node scripts/seed.js
 * Requires: DATABASE_URL or postgresql://postgres:postgres@localhost/straight-outta
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artistRegionsDir = path.resolve(__dirname, '..', 'artist-regions');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost/straight-outta';

// Map .txt filename (without extension) -> locations.name (DB code).
// Order and codes match LOCATION_DISPLAY_NAMES keys in aws/playlist_refresher/handler.py.
const FILE_TO_LOCATION_NAME = {
  // West
  'los-angeles': 'LA',
  'bay-area': 'BAY',
  'norcal': 'SAC',
  'pacific-nw': 'PNW',
  'southwest': 'SW',
  // Midwest
  'chicago': 'CHI',
  'ohio': 'CLE',
  'michigan': 'DET',
  'lower-midwest': 'STL',
  'milwaukee': 'MIL',
  // South
  'florida': 'FL',
  'atlanta': 'ATL',
  'houston': 'HOU',
  'dfw': 'DFW',
  'mississippi': 'MISS',
  'new-orleans': 'NO',
  'tenn': 'MEM',
  // East
  'ny': 'NY',
  'buffalo': 'BUF',
  'philly': 'PHI',
  'pittsburgh': 'PITT',
  'northeast': 'NE',
  'dmv': 'DMV',
  'virginia': 'VA',
  'carolinas': 'NC/SC',
};

const REGION_FOLDER_TO_NAME = {
  west: 'West',
  midwest: 'Midwest',
  south: 'South',
  east: 'East',
};

function getLocationName(filename) {
  const base = path.basename(filename, '.txt');
  const key = base.toLowerCase().replace(/\s+/g, '-');
  return FILE_TO_LOCATION_NAME[key] ?? base;
}

function getArtistsFromFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((name) => name.length > 0);
}

function* walkTxtFiles(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkTxtFiles(full);
    } else if (e.isFile() && e.name.endsWith('.txt')) {
      yield full;
    }
  }
}

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    // 1) Upsert regions
    const regionNames = ['West', 'Midwest', 'South', 'East'];
    for (const name of regionNames) {
      await client.query(
        `INSERT INTO regions (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
        [name]
      );
    }
    console.log('Upserted regions:', regionNames.join(', '));

    let locationCount = 0;
    let artistCount = 0;

    for (const txtPath of walkTxtFiles(artistRegionsDir)) {
      const relative = path.relative(artistRegionsDir, txtPath);
      const parts = path.dirname(relative).split(path.sep);
      const regionFolder = parts[0]?.toLowerCase() || '';
      const regionName = REGION_FOLDER_TO_NAME[regionFolder];
      if (!regionName) {
        console.warn('Skipping unknown region folder:', path.dirname(relative));
        continue;
      }

      const locationName = getLocationName(txtPath);

      // 2) Get region id and upsert location
      const regionRow = await client.query(
        `SELECT id FROM regions WHERE name = $1`,
        [regionName]
      );
      const regionId = regionRow.rows[0]?.id;
      if (!regionId) {
        console.warn('Region not found:', regionName);
        continue;
      }

      await client.query(
        `INSERT INTO locations (region_id, name) VALUES ($1, $2) ON CONFLICT (region_id, name) DO NOTHING`,
        [regionId, locationName]
      );

      const locRow = await client.query(
        `SELECT id FROM locations WHERE region_id = $1 AND name = $2`,
        [regionId, locationName]
      );
      const locationId = locRow.rows[0]?.id;
      if (!locationId) continue;
      locationCount += 1;

      // 3) Insert artists (skip if already exists for this location to allow re-runs)
      const artists = getArtistsFromFile(txtPath);
      let inserted = 0;
      for (const name of artists) {
        const res = await client.query(
          `INSERT INTO artists (location_id, name)
           SELECT $1, $2 WHERE NOT EXISTS (
             SELECT 1 FROM artists WHERE location_id = $1 AND name = $2
           )`,
          [locationId, name]
        );
        if (res.rowCount > 0) inserted += 1;
      }
      artistCount += inserted;
      console.log(`  ${regionName} / ${locationName}: ${artists.length} artists (${inserted} new)`);
    }

    console.log(`Done. Locations with files: ${locationCount}, artists inserted this run: ${artistCount}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
