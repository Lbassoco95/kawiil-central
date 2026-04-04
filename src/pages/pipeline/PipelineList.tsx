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
  const [urgencyFilter, setUrgencyFilter] = useState<string>("all");
  const [visaFilter, setVisaFilter] = useState<string>("all");

  const stageName = useMemo(() => {
    const m = new Map(stages.map((s) => [s.id, s.name]));
    return (id: string) => m.get(id) || "\u2014";
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
    if (urgencyFilter !== "all") {
      rows = rows.filter((l) => (l as Record<string, unknown>).urgency === urgencyFilter);
    }
    if (visaFilter !== "all") {
      rows = rows.filter((l) => {
        const needsVisa = (l as Record<string, unknown>).needs_visa;
        return visaFilter === "yes" ? !!needsVisa : !needsVisa;
      });
    }
    return rows;
  }, [leads, q, priority, country, stageFilter, urgencyFilter, visaFilter]);

  if (sl || ll) {
    return <Skeleton className="h-[480px] w-full" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[180px]">
          <label className="text-xs text-muted-foreground">Buscar</label>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, email, campa\u00f1a\u2026" />
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
          <label className="text-xs text-muted-foreground">Pa\u00eds</label>
          <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="M\u00e9xico\u2026" />
        </div>
        <div className="w-[140px]">
          <label className="text-xs text-muted-foreground">Urgencia</label>
          <Select value={urgencyFilter} onValueChange={setUrgencyFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="immediate">Inmediato</SelectItem>
              <SelectItem value="short_term">Corto plazo</SelectItem>
              <SelectItem value="exploring">Explorando</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-[120px]">
          <label className="text-xs text-muted-foreground">Visa</label>
          <Select value={visaFilter} onValueChange={setVisaFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="yes">S\u00ed</SelectItem>
              <SelectItem value="no">No</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => { setQ(""); setPriority("all"); setCountry(""); setStageFilter("all"); setUrgencyFilter("all"); setVisaFilter("all"); }}>
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
              <TableHead>Pa\u00eds</TableHead>
              <TableHead>Prioridad</TableHead>
              <TableHead>Etapa</TableHead>
              <TableHead>Campa\u00f1a</TableHead>
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
                  <TableCell>{l.company_name || "\u2014"}</TableCell>
                  <TableCell className="text-sm">{l.email || "\u2014"}</TableCell>
                  <TableCell>{l.country_name || l.country_code || "\u2014"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{l.priority}</Badge>
                  </TableCell>
                  <TableCell>{stageName(l.stage_id)}</TableCell>
                  <TableCell className="max-w-[160px] truncate text-sm text-muted-foreground">
                    {l.campaign_name || "\u2014"}
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
