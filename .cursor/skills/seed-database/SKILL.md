---
name: seed-database
description: Insert artists into database.
---

## When to Use

- Use this skill when asked to seed the database.
- This skill is helpful for setting application data.

## Instructions

- Review the schema under `migrations/0001_initial.sql` (and later migrations in `migrations/`).
- Use the folders and `.txt` files within the `/artist-regions` directory to operate on the database located at `postgresql://postgres:postgres@localhost/straight-outta`.
    - For each location, upsert the artists in its `.txt` file.