/**
 * Pestaña Minuta — stub B2 + cableado B4.
 * /juntas/:meetingId/minuta
 */

import { Link, useParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { mtgDb } from "@/lib/mtg/db";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowLeft, Loader2 } from "lucide-react";

export default function JuntaMinuta() {
  const { meetingId } = useParams<{ meetingId: string }>();
  const { user } = useAuth();

  const q = useQuery({
    queryKey: ["mtg-minutes", meetingId],
    enabled: !!user && !!meetingId,
    queryFn: async () => {
      const { data: minutes, error } = await mtgDb
        .from("mtg_minutes")
        .select("*")
        .eq("meeting_id", meetingId!)
        .order("version", { ascending: false });
      if (error) throw error;
      const { data: proposed } = await mtgDb
        .from("mtg_agreements")
        .select("*")
        .eq("meeting_id", meetingId!)
        .eq("status", "proposed");
      return { minutes: minutes ?? [], proposed: proposed ?? [] };
    },
  });

  return (
    <AppLayout>
      <div className="space-y-4 p-2">
        <Button asChild variant="ghost" size="sm">
          <Link to={`/juntas/${meetingId}`}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Tablero
          </Link>
        </Button>
        <h1 className="text-xl font-bold">Minuta</h1>
        {q.isLoading && (
          <div className="flex gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        )}
        {q.data && q.data.minutes.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Aún no hay borrador. Al terminar la junta (y con B4 activo) se encola{" "}
            <code>mtg.generate_minutes</code>. Mientras tanto puedes capturar acuerdos en el tablero.
          </p>
        )}
        {q.data?.minutes.map((m) => (
          <article key={m.id} className="border rounded-md p-4 space-y-2">
            <div className="text-sm text-muted-foreground">
              v{m.version} · {m.status} · {m.generated_by ?? "—"}
            </div>
            <pre className="whitespace-pre-wrap text-sm font-sans">{m.content_md ?? "(vacío)"}</pre>
          </article>
        ))}
        {(q.data?.proposed.length ?? 0) > 0 && (
          <section>
            <h2 className="font-semibold">Acuerdos propuestos (revisión B4)</h2>
            <ul className="text-sm list-disc pl-5">
              {q.data!.proposed.map((a) => (
                <li key={a.id}>{a.text}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </AppLayout>
  );
}
