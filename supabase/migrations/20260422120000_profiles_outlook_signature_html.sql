-- Firma HTML opcional para componer en Kawiil; precede a inferencia desde Enviados y al fallback de /me.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS outlook_signature_html text;

COMMENT ON COLUMN public.profiles.outlook_signature_html IS
  'HTML de firma de correo. Precedencia en microsoft-api (get-email-signature-html): kawiil > inferida desde Enviados > perfil Microsoft Graph.';
