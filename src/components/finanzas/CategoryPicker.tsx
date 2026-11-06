import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFinanceCategories } from "@/hooks/useFinanceBank";

const NEW = "__nueva__";

export function CategoryPicker({ value, onChange, className }: { value: string; onChange: (v: string, kind?: "gasto" | "ingreso" | "neutral") => void; className?: string }) {
  const { categories } = useFinanceCategories();
  const [custom, setCustom] = useState(false);
  const [text, setText] = useState("");
  if (custom) {
    return (
      <div className="flex gap-1">
        <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Nueva categoría" className="h-8 w-40" />
        <Button size="sm" className="h-8" disabled={!text.trim()} onClick={() => { onChange(text.trim()); setCustom(false); setText(""); }}>OK</Button>
      </div>
    );
  }
  return (
    <Select value={value} onValueChange={(v) => (v === NEW ? setCustom(true) : onChange(v))}>
      <SelectTrigger className={`h-8 text-xs ${className ?? "w-48"}`}><SelectValue placeholder="Categoría…" /></SelectTrigger>
      <SelectContent>
        {categories.map((c) => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}
        <SelectItem value={NEW}>+ Nueva categoría…</SelectItem>
      </SelectContent>
    </Select>
  );
}

