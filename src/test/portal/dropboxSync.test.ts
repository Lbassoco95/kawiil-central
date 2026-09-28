/**
 * Criterio 3: sincronización con una carpeta de prueba que contiene
 * ADMINISTRATIVO con .key, .cer y .dec → NINGUNO entra a Supabase.
 * Usa el MISMO motor que la Edge portal-dropbox-sync, con una carpeta local
 * como origen y un destino en memoria que registra todo lo que «subiría».
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, renameSync, rmSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  runSync,
  discoverClientFolders,
  type SyncSource,
  type SyncSink,
  type SyncEntry,
  type ExistingDoc,
  type NewDocument,
  type MappedFolder,
} from "../../../supabase/functions/_shared/portal/dropboxSync.ts";

/** Origen = carpeta local. El id estable es el inode (sobrevive a renombres, como el id de Dropbox). */
function localSource(root: string): SyncSource & { listedPaths: string[] } {
  const byId = new Map<string, string>();
  const listedPaths: string[] = [];
  const idOf = (abs: string) => {
    const id = `id:${statSync(abs).ino}`;
    byId.set(id, abs);
    return id;
  };
  // Como Dropbox: el id se resuelve aunque la carpeta se haya renombrado o movido.
  const findByIno = (dir: string, ino: number): string | null => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      const st = statSync(p);
      if (st.ino === ino) return p;
      if (st.isDirectory()) { const hit = findByIno(p, ino); if (hit) return hit; }
    }
    return null;
  };
  const resolve = (ref: string) => {
    if (!ref.startsWith("id:")) return join(root, ref);
    const hit = findByIno(root, Number(ref.slice(3)));
    if (!hit) throw new Error(`id no encontrado: ${ref}`);
    byId.set(ref, hit);
    return hit;
  };
  const entry = (abs: string): SyncEntry => {
    const st = statSync(abs);
    const rel = "/" + relative(root, abs).split(sep).join("/");
    return st.isDirectory()
      ? { kind: "folder", id: idOf(abs), name: abs.split(sep).pop()!, pathDisplay: rel }
      : {
          kind: "file",
          id: idOf(abs),
          name: abs.split(sep).pop()!,
          pathDisplay: rel,
          size: st.size,
          contentHash: createHash("sha256").update(readFileSync(abs)).digest("hex"),
        };
  };
  const walk = (abs: string): SyncEntry[] =>
    readdirSync(abs).flatMap((n) => {
      const p = join(abs, n);
      listedPaths.push(p);
      return statSync(p).isDirectory() ? [entry(p), ...walk(p)] : [entry(p)];
    });
  return {
    listedPaths,
    async listChildren(ref) {
      const abs = resolve(ref);
      return readdirSync(abs).map((n) => {
        listedPaths.push(join(abs, n));
        return entry(join(abs, n));
      });
    },
    async listRecursive(ref) {
      return walk(resolve(ref));
    },
    async download(id) {
      return new Uint8Array(readFileSync(resolve(id)));
    },
  };
}

/** Destino en memoria: lo que aquí queda es lo que entraría a Supabase. */
function memorySink() {
  const docs = new Map<string, ExistingDoc & { doc: NewDocument; bytes: Uint8Array }>();
  const sink: SyncSink = {
    async existingDocs(clientId) {
      return [...docs.values()].filter((d) => d.doc.clientId === clientId);
    },
    async createDocument(doc, bytes) {
      docs.set(doc.entry.id, {
        id: doc.entry.id, dropboxFileId: doc.entry.id, contentHash: doc.entry.contentHash ?? null,
        sourcePath: doc.entry.pathDisplay, status: "pendiente", doc, bytes,
      });
    },
    async replaceContent(existing, doc, bytes) {
      docs.set(existing.dropboxFileId, { ...docs.get(existing.dropboxFileId)!, contentHash: doc.entry.contentHash ?? null, doc, bytes });
    },
    async updatePath(existing, newPath) {
      docs.get(existing.dropboxFileId)!.sourcePath = newPath;
    },
  };
  return { sink, docs };
}

