import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify the calling user is admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('No authorization header');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Client with caller's JWT to check permissions
    const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: callerUser }, error: authError } = await callerClient.auth.getUser();
    if (authError || !callerUser) throw new Error('Unauthorized');

    // Check caller is admin
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: isAdmin } = await adminClient.rpc('is_admin_or_manager', { _user_id: callerUser.id });
    if (!isAdmin) throw new Error('Only admins and managers can invite users');

    const { email, full_name, role, area, phone } = await req.json();

    if (!email || !full_name || !role) {
      throw new Error('Email, full_name, and role are required');
    }

    // Get caller's org_id
    const { data: orgId } = await adminClient.rpc('get_user_org_id', { _user_id: callerUser.id });
    if (!orgId) throw new Error('Could not determine organization');

    // Create user with admin API (inviteUserByEmail)
    const siteUrl = Deno.env.get('SITE_URL') || 'https://kawiil-core-hub.lovable.app';
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name },
      redirectTo: `${siteUrl}/cambiar-contrasena`,
    });

    if (inviteError) {
      // Check if user already exists
      if (inviteError.message?.includes('already been registered') || inviteError.message?.includes('already exists')) {
        throw new Error('Este correo ya está registrado en el sistema');
      }
      throw inviteError;
    }

    const newUserId = inviteData.user.id;

    // Update the profile (trigger should have created it)
    const { error: profileError } = await adminClient
      .from('profiles')
      .update({
        full_name,
        area: area || null,
        phone: phone || null,
        organization_id: orgId,
        invitation_accepted: false,
        onboarding_status: 'invited',
      })
      .eq('user_id', newUserId);

    if (profileError) {
      console.error('Profile update error:', profileError);
    }

    // Set role
    const { error: roleError } = await adminClient
      .from('user_roles')
      .upsert({
        user_id: newUserId,
        role: role,
      }, { onConflict: 'user_id,role' });

    if (roleError) {
      console.error('Role assignment error:', roleError);
    }

    return new Response(JSON.stringify({
      success: true,
      user_id: newUserId,
      message: `Invitación enviada a ${email}`,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Invite user error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
