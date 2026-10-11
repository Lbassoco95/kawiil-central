import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignaturePad } from "./SignaturePad";
import { esignDb } from "@/lib/esign";
import { toast } from "sonner";
import { Loader2, PenTool, Trash2 } from "lucide-react";

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return await (await fetch(dataUrl)).blob();
}

/** Guarda/actualiza la firma del usuario (bucket privado `esign`, una por usuario). */
export function MySignatureCard() {
  const { user } = useAuth();
  const [current, setCurrent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [png, setPng] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data: row } = await esignDb.from("user_signatures").select("image_path").eq("user_id", user.id).maybeSingle();
    if (row) {
      const { data } = await supabase.storage.from("esign").createSignedUrl(row.image_path, 600);
      setCurrent(data?.signedUrl ?? null);
    } else {
      setCurrent(null);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!user || !png) return;
    setSaving(true);
    try {
      const { data: prof, error: pErr } = await supabase
        .from("profiles").select("organization_id").eq("user_id", user.id).single();
      if (pErr || !prof) throw new Error("No se encontró tu perfil");
      const path = `${prof.organization_id}/signatures/${user.id}/signature.png`;
      const up = await supabase.storage.from("esign").upload(path, await dataUrlToBlob(png), {
        contentType: "image/png",
        upsert: true,
      });
      if (up.error) throw up.error;
      const { error } = await esignDb.from("user_signatures").upsert({
        user_id: user.id,
        organization_id: prof.organization_id,
        image_path: path,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      toast.success("Firma guardada");
      setEditing(false);
      setPng(null);
      await load();
    } catch (e) {
      toast.error("No se pudo guardar la firma: " + (e instanceof Error ? e.message : "error"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!user) return;
    const { data: row } = await esignDb.from("user_signatures").select("image_path").eq("user_id", user.id).maybeSingle();
    if (row) await supabase.storage.from("esign").remove([row.image_path]);
    await esignDb.from("user_signatures").delete().eq("user_id", user.id);
    toast.success("Firma eliminada");
    await load();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <PenTool className="h-4 w-4" /> Mi firma
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : editing || !current ? (
          <>
            <SignaturePad onChange={setPng} />
            <div className="flex justify-end gap-2">
              {current && (
                <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                  Cancelar
                </Button>
              )}
              <Button onClick={save} disabled={!png || saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Guardar firma
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-md border bg-white p-2">
              <img src={current} alt="Mi firma guardada" className="mx-auto max-h-28" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" className="gap-1" onClick={remove}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" /> Eliminar
              </Button>
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Cambiar
              </Button>
            </div>
          </>
        )}
        <p className="text-xs text-muted-foreground">
          Se usa para firmar con un clic los documentos que te lleguen en la bandeja. Solo tú puedes verla.
        </p>
      </CardContent>
    </Card>
  );
}
