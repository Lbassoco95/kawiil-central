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
      '.tag': 'root',
      root: rootNamespaceId,
    });
  }
  return headers;
}

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

async function listFolderRequest(headers: Record<string, string>, folderPath: string) {
  const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      path: folderPath,
      recursive: false,
      include_media_info: false,
      include_deleted: false,
      limit: 100,
    }),
  });

  const raw = await response.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    raw,
    data,
  };
}

async function resolvePathAndList(headers: Record<string, string>, requestedPath: string) {
  const firstTry = await listFolderRequest(headers, requestedPath || '');
  if (firstTry.ok) {
    return { data: firstTry.data, resolvedPath: requestedPath || '' };
  }

  const isNotFound = firstTry.status === 409 && (firstTry.raw || '').includes('path/not_found');
  if (!isNotFound || !requestedPath) {
    throw new Error(`Dropbox API error [${firstTry.status}]: ${firstTry.raw}`);
  }

  const rootTry = await listFolderRequest(headers, '');
  if (!rootTry.ok) {
    throw new Error(`Dropbox API error [${rootTry.status}]: ${rootTry.raw}`);
  }

  const targetName = normalizeName(requestedPath.split('/').filter(Boolean).pop() || requestedPath);
  const folders = (rootTry.data?.entries || []).filter((entry: any) => entry['.tag'] === 'folder');

  const ranked = folders
    .map((entry: any) => {
      const name = String(entry.name || '');
      const normalized = normalizeName(name);
      let score = 0;

      if (normalized === targetName) score = 100;
      else if (normalized.startsWith(targetName)) score = 85;
      else if (normalized.includes(targetName)) score = 75;

      if (normalized.includes('conflicto')) score -= 8;

      return { entry, score };
    })
    .filter((item: any) => item.score > 0)
    .sort((a: any, b: any) => b.score - a.score);

  if (ranked.length === 0) {
    throw new Error(`Dropbox API error [${firstTry.status}]: ${firstTry.raw}`);
  }

  const candidate = ranked[0].entry;
  const candidatePath = candidate.path_display || `/${candidate.name}`;
  console.log(`Path not found for "${requestedPath}". Using best match: "${candidatePath}"`);

  const candidateTry = await listFolderRequest(headers, candidatePath);
  if (!candidateTry.ok) {
    throw new Error(`Dropbox API error [${candidateTry.status}]: ${candidateTry.raw}`);
  }

  return { data: candidateTry.data, resolvedPath: candidatePath };
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

    const { path = '', action = 'list' } = await req.json();

    const rootNamespaceId = await getTeamRootNamespaceId(DROPBOX_ACCESS_TOKEN);
    const dbxHeaders = getDropboxHeaders(DROPBOX_ACCESS_TOKEN, rootNamespaceId);

    if (action === 'list') {
      const { data, resolvedPath } = await resolvePathAndList(dbxHeaders, path || '');
      const entries = (data.entries || []).map((entry: any) => ({
        id: entry.id,
        name: entry.name,
        path: entry.path_display,
        type: entry['.tag'],
        size: entry.size || null,
        modified: entry.client_modified || null,
      }));

      return new Response(JSON.stringify({ entries, has_more: data.has_more, resolved_path: resolvedPath }), {
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
