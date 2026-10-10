import { describe, expect, it } from "vitest";
import { agruparFilasRpc, type RpcRow } from "./useGlobalSearch";

describe("agruparFilasRpc", () => {
  it("agrupa por entidad y arma la ruta de cada resultado", () => {
    const filas: RpcRow[] = [
      { entidad: "client", id: "c1", titulo: "Grupo Textil", subtitulo: "GTN180101AB1" },
      { entidad: "lead", id: "l1", titulo: "Marisol Vázquez", subtitulo: "Innovación" },
      { entidad: "task", id: "t1", titulo: "Declaración mensual", subtitulo: null },
    ];
    const r = agruparFilasRpc(filas);

    expect(r.client).toEqual([
      {
        id: "c1",
        entity: "client",
        title: "Grupo Textil",
        subtitle: "GTN180101AB1",
        to: "/clientes/c1",
      },
    ]);
    expect(r.lead[0].to).toBe("/pipeline/leads/l1");
    expect(r.task[0].to).toBe("/tareas?id=t1");
    expect(r.project).toEqual([]);
    expect(r.document).toEqual([]);
  });

  it("conserva el orden que devuelve la base dentro de cada grupo", () => {
    const r = agruparFilasRpc([
      { entidad: "client", id: "a", titulo: "Primero", subtitulo: null },
      { entidad: "task", id: "x", titulo: "Otra cosa", subtitulo: null },
      { entidad: "client", id: "b", titulo: "Segundo", subtitulo: null },
    ]);
    expect(r.client.map((h) => h.title)).toEqual(["Primero", "Segundo"]);
  });

  it("descarta filas sin título, que no se podrían mostrar", () => {
    const r = agruparFilasRpc([
      { entidad: "client", id: "c1", titulo: null, subtitulo: "algo" },
      { entidad: "client", id: "c2", titulo: "", subtitulo: null },
      { entidad: "client", id: "c3", titulo: "Válido", subtitulo: null },
    ]);
    expect(r.client.map((h) => h.id)).toEqual(["c3"]);
  });

  it("ignora entidades desconocidas en vez de romper", () => {
    const r = agruparFilasRpc([
      { entidad: "contrato" as RpcRow["entidad"], id: "z", titulo: "Nuevo tipo", subtitulo: null },
      { entidad: "client", id: "c1", titulo: "Cliente", subtitulo: null },
    ]);
    expect(r.client).toHaveLength(1);
    expect(Object.keys(r)).toEqual(["client", "project", "task", "document", "lead"]);
  });

  it("sin filas devuelve los cinco grupos vacíos", () => {
    const r = agruparFilasRpc([]);
    expect(Object.values(r).every((g) => g.length === 0)).toBe(true);
  });
});
