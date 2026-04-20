import * as React from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { avatarGradient, initialsOf } from "@/lib/avatarGradient";
import { cn } from "@/lib/utils";

export type UserAvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

type TooltipSide = "top" | "right" | "bottom" | "left";

const SIZE_CLASSES: Record<UserAvatarSize, string> = {
  xs: "h-[18px] w-[18px] text-[8px]",
  sm: "h-6 w-6 text-[9px]",
  md: "h-8 w-8 text-[11px]",
  lg: "h-10 w-10 text-xs",
  xl: "h-12 w-12 text-sm",
};

export interface UserAvatarProps {
  /** Nombre completo del usuario (se usa para iniciales y tooltip). */
  name?: string | null;
  /** Email del usuario (fallback para tooltip/seed si no hay nombre). */
  email?: string | null;
  /** URL pública de la foto de perfil (Microsoft Graph/Supabase Storage). */
  avatarUrl?: string | null;
  /** Identificador estable para el gradiente (user_id u otro). */
  userId?: string | null;
  /** Tamaño visual del avatar. */
  size?: UserAvatarSize;
  /** Clases extra para el contenedor Avatar (útil para apilado, bordes, etc.). */
  className?: string;
  /** Clases extra para el fallback (iniciales). */
  fallbackClassName?: string;
  /** Controla si se muestra tooltip con el nombre. */
  showTooltip?: boolean;
  /** Lado del tooltip. */
  tooltipSide?: TooltipSide;
  /** Texto alternativo para la imagen. */
  alt?: string;
  /** Label opcional para override de iniciales cuando no hay nombre. */
  fallbackLabel?: string;
}

/**
 * Componente unificado para mostrar avatares de usuario.
 *
 * - Muestra la foto de `avatarUrl` cuando existe (Radix cae al fallback si falla la imagen).
 * - Si no hay foto, muestra iniciales con gradiente estable basado en `userId`/nombre/email.
 * - Al hacer hover muestra un Tooltip Radix con el nombre (o email si no hay nombre).
 */
export const UserAvatar = React.forwardRef<HTMLSpanElement, UserAvatarProps>(function UserAvatar(
  {
    name,
    email,
    avatarUrl,
    userId,
    size = "md",
    className,
    fallbackClassName,
    showTooltip = true,
    tooltipSide = "top",
    alt,
    fallbackLabel,
  },
  ref,
) {
  const displayName = (name && name.trim()) || (email && email.trim()) || "";
  const seed = userId || displayName || email || "anon";
  const initials = fallbackLabel || initialsOf(displayName || email || null);

  const avatar = (
    <Avatar ref={ref} className={cn(SIZE_CLASSES[size], className)}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={alt ?? displayName} /> : null}
      <AvatarFallback
        className={cn("font-semibold text-white", fallbackClassName)}
        style={{ background: avatarGradient(seed) }}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );

  if (!showTooltip || !displayName) {
    return avatar;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{avatar}</span>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} className="text-xs">
        {displayName}
      </TooltipContent>
    </Tooltip>
  );
});

export default UserAvatar;
