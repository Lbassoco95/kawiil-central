import { cn } from "@/lib/utils";
import { useMailFolders, useUnreadEmailCount, useOutlookEmails } from "@/hooks/useMicrosoft";
import { inferEmailChips } from "@/lib/emailChips";
import { useMemo } from "react";

export type MailTabId = "inbox" | "starred" | "clientes" | "sat" | "facturas" | "interno" | "sentItems" | "drafts";

interface Props {
  activeTab: MailTabId;
  onSelectTab: (tab: MailTabId) => void;
}

const CHIP_DOTS: Partial<Record<MailTabId, string>> = {
  clientes: "hsl(210 100% 47%)",
  sat: "hsl(0 72% 51%)",
  facturas: "hsl(32 90% 48%)",
  interno: "hsl(157 72% 36%)",
};

export function MailTabs({ activeTab, onSelectTab }: Props) {
  const { data: inboxUnread = 0 } = useUnreadEmailCount();
  const { data: foldersData } = useMailFolders();

  // Get email counts from mail folders data
  const folderCounts = useMemo(() => {
    const folders = (foldersData?.folders ?? []) as any[];
    const counts: Record<string, number> = {};
    for (const f of folders) {
      counts[f.id] = f.unreadItemCount ?? 0;
      if (f.wellKnownName) counts[f.wellKnownName] = f.unreadItemCount ?? 0;
    }
    return counts;
  }, [foldersData]);

  // Load inbox emails to count AI-inferred categories
  const { data: inboxData } = useOutlookEmails("inbox");
  const inboxEmails = useMemo(
    () => (inboxData?.pages ?? []).flatMap((p) => p.emails as any[]),
    [inboxData]
  );

  const aiCounts = useMemo(() => {
    const counts = { clientes: 0, sat: 0, facturas: 0, interno: 0 };
    for (const email of inboxEmails) {
      const chips = inferEmailChips({
        from: email.from,
        subject: email.subject,
        importance: email.importance,
      });
      for (const chip of chips) {
        if (chip.tone === "cliente") counts.clientes++;
        if (chip.tone === "sat") counts.sat++;
        if (chip.tone === "factura") counts.facturas++;
        if (chip.tone === "interno") counts.interno++;
      }
    }
    return counts;
  }, [inboxEmails]);

  const TABS: { id: MailTabId; label: string }[] = [
    { id: "inbox", label: "Bandeja" },
    { id: "starred", label: "Destacados" },
    { id: "clientes", label: "Clientes" },
    { id: "sat", label: "SAT" },
    { id: "facturas", label: "Facturas" },
    { id: "interno", label: "Interno" },
    { id: "sentItems", label: "Enviados" },
    { id: "drafts", label: "Borradores" },
  ];

  const getCount = (id: MailTabId) => {
    if (id === "inbox") return inboxUnread > 0 ? inboxUnread : null;
    if (id === "clientes") return aiCounts.clientes > 0 ? aiCounts.clientes : null;
    if (id === "sat") return aiCounts.sat > 0 ? aiCounts.sat : null;
    if (id === "facturas") return aiCounts.facturas > 0 ? aiCounts.facturas : null;
    if (id === "interno") return aiCounts.interno > 0 ? aiCounts.interno : null;
    return null;
  };

  return (
    <div className="flex items-end overflow-x-auto scrollbar-none shrink-0 border-b border-border/50 bg-card/80 backdrop-blur-sm">
      {TABS.map((tab) => {
        const count = getCount(tab.id);
        const dot = CHIP_DOTS[tab.id];
        return (
          <button
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 h-11 px-3.5 text-[12.5px] font-medium border-b-2 whitespace-nowrap transition-colors shrink-0",
              activeTab === tab.id
                ? "text-foreground border-b-foreground font-semibold"
                : "text-muted-foreground border-b-transparent hover:text-foreground"
            )}
          >
            {dot && (
              <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: dot }} />
            )}
            {tab.label}
            {count != null && (
              <span className={cn(
                "text-[11px] font-medium",
                activeTab === tab.id ? "text-muted-foreground" : "text-muted-foreground/70"
              )}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
