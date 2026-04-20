import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  functionInvokeUserMessage,
  invokeFunctionWithSession,
} from "@/lib/supabaseInvoke";

export type SatCertType = "fiel" | "csd_sello";

export interface SatCertificateSummary {
  id: string;
  certType: SatCertType;
  label: string | null;
  certSerial: string | null;
  certSubjectRfc: string | null;
  certNotBefore: string | null;
  certNotAfter: string | null;
  certFingerprint: string | null;
  updatedAt: string;
  daysLeft: number | null;
}

export interface SatCertificatesListResponse {
  items: SatCertificateSummary[];
  fiel: SatCertificateSummary | null;
  csds: SatCertificateSummary[];
  configured: boolean;
  certFingerprint: string | null;
  updatedAt: string | null;
}

export interface SaveCertificateInput {
  clientId: string;
  certType: SatCertType;
  certificateBase64: string;
  privateKeyBase64: string;
  label?: string | null;
  forceRfcMismatch?: boolean;
}

export interface SaveCertificateRfcMismatchError extends Error {
  code: "rfc_mismatch";
  certificateRfc: string | null;
  clientRfc: string | null;
}

export function isRfcMismatchError(
  err: unknown,
): err is SaveCertificateRfcMismatchError {
  return (
    err instanceof Error &&
    (err as SaveCertificateRfcMismatchError).code === "rfc_mismatch"
  );
}

const KEY = (clientId: string) => ["client-sat-certs", clientId] as const;

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result as string;
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export function useClientSatCertificates(clientId: string) {
  const { user, session } = useAuth();
  return useQuery<SatCertificatesListResponse>({
    queryKey: KEY(clientId),
    enabled: !!user && !!session?.access_token && !!clientId,
    queryFn: async () => {
      const { data, error } = await invokeFunctionWithSession(
        "client-sat-certificates",
        { action: "list", clientId },
      );
      const payload = (data ?? {}) as Partial<SatCertificatesListResponse> & {
        error?: string;
      };
      if (payload.error || error) {
        throw new Error(functionInvokeUserMessage(data, error));
      }
      return {
        items: payload.items ?? [],
        fiel: payload.fiel ?? null,
        csds: payload.csds ?? [],
        configured: payload.configured ?? false,
        certFingerprint: payload.certFingerprint ?? null,
        updatedAt: payload.updatedAt ?? null,
      };
    },
  });
}

export function useSaveClientSatCertificate(clientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveCertificateInput) => {
      const { data, error } = await invokeFunctionWithSession(
        "client-sat-certificates",
        {
          action: "save",
          clientId: input.clientId,
          certType: input.certType,
          certificateBase64: input.certificateBase64,
          privateKeyBase64: input.privateKeyBase64,
          label: input.label ?? null,
          forceRfcMismatch: input.forceRfcMismatch ?? false,
        },
      );
      const payload = (data ?? {}) as {
        error?: string;
        message?: string;
        certificateRfc?: string | null;
        clientRfc?: string | null;
        certificate?: SatCertificateSummary;
      };
      if (payload.error === "rfc_mismatch") {
        const e = new Error(
          payload.message ?? "El RFC del certificado no coincide.",
        ) as SaveCertificateRfcMismatchError;
        e.code = "rfc_mismatch";
        e.certificateRfc = payload.certificateRfc ?? null;
        e.clientRfc = payload.clientRfc ?? null;
        throw e;
      }
      if (payload.error || error) {
        throw new Error(functionInvokeUserMessage(data, error));
      }
      return payload.certificate ?? null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY(clientId) });
      queryClient.invalidateQueries({
        queryKey: ["moffin-fiel-status", clientId],
      });
    },
  });
}

export function useDeleteClientSatCertificate(clientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      certificateId?: string;
      certType?: SatCertType;
    }) => {
      const body: Record<string, unknown> = { action: "delete" };
      if (input.certificateId) body.certificateId = input.certificateId;
      else {
        body.clientId = clientId;
        body.certType = input.certType ?? "fiel";
      }
      const { data, error } = await invokeFunctionWithSession(
        "client-sat-certificates",
        body,
      );
      const payload = (data ?? {}) as { error?: string; message?: string };
      if (payload.error || error) {
        throw new Error(functionInvokeUserMessage(data, error));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY(clientId) });
      queryClient.invalidateQueries({
        queryKey: ["moffin-fiel-status", clientId],
      });
    },
  });
}
