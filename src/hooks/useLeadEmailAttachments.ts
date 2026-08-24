import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Adjuntos de un correo del lead.
 *
 * No viven en la base: `email_log` sólo guarda la bandera `has_attachments`.
 * Los archivos se leen del buzón bajo demanda (al abrir el correo) y se
 * descargan uno a uno, para no traer megas que casi nunca se ocupan.
 */

export interface LeadEmailAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number | null;
  downloadable: boolean;
}

export function useLeadEmailAttachments(emailLogId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["lead-email-attachments", emailLogId],
    enabled: !!emailLogId && enabled,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("lead-email-attachments", {
        body: { email_log_id: emailLogId },
      });
      if (error) throw error;
      const res = data as { attachments?: LeadEmailAttachment[]; error?: string };
      if (res?.error) throw new Error(res.error);
      return res.attachments ?? [];
    },
  });
}

/** Trae UN adjunto con su contenido en base64 para descargarlo. */
export function useDownloadLeadEmailAttachment() {
  return useMutation({
    mutationFn: async (vars: { emailLogId: string; attachmentId: string }) => {
      const { data, error } = await supabase.functions.invoke("lead-email-attachments", {
        body: { email_log_id: vars.emailLogId, attachment_id: vars.attachmentId },
      });
      if (error) throw error;
      const res = data as {
        attachment?: { name: string; contentType: string; contentBytes: string };
        error?: string;
      };
      if (res?.error) throw new Error(res.error);
      if (!res.attachment) throw new Error("El buzón no devolvió el adjunto");
      return res.attachment;
    },
  });
}
