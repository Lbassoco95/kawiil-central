import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Cache the team root namespace ID
let cachedRootNamespaceId: string | null = null;

async function getTeamRootNamespaceId(token: string): Promise<string | null> {
  if (cachedRootNamespaceId) return cachedRootNamespaceId;

  try {
    const response = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) return null;

    const account = await response.json();
    // If the account has a team with a root namespace, use it
    const rootNsId = account?.root_info?.root_namespace_id;
    if (rootNsId && account?.root_info?.['.tag'] === 'team') {
      cachedRootNamespaceId = rootNsId;
      console.log('Using team root namespace:', rootNsId);
      return rootNsId;
    }
    return null;
  } catch (e) {
    console.error('Error getting team namespace:', e);
    return null;
  }
}

function getDropboxHeaders(token: string, rootNamespaceId: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (rootNamespaceId) {
    headers['Dropbox-API-Path-Root'] = JSON.stringify({
      ".tag": "root",
      "root": rootNamespaceId
    });
  }
  return headers;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const DROPBOX_ACCESS_TOKEN = Deno.env.get('DROPBOX_ACCESS_TOKEN');
    if (!DROPBOX_ACCESS_TOKEN) {
      throw new Error('DROPBOX_ACCESS_TOKEN is not configured');
    }

    const { path = "", action = "list" } = await req.json();

    // Get team root namespace
    const rootNamespaceId = await getTeamRootNamespaceId(DROPBOX_ACCESS_TOKEN);
    const dbxHeaders = getDropboxHeaders(DROPBOX_ACCESS_TOKEN, rootNamespaceId);

    if (action === "list") {
      const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
        method: 'POST',
        headers: dbxHeaders,
        body: JSON.stringify({
          path: path || "",
          recursive: false,
          include_media_info: false,
          include_deleted: false,
          limit: 100,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Dropbox API error [${response.status}]: ${errorBody}`);
      }

      const data = await response.json();
      const entries = data.entries.map((entry: any) => ({
        id: entry.id,
        name: entry.name,
        path: entry.path_display,
        type: entry['.tag'],
        size: entry.size || null,
        modified: entry.client_modified || null,
      }));

      return new Response(JSON.stringify({ entries, has_more: data.has_more }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === "get_link") {
      let shareUrl = "";
      try {
        const response = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
          method: 'POST',
          headers: dbxHeaders,
          body: JSON.stringify({ path }),
        });

        if (response.ok) {
          const data = await response.json();
          shareUrl = data.url;
        } else {
          const errorBody = await response.json();
          if (errorBody?.error?.['.tag'] === 'shared_link_already_exists') {
            const listRes = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
              method: 'POST',
              headers: dbxHeaders,
              body: JSON.stringify({ path, direct_only: true }),
            });
            if (listRes.ok) {
              const listData = await listRes.json();
              if (listData.links?.length > 0) {
                shareUrl = listData.links[0].url;
              }
            }
          } else {
            throw new Error(`Dropbox sharing error [${response.status}]: ${JSON.stringify(errorBody)}`);
          }
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes('Dropbox sharing error')) throw e;
        throw e;
      }

      return new Response(JSON.stringify({ url: shareUrl }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Dropbox browse error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
