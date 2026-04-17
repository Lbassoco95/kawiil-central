import {
  ACTIVE_SUPABASE_PUBLISHABLE_KEY,
  ACTIVE_SUPABASE_URL,
  supabase,
} from "@/integrations/supabase/client";

/**
 * Uploads a file to Dropbox via a dedicated edge function.
 * Sends raw binary bytes (no base64) to avoid memory issues.
 */
export async function uploadFileToDropbox(
  file: File,
  uploadPath: string,
): Promise<{ name: string; path: string; url: string }> {
  // Parse scoped path for namespace support
  let actualPath = uploadPath;
  let namespaceId = "";

  if (uploadPath.startsWith("memberns:")) {
    const payload = uploadPath.slice("memberns:".length);
    const sepIdx = payload.indexOf(":");
    if (sepIdx !== -1) {
      namespaceId = payload.slice(0, sepIdx);
      actualPath = payload.slice(sepIdx + 1);
    }
  }

  const anonKey = ACTIVE_SUPABASE_PUBLISHABLE_KEY;

  // Get session token for auth
  const { data: { session } } = await supabase.auth.getSession();
  const authToken = session?.access_token || anonKey;

  const url = `${ACTIVE_SUPABASE_URL}/functions/v1/dropbox-upload`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Authorization": `Bearer ${authToken}`,
      "apikey": anonKey,
      "x-upload-path": encodeURIComponent(actualPath),
      "x-upload-namespace": namespaceId,
    },
    body: file, // Send raw File object - browser streams it efficiently
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(errData.error || `Upload failed: ${response.status}`);
  }

  const data = await response.json();
  if (data?.error) throw new Error(data.error);

  return {
    name: data.name || file.name,
    path: data.path || uploadPath,
    url: data.url || "",
  };
}
