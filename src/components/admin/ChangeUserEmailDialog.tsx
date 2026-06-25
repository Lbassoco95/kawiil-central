import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, AtSign } from "lucide-react";
import { useUpdateUserEmail } from "@/hooks/useOrgUsers";
import type { OrgUser } from "@/hooks/useOrgUsers";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Cambia el correo (cuenta de acceso) de un colaborador en Auth + perfil. */
export function ChangeUserEmailDialog({
  user,
  open,
  onOpenChange,
}: {
  user: OrgUser | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const update = useUpdateUserEmail();
  const [email, setEmail] = useState("");
  const [sendLink, setSendLink] = useState(true);

  useEffect(() => {
    if (open) {
      setEmail("");
      setSendLink(true);
    }
  }, [open, user?.user_id]);

  if (!user) return null;

  const trimmed = email.trim().toLowerCase();
  const valid = EMAIL_RE.test(trimmed) && trimmed !== user.email.toLowerCase();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AtSign className="h-4 w-4" /> Cambiar correo
          </DialogTitle>
          <DialogDescription>
            Actualiza el correo de acceso de <strong>{user.full_name}</strong>. Con el nuevo correo
            iniciará sesión a partir de ahora.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Correo actual</Label>
            <p className="text-sm text-muted-foreground break-all">{user.email}</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Nuevo correo</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nombre@kawiil.mx"
              className="h-9 text-sm"
              autoComplete="off"
            />
            {email && !valid && (
              <p className="text-[10px] text-destructive">
                Escribe un correo válido y distinto del actual.
              </p>
            )}
          </div>

          <label className="flex items-start gap-2 text-xs cursor-pointer">
            <Checkbox
              checked={sendLink}
              onCheckedChange={(c) => setSendLink(c === true)}
              className="mt-0.5"
            />
            <span className="text-muted-foreground">
              Enviar el enlace de acceso al nuevo correo (recomendado para que establezca su
              contraseña y conozca su nueva dirección).
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            disabled={!valid || update.isPending}
            onClick={() =>
              update.mutate(
                { user_id: user.user_id, new_email: trimmed, send_link: sendLink },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            {update.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Cambiar correo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
