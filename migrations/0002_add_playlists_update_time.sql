-- Add update_time to playlists (set on row update)
ALTER TABLE playlists
  ADD COLUMN IF NOT EXISTS update_time TIMESTAMPTZ DEFAULT now();

-- Set update_time on every UPDATE
CREATE OR REPLACE FUNCTION playlists_set_update_time()
RETURNS TRIGGER AS $$
BEGIN
  NEW.update_time = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS playlists_update_time_trigger ON playlists;
CREATE TRIGGER playlists_update_time_trigger
  BEFORE UPDATE ON playlists
  FOR EACH ROW
  EXECUTE FUNCTION playlists_set_update_time();
