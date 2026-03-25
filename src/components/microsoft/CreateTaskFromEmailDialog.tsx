import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateTask } from "@/hooks/useTasks";
import { useClients } from "@/hooks/useClients";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  emailSubject?: string;
  senderName?: string;
  senderEmail?: string;
  bodyPreview?: string;
  receivedDate?: string;
}

export function CreateTaskFromEmailDialog({
  open,
  onOpenChange,
  emailSubject,
  senderName,
  senderEmail,
  bodyPreview,
  receivedDate,
}: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("media");
  const [assignedTo, setAssignedTo] = useState("");
  const [clientId, setClientId] = useState("");

  const createTask = useCreateTask();
  const { data: clients } = useClients();
  const { data: users } = useOrgUsers();

  useEffect(() => {
    if (open) {
      setTitle(`[Correo] ${emailSubject || "(sin asunto)"}`);
      const parts = [];
      if (senderName || senderEmail) parts.push(`De: ${senderName || ""} <${senderEmail || ""}>`);
      if (receivedDate) parts.push(`Fecha: ${receivedDate}`);
      if (bodyPreview) parts.push(`\n${bodyPreview.substring(0, 500)}`);
      setDescription(parts.join("\n"));
      setPriority("media");
      setAssignedTo("");
      setClientId("");
    }
  }, [open, emailSubject, senderName, senderEmail, bodyPreview, receivedDate]);

  const handleCreate = () => {
    if (!title.trim()) return;
    createTask.mutate(
      {
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        assigned_to: assignedTo || undefined,
        client_id: clientId || undefined,
      },
      {
        onSuccess: () => {
          toast.success("Tarea creada desde correo");
          onOpenChange(false);
        },
        onError: () => toast.error("Error al crear la tarea"),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Crear tarea desde correo</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Título</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Descripción</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Prioridad</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="baja">Baja</SelectItem>
                  <SelectItem value="media">Media</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="urgente">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Asignar a</Label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger>
                <SelectContent>
                  {users?.filter((u) => u.is_active).map((u) => (
                    <SelectItem key={u.user_id} value={u.user_id}>{u.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Cliente (opcional)</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger><SelectValue placeholder="Sin cliente" /></SelectTrigger>
              <SelectContent>
                {clients?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleCreate} disabled={createTask.isPending || !title.trim()}>
            {createTask.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Crear tarea
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
