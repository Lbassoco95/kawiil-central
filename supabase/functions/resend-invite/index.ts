import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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
    if (!isAdmin) throw new Error('Solo admins y managers pueden reenviar invitaciones');

    const { user_id } = await req.json();
    if (!user_id) throw new Error('user_id is required');

    // Get user info
    const { data: { user: targetUser }, error: userError } = await adminClient.auth.admin.getUserById(user_id);
    if (userError || !targetUser) throw new Error('Usuario no encontrado');

    const siteUrl = Deno.env.get('SITE_URL') || 'https://kawiil-core-hub.lovable.app';
    const email = targetUser.email!;
    const isConfirmed = !!targetUser.email_confirmed_at;

    console.log(`Resending for ${email}, confirmed: ${isConfirmed}`);

    if (!isConfirmed) {
      // User never confirmed — confirm them first, then send recovery
      // This ensures they always get a "set your password" email, not a "register" one
      const { error: confirmError } = await adminClient.auth.admin.updateUserById(user_id, {
        email_confirm: true,
        user_metadata: { ...targetUser.user_metadata, must_change_password: true },
      });
      if (confirmError) {
        console.warn('Could not confirm user:', confirmError.message);
      }

      // Now send recovery email
      const { error: resetError } = await adminClient.auth.resetPasswordForEmail(email, {
        redirectTo: `${siteUrl}/cambiar-contrasena`,
      });

      if (resetError) {
        const msg = resetError.message || '';
        const isRateLimited = msg.toLowerCase().includes('for security purposes') && msg.toLowerCase().includes('after');
        if (isRateLimited) {
          const secondsMatch = msg.match(/after\s+(\d+)\s+seconds/i);
          const retryAfterSeconds = secondsMatch ? Number(secondsMatch[1]) : 60;
          return new Response(JSON.stringify({
            success: false,
            rate_limited: true,
            retry_after_seconds: retryAfterSeconds,
            message: `Espera ${retryAfterSeconds}s antes de reenviar a ${email}`,
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        throw resetError;
      }

      console.log(`User confirmed + recovery sent to ${email}`);
    } else {
      // User already confirmed — send password recovery email
      // First update metadata to force password change on next login
      const { error: updateErr } = await adminClient.auth.admin.updateUserById(user_id, {
        user_metadata: { ...targetUser.user_metadata, must_change_password: true },
      });
      if (updateErr) console.warn('Could not update metadata:', updateErr.message);

      // Send recovery email (rate-limited by provider to ~60s per email)
      const { error: resetError } = await adminClient.auth.resetPasswordForEmail(email, {
        redirectTo: `${siteUrl}/cambiar-contrasena`,
      });

      if (resetError) {
        const msg = resetError.message || '';
        const isRateLimited = msg.toLowerCase().includes('for security purposes') && msg.toLowerCase().includes('after');

        if (isRateLimited) {
          const secondsMatch = msg.match(/after\s+(\d+)\s+seconds/i);
          const retryAfterSeconds = secondsMatch ? Number(secondsMatch[1]) : 60;

          return new Response(JSON.stringify({
            success: false,
            rate_limited: true,
            retry_after_seconds: retryAfterSeconds,
            message: `Espera ${retryAfterSeconds}s antes de reenviar a ${email}`,
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        throw resetError;
      }

      // Update onboarding status to reflect they need to set password
      await adminClient.from('profiles').update({
        onboarding_status: 'password_pending',
      }).eq('user_id', user_id);

      console.log(`Recovery email sent to ${email}`);
    }

    return new Response(JSON.stringify({
      success: true,
      message: `Enlace de acceso reenviado a ${email}`,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Resend invite error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
