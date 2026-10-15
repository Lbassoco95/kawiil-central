import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatMX } from "@/lib/dateUtils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Database } from "@/integrations/supabase/types";

type LawsuitRow = Database["public"]["Tables"]["project_lawsuits"]["Row"];
type MessageRow = Database["public"]["Tables"]["lawsuit_client_messages"]["Row"];

/** Conversación con el cliente sobre este juicio/trámite (el cliente la ve y responde en su portal). */
export function LawsuitClientMessagesPanel({ lawsuit }: { lawsuit: LawsuitRow }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const queryKey = ["lawsuit-client-messages", lawsuit.id];

  const { data: messages = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lawsuit_client_messages")
        .select("*")
        .eq("lawsuit_id", lawsuit.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as MessageRow[];
    },
    refetchInterval: 30_000,
  });

  // Al abrir la conversación, los mensajes del cliente quedan como leídos.
  const unreadKey = messages
    .filter((m) => m.sender === "client" && !m.read_by_team_at)
    .map((m) => m.id)
    .join(",");
  useEffect(() => {
    if (!unreadKey) return;
    void supabase
      .from("lawsuit_client_messages")
      .update({ read_by_team_at: new Date().toISOString() })
      .in("id", unreadKey.split(","))
      .then(() => queryClient.invalidateQueries({ queryKey: ["lawsuit-client-unread", lawsuit.id] }));
  }, [unreadKey, lawsuit.id, queryClient]);

  const send = useMutation({
    mutationFn: async () => {
      const { data: profile } = await supabase.from("profiles").select("full_name").eq("user_id", user!.id).single();
      const { error } = await supabase.from("lawsuit_client_messages").insert({
        lawsuit_id: lawsuit.id,
        organization_id: lawsuit.organization_id,
        sender: "team",
        author_name: profile?.full_name ?? null,
        content: draft.trim(),
        created_by: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (e: Error) => toast.error("No se pudo enviar: " + e.message),
  });

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-medium text-muted-foreground">Mensajes con el cliente</h4>
      {!lawsuit.client_visible && (
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          Este asunto no está visible para el cliente: no podrá ver ni enviar mensajes hasta que lo publiques.
        </p>
      )}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : messages.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-3">Aún no hay mensajes.</p>
      ) : (
        <ul className="space-y-2">
          {messages.map((m) => (
            <li
              key={m.id}
              className={`max-w-[85%] rounded-lg border p-3 ${
                m.sender === "team" ? "ml-auto bg-primary/5" : "bg-amber-500/5 border-amber-500/30"
              }`}
            >
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                {m.sender === "team" ? m.author_name || "Equipo" : `Cliente${m.author_name ? ` · ${m.author_name}` : ""}`}
                {" · "}
                {formatMX(m.created_at, "dd MMM yyyy HH:mm")}
              </p>
              <p className="whitespace-pre-wrap text-sm">{m.content}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2">
        <Textarea
          rows={3}
          maxLength={2000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Escribe una actualización o respuesta para el cliente…"
        />
        <Button size="sm" onClick={() => send.mutate()} disabled={!draft.trim() || send.isPending}>
          <Send className="h-4 w-4 mr-1" /> Enviar al cliente
        </Button>
      </div>
    </div>
  );
}
