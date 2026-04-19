import { LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrentProfile, getInitials } from "@/hooks/useCurrentProfile";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ThemeToggle } from "./ThemeToggle";
import { cn } from "@/lib/utils";

interface SidebarFooterProps {
  collapsed: boolean;
}

export function SidebarFooter({ collapsed }: SidebarFooterProps) {
  const { signOut, user } = useAuth();
  const { data: profile } = useCurrentProfile();

  const initials = getInitials(profile, user?.email);

  return (
    <TooltipProvider delayDuration={250}>
      <div
        className={cn(
          "flex-shrink-0 border-t",
          collapsed ? "px-1.5 py-2" : "px-2.5 py-3",
        )}
        style={{
          borderColor: "var(--sb-border)",
          background: "linear-gradient(180deg, transparent, rgba(0,0,0,0.15))",
        }}
      >
        {/* User identity + theme + logout */}
        <div
          className={cn(
            "grid items-center gap-1.5",
            collapsed ? "grid-cols-1" : "grid-cols-[1fr_auto_auto]",
          )}
        >
          <div
            className={cn(
              "flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1",
              collapsed && "justify-center",
            )}
          >
            <Avatar
              className="h-7 w-7 flex-shrink-0"
              style={{ boxShadow: "0 0 0 2px var(--sb-bg)" }}
            >
              {profile?.avatar_url ? (
                <AvatarImage src={profile.avatar_url} alt={profile?.full_name || "Avatar"} />
              ) : null}
              <AvatarFallback
                className="text-[11px] font-bold text-white"
                style={{
                  background: "linear-gradient(135deg, hsl(260 70% 60%), hsl(210 80% 55%))",
                }}
              >
                {initials}
              </AvatarFallback>
            </Avatar>
            {!collapsed && (
              <div className="min-w-0 leading-tight">
                <div
                  className="truncate text-[12px] font-semibold"
                  style={{ color: "var(--sb-fg)" }}
                >
                  {profile?.full_name || user?.email || "Kawiiler"}
                </div>
                {profile?.area && (
                  <div className="truncate text-[10px]" style={{ color: "var(--sb-fg-dim)" }}>
                    {profile.area}
                  </div>
                )}
              </div>
            )}
          </div>

          <ThemeToggle />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => signOut()}
                className="kw-sb-iconbtn"
                aria-label="Cerrar sesión"
              >
                <LogOut className="h-[15px] w-[15px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Cerrar sesión</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
