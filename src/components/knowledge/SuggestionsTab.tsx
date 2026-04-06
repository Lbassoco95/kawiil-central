import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Lightbulb, Check, X } from "lucide-react";
import { toast } from "sonner";

type SuggestionRow = {
  id: string;
  suggestion_text: string;
  category: string;
  summary: Record<string, unknown> | null;
  status: string;
  created_at: string;
  user_id: string;
};

export function SuggestionsTab() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["improvement-suggestions", user?.id, statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("improvement_suggestions")
        .select("id, suggestion_text, category, summary, status, created_at, user_id")
        .order("created_at", { ascending: false });
      if (statusFilter !== "all") {
        q = q.eq("status", statusFilter);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as SuggestionRow[];
    },
    enabled: !!user,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("improvement_suggestions").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["improvement-suggestions"] });
      toast.success("Estado actualizado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          Sugerencias detectadas automáticamente en el chat (mejoras al producto).
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pending">Pendientes</SelectItem>
            <SelectItem value="reviewed">Revisadas</SelectItem>
            <SelectItem value="dismissed">Descartadas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : !rows.length ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No hay sugerencias en este filtro.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <CardTitle className="text-sm font-medium leading-snug">{r.suggestion_text}</CardTitle>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline">{r.category}</Badge>
                    <Badge
                      variant={r.status === "pending" ? "default" : "secondary"}
                      className="capitalize"
                    >
                      {r.status}
                    </Badge>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleString("es-MX")} ·{" "}
                  {r.user_id === user?.id ? "Tú" : "Usuario"}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {r.summary && typeof (r.summary as { text?: string }).text === "string" && (
                  <p className="text-xs text-muted-foreground italic">
                    {(r.summary as { text: string }).text}
                  </p>
                )}
                {r.status === "pending" && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      disabled={updateStatus.isPending}
                      onClick={() => updateStatus.mutate({ id: r.id, status: "reviewed" })}
                    >
                      <Check className="h-3.5 w-3.5" /> Revisada
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1 text-muted-foreground"
                      disabled={updateStatus.isPending}
                      onClick={() => updateStatus.mutate({ id: r.id, status: "dismissed" })}
                    >
                      <X className="h-3.5 w-3.5" /> Descartar
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
