---
name: seed-database
description: Insert regions, locations and artists into database.
---

## When to Use

- Use this skill when asked to seed the database.
- This skill is helpful for setting application data.

## Instructions

- Review the schema under `assets/schema.sql`.
- Use the folders and `.txt` files within the `/artist-regions` directory to operate on the database located at `postgresql://postgres:postgres@localhost/straight-outta`.
    - Upsert each of the four regions indicated by the folders (East, Midwest, South, and West).
    - Upsert each location indicated by a `.txt` file in the region folders.
    - For each location, upsert the artists in its `.txt` file.