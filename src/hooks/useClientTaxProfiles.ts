/**
 * Perfiles fiscales del cliente (Ju'un, `fis_tax_profiles`).
 *
 * Acceso directo a la tabla: no hace falta Edge Function porque aquí no hay
 * nada cifrado — son datos públicos de la Constancia de Situación Fiscal. La
 * RLS por organización es la que aísla. (La e.firma y la CIEC, que sí son
 * secretos, viven en otro módulo y Ju'un no los toca.)
 *
 * El PDF de la CSF va al bucket privado `juun` y solo se lee por signed URL de
 * vida corta.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  juunDb,
  type FisTaxProfileInsert,
  type FisTaxProfileRow,
} from "@/lib/juun/db";
import {
  JUUN_BUCKET,
  JUUN_SIGNED_URL_TTL_SECONDS,
  buildJuunPath,
} from "@/lib/juun/storagePaths";
import { normalizarRfc } from "@/lib/juun/rfc";

export type TaxProfile = FisTaxProfileRow;

const KEY = (clientId: string | undefined) => ["juun-tax-profiles", clientId] as const;

export interface TaxProfileFormValues {
  rfc: string;
  razon_social: string;
  cp_fiscal: string;
  regimen_fiscal: string;
  uso_cfdi_default: string;
  email_recepcion: string | null;
}

async function resolveOrgId(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  if (!data?.organization_id) throw new Error("Tu usuario no tiene organización asignada.");
  return data.organization_id;
}

/** Sube la CSF y devuelve su ruta. El nombre original no se conserva: no aporta y sí ensucia. */
async function uploadCsf(file: File, organizationId: string, clientId: string): Promise<string> {
  const path = buildJuunPath({
    organizationId,
    clientId,
    kind: "csf",
    fileName: file.name,
  });
  const { error } = await supabase.storage.from(JUUN_BUCKET).upload(path, file, {
    contentType: file.type || "application/pdf",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

async function removeQuietly(path: string | null | undefined) {
  if (!path) return;
  try {
    await supabase.storage.from(JUUN_BUCKET).remove([path]);
  } catch {
    // Un archivo huérfano en storage no justifica romperle la operación al usuario.
  }
}

export function useClientTaxProfiles(clientId: string | undefined) {
  const { user } = useAuth();
  return useQuery<TaxProfile[]>({
    queryKey: KEY(clientId),
    enabled: !!user && !!clientId,
    queryFn: async () => {
      const { data, error } = await juunDb
        .from("fis_tax_profiles")
        .select("*")
        .eq("client_id", clientId!)
        .order("is_default", { ascending: false })
        .order("active", { ascending: false })
        .order("razon_social", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TaxProfile[];
    },
  });
}

export function useCreateTaxProfile(clientId: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ values, csfFile }: { values: TaxProfileFormValues; csfFile?: File | null }) => {
      const orgId = await resolveOrgId(user!.id);
      let csfPath: string | null = null;
      if (csfFile) csfPath = await uploadCsf(csfFile, orgId, clientId);

      const row: FisTaxProfileInsert = {
        organization_id: orgId,
        client_id: clientId,
        rfc: normalizarRfc(values.rfc),
        razon_social: values.razon_social.trim(),
        cp_fiscal: values.cp_fiscal.trim(),
        regimen_fiscal: values.regimen_fiscal,
        uso_cfdi_default: values.uso_cfdi_default,
        email_recepcion: values.email_recepcion?.trim() || null,
        csf_file_path: csfPath,
        created_by: user!.id,
      };

      const { data, error } = await juunDb.from("fis_tax_profiles").insert(row).select().single();
      if (error) {
        await removeQuietly(csfPath);
        throw error;
      }
      return data as TaxProfile;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY(clientId) }),
  });
}

export function useUpdateTaxProfile(clientId: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      profile,
      values,
      csfFile,
    }: {
      profile: TaxProfile;
      values: TaxProfileFormValues;
      csfFile?: File | null;
    }) => {
      let nuevaCsf: string | null = null;
      if (csfFile) {
        const orgId = await resolveOrgId(user!.id);
        nuevaCsf = await uploadCsf(csfFile, orgId, clientId);
      }

      const rfcNuevo = normalizarRfc(values.rfc);
      // Cambiar el RFC invalida la verificación anterior: se verificó otro dato.
      const cambioRfc = rfcNuevo !== profile.rfc;

      const { data, error } = await juunDb
        .from("fis_tax_profiles")
        .update({
          rfc: rfcNuevo,
          razon_social: values.razon_social.trim(),
          cp_fiscal: values.cp_fiscal.trim(),
          regimen_fiscal: values.regimen_fiscal,
          uso_cfdi_default: values.uso_cfdi_default,
          email_recepcion: values.email_recepcion?.trim() || null,
          ...(nuevaCsf ? { csf_file_path: nuevaCsf } : {}),
          ...(cambioRfc || nuevaCsf ? { csf_verified_at: null, csf_verified_by: null } : {}),
        })
        .eq("id", profile.id)
        .select()
        .single();

      if (error) {
        await removeQuietly(nuevaCsf);
        throw error;
      }
      if (nuevaCsf) await removeQuietly(profile.csf_file_path);
      return data as TaxProfile;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY(clientId) }),
  });
}

/** Baja lógica. No se borra: los tickets ya facturados apuntan a este perfil. */
export function useDeactivateTaxProfile(clientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (profileId: string) => {
      const { error } = await juunDb
        .from("fis_tax_profiles")
        .update({ active: false })
        .eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY(clientId) }),
  });
}

export function useReactivateTaxProfile(clientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (profileId: string) => {
      const { error } = await juunDb
        .from("fis_tax_profiles")
        .update({ active: true })
        .eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY(clientId) }),
  });
}

/** Marcar predeterminado. El trigger de la base desmarca a los demás. */
export function useSetDefaultTaxProfile(clientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (profileId: string) => {
      const { error } = await juunDb
        .from("fis_tax_profiles")
        .update({ is_default: true })
        .eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY(clientId) }),
  });
}

/**
 * Sello de revisión humana contra la CSF. Por ahora se pone a mano; cuando
 * exista lectura automática de la constancia, este mismo campo lo llenará el
 * proceso.
 */
export function useMarkCsfVerified(clientId: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ profileId, verified }: { profileId: string; verified: boolean }) => {
      const { error } = await juunDb
        .from("fis_tax_profiles")
        .update(
          verified
            ? { csf_verified_at: new Date().toISOString(), csf_verified_by: user!.id }
            : { csf_verified_at: null, csf_verified_by: null }
        )
        .eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY(clientId) }),
  });
}

/** Signed URL de vida corta para abrir la CSF. Se genera al momento de la descarga, nunca se guarda. */
export async function getCsfSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(JUUN_BUCKET)
    .createSignedUrl(path, JUUN_SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error("No se pudo generar el enlace de descarga.");
  return data.signedUrl;
}
