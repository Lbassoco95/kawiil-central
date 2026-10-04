import {
  FileText,
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

export const MORE_NAV: NavItem[] = [
  { to: "/facturacion", label: "Facturación", Icon: Receipt, more: true },
  { to: "/origen", label: "Origen de datos", Icon: Waypoints, more: true },
  { to: "/hallazgos", label: "Hallazgos", Icon: Lightbulb, more: true },
  { to: "/facturas", label: "Facturas (espejo)", Icon: FileText, more: true },
  { to: "/cuenta", label: "Cuenta", Icon: MoreHorizontal, more: true },
];

export const ALL_NAV = [...PRIMARY_NAV, ...MORE_NAV];
