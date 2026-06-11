-- Almacena qué claves de respuesta el usuario marcó como públicas en su perfil.
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS public_answers TEXT[] DEFAULT '{}';
