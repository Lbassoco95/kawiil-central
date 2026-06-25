import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('No authorization header');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: callerUser }, error: authError } = await callerClient.auth.getUser();
    if (authError || !callerUser) throw new Error('Unauthorized');

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: isAdmin } = await adminClient.rpc('is_admin_or_manager', { _user_id: callerUser.id });
    if (!isAdmin) throw new Error('Solo admins y managers pueden cambiar el correo de un usuario');

    const body = await req.json();
    const user_id: string | undefined = body.user_id;
    const newEmail: string = (body.new_email ?? '').trim().toLowerCase();
    const sendLink: boolean = body.send_link !== false; // por defecto envía el enlace

    if (!user_id) throw new Error('user_id is required');
    if (!newEmail || !EMAIL_RE.test(newEmail)) throw new Error('Correo nuevo inválido');

    // Usuario objetivo.
    const { data: { user: targetUser }, error: userError } = await adminClient.auth.admin.getUserById(user_id);
    if (userError || !targetUser) throw new Error('Usuario no encontrado');

    const currentEmail = targetUser.email?.trim().toLowerCase();
    if (currentEmail === newEmail) {
      return new Response(JSON.stringify({ success: true, message: 'El correo ya es ese; sin cambios.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1) Cambiar el correo en Auth (confirmado, sin pedir verificación al usuario).
    const { error: updateError } = await adminClient.auth.admin.updateUserById(user_id, {
      email: newEmail,
      email_confirm: true,
    });
    if (updateError) {
      const m = (updateError.message || '').toLowerCase();
      if (m.includes('already been registered') || m.includes('already exists') || m.includes('duplicate')) {
        throw new Error('Ese correo ya pertenece a otra cuenta.');
      }
      throw updateError;
    }

    // 2) Reflejar el correo en el perfil.
    const { error: profileError } = await adminClient
      .from('profiles')
      .update({ email: newEmail })
      .eq('user_id', user_id);
    if (profileError) console.error('Profile email update error:', profileError.message);

    // 3) Opcional: enviar el enlace de acceso al nuevo correo (recuperación de contraseña).
    let linkSent = false;
    let linkNote = '';
    if (sendLink) {
      const siteBase = (Deno.env.get('SITE_URL') || Deno.env.get('PUBLIC_APP_URL') || '').replace(/\/$/, '');
      if (!siteBase || !/^https?:\/\//i.test(siteBase)) {
        linkNote = 'No se envió el enlace: SITE_URL no está configurada en Edge Functions.';
      } else {
        const redirectTo = `${siteBase}/cambiar-contrasena?flow=direct`;
        await adminClient.auth.admin.updateUserById(user_id, {
          user_metadata: { ...targetUser.user_metadata, must_change_password: true },
        });
        const { error: resetError } = await adminClient.auth.resetPasswordForEmail(newEmail, { redirectTo });
        if (resetError) {
          const msg = resetError.message || '';
          const m = msg.toLowerCase();
          const rateLimited =
            (m.includes('for security purposes') && m.includes('after')) ||
            m.includes('email rate limit') ||
            m.includes('rate limit exceeded') ||
            (m.includes('seconds') && m.includes('wait'));
          linkNote = rateLimited
            ? 'El correo se cambió, pero el envío del enlace está limitado por tiempo; reenvíalo en un minuto.'
            : `El correo se cambió, pero falló el envío del enlace: ${msg}`;
        } else {
          linkSent = true;
          await adminClient.from('profiles')
            .update({ invitation_accepted: false, onboarding_status: 'invited' })
            .eq('user_id', user_id);
        }
      }
    }

    const message = linkSent
      ? `Correo actualizado a ${newEmail}. Se envió el enlace de acceso a esa dirección.`
      : `Correo actualizado a ${newEmail}.${linkNote ? ' ' + linkNote : ''}`;

    return new Response(JSON.stringify({ success: true, link_sent: linkSent, message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Update user email error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
