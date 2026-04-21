import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const OPENAI_URL = "https://api.openai.com/v1/embeddings";
const SUPPORTED_EXTENSIONS = [
  ".pdf",
  ".xml",
  ".txt",
  ".md",
  ".docx",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".csv",
  ".json",
];
const TEXT_EXTENSIONS = [".txt", ".md", ".csv", ".json"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

let _token: string | null = null;
let _tokenExpiry = 0;
let _adminMemberId: string | null = null;
let _rootNamespaceId: string | null = null;

async function getDropboxToken(): Promise<string> {
  if (_token && Date.now() < _tokenExpiry - 60_000) return _token;

  let refreshToken = Deno.env.get("DROPBOX_REFRESH_TOKEN");
  const appKey = Deno.env.get("DROPBOX_APP_KEY");
  const appSecret = Deno.env.get("DROPBOX_APP_SECRET");

  if (!refreshToken || refreshToken.length < 50) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && serviceKey) {
      const sb = createClient(supabaseUrl, serviceKey);
      const { data } = await sb.from("integrations").select("config").eq("provider", "dropbox").eq("is_active", true).single();
      if (data?.config?.refresh_token) refreshToken = data.config.refresh_token;
    }
  }

  if (refreshToken && appKey && appSecret && refreshToken.length > 50) {
    const resp = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${appKey}:${appSecret}`)}`,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    });
    if (resp.ok) {
      const data = await resp.json();
      _token = data.access_token;
      _tokenExpiry = Date.now() + data.expires_in * 1000;
      return _token!;
    }
  }

  const staticToken = Deno.env.get("DROPBOX_ACCESS_TOKEN");
  if (!staticToken) throw new Error("No Dropbox credentials configured");
  return staticToken;
}

async function initTeamContext(token: string): Promise<void> {
  if (_adminMemberId && _rootNamespaceId) return;

  try {
    const membersResp = await fetch("https://api.dropboxapi.com/2/team/members/list_v2", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 50 }),
    });
    if (membersResp.ok) {
      const data = await membersResp.json();
      const members = data?.members || [];
      const admin = members.find((m: any) => m?.role?.[".tag"] === "team_admin");
      _adminMemberId = admin?.profile?.team_member_id || members[0]?.profile?.team_member_id || null;
    }
  } catch (e) {
    console.error("Team members lookup failed:", e);
  }

  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (_adminMemberId) headers["Dropbox-API-Select-Admin"] = _adminMemberId;
    const accResp = await fetch("https://api.dropboxapi.com/2/users/get_current_account", { method: "POST", headers });
    if (accResp.ok) {
      const account = await accResp.json();
      _rootNamespaceId = account?.root_info?.root_namespace_id || null;
    }
  } catch (e) {
    console.error("Root namespace lookup failed:", e);
  }
}

function getTeamHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (_adminMemberId) headers["Dropbox-API-Select-Admin"] = _adminMemberId;
  if (_rootNamespaceId) {
    headers["Dropbox-API-Path-Root"] = JSON.stringify({ ".tag": "root", root: _rootNamespaceId });
  }
  return headers;
}

function getTeamContentHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (_adminMemberId) headers["Dropbox-API-Select-Admin"] = _adminMemberId;
  if (_rootNamespaceId) {
    headers["Dropbox-API-Path-Root"] = JSON.stringify({ ".tag": "root", root: _rootNamespaceId });
  }
  return headers;
}

function getExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx).toLowerCase() : "";
}

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".xml": "application/xml",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx":
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return map[ext] || "application/octet-stream";
}

async function listDropboxFolder(
  token: string,
  path: string,
  recursive = false
): Promise<any[]> {
  const entries: any[] = [];

  const listResp = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers: getTeamHeaders(token),
    body: JSON.stringify({ path: path || "", recursive, limit: 500 }),
  });

  if (!listResp.ok) {
    throw new Error(`Dropbox list_folder failed: ${await listResp.text()}`);
  }

  let data = await listResp.json();
  entries.push(...data.entries);
  let hasMore = data.has_more;
  let cursor = data.cursor;

  while (hasMore && cursor) {
    const contResp = await fetch("https://api.dropboxapi.com/2/files/list_folder/continue", {
      method: "POST",
      headers: getTeamHeaders(token),
      body: JSON.stringify({ cursor }),
    });
    if (!contResp.ok) break;
    data = await contResp.json();
    entries.push(...data.entries);
    hasMore = data.has_more;
    cursor = data.cursor;
  }

  return entries;
}

