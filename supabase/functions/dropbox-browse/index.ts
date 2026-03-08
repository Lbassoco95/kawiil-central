import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Cache the team root namespace ID, admin member ID, and refreshed access token
let cachedRootNamespaceId: string | null = null;
let cachedAdminMemberId: string | null = null;
let cachedAccessToken: string | null = null;
let cachedTokenExpiry: number = 0;

async function getValidAccessToken(): Promise<string> {
  // If we have a cached token that's still valid (with 5 min buffer), use it
  if (cachedAccessToken && Date.now() < cachedTokenExpiry - 300_000) {
    return cachedAccessToken;
  }

  const refreshToken = Deno.env.get('DROPBOX_REFRESH_TOKEN');
  const appKey = Deno.env.get('DROPBOX_APP_KEY');
  const appSecret = Deno.env.get('DROPBOX_APP_SECRET');

  if (!refreshToken || !appKey || !appSecret) {
    // Fallback to static token if refresh credentials aren't configured
    const staticToken = Deno.env.get('DROPBOX_ACCESS_TOKEN');
    if (!staticToken) throw new Error('No Dropbox credentials configured');
    return staticToken;
  }

  console.log('Refreshing Dropbox access token...');
  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${appKey}:${appSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to refresh Dropbox token: ${errText}`);
  }

  const data = await response.json();
  cachedAccessToken = data.access_token;
  cachedTokenExpiry = Date.now() + (data.expires_in * 1000);
  console.log('Dropbox access token refreshed successfully');
  return cachedAccessToken!;
}

async function getTeamAdminMemberId(token: string): Promise<string | null> {
  if (cachedAdminMemberId) return cachedAdminMemberId;

  try {
    const response = await fetch('https://api.dropboxapi.com/2/team/members/list_v2', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ limit: 50 }),
    });

    if (!response.ok) {
      console.error('Failed to list team members:', await response.text());
      return null;
    }

    const data = await response.json();
    const members = data?.members || [];
    // Find a team admin
    const admin = members.find((m: any) => m?.role?.['.tag'] === 'team_admin');
    const memberId = admin?.profile?.team_member_id || members[0]?.profile?.team_member_id;
    if (memberId) {
      cachedAdminMemberId = memberId;
      console.log('Using team admin member ID:', memberId);
    }
    return memberId || null;
  } catch (e) {
    console.error('Error getting team admin:', e);
    return null;
  }
}

async function getTeamRootNamespaceId(token: string, adminMemberId: string | null): Promise<string | null> {
  if (cachedRootNamespaceId) return cachedRootNamespaceId;

  try {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
    };
    if (adminMemberId) {
      headers['Dropbox-API-Select-Admin'] = adminMemberId;
    }

    const response = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
      method: 'POST',
      headers,
    });

    if (!response.ok) {
      console.error('Failed to get account info:', await response.text());
      return null;
    }

    const account = await response.json();
    const rootNsId = account?.root_info?.root_namespace_id;
    if (rootNsId) {
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

function getDropboxHeaders(token: string, rootNamespaceId: string | null, adminMemberId: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (adminMemberId) {
    headers['Dropbox-API-Select-Admin'] = adminMemberId;
  }
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

async function listFolderRequest(
  headers: Record<string, string>,
  options: { path?: string; cursor?: string },
) {
  const isContinue = Boolean(options.cursor);
  const endpoint = isContinue
    ? 'https://api.dropboxapi.com/2/files/list_folder/continue'
    : 'https://api.dropboxapi.com/2/files/list_folder';

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(
      isContinue
        ? { cursor: options.cursor }
        : {
            path: options.path ?? '',
            recursive: false,
            include_media_info: false,
            include_deleted: false,
            limit: 2000,
          },
    ),
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

async function listAllFolderEntries(headers: Record<string, string>, folderPath: string) {
  const entries: any[] = [];
  let cursor: string | null = null;

  do {
    const page = await listFolderRequest(
      headers,
      cursor ? { cursor } : { path: folderPath },
    );

    if (!page.ok) {
      throw new Error(`Dropbox API error [${page.status}]: ${page.raw}`);
    }

    entries.push(...(page.data?.entries || []));
    cursor = page.data?.has_more ? page.data?.cursor ?? null : null;
  } while (cursor);

  return entries;
}

function rankFolderCandidate(entry: any, targetName: string) {
  const name = String(entry.name || '');
  const normalized = normalizeName(name);
  const normalizedWithoutSuffix = normalizeName(name.replace(/\s*\([^)]*\)\s*$/g, ''));

  let score = 0;

  if (normalized === targetName) score = 130;
  else if (normalizedWithoutSuffix === targetName) score = 120;
  else if (normalized.startsWith(targetName)) score = 90;
  else if (normalizedWithoutSuffix.startsWith(targetName)) score = 85;
  else if (normalized.includes(targetName)) score = 75;
  else if (normalizedWithoutSuffix.includes(targetName)) score = 70;

  if (normalized.includes('conflicto') || normalized.includes('solo lectura')) score -= 45;

  return score;
}

function splitPathSegments(path: string): string[] {
  return (path || '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function buildPathFromSegments(segments: string[]): string {
  return segments.length > 0 ? `/${segments.join('/')}` : '';
}

async function findBestFolderMatchInPath(
  headers: Record<string, string>,
  parentPath: string,
  targetSegment: string,
) {
  const targetName = normalizeName(targetSegment);
  const entries = await listAllFolderEntries(headers, parentPath);
  const folders = entries.filter((entry: any) => entry['.tag'] === 'folder');

  const ranked = folders
    .map((entry: any) => ({ entry, score: rankFolderCandidate(entry, targetName) }))
    .filter((item: any) => item.score > 0)
    .sort((a: any, b: any) => b.score - a.score);

  return ranked[0]?.entry ?? null;
}

async function resolveFolderPathBySegments(headers: Record<string, string>, requestedPath: string) {
  const segments = splitPathSegments(requestedPath);
  if (segments.length === 0) return '';

  let currentPath = '';

  for (const segment of segments) {
    const candidate = await findBestFolderMatchInPath(headers, currentPath, segment);
    if (!candidate) return currentPath || null;

    const candidatePath =
      candidate.path_display ||
      buildPathFromSegments([...splitPathSegments(currentPath), String(candidate.name || '')]);

    currentPath = candidatePath;
  }

  return currentPath;
}

async function resolvePathAndList(headers: Record<string, string>, requestedPath: string) {
  const normalizedRequestedPath = buildPathFromSegments(splitPathSegments(requestedPath));
  const firstTry = await listFolderRequest(headers, { path: normalizedRequestedPath });
  if (firstTry.ok) {
    return { data: firstTry.data, resolvedPath: normalizedRequestedPath };
  }

  const isNotFound = firstTry.status === 409 && (firstTry.raw || '').includes('path/not_found');
  if (!isNotFound || !normalizedRequestedPath) {
    throw new Error(`Dropbox API error [${firstTry.status}]: ${firstTry.raw}`);
  }

  const segmentResolvedPath = await resolveFolderPathBySegments(headers, normalizedRequestedPath);
  if (segmentResolvedPath) {
    const segmentTry = await listFolderRequest(headers, { path: segmentResolvedPath });
    if (segmentTry.ok) {
      if (segmentResolvedPath !== normalizedRequestedPath) {
        console.log(`Path not found for "${normalizedRequestedPath}". Resolved by segments to: "${segmentResolvedPath}"`);
      }
      return { data: segmentTry.data, resolvedPath: segmentResolvedPath };
    }
  }

  const targetName = normalizeName(splitPathSegments(normalizedRequestedPath).pop() || normalizedRequestedPath);
  const rootEntries = await listAllFolderEntries(headers, '');
  const folders = rootEntries.filter((entry: any) => entry['.tag'] === 'folder');

  const ranked = folders
    .map((entry: any) => ({ entry, score: rankFolderCandidate(entry, targetName) }))
    .filter((item: any) => item.score > 0)
    .sort((a: any, b: any) => b.score - a.score);

  if (ranked.length === 0) {
    throw new Error(`Dropbox API error [${firstTry.status}]: ${firstTry.raw}`);
  }

  const candidate = ranked[0].entry;
  const candidatePath = candidate.path_display || `/${candidate.name}`;
  console.log(`Path not found for "${normalizedRequestedPath}". Using best root match: "${candidatePath}"`);

  const candidateTry = await listFolderRequest(headers, { path: candidatePath });
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

    const body = await req.json();
    const { path = '', action = 'list', file_content, file_name } = body;

    const adminMemberId = await getTeamAdminMemberId(DROPBOX_ACCESS_TOKEN);
    const rootNamespaceId = await getTeamRootNamespaceId(DROPBOX_ACCESS_TOKEN, adminMemberId);
    const dbxHeaders = getDropboxHeaders(DROPBOX_ACCESS_TOKEN, rootNamespaceId, adminMemberId);

    if (action === 'list') {
      // When browsing root, default to the shared team folder "Kawiil Mx"
      // to prevent users from seeing other members' personal folders
      const browsePath = (!path || path === '' || path === '/') ? '/Kawiil Mx' : path;
      const { data, resolvedPath } = await resolvePathAndList(dbxHeaders, browsePath);
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

    if (action === 'upload') {
      if (!file_content || !path) {
        throw new Error('file_content and path are required for upload');
      }

      const fileBytes = Uint8Array.from(atob(file_content), (c) => c.charCodeAt(0));

      const uploadHeaders: Record<string, string> = {
        'Authorization': `Bearer ${DROPBOX_ACCESS_TOKEN}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path,
          mode: 'add',
          autorename: true,
          mute: false,
        }),
      };

      if (adminMemberId) {
        uploadHeaders['Dropbox-API-Select-Admin'] = adminMemberId;
      }

      if (rootNamespaceId) {
        uploadHeaders['Dropbox-API-Path-Root'] = JSON.stringify({
          '.tag': 'root',
          root: rootNamespaceId,
        });
      }

      const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: uploadHeaders,
        body: fileBytes,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Dropbox upload error [${response.status}]: ${errText}`);
      }

      const result = await response.json();
      const uploadedPath = result.path_display || path;

      // Get a shared link for the uploaded file
      let shareUrl = '';
      try {
        const linkRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
          method: 'POST',
          headers: dbxHeaders,
          body: JSON.stringify({ path: uploadedPath }),
        });
        if (linkRes.ok) {
          const linkData = await linkRes.json();
          shareUrl = linkData.url;
        } else {
          const linkErr = await linkRes.json();
          if (linkErr?.error?.['.tag'] === 'shared_link_already_exists') {
            const listRes = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
              method: 'POST',
              headers: dbxHeaders,
              body: JSON.stringify({ path: uploadedPath, direct_only: true }),
            });
            if (listRes.ok) {
              const listData = await listRes.json();
              if (listData.links?.length > 0) shareUrl = listData.links[0].url;
            }
          }
        }
      } catch (linkError) {
        console.error('Error getting share link after upload:', linkError);
      }

      return new Response(JSON.stringify({ success: true, name: result.name, path: uploadedPath, url: shareUrl }), {
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

    if (action === 'create_folder') {
      const folderPath = body.folder_path || path;
      if (!folderPath) {
        throw new Error('folder_path or path is required for create_folder');
      }

      const response = await fetch('https://api.dropboxapi.com/2/files/create_folder_v2', {
        method: 'POST',
        headers: dbxHeaders,
        body: JSON.stringify({ path: folderPath, autorename: false }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Dropbox create_folder error [${response.status}]: ${errText}`);
      }

      const result = await response.json();
      const metadata = result.metadata || {};

      return new Response(JSON.stringify({
        success: true,
        name: metadata.name,
        path: metadata.path_display || folderPath,
      }), {
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
