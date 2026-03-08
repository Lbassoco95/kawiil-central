import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const APP_KEY = Deno.env.get('DROPBOX_APP_KEY');
    const APP_SECRET = Deno.env.get('DROPBOX_APP_SECRET');
    if (!APP_KEY || !APP_SECRET) {
      throw new Error('DROPBOX_APP_KEY or DROPBOX_APP_SECRET not configured');
    }

    const { code } = await req.json();
    if (!code) throw new Error('Authorization code is required');

    const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${APP_KEY}:${APP_SECRET}`)}`,
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Dropbox token exchange failed: ${JSON.stringify(data)}`);
    }

    return new Response(JSON.stringify({
      refresh_token: data.refresh_token,
      access_token: data.access_token,
      expires_in: data.expires_in,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
