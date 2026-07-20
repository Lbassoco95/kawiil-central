import { cn } from "@/lib/utils";

interface Props {
  email: string;
  color: string;
  size?: "sm" | "md";
  className?: string;
}

export function MailAccountBadge({ email, color, size = "sm", className }: Props) {
  const initial = email ? email[0].toUpperCase() : "?";
  const dim = size === "sm" ? "w-[14px] h-[14px] text-[8px]" : "w-5 h-5 text-[10px]";
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full font-bold text-white shrink-0 select-none leading-none",
        dim,
        className,
      )}
      style={{ background: color }}
      title={email}
    >
      {initial}
    </span>
  );
}
