-- Grabaciones A/V de juntas largas (~167MB+) fallaban con EntityTooLarge.
UPDATE storage.buckets
SET file_size_limit = 524288000  -- 500 MiB
WHERE id = 'mtg';
