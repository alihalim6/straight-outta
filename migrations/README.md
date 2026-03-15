# Database migrations

Migrations are applied in order by filename. Each SQL file is run once; applied names are stored in `schema_migrations`.

## First-time setup (new database)

```bash
export DATABASE_URL="postgresql://..."
python run_migrations.py
```

## Existing database (schema already created manually)

1. Run the migrator once so it creates `schema_migrations` (it will fail when applying `0001_initial.sql` because tables already exist):
   ```bash
   python3 run_migrations.py
   ```
2. Mark the initial schema as applied:
   ```bash
   psql "$DATABASE_URL" -c "INSERT INTO schema_migrations (name) VALUES ('0001_initial');"
   ```
3. Run the migrator again so later migrations (e.g. `0002_add_playlists_update_time`) run:
   ```bash
   python3 run_migrations.py
   ```

## Adding a new migration

Add a new file `migrations/NNNN_description.sql` (e.g. `0003_add_foo.sql`) and run `python run_migrations.py`.