async function downloadAndExtractText(
  token: string,
  path: string,
  ext: string
): Promise<string | null> {
  const headers = getTeamContentHeaders(token);
  headers["Dropbox-API-Arg"] = JSON.stringify({ path });
  const resp = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers,
  });

  if (!resp.ok) return null;

  if (TEXT_EXTENSIONS.includes(ext)) {
    return await resp.text();
  }

  // For PDFs and binary files, return null (they need process-document with Claude)
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const openaiKey = Deno.env.get("OPENAI_API_KEY");

    const body = await req.json();
    const {
      folder_path,
      organization_id,
      client_id,
      project_id,
      recursive = false,
    } = body;

    if (!organization_id || folder_path === undefined || folder_path === null) {
      return new Response(
        JSON.stringify({ error: "organization_id and folder_path are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = await getDropboxToken();
    await initTeamContext(token);
    console.log(`Indexing Dropbox folder: ${folder_path} (recursive: ${recursive})`);

    const entries = await listDropboxFolder(token, folder_path, recursive);
    const files = entries.filter(
      (e) =>
        e[".tag"] === "file" &&
        SUPPORTED_EXTENSIONS.includes(getExtension(e.name)) &&
        e.size <= MAX_FILE_SIZE
    );

    console.log(`Found ${files.length} indexable files out of ${entries.length} entries`);

    // Check which files are already indexed
    const { data: existingDocs } = await supabase
      .from("documents")
      .select("external_path")
      .eq("organization_id", organization_id)
      .eq("source", "dropbox");

    const alreadyIndexed = new Set(
      existingDocs?.map((d) => d.external_path) || []
    );

    const newFiles = files.filter((f) => !alreadyIndexed.has(f.path_lower));
    console.log(`${newFiles.length} new files to index`);

    let registered = 0;
    let embedded = 0;

    for (const file of newFiles) {
      const ext = getExtension(file.name);
      const mime = getMimeType(ext);

      // Register the document in the documents table
      const { data: doc, error: docErr } = await supabase
        .from("documents")
        .insert({
          organization_id,
          client_id: client_id || null,
          project_id: project_id || null,
          name: file.name,
          source: "dropbox",
          external_id: file.id,
          external_path: file.path_lower,
          file_size: file.size,
          mime_type: mime,
          document_type: ext.replace(".", "").toUpperCase(),
        })
        .select("id")
        .single();

      if (docErr) {
        console.error(`Failed to register ${file.name}:`, docErr.message);
        continue;
      }
      registered++;

      // For text files: extract content and create embeddings directly
      if (TEXT_EXTENSIONS.includes(ext) && openaiKey) {
        const text = await downloadAndExtractText(token, file.path_lower, ext);
        if (text && text.length > 30) {
          // Chunk the text
          const chunks = chunkText(text);
          const BATCH = 25;

          for (let i = 0; i < chunks.length; i += BATCH) {
            const batch = chunks.slice(i, i + BATCH);
            const embResp = await fetch(OPENAI_URL, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${openaiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                input: batch.map((c) => c.replace(/\n+/g, " ").trim()),
                model: "text-embedding-3-small",
                dimensions: 1536,
              }),
            });

            if (embResp.ok) {
              const embData = await embResp.json();
              const rows = batch.map((chunk, idx) => ({
                organization_id,
                document_id: doc.id,
                client_id: client_id || null,
                project_id: project_id || null,
                source_type: "document",
                source_id: doc.id,
                content: `[${file.name}] ${chunk}`,
                metadata: {
                  filename: file.name,
                  dropbox_path: file.path_lower,
                  chunk_index: i + idx,
                },
                embedding: JSON.stringify(embData.data[idx].embedding),
                token_count: Math.ceil(chunk.length / 3.5),
              }));
              await supabase.from("document_chunks").insert(rows);
              embedded += rows.length;
            }
          }
        }
      }

      // For PDFs/binary/office docs: trigger process-document to extract with Claude
      const PROCESS_DOC_MIMES = [
        "application/pdf",
        "application/xml",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ];
      if (!TEXT_EXTENSIONS.includes(ext) && PROCESS_DOC_MIMES.includes(mime)) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        try {
          const procResp = await fetch(`${supabaseUrl}/functions/v1/process-document`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ document_id: doc.id }),
          });
          if (procResp.ok) {
            const procResult = await procResp.json().catch(() => ({}));
            embedded += procResult.chunks_created || 0;
            console.log(`process-document OK for ${file.name}: ${procResult.chunks_created || 0} chunks`);
          } else {
            console.error(`process-document HTTP ${procResp.status} for ${file.name}`);
          }
        } catch (err) {
          console.error(`Trigger process-document failed for ${file.name}:`, err);
        }
      }
    }

    const result = {
      success: true,
      folder_path,
      total_entries: entries.length,
      indexable_files: files.length,
      new_files: newFiles.length,
      registered,
      embedded_chunks: embedded,
      already_indexed: alreadyIndexed.size,
    };

    console.log("index-dropbox result:", result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("index-dropbox error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function chunkText(text: string): string[] {
  const maxChars = 2450; // ~700 tokens
  const overlapChars = 350; // ~100 tokens
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const bp = text.lastIndexOf("\n\n", end);
      const bn = text.lastIndexOf("\n", end);
      const bs = text.lastIndexOf(". ", end);
      if (bp > start + maxChars * 0.3) end = bp + 2;
      else if (bn > start + maxChars * 0.3) end = bn + 1;
      else if (bs > start + maxChars * 0.3) end = bs + 2;
    }
    chunks.push(text.slice(start, end).trim());
    start = end - overlapChars;
    if (start >= text.length) break;
  }
  return chunks.filter((c) => c.length > 20);
}
