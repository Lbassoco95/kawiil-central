import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { invokeSlackApi, type SlackConversation } from "@/lib/slackApi";
import { useSlackUserProfiles, type SlackUserProfile } from "@/hooks/useSlackUserProfiles";

type TabId = "tasks" | "ai";

interface Props {
  channelId?: string;
  channelName?: string;
  currentConv?: SlackConversation | null;
  userMap?: Record<string, SlackUserProfile | undefined>;
  unreadMentions?: number;
  onOpenActivity?: () => void;
}

// ─── Avatar helper ────────────────────────────────────────────
const AV_COLORS = [
  "#5865F2","#57F287","#FEE75C","#EB459E","#ED4245",
  "#7289DA","#43B581","#FAA61A","#F47FFF","#1abc9c",
];
function avColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}
function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase() || "??";
}
function MemberAvatar({ uid, profile, size = 32 }: { uid: string; profile?: SlackUserProfile; size?: number }) {
  const name = profile?.display_name || profile?.real_name || uid;
  const bg = avColor(uid);
  return (
    <div
      title={name}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: profile?.avatar_url ? "transparent" : bg,
        flexShrink: 0,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.38,
        fontWeight: 700,
        color: "#fff",
        border: "2px solid hsl(var(--background))",
      }}
    >
      {profile?.avatar_url
        ? <img src={profile.avatar_url} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        : initials(name)}
    </div>
  );
}

