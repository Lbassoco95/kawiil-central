import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Building2, Plus, Power, PowerOff } from "lucide-react";
import {
  useGroupCompanies,
  useCreateGroupCompany,
  useUpdateGroupCompany,
} from "@/hooks/useGroupCompanies";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GroupCompanyManagerDialog({ open, onOpenChange }: Props) {
  const { data: companies = [], isLoading } = useGroupCompanies(true);
  const createCompany = useCreateGroupCompany();
  const updateCompany = useUpdateGroupCompany();
  const [name, setName] = useState("");
  const [rfc, setRfc] = useState("");

  const handleAdd = async () => {
    if (!name.trim()) return;
    await createCompany.mutateAsync({ name, rfc });
    setName("");
    setRfc("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Empresas del grupo
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Empresas del grupo (Yoltik, Tonatiuh, Ixim…) a cuenta de las cuales el despacho puede
          pagar. Cuando registras un gasto a su cuenta, se rastrea como una cuenta por cobrar.
        </p>

        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Nombre *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Yoltik" className="h-9" />
          </div>
          <div className="w-36 space-y-1">
            <Label className="text-xs">RFC</Label>
            <Input value={rfc} onChange={(e) => setRfc(e.target.value)} placeholder="Opcional" className="h-9" />
          </div>
          <Button size="sm" onClick={handleAdd} disabled={!name.trim() || createCompany.isPending} className="h-9">
            <Plus className="h-4 w-4 mr-1" /> Agregar
          </Button>
        </div>

        <div className="max-h-72 space-y-1.5 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Cargando…</p>
          ) : companies.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Aún no hay empresas del grupo.</p>
          ) : (
            companies.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/50 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {c.name}
                    {!c.is_active && (
                      <Badge variant="outline" className="ml-2 text-[10px]">Inactiva</Badge>
                    )}
                  </p>
                  {c.rfc && <p className="text-[11px] text-muted-foreground">{c.rfc}</p>}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-xs"
                  onClick={() => updateCompany.mutate({ id: c.id, is_active: !c.is_active })}
                  disabled={updateCompany.isPending}
                >
                  {c.is_active ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                  {c.is_active ? "Desactivar" : "Activar"}
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
