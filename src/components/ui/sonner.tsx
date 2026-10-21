import { useTheme } from "next-themes";
import { CheckCircle2, Leaf, Sparkles, Wind } from "lucide-react";
import { Toaster as Sonner, toast } from "sonner";
import { installZenCopy } from "@/lib/zenCopy";

// Tono suave para todos los avisos de la app (ver docs/direccion-visual-zen-glass.md)
installZenCopy(toast);

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group zen-toaster"
      position="bottom-right"
      duration={4500}
      gap={12}
      icons={{
        success: <CheckCircle2 size={16} strokeWidth={2} />,
        info: <Sparkles size={16} strokeWidth={2} />,
        warning: <Wind size={16} strokeWidth={2} />,
        error: <Leaf size={16} strokeWidth={2} />,
      }}
      toastOptions={{
        classNames: {
          toast: "group toast",
          description: "group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
