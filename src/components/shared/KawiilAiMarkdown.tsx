import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

export type KawiilAiMarkdownVariant = "default" | "compact";

const structureClasses =
  "max-w-none [&_*]:break-words [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5 [&_strong]:font-semibold [&_em]:italic [&_h1]:text-base [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1.5 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-2.5 [&_h2]:mb-1 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mt-2 [&_h3]:mb-1 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/30 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground [&_a]:text-primary [&_a]:underline";

/**
 * Markdown homogéneo para textos generados por IA (negritas, listas, encabezados, emojis).
 */
export function KawiilAiMarkdown({
  children,
  className,
  variant = "default",
}: {
  children: string;
  className?: string;
  variant?: KawiilAiMarkdownVariant;
}) {
  if (!children?.trim()) return null;

  return (
    <div
      className={cn(
        variant === "compact" ? "text-[12px] sm:text-[13px]" : "text-[13px]",
        "text-foreground leading-relaxed",
        structureClasses,
        className,
      )}
    >
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
