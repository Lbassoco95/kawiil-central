import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { usePipelineStages, usePipelineLeads, type Lead } from "@/hooks/usePipeline";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export default function PipelineList() {
  const { data: stages = [], isLoading: sl } = usePipelineStages();
  const { data: leads = [], isLoading: ll } = usePipelineLeads(true);
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState<string>("all");
  const [country, setCountry] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");

  const stageName = useMemo(() => {
    const m = new Map(stages.map((s) => [s.id, s.name]));
    return (id: string) => m.get(id) || "—";
  }, [stages]);

  const filtered = useMemo(() => {
    let rows: Lead[] = leads;
    if (q.trim()) {
      const t = q.toLowerCase();
      rows = rows.filter(
        (l) =>
          l.full_name.toLowerCase().includes(t) ||
          (l.email && l.email.toLowerCase().includes(t)) ||
          (l.company_name && l.company_name.toLowerCase().includes(t)) ||
          (l.campaign_name && l.campaign_name.toLowerCase().includes(t)),
      );
    }
    if (priority !== "all") rows = rows.filter((l) => l.priority === priority);
    if (country.trim()) {
      const c = country.toLowerCase();
      rows = rows.filter(
        (l) =>
          (l.country_name && l.country_name.toLowerCase().includes(c)) ||
          (l.country_code && l.country_code.toLowerCase().includes(c)),
      );
    }
    if (stageFilter !== "all") rows = rows.filter((l) => l.stage_id === stageFilter);
    return rows;
  }, [leads, q, priority, country, stageFilter]);

  if (sl || ll) {
    return <Skeleton className="h-[480px] w-full" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[180px]">
          <label className="text-xs text-muted-foreground">Buscar</label>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, email, campaña…" />
        </div>
        <div className="w-[140px]">
          <label className="text-xs text-muted-foreground">Prioridad</label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="urgent">Urgente</SelectItem>
              <SelectItem value="high">Alta</SelectItem>
              <SelectItem value="medium">Media</SelectItem>
              <SelectItem value="low">Baja</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-[160px]">
          <label className="text-xs text-muted-foreground">Etapa</label>
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Etapa" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {stages.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-[140px]">
          <label className="text-xs text-muted-foreground">País</label>
          <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="México…" />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => { setQ(""); setPriority("all"); setCountry(""); setStageFilter("all"); }}>
          Limpiar
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>País</TableHead>
              <TableHead>Prioridad</TableHead>
              <TableHead>Etapa</TableHead>
              <TableHead>Campaña</TableHead>
              <TableHead className="w-[100px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  Sin resultados
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.full_name}</TableCell>
                  <TableCell>{l.company_name || "—"}</TableCell>
                  <TableCell className="text-sm">{l.email || "—"}</TableCell>
                  <TableCell>{l.country_name || l.country_code || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{l.priority}</Badge>
                  </TableCell>
                  <TableCell>{stageName(l.stage_id)}</TableCell>
                  <TableCell className="max-w-[160px] truncate text-sm text-muted-foreground">
                    {l.campaign_name || "—"}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/pipeline/leads/${l.id}`}>Ver</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
