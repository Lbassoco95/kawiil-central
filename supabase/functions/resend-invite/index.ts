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

    // Re-invite the user
    const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(targetUser.email!, {
      data: targetUser.user_metadata,
    });

    if (inviteError) {
      // If already confirmed, try generating a new invite link
      if (inviteError.message?.includes('already been registered') || inviteError.message?.includes('already confirmed')) {
        // Use generateLink as fallback
        const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
          type: 'invite',
          email: targetUser.email!,
          options: { data: targetUser.user_metadata },
        });
        if (linkError) throw linkError;
      } else {
        throw inviteError;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: `Invitación reenviada a ${targetUser.email}`,
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
