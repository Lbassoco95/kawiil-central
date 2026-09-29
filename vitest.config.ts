import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      // Los módulos compartidos con Deno importan "npm:<paquete>@<versión>"; en Vitest es el paquete de node_modules.
      { find: /^npm:(node-forge)@[\d.]+$/, replacement: "$1" },
    ],
  },
});
