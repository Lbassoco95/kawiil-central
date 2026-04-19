export function initialsOf(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function avatarGradient(seed?: string | null): string {
  const palette = [
    ["hsl(var(--primary))", "hsl(var(--accent))"],
    ["hsl(var(--accent))", "hsl(var(--primary))"],
    ["hsl(217 91% 60%)", "hsl(262 83% 58%)"],
    ["hsl(157 72% 36%)", "hsl(199 89% 48%)"],
    ["hsl(38 92% 50%)", "hsl(25 95% 53%)"],
  ];
  let idx = 0;
  if (seed) {
    let h = 0;
    for (let i = 0; i < seed.length; i += 1) {
      h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    }
    idx = h % palette.length;
  }
  const [from, to] = palette[idx];
  return `linear-gradient(135deg, ${from}, ${to})`;
}
