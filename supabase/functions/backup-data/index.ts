/**
 * backup-data — respaldo de tablas de central al bucket privado `backups`.
 * La lógica (credencial, qué se respalda, qué se responde) vive en handler.ts;
 * aquí solo se conecta con Supabase. Ver docs/seguridad/backup-data.md.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleBackup } from "./handler.ts";

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    return await handleBackup(req, {
      cronSecret: Deno.env.get("BACKUP_CRON_SECRET"),
      organizationId: Deno.env.get("BACKUP_ORGANIZATION_ID"),
      async verifyJwt(token) {
        const { data, error } = await admin.auth.getUser(token);
        return error || !data?.user ? null : { id: data.user.id };
      },
      async staffInfo(userId) {
        const [{ data: profile }, { data: role }] = await Promise.all([
          admin.from("profiles").select("organization_id").eq("user_id", userId).maybeSingle(),
          admin.from("user_roles").select("role").eq("user_id", userId).eq("role", "transformador").maybeSingle(),
        ]);
        return { organizationId: (profile?.organization_id as string | undefined) ?? null, isG4: !!role };
      },
      async readTable(table, from, to) {
        const { data, error } = await admin.from(table).select("*").range(from, to);
        return error ? { rows: [], error: error.message } : { rows: data ?? [] };
      },
      async upload(path, body) {
        const { error } = await admin.storage.from("backups")
          .upload(path, new Blob([body], { type: "application/json" }), { contentType: "application/json", upsert: false });
        return error ? error.message : null;
      },
      async log(entry) {
        console.log("backup-data:", JSON.stringify({ outcome: entry.outcome, reason: entry.reason, via: entry.via }));
      },
    });
  } catch (err) {
    console.error("Backup error:", err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ error: "interno" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
