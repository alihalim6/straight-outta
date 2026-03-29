-- Canonical location rows (code stored in locations.name). Skip if region+name already exists.
INSERT INTO regions (name)
VALUES ('West'), ('Midwest'), ('South'), ('East')
ON CONFLICT (name) DO NOTHING;

-- West
INSERT INTO locations (region_id, name)
SELECT r.id, v.name
FROM regions r
CROSS JOIN (
  VALUES
    ('LA'),
    ('BAY'),
    ('SAC'),
    ('SEA/POR'),
    ('DEN')
) AS v(name)
WHERE r.name = 'West'
ON CONFLICT (region_id, name) DO NOTHING;

-- Midwest
INSERT INTO locations (region_id, name)
SELECT r.id, v.name
FROM regions r
CROSS JOIN (
  VALUES
    ('CHI'),
    ('CLE'),
    ('DET'),
    ('STL'),
    ('MIL')
) AS v(name)
WHERE r.name = 'Midwest'
ON CONFLICT (region_id, name) DO NOTHING;

-- South
INSERT INTO locations (region_id, name)
SELECT r.id, v.name
FROM regions r
CROSS JOIN (
  VALUES
    ('FL'),
    ('ATL'),
    ('HOU'),
    ('DFW'),
    ('MISS'),
    ('NO'),
    ('TENN')
) AS v(name)
WHERE r.name = 'South'
ON CONFLICT (region_id, name) DO NOTHING;

-- East
INSERT INTO locations (region_id, name)
SELECT r.id, v.name
FROM regions r
CROSS JOIN (
  VALUES
    ('NY'),
    ('BUF'),
    ('PHI'),
    ('PITT'),
    ('NE'),
    ('DMV'),
    ('VA'),
    ('NC/SC')
) AS v(name)
WHERE r.name = 'East'
ON CONFLICT (region_id, name) DO NOTHING;
