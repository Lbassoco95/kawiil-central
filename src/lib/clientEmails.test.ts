import { describe, expect, it } from "vitest";
import { collectClientEmails } from "./clientEmails";

describe("collectClientEmails", () => {
  it("une correo de la ficha y de perfiles fiscales sin duplicados", () => {
    expect(
      collectClientEmails("a@x.com, B@x.com", ["b@X.com", "c@x.com; d@x.com", null]),
    ).toEqual(["a@x.com", "B@x.com", "c@x.com", "d@x.com"]);
  });

  it("ignora vacíos y valores inválidos", () => {
    expect(collectClientEmails(null, ["", "no-es-correo", undefined])).toEqual([]);
  });
});
