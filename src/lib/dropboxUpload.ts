import { supabase } from "@/integrations/supabase/client";

/**
 * Reads a File as base64 and uploads via JSON body to avoid
 * FormData parsing issues in edge functions.
 */
export async function uploadFileToDropbox(
  file: File,
  uploadPath: string,
): Promise<{ name: string; path: string; url: string }> {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  // Convert to base64
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);

  const { data, error } = await supabase.functions.invoke("dropbox-browse", {
    body: {
      action: "upload",
      path: uploadPath,
      file_content: base64,
      file_name: file.name,
    },
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.error);

  return {
    name: data.name || file.name,
    path: data.path || uploadPath,
    url: data.url || "",
  };
}
