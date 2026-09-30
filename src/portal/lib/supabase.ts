import { createClient } from "@supabase/supabase-js";

const url = String(import.meta.env.VITE_PORTAL_SUPABASE_URL ?? "").trim();
const publishableKey = String(import.meta.env.VITE_PORTAL_SUPABASE_PUBLISHABLE_KEY ?? "").trim();

if (!url || !publishableKey) throw new Error("Kawiil OS no está configurado: faltan las variables de su proyecto Supabase independiente.");
if (url === String(import.meta.env.VITE_SUPABASE_URL ?? "").trim()) throw new Error("Kawiil OS se niega a usar el proyecto Supabase de central.");

export const db = createClient(url, publishableKey, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});