let root: string;
const put = (rel: string, content = "contenido") => {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "portal-dbx-"));
  // Cliente sintético con las 5 áreas reales.
  put("CLIENTES/ACME SINTETICA/ADMINISTRATIVO/FIEL/acme.key", "LLAVE PRIVADA");
  put("CLIENTES/ACME SINTETICA/ADMINISTRATIVO/FIEL/acme.cer", "CERTIFICADO");
  put("CLIENTES/ACME SINTETICA/ADMINISTRATIVO/declaracion.dec", "DEC");
  put("CLIENTES/ACME SINTETICA/ADMINISTRATIVO/constancia.pdf", "PDF DE ADMINISTRATIVO");
  put("CLIENTES/ACME SINTETICA/LEGAL/acta.pdf", "ACTA");
  put("CLIENTES/ACME SINTETICA/RECURSOS HUMANOS/nomina.xlsx", "NOMINA");
  put("CLIENTES/ACME SINTETICA/FISCAL/2026/Declaracion anual 2025.pdf", "ANUAL");
  put("CLIENTES/ACME SINTETICA/FISCAL/Opinion cumplimiento.pdf", "OPINION");
  put("CLIENTES/ACME SINTETICA/FISCAL/csd_sello.cer", "CSD EN FISCAL");
  put("CLIENTES/ACME SINTETICA/FISCAL/Contraseña CIEC.pdf", "CIEC");
  put("CLIENTES/ACME SINTETICA/FISCAL/pago (conflicted copy 2026-08-01).pdf", "CONFLICTO");
  put("CLIENTES/ACME SINTETICA/FISCAL/acceso.url", "[InternetShortcut]");
  put("CLIENTES/ACME SINTETICA/FISCAL/programa.exe", "MZ");
  put("CLIENTES/ACME SINTETICA/CONTABILIDAD/2026/08/balanza.xlsx", "BALANZA");
  put("CLIENTES/ACME SINTETICA/CONTABILIDAD/2026/08/pago provisional.pdf", "PAGO");
  put("CLIENTES/ACME SINTETICA/nota suelta.pdf", "SUELTA");
  put("CLIENTES/OTRO SINTETICO/FISCAL/otro.pdf", "OTRO");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function mapped(source: SyncSource): Promise<MappedFolder[]> {
  const found = await discoverClientFolders(source, "CLIENTES");
  const acme = found.find((f) => f.name === "ACME SINTETICA")!;
  return [{ folderRowId: "row-1", dropboxFolderId: acme.dropboxFolderId, pathDisplay: acme.pathDisplay, clientId: "cliente-a", organizationId: "org-k" }];
}

