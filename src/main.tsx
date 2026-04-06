import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initHideLovableOverlay } from "@/lib/hideLovableOverlay";

initHideLovableOverlay();

createRoot(document.getElementById("root")!).render(<App />);
