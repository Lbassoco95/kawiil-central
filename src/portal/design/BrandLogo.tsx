import { Link } from "react-router-dom";
import { LOGO } from "./assets";
import { portalPath } from "../lib/basePath";

type Variant = "horizontal" | "symbol" | "wordmark";
type Tone = "blue" | "white" | "navy" | "auto";

type Props = {
  variant?: Variant;
  tone?: Tone;
  height?: number;
  className?: string;
  /** Si true, envuelve en enlace al inicio con nombre accesible. */
  linkHome?: boolean;
  /** alt vacío = decorativo (cuando el control ya tiene nombre). */
  decorative?: boolean;
};

function srcFor(variant: Variant, tone: Exclude<Tone, "auto">): string {
  if (variant === "symbol") {
    if (tone === "white") return LOGO.symbolWhite;
    if (tone === "navy") return LOGO.symbolNavy;
    return LOGO.symbolBlue;
  }
  if (variant === "wordmark") {
    if (tone === "white") return LOGO.wordWhite;
    if (tone === "navy") return LOGO.wordNavy;
    return LOGO.wordBlue;
  }
  if (tone === "white") return LOGO.horizontalWhite;
  if (tone === "navy") return LOGO.horizontalNavy;
  return LOGO.horizontalBlue;
}

/**
 * Marca Kawiil OS — SVG del pack de identidad.
 * horizontal ~32–40 px en nav; login puede ir más alto; symbol ~28–32 px.
 */
export default function BrandLogo({
  variant = "horizontal",
  tone = "auto",
  height = variant === "symbol" ? 30 : 36,
  className,
  linkHome = false,
  decorative = false,
}: Props) {
  const resolvedTone: Exclude<Tone, "auto"> = tone === "auto" ? "blue" : tone;
  const img = (
    <img
      src={srcFor(variant, resolvedTone)}
      alt={decorative || linkHome ? "" : "Kawiil OS"}
      height={height}
      className={className}
      style={{ height, width: "auto", objectFit: "contain", display: "block" }}
      decoding="async"
    />
  );

  if (!linkHome) return img;

  return (
    <Link
      to={portalPath("/")}
      aria-label="Kawiil OS — Inicio"
      className="inline-flex min-h-11 min-w-11 items-center"
      style={{ padding: 4 }}
    >
      {img}
    </Link>
  );
}

/** Par claro/oscuro para header (CSS .logo-light / .logo-dark). */
export function BrandLogoThemePair({
  variant = "horizontal",
  height = 32,
}: {
  variant?: Variant;
  height?: number;
}) {
  return (
    <>
      <img
        className="logo-light"
        src={srcFor(variant, "blue")}
        alt="Kawiil OS"
        style={{ height, width: "auto", objectFit: "contain" }}
        decoding="async"
      />
      <img
        className="logo-dark"
        src={srcFor(variant, "white")}
        alt="Kawiil OS"
        style={{ height, width: "auto", objectFit: "contain" }}
        decoding="async"
      />
    </>
  );
}
