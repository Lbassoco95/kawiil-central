-- Grabaciones A/V largas (~167MB+) fallaban con EntityTooLarge (límite global).
-- Subimos el tope del bucket mtg a 500 MiB (alineado con el check del front).

UPDATE storage.buckets
SET file_size_limit = 524288000
WHERE id = 'mtg';
