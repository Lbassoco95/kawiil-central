import { describe, expect, it } from "vitest";
import { parseParticipantNames, personMatches } from "./people";

const MD = `# Resumen de junta — Junta Impuestos

## Participantes
- 4 (estimado, media)
- Lupita, Jairo
- _Se mencionan varios nombres, pero no se identifican claramente los roles de cada uno._

**Idiomas en la junta:** español + chino`;

describe("parseParticipantNames", () => {
  it("extrae solo los nombres de la sección Participantes", () => {
    expect(parseParticipantNames(MD)).toEqual(["Lupita", "Jairo"]);
  });
  it("devuelve [] sin sección o sin texto", () => {
    expect(parseParticipantNames("# Minuta\n- algo")).toEqual([]);
    expect(parseParticipantNames(null)).toEqual([]);
  });
  it("separa con 'y' y quita duplicados", () => {
    const md = "## Participantes\n- Ana y Luis\n- Luis (director)";
    expect(parseParticipantNames(md)).toEqual(["Ana", "Luis"]);
  });
});

describe("personMatches", () => {
  it("compara nombre y alias sin importar mayúsculas", () => {
    expect(personMatches({ name: "Lupita Pérez", aliases: ["Lupita"] }, " lupita ")).toBe(true);
    expect(personMatches({ name: "Jairo", aliases: [] }, "Luis")).toBe(false);
  });
});
