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
    if (!isAdmin) throw new Error('Only admins and managers can create users');

    const { email, full_name, password, role, area, phone } = await req.json();

    if (!email || !full_name || !password || !role) {
      throw new Error('Email, full_name, password, and role are required');
    }

    if (password.length < 6) {
      throw new Error('La contraseña debe tener al menos 6 caracteres');
    }

    const { data: orgId } = await adminClient.rpc('get_user_org_id', { _user_id: callerUser.id });
    if (!orgId) throw new Error('Could not determine organization');

    // Create user with admin API
    const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    });

    if (createError) {
      if (createError.message?.includes('already been registered') || createError.message?.includes('already exists')) {
        throw new Error('Este correo ya está registrado en el sistema');
      }
      throw createError;
    }

    const newUserId = createData.user.id;

    // Update profile
    const { error: profileError } = await adminClient
      .from('profiles')
      .update({
        full_name,
        area: area || null,
        phone: phone || null,
        organization_id: orgId,
      })
      .eq('user_id', newUserId);

    if (profileError) console.error('Profile update error:', profileError);

    // Set role
    const { error: roleError } = await adminClient
      .from('user_roles')
      .upsert({
        user_id: newUserId,
        role: role,
      }, { onConflict: 'user_id,role' });

    if (roleError) console.error('Role assignment error:', roleError);

    return new Response(JSON.stringify({
      success: true,
      user_id: newUserId,
      message: `Usuario ${full_name} creado exitosamente`,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Create user error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
