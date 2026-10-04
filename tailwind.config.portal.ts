import type { Config } from "tailwindcss";
import base from "./tailwind.config";

/** Tailwind del portal: `--primary` del pack es hex (#0063cc), no canales HSL. */
const config: Config = {
  ...base,
  content: ["./src/portal/**/*.{ts,tsx}", "./portal/index.html", "./src/components/ui/**/*.{ts,tsx}"],
  theme: {
    ...base.theme,
    extend: {
      ...base.theme?.extend,
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', "system-ui", "-apple-system", "sans-serif"],
        display: ['"Outfit"', '"Plus Jakarta Sans"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      colors: {
        ...(base.theme?.extend as { colors?: Record<string, unknown> })?.colors,
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--on-primary)",
        },
        background: "var(--canvas)",
        foreground: "var(--ink)",
        muted: {
          DEFAULT: "var(--surface-glass-strong)",
          foreground: "var(--ink-muted)",
        },
        border: "var(--line)",
        input: "var(--control-border)",
        ring: "var(--link)",
        card: {
          DEFAULT: "var(--surface-glass-strong)",
          foreground: "var(--ink)",
        },
      },
    },
  },
};

export default config;
