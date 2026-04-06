import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// lovable-tagger omitido: evita el badge "Edit with Lovable" en dev. Reactivar con:
// import { componentTagger } from "lovable-tagger";
// plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
export default defineConfig(() => ({
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
