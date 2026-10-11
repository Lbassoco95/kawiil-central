import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": '*',
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TABLES_TO_BACKUP = [
  "organizations",
  "profiles",
  "user_roles",
  "celulas",
  "user_celulas",
  "clients",
  "client_compliance_config",
  "projects",
  "project_members",
  "project_comments",
  "tasks",
  "task_assignees",
  "task_comments",
  "documents",
  "document_types",
  "extracted_documents",
  "extraction_logs",
  "accounting_periods",
  "annual_declarations",
  "compliance_entity_types",
  "compliance_task_templates",
  "tax_obligation_types",
  "activity_log",
  "integrations",
  "catalog_tags",
  "notifications",
  "reminders",
  "expenses",
  "chat_conversations",
  "chat_messages",
  "internal_procedures",
  "procedure_versions",
  "procedure_comments",
  "internal_comunicados",
  "mood_checkins",
  "personalized_phrases",
  "user_preferences",
  "microsoft_tokens",
  "savio_webhook_events",
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // El respaldo usa service_role: solo un admin/gerente autenticado puede
    // dispararlo. (verify_jwt = true en config.toml es la primera barrera;
    // esto valida además el rol.)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);
    const callerClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await callerClient.auth.getUser();
    if (authError || !user) return json({ error: "No autorizado" }, 401);
    const { data: isAdmin } = await supabase.rpc("is_admin_or_manager", { _user_id: user.id });
    if (!isAdmin) return json({ error: "Permisos insuficientes" }, 403);

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    const dateFolder = now.toISOString().split("T")[0];

    const backupData: Record<string, unknown[]> = {};
    const errors: string[] = [];

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

    const backupJson = JSON.stringify(backupData, null, 2);
    const filePath = `${dateFolder}/backup-${timestamp}.json`;

    const { error: uploadError } = await supabase.storage
      .from("backups")
      .upload(filePath, new Blob([backupJson], { type: "application/json" }), {
        contentType: "application/json",
        upsert: false,
      });

    if (uploadError) {
      errors.push(`Storage upload: ${uploadError.message}`);
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

    // Nunca se devuelven los datos por HTTP: el respaldo solo vive en el bucket privado.
    return json(summary, 200);
  } catch (err) {
    console.error("Backup error:", err);
    return json({ error: "Error interno" }, 500);
  }
});
