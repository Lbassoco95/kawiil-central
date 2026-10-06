import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import tailwind from "tailwindcss";
import autoprefixer from "autoprefixer";

/**
 * Build SEPARADO del portal del cliente. No incluye código ni rutas del
 * back-office: su entrada es portal/index.html → src/portal/main.tsx, y la
 * prueba src/test/portal/boundary.test.ts impide importar páginas, layouts,
 * contextos u hooks de central.
 *   npm run dev:portal    → http://localhost:8081
 *   npm run build:portal  → dist-portal/
 * El dominio público es VITE_PORTAL_PUBLIC_URL (no se fija aquí).
 */
export default defineConfig({
  root: path.resolve(__dirname, "portal"),
  envDir: path.resolve(__dirname),
  publicDir: path.resolve(__dirname, "portal/public"),
  server: {
    host: "::",
    port: 8081,
    hmr: { overlay: false },
    // Entrada portal/index.html → ../src/portal (fuera del root Vite).
    fs: { allow: [path.resolve(__dirname)] },
  },
  preview: { port: 8081 },
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwind({ config: path.resolve(__dirname, "tailwind.config.portal.ts") }), autoprefixer()],
    },
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: {
    outDir: path.resolve(__dirname, "dist-portal"),
    emptyOutDir: true,
  },
});
