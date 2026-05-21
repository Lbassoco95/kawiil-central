import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type TabId = "tasks" | "ai";

interface Props {
  channelId?: string;
  channelName?: string;
  unreadMentions?: number;
  onOpenActivity?: () => void;
}

export function KawiilContextPanel({
  channelId,
  channelName,
  unreadMentions = 0,
  onOpenActivity,
}: Props) {
  const [tab, setTab] = useState<TabId>("tasks");
  const { user } = useAuth();

  // Tareas pendientes del usuario
  const tasksQuery = useQuery({
    queryKey: ["context-panel-tasks", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, title, due_date, priority, status")
        .eq("assigned_to", user!.id)
        .in("status", ["pending", "in_progress"])
        .order("due_date", { ascending: true })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const tasks = tasksQuery.data ?? [];

  return (
    <div className="slack-context">
      {/* Cabecera */}
      <div className="sl-ctx-head">
        <span className="sl-ctx-head-title">Kawiil</span>
        <span
          className="sl-ctx-head-badge"
          style={{ cursor: "pointer" }}
          onClick={onOpenActivity}
        >
          {unreadMentions > 0 ? `${unreadMentions > 9 ? "9+" : unreadMentions} nueva${unreadMentions === 1 ? "" : "s"}` : "Centro"}
        </span>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12, borderBottom: "1px solid hsl(var(--border))", paddingBottom: 8 }}>
        <button
          onClick={() => setTab("tasks")}
          style={{
            background: tab === "tasks" ? "hsl(var(--primary))" : "transparent",
            color: tab === "tasks" ? "#fff" : "hsl(var(--muted-foreground))",
            border: 0,
            borderRadius: 6,
            padding: "3px 10px",
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          Tareas
        </button>
        <button
          onClick={() => setTab("ai")}
          style={{
            background: tab === "ai" ? "hsl(var(--primary))" : "transparent",
            color: tab === "ai" ? "#fff" : "hsl(var(--muted-foreground))",
            border: 0,
            borderRadius: 6,
            padding: "3px 10px",
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          IA
        </button>
      </div>

      {/* ── TAREAS ── */}
      {tab === "tasks" && (
        <div>
          {/* Sección tareas pendientes */}
          <div className="sl-ctx-card">
            <div className="sl-ctx-card-head">
              <div className="sl-ctx-card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                </svg>
                Tareas pendientes
              </div>
              <span className="sl-ctx-card-link">Ver todas</span>
            </div>

            {tasksQuery.isLoading && (
              <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>Cargando…</p>
            )}

            {!tasksQuery.isLoading && tasks.length === 0 && (
              <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", textAlign: "center", padding: "12px 0" }}>
                Sin tareas pendientes ✓
              </p>
            )}

            {tasks.map((t) => (
              <div
                key={t.id}
                className={`sl-ctx-task${t.priority === "urgent" ? " urgent" : ""}`}
              >
                <div className="sl-ctx-task-check" />
                <div className="sl-ctx-task-body">
                  <div className="sl-ctx-task-title">{t.title}</div>
                  <div className="sl-ctx-task-meta">
                    {t.due_date && (
                      <span className="due">
                        {new Date(t.due_date).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: "1px 5px",
                        borderRadius: 3,
                        letterSpacing: "0.04em",
                        background:
                          t.priority === "urgent" ? "hsl(var(--priority-urgent) / 0.12)"
                          : t.priority === "high" ? "hsl(var(--priority-high) / 0.12)"
                          : t.priority === "medium" ? "hsl(var(--priority-medium) / 0.12)"
                          : "hsl(var(--priority-low) / 0.12)",
                        color:
                          t.priority === "urgent" ? "hsl(var(--priority-urgent))"
                          : t.priority === "high" ? "hsl(var(--priority-high))"
                          : t.priority === "medium" ? "hsl(24 96% 40%)"
                          : "hsl(var(--priority-low))",
                      }}
                    >
                      {t.priority === "urgent" ? "Urgente"
                        : t.priority === "high" ? "Alta"
                        : t.priority === "medium" ? "Media"
                        : "Baja"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Acceso a actividad */}
          {onOpenActivity && (
            <div className="sl-ctx-card">
              <div className="sl-ctx-card-head">
                <div className="sl-ctx-card-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                  </svg>
                  Menciones y actividad
                </div>
                {unreadMentions > 0 && (
                  <span style={{
                    background: "hsl(var(--primary))",
                    color: "#fff",
                    fontSize: 9,
                    fontWeight: 800,
                    padding: "2px 7px",
                    borderRadius: 9999,
                  }}>
                    {unreadMentions}
                  </span>
                )}
              </div>
              <button
                onClick={onOpenActivity}
                style={{
                  width: "100%",
                  background: "transparent",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  padding: "6px 10px",
                  fontSize: 12,
                  cursor: "pointer",
                  color: "hsl(var(--primary))",
                  fontWeight: 600,
                  textAlign: "left",
                }}
              >
                Ver toda la actividad →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── IA ── */}
      {tab === "ai" && (
        <div className="sl-ctx-card">
          <div className="sl-ctx-card-head">
            <div className="sl-ctx-card-title" style={{ color: "hsl(var(--primary))" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/>
                <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/>
              </svg>
              Kawiil IA
            </div>
          </div>

          <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginBottom: 10 }}>
            Asistente del canal {channelName ? `#${channelName}` : ""}
          </p>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {["Resumir canal", "Pendientes del día", "Buscar mensajes"].map((chip) => (
              <button
                key={chip}
                className="sl-ai-chip"
                style={{ fontSize: 11 }}
              >
                {chip}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              placeholder="Pregunta sobre este canal…"
              style={{
                flex: 1,
                background: "hsl(var(--muted))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                padding: "6px 10px",
                fontSize: 12,
                color: "hsl(var(--foreground))",
                outline: "none",
              }}
            />
            <button
              style={{
                background: "hsl(var(--primary))",
                color: "#fff",
                border: 0,
                borderRadius: 8,
                padding: "6px 10px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
