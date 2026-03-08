import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TABLES_TO_BACKUP = [
  "clients",
  "projects",
  "tasks",
  "documents",
  "profiles",
  "accounting_periods",
  "annual_declarations",
  "task_comments",
  "task_assignees",
  "project_members",
  "user_roles",
  "celulas",
  "catalog_tags",
  "activity_log",
  "integrations",
  "client_compliance_config",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    const dateFolder = now.toISOString().split("T")[0];

    const backupData: Record<string, unknown[]> = {};
    const errors: string[] = [];

    // Export each table
    for (const table of TABLES_TO_BACKUP) {
      let allRows: unknown[] = [];
      let from = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from(table)
          .select("*")
          .range(from, from + pageSize - 1);

        if (error) {
          errors.push(`${table}: ${error.message}`);
          hasMore = false;
        } else {
          allRows = allRows.concat(data || []);
          hasMore = (data?.length || 0) === pageSize;
          from += pageSize;
        }
      }

      backupData[table] = allRows;
    }

    // Create a single JSON backup file
    const backupJson = JSON.stringify(backupData, null, 2);
    const filePath = `${dateFolder}/backup-${timestamp}.json`;

    const { error: uploadError } = await supabase.storage
      .from("backups")
      .upload(filePath, new Blob([backupJson], { type: "application/json" }), {
        contentType: "application/json",
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    // Clean up old backups (keep last 7 days)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const { data: folders } = await supabase.storage.from("backups").list("", {
      limit: 100,
      sortBy: { column: "name", order: "asc" },
    });

    if (folders) {
      for (const folder of folders) {
        if (folder.name < sevenDaysAgo.toISOString().split("T")[0]) {
          const { data: files } = await supabase.storage
            .from("backups")
            .list(folder.name);
          if (files && files.length > 0) {
            const filePaths = files.map((f) => `${folder.name}/${f.name}`);
            await supabase.storage.from("backups").remove(filePaths);
          }
        }
      }
    }

    const summary = {
      timestamp: now.toISOString(),
      file: filePath,
      tables: Object.fromEntries(
        Object.entries(backupData).map(([k, v]) => [k, v.length])
      ),
      errors: errors.length > 0 ? errors : undefined,
      size_bytes: new Blob([backupJson]).size,
    };

    console.log("Backup completed:", JSON.stringify(summary));

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Backup error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
