ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS microsoft_email text,
ADD COLUMN IF NOT EXISTS microsoft_user_id text;