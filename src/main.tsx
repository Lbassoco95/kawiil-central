import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initHideLovableOverlay } from "@/lib/hideLovableOverlay";

initHideLovableOverlay();

const arrancar = () => createRoot(document.getElementById("root")!).render(<App />);
// Modo de prueba del módulo Agentes: solo existe en vistas previas y desarrollo (en producción esta rama se elimina del paquete).
if (__PRUEBA_DISPONIBLE__) void import("./pruebas/modoPrueba").then((m) => { m.instalarSiCorresponde(); arrancar(); }); else arrancar();
