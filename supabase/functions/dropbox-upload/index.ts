import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-upload-path, x-upload-namespace, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

let cachedAccessToken: string | null = null;
let cachedTokenExpiry = 0;
let cachedAdminMemberId: string | null = null;
let cachedRootNamespaceId: string | null = null;

async function getRefreshTokenFromDb(): Promise<string | null> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) return null;
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data } = await supabase
      .from('integrations')
      .select('config')
      .eq('provider', 'dropbox')
      .eq('is_active', true)
      .single();
    return data?.config?.refresh_token || null;
  } catch { return null; }
}

async function getValidAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < cachedTokenExpiry - 300_000) {
    return cachedAccessToken;
  }
  let refreshToken = Deno.env.get('DROPBOX_REFRESH_TOKEN');
  const appKey = Deno.env.get('DROPBOX_APP_KEY');
  const appSecret = Deno.env.get('DROPBOX_APP_SECRET');

  if (!refreshToken || refreshToken.length < 50) {
    const dbToken = await getRefreshTokenFromDb();
    if (dbToken) refreshToken = dbToken;
  }

  if (!refreshToken || !appKey || !appSecret) {
    const staticToken = Deno.env.get('DROPBOX_ACCESS_TOKEN');
    if (!staticToken) throw new Error('No Dropbox credentials configured');
    return staticToken;
  }

  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${appKey}:${appSecret}`)}`,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });

  if (!response.ok) throw new Error(`Failed to refresh token: ${await response.text()}`);
  const data = await response.json();
  cachedAccessToken = data.access_token;
  cachedTokenExpiry = Date.now() + (data.expires_in * 1000);
  return cachedAccessToken!;
}

async function getTeamAdminMemberId(token: string): Promise<string | null> {
  if (cachedAdminMemberId) return cachedAdminMemberId;
  try {
    const res = await fetch('https://api.dropboxapi.com/2/team/members/list_v2', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 50 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const members = data?.members || [];
    const admin = members.find((m: any) => m?.role?.['.tag'] === 'team_admin');
    const id = admin?.profile?.team_member_id || members[0]?.profile?.team_member_id;
    if (id) cachedAdminMemberId = id;
    return id || null;
  } catch { return null; }
}

async function getTeamRootNamespaceId(token: string, adminId: string | null): Promise<string | null> {
  if (cachedRootNamespaceId) return cachedRootNamespaceId;
  try {
    const headers: Record<string, string> = { 'Authorization': `Bearer ${token}` };
    if (adminId) headers['Dropbox-API-Select-Admin'] = adminId;
    const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', { method: 'POST', headers });
    if (!res.ok) return null;
    const account = await res.json();
    const id = account?.root_info?.root_namespace_id;
    if (id) cachedRootNamespaceId = id;
    return id || null;
  } catch { return null; }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Escape non-ASCII chars for HTTP header safety (Dropbox-API-Arg requirement)
  function asciiSafeJson(obj: unknown): string {
    return JSON.stringify(obj).replace(/[\u0080-\uffff]/g, (ch) => {
      return '\\u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4);
    });
  }

  try {
    const rawUploadPath = req.headers.get('x-upload-path');
    const uploadPath = rawUploadPath ? decodeURIComponent(rawUploadPath) : null;
    const namespaceId = req.headers.get('x-upload-namespace');

    if (!uploadPath) {
      throw new Error('x-upload-path header is required');
    }

    // Read body as raw bytes - no base64 overhead
    const fileBytes = new Uint8Array(await req.arrayBuffer());
    if (fileBytes.length === 0) {
      throw new Error('Empty file body');
    }

    const token = await getValidAccessToken();
    const adminId = await getTeamAdminMemberId(token);
    const rootNsId = await getTeamRootNamespaceId(token, adminId);

    // Build upload headers
    const uploadHeaders: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': asciiSafeJson({
        path: uploadPath,
        mode: 'add',
        autorename: true,
        mute: false,
      }),
    };

    if (adminId) uploadHeaders['Dropbox-API-Select-Admin'] = adminId;

    if (namespaceId) {
      uploadHeaders['Dropbox-API-Path-Root'] = JSON.stringify({ '.tag': 'namespace_id', namespace_id: namespaceId });
    } else if (rootNsId) {
      uploadHeaders['Dropbox-API-Path-Root'] = JSON.stringify({ '.tag': 'root', root: rootNsId });
    }

    const uploadRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: uploadHeaders,
      body: fileBytes,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error(`Dropbox upload error [${uploadRes.status}]: ${errText}`);
    }

    const result = await uploadRes.json();
    const uploadedPath = result.path_display || uploadPath;

    // Get share link
    let shareUrl = '';
    const linkHeaders: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    if (adminId) linkHeaders['Dropbox-API-Select-Admin'] = adminId;
    if (namespaceId) {
      linkHeaders['Dropbox-API-Path-Root'] = JSON.stringify({ '.tag': 'namespace_id', namespace_id: namespaceId });
    } else if (rootNsId) {
      linkHeaders['Dropbox-API-Path-Root'] = JSON.stringify({ '.tag': 'root', root: rootNsId });
    }

    try {
      const linkRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
        method: 'POST',
        headers: linkHeaders,
        body: JSON.stringify({ path: uploadedPath }),
      });
      if (linkRes.ok) {
        shareUrl = (await linkRes.json()).url;
      } else {
        const linkErr = await linkRes.json();
        if (linkErr?.error?.['.tag'] === 'shared_link_already_exists') {
          const listRes = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
            method: 'POST',
            headers: linkHeaders,
            body: JSON.stringify({ path: uploadedPath, direct_only: true }),
          });
          if (listRes.ok) {
            const listData = await listRes.json();
            if (listData.links?.length > 0) shareUrl = listData.links[0].url;
          }
        }
      }
    } catch (e) {
      console.error('Error getting share link:', e);
    }

    return new Response(JSON.stringify({ success: true, name: result.name, path: uploadedPath, url: shareUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Dropbox upload error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
