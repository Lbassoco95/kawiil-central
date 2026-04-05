import { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function AiMessageFeedback({ messageId }: { messageId: string }) {
  const { user } = useAuth();
  const [done, setDone] = useState(false);

  const { data: orgId } = useQuery({
    queryKey: ["ai-feedback-org", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;
      return data?.organization_id as string | null;
    },
    enabled: !!user,
  });

  const send = async (rating: "up" | "down") => {
    if (!user || !orgId || done) return;
    const { error } = await supabase.from("ai_feedback").insert({
      user_id: user.id,
      organization_id: orgId,
      chat_message_id: messageId,
      rating,
    });
    if (error) {
      if (error.message.includes("duplicate") || error.code === "23505") {
        setDone(true);
        return;
      }
      toast.error(error.message);
      return;
    }
    setDone(true);
    toast.success("Gracias por tu opinión");
  };

  return (
    <div className="flex items-center gap-1 mt-1.5 ml-10 opacity-70 hover:opacity-100 transition-opacity">
      <span className="text-[10px] text-muted-foreground mr-1">¿Útil?</span>
      <button
        type="button"
        disabled={done}
        className={cn("p-1 rounded-md hover:bg-secondary/80", done && "pointer-events-none opacity-40")}
        aria-label="Respuesta útil"
        onClick={() => void send("up")}
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={done}
        className={cn("p-1 rounded-md hover:bg-secondary/80", done && "pointer-events-none opacity-40")}
        aria-label="Respuesta poco útil"
        onClick={() => void send("down")}
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