export function KawiilContextPanel({
  channelId,
  channelName,
  currentConv,
  userMap = {},
  unreadMentions = 0,
  onOpenActivity,
}: Props) {
  const [tab, setTab] = useState<TabId>("tasks");
  const { user } = useAuth();

  // Retrasa la carga de miembros 3s para no competir con conversations.history
  const [membersChannelId, setMembersChannelId] = useState<string | undefined>();
  useEffect(() => {
    if (!channelId) { setMembersChannelId(undefined); return; }
    const t = setTimeout(() => setMembersChannelId(channelId), 3_000);
    return () => clearTimeout(t);
  }, [channelId]);

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

  // Miembros del canal — carga diferida 3s para no bloquear el historial
  const membersQuery = useQuery({
    queryKey: ["slack-chan-members", membersChannelId],
    queryFn: async () => {
      const d = await invokeSlackApi<{ ok: boolean; members: string[] }>(
        { action: "conversations.members", channel: membersChannelId },
      );
      return d.ok ? d.members : [];
    },
    enabled: !!membersChannelId,
    staleTime: 5 * 60_000,
  });
  const memberIds = (membersQuery.data ?? []).slice(0, 50);

  // Perfiles de miembros (cae en el userMap global si ya se cargaron)
  const memberProfilesQuery = useSlackUserProfiles(memberIds);
  const memberProfiles = { ...userMap, ...(memberProfilesQuery.data ?? {}) };

  const tasks = tasksQuery.data ?? [];

  // ─── Mensajes programados de este canal (previsualización + cancelar) ──
  const qc = useQueryClient();
  const scheduledQuery = useQuery({
    queryKey: ["slack-scheduled-messages", channelId],
    queryFn: async () => {
      const d = await invokeSlackApi<{
        ok: boolean;
        scheduled_messages?: Array<{ id: string; channel: string; post_at: number; text?: string }>;
      }>({ action: "chat.scheduledMessages.list", channel: channelId }, { timeoutMs: 20_000 });
      return d.ok ? (d.scheduled_messages ?? []) : [];
    },
    enabled: !!channelId,
    staleTime: 30_000,
  });
  const scheduled = [...(scheduledQuery.data ?? [])].sort((a, b) => a.post_at - b.post_at);

  const cancelScheduled = useMutation({
    mutationFn: async (m: { id: string; channel: string }) => {
      const d = await invokeSlackApi<{ ok: boolean; error?: string }>(
        { action: "chat.deleteScheduledMessage", channel: m.channel, scheduled_message_id: m.id },
        { timeoutMs: 20_000 },
      );
      if (!d.ok) throw new Error(d.error || "No se pudo cancelar");
    },
    onSuccess: () => {
      toast.success("Mensaje programado cancelado");
      void qc.invalidateQueries({ queryKey: ["slack-scheduled-messages", channelId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo cancelar"),
  });

  const fmtWhen = (postAt: number) =>
    new Date(postAt * 1000).toLocaleString("es-MX", {
      weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });

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
          {/* Mensajes programados de este canal (previsualización) */}
          {scheduled.length > 0 && (
            <div className="sl-ctx-card">
              <div className="sl-ctx-card-head">
                <div className="sl-ctx-card-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                  Mensajes programados
                </div>
                <span className="sl-ctx-card-link">{scheduled.length}</span>
              </div>
              {scheduled.map((m) => (
                <div
                  key={m.id}
                  style={{
                    border: "1px solid hsl(var(--border))", borderRadius: 8,
                    padding: "8px 10px", marginTop: 6, background: "hsl(var(--muted) / 0.3)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "hsl(var(--primary))" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                    </svg>
                    Se enviará {fmtWhen(m.post_at)}
                  </div>
                  <div style={{
                    fontSize: 13, color: "hsl(var(--foreground))", marginTop: 4,
                    display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical",
                    overflow: "hidden", whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>
                    {m.text || "(sin texto)"}
                  </div>
                  <button
                    type="button"
                    disabled={cancelScheduled.isPending}
                    onClick={() => cancelScheduled.mutate({ id: m.id, channel: m.channel })}
                    style={{
                      marginTop: 6, fontSize: 11, fontWeight: 600, color: "hsl(var(--destructive))",
                      background: "transparent", border: "1px solid hsl(var(--destructive) / 0.35)",
                      borderRadius: 6, padding: "2px 8px", cursor: "pointer",
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              ))}
            </div>
          )}

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

          {/* Info del canal actual */}
          {currentConv && (
            <div className="sl-ctx-card" style={{ marginTop: 8 }}>
              <div className="sl-ctx-card-head">
                <div className="sl-ctx-card-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                  Este canal
                </div>
              </div>

              {/* DM individual */}
              {currentConv.is_im && currentConv.user && (() => {
                const p = memberProfiles[currentConv.user];
                const name = p?.display_name || p?.real_name || channelName || currentConv.user;
                return (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "8px 0 4px" }}>
                    <MemberAvatar uid={currentConv.user} profile={p} size={48} />
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--foreground))" }}>{name}</div>
                      <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>Mensaje directo</div>
                    </div>
                  </div>
                );
              })()}

              {/* Grupo MPIM */}
              {currentConv.is_mpim && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
                  {memberIds.length > 0 ? (
                    <>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {memberIds.slice(0, 6).map((uid) => (
                          <MemberAvatar key={uid} uid={uid} profile={memberProfiles[uid]} size={30} />
                        ))}
                        {memberIds.length > 6 && (
                          <div style={{
                            width: 30, height: 30, borderRadius: "50%",
                            background: "hsl(var(--muted))",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))",
                            border: "2px solid hsl(var(--background))",
                          }}>
                            +{memberIds.length - 6}
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {memberIds.slice(0, 4).map((uid) => {
                          const p = memberProfiles[uid];
                          const n = p?.display_name || p?.real_name;
                          return n ? (
                            <span key={uid} style={{
                              fontSize: 10, background: "hsl(var(--muted))",
                              color: "hsl(var(--foreground))", padding: "1px 7px",
                              borderRadius: 9999, fontWeight: 500,
                            }}>
                              {n.split(" ")[0]}
                            </span>
                          ) : null;
                        })}
                        {memberIds.length > 4 && (
                          <span style={{
                            fontSize: 10, color: "hsl(var(--muted-foreground))",
                            padding: "1px 5px", alignSelf: "center",
                          }}>
                            y {memberIds.length - 4} más
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 9999, background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                        Grupo
                      </span>
                      {(currentConv as any).num_members != null && (
                        <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 9999, background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                          {(currentConv as any).num_members} miembros
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Canal público/privado */}
              {!currentConv.is_im && !currentConv.is_mpim && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, color: "hsl(var(--foreground))" }}>
                    <span style={{ fontSize: 16 }}>
                      {currentConv.is_private ? "🔒" : "#"}
                    </span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {channelName}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 9999,
                      background: currentConv.is_private
                        ? "hsl(239 84% 67% / 0.12)"
                        : "hsl(142 71% 45% / 0.12)",
                      color: currentConv.is_private
                        ? "hsl(239 84% 72%)"
                        : "hsl(142 71% 35%)",
                    }}>
                      {currentConv.is_private ? "Privado" : "Público"}
                    </span>
                    {(currentConv as any).num_members != null && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 9999,
                        background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))",
                        display: "flex", alignItems: "center", gap: 4,
                      }}>
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                        </svg>
                        {(currentConv as any).num_members} miembros
                      </span>
                    )}
                  </div>

                  {(currentConv as any).topic?.value && (
                    <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", lineHeight: 1.4, margin: 0, borderLeft: "2px solid hsl(var(--border))", paddingLeft: 6 }}>
                      {(currentConv as any).topic.value}
                    </p>
                  )}
                  {!(currentConv as any).topic?.value && (currentConv as any).purpose?.value && (
                    <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", lineHeight: 1.4, margin: 0, borderLeft: "2px solid hsl(var(--border))", paddingLeft: 6 }}>
                      {(currentConv as any).purpose.value}
                    </p>
                  )}

                  {/* Lista de participantes */}
                  {membersQuery.isLoading && !membersQuery.data && (
                    <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", margin: 0 }}>Cargando participantes…</p>
                  )}
                  {memberIds.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", marginBottom: 2 }}>
                        Participantes
                      </div>
                      {memberIds.map((uid) => {
                        const p = memberProfiles[uid];
                        const name = p?.display_name || p?.real_name || uid;
                        return (
                          <div key={uid} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <MemberAvatar uid={uid} profile={p} size={26} />
                            <span style={{ fontSize: 12, color: "hsl(var(--foreground))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                              {name}
                            </span>
                          </div>
                        );
                      })}
                      {memberIds.length > 20 && (
                        <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
                          y {memberIds.length - 20} más…
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

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