describe("sincronización Dropbox → Supabase (carpeta local)", () => {
  it("ningún .key, .cer ni .dec, ni nada de ADMINISTRATIVO, entra", async () => {
    const source = localSource(root);
    const { sink, docs } = memorySink();
    const { stats, rejected } = await runSync(source, sink, await mapped(source));

    const entered = [...docs.values()].map((d) => d.doc.entry.pathDisplay);
    expect(entered.some((p) => /\.(key|cer|dec)$/i.test(p))).toBe(false);
    expect(entered.some((p) => /ADMINISTRATIVO/i.test(p))).toBe(false);
    for (const d of docs.values()) {
      const text = new TextDecoder().decode(d.bytes);
      expect(text).not.toMatch(/LLAVE PRIVADA|CERTIFICADO|CSD EN FISCAL|CIEC/);
    }
    expect(entered.sort()).toEqual([
      "/CLIENTES/ACME SINTETICA/CONTABILIDAD/2026/08/balanza.xlsx",
      "/CLIENTES/ACME SINTETICA/CONTABILIDAD/2026/08/pago provisional.pdf",
      "/CLIENTES/ACME SINTETICA/FISCAL/2026/Declaracion anual 2025.pdf",
      "/CLIENTES/ACME SINTETICA/FISCAL/Opinion cumplimiento.pdf",
    ]);
    expect(stats.created).toBe(4);
    expect(rejected).toEqual(expect.arrayContaining([
      { path: "/CLIENTES/ACME SINTETICA/ADMINISTRATIVO", reason: "area_prohibida" },
      { path: "/CLIENTES/ACME SINTETICA/LEGAL", reason: "area_solo_subida_expresa" },
      { path: "/CLIENTES/ACME SINTETICA/RECURSOS HUMANOS", reason: "area_solo_subida_expresa" },
      { path: "/CLIENTES/ACME SINTETICA/FISCAL/csd_sello.cer", reason: "credencial" },
      { path: "/CLIENTES/ACME SINTETICA/FISCAL/Contraseña CIEC.pdf", reason: "credencial" },
      { path: "/CLIENTES/ACME SINTETICA/FISCAL/pago (conflicted copy 2026-08-01).pdf", reason: "ruido_de_sincronizacion" },
      { path: "/CLIENTES/ACME SINTETICA/FISCAL/acceso.url", reason: "ruido_de_sincronizacion" },
      { path: "/CLIENTES/ACME SINTETICA/FISCAL/programa.exe", reason: "tipo_no_permitido" },
      { path: "/CLIENTES/ACME SINTETICA/nota suelta.pdf", reason: "fuera_de_area" },
    ]));
    // Ni siquiera se LISTÓ el contenido de ADMINISTRATIVO, LEGAL ni RR. HH.
    expect(source.listedPaths.some((p) => /ADMINISTRATIVO[\\/]/.test(p))).toBe(false);
    expect(source.listedPaths.some((p) => /(LEGAL|RECURSOS HUMANOS)[\\/]/.test(p))).toBe(false);
    // Carpeta de otro cliente no mapeada: no se toca.
    expect(entered.some((p) => p.includes("OTRO SINTETICO"))).toBe(false);
  });

  it("todo nace pendiente, con periodo sugerido por la ruta CONTABILIDAD/<año>/<mes>", async () => {
    const source = localSource(root);
    const { sink, docs } = memorySink();
    await runSync(source, sink, await mapped(source));
    expect([...docs.values()].every((d) => d.status === "pendiente")).toBe(true);
    const balanza = [...docs.values()].find((d) => d.doc.entry.name === "balanza.xlsx")!;
    expect([balanza.doc.area, balanza.doc.suggestedYear, balanza.doc.suggestedMonth]).toEqual(["CONTABILIDAD", 2026, 8]);
    expect(balanza.doc.storagePath).toMatch(/^org-k\/cliente-a\/CONTABILIDAD\/\d+\/balanza\.xlsx$/);
  });

  it("es repetible: no duplica, detecta cambios y tolera carpetas renombradas", async () => {
    const source = localSource(root);
    const { sink, docs } = memorySink();
    const folders = await mapped(source);
    await runSync(source, sink, folders);
    const again = await runSync(source, sink, folders);
    expect(again.stats).toMatchObject({ created: 0, replaced: 0, unchanged: 4 });
    expect(docs.size).toBe(4);

    put("CLIENTES/ACME SINTETICA/FISCAL/Opinion cumplimiento.pdf", "OPINION ACTUALIZADA");
    const changed = await runSync(source, sink, folders);
    expect(changed.stats).toMatchObject({ created: 0, replaced: 1 });

    // Renombrar la carpeta del cliente: el vínculo es por id, no por nombre.
    renameSync(join(root, "CLIENTES/ACME SINTETICA"), join(root, "CLIENTES/ACME SINTETICA SA DE CV"));
    const renamed = await runSync(source, sink, folders);
    expect(renamed.stats).toMatchObject({ created: 0, replaced: 0, moved: 4 });
    expect(docs.size).toBe(4);
  });

  it("el descubrimiento marca posibles duplicados sin vincular nada solo", async () => {
    put("CLIENTES/Acme  Sintética/FISCAL/x.pdf");
    const found = await discoverClientFolders(localSource(root), "CLIENTES");
    expect(found.filter((f) => f.possibleDuplicate).length).toBe(2);
  });
});
