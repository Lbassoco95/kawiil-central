import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Plus, Filter, Loader2 } from "lucide-react";
import { useListMailRules } from "@/hooks/useMicrosoft";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders?: { id: string; displayName: string }[];
  onNewRule: () => void;
}

export function MailRulesSheet({ open, onOpenChange, onNewRule }: Props) {
  const { data: rules = [], isLoading } = useListMailRules();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[320px] p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border/40 flex-row items-center justify-between">
          <SheetTitle className="text-sm font-semibold">Reglas de correo</SheetTitle>
          <Button size="sm" onClick={onNewRule} className="h-7 text-xs gap-1">
            <Plus className="w-3 h-3" />
            Nueva regla
          </Button>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Cargando reglas…</span>
            </div>
          )}
          {!isLoading && rules.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <Filter className="w-10 h-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No hay reglas configuradas</p>
              <p className="text-xs text-muted-foreground/60">
                Crea una regla para mover automáticamente los correos de un remitente.
              </p>
            </div>
          )}
          {rules.map((rule) => (
            <div key={rule.id} className="flex items-start gap-3 py-3 border-b border-border/30 last:border-0">
              <Filter className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-foreground truncate">{rule.rule_name}</p>
                <p className="text-[11.5px] text-muted-foreground">{rule.sender_email}</p>
                {rule.move_to_folder_name && (
                  <p className="text-[11px] text-muted-foreground/70 mt-0.5">→ {rule.move_to_folder_name}</p>
                )}
                {rule.mark_as_read && (
                  <p className="text-[11px] text-muted-foreground/70">✓ Marcar como leído</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
