import {
  Bell,
  FileStack,
  Home,
  Inbox,
  Lightbulb,
  MessageSquare,
  MoreHorizontal,
  Receipt,
  TrendingDown,
  TrendingUp,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  short?: string;
  Icon: LucideIcon;
  primary?: boolean;
  more?: boolean;
};

/** Navegación del producto cliente (sin Savio, sin IA). */
export const PRIMARY_NAV: NavItem[] = [
  { to: "/", label: "Resumen", short: "Resumen", Icon: Home, primary: true },
  { to: "/ingresos", label: "Ingresos", short: "Ingresos", Icon: TrendingUp, primary: true },
  { to: "/egresos", label: "Egresos", short: "Egresos", Icon: TrendingDown, primary: true },
  { to: "/buzon", label: "Buzón", short: "Buzón", Icon: Inbox, primary: true },
  { to: "/mensajes", label: "Mensajes", short: "Msgs", Icon: MessageSquare, primary: true },
];

/**
 * Facturación = emitir (wizard) / subir ticket para que Kawiil emita (no archivo SatGo).
 * CFDI emitidas/recibidas + cobranza viven en Ingresos / Egresos.
 * En `/diseno` Layout remapea `/facturas` → `/facturacion`.
 */
export const MORE_NAV: NavItem[] = [
  { to: "/facturas", label: "Facturación", Icon: Receipt, more: true },
  { to: "/origen", label: "Origen de datos", Icon: Waypoints, more: true },
  { to: "/hallazgos", label: "Seguimientos", Icon: Lightbulb, more: true },
  { to: "/documentos", label: "Documentos", Icon: FileStack, more: true },
  { to: "/alertas", label: "Alertas", Icon: Bell, more: true },
  { to: "/cuenta", label: "Cuenta", Icon: MoreHorizontal, more: true },
];

export const ALL_NAV = [...PRIMARY_NAV, ...MORE_NAV];
