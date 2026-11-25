import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// lovable-tagger omitido: evita el badge "Edit with Lovable" en dev. Reactivar con:
// import { componentTagger } from "lovable-tagger";
// plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
// El modo de prueba del módulo Agentes (src/pruebas, ruta /agentes/prueba) existe SOLO en vistas previas de Vercel y en desarrollo. Cualquier otro build
// (producción de Vercel, Railway, cualquier otro) lo deja fuera: la constante vale false y el código se elimina del paquete.
export default defineConfig(({ mode }) => ({
  define: { __PRUEBA_DISPONIBLE__: JSON.stringify(mode === "development" || process.env.VERCEL_ENV === "preview") },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
