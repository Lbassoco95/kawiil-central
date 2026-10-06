/** B5 · Qué se busca en claro: el material sintético completo, ventanas de él, su forma hex y los secretos. */
export const SECRETS = {
  key: "k".repeat(24) + "-llave-sintetica-B5",
  password: "p".repeat(24) + "-pass-sintetica-B5",
  fiel: "f".repeat(24) + "-fiel-sintetica-B5",
};

export function needles(m: { cerB64: string; keyB64: string; password: string }, secrets = SECRETS): string[] {
  const out = new Set<string>([m.cerB64, m.keyB64, m.password, secrets.key, secrets.password, secrets.fiel]);
  for (const b64 of [m.cerB64, m.keyB64]) {
    for (let i = 0; i + 48 <= b64.length; i += 97) out.add(b64.slice(i, i + 48));
    out.add(Buffer.from(b64, "base64").toString("hex").slice(64, 160));
  }
  return [...out];
}

export function findPlain(haystack: string, list: string[]): string[] {
  return list.filter((n) => haystack.includes(n)).map((n) => `${n.slice(0, 12)}…(${n.length})`);
}
