import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ModuleGate } from "@/components/ModuleGate";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Clientes from "./pages/Clientes";
import Proyectos from "./pages/Proyectos";
import Tareas from "./pages/Tareas";
import Documentos from "./pages/Documentos";
import Admin from "./pages/Admin";
import ClienteDetalle from "./pages/ClienteDetalle";
import ProyectoDetalle from "./pages/ProyectoDetalle";
import CambiarContrasena from "./pages/CambiarContrasena";
import Microsoft365Calendario from "./pages/Microsoft365Calendario";
import Microsoft365Correo from "./pages/Microsoft365Correo";
import Hub from "./pages/Hub";
import Notificaciones from "./pages/Notificaciones";
import AsistenteIA from "./pages/AsistenteIA";
import BaseConocimiento from "./pages/BaseConocimiento";
import Finanzas from "./pages/Finanzas";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/cambiar-contrasena" element={<CambiarContrasena />} />
            <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/clientes" element={<ProtectedRoute><Clientes /></ProtectedRoute>} />
            <Route path="/clientes/:id" element={<ProtectedRoute><ClienteDetalle /></ProtectedRoute>} />
            <Route path="/proyectos" element={<ProtectedRoute><Proyectos /></ProtectedRoute>} />
            <Route path="/proyectos/:id" element={<ProtectedRoute><ProyectoDetalle /></ProtectedRoute>} />
            <Route path="/tareas" element={<ProtectedRoute><Tareas /></ProtectedRoute>} />
            <Route path="/microsoft365" element={<Navigate to="/microsoft365/calendario" replace />} />
            <Route path="/microsoft365/calendario" element={<ProtectedRoute><ModuleGate moduleKey="calendario"><Microsoft365Calendario /></ModuleGate></ProtectedRoute>} />
            <Route path="/microsoft365/correo" element={<ProtectedRoute><ModuleGate moduleKey="correo"><Microsoft365Correo /></ModuleGate></ProtectedRoute>} />
            <Route path="/documentos" element={<ProtectedRoute><ModuleGate moduleKey="documentos"><Documentos /></ModuleGate></ProtectedRoute>} />
            <Route path="/hub" element={<ProtectedRoute><ModuleGate moduleKey="hub"><Hub /></ModuleGate></ProtectedRoute>} />
            <Route path="/despacho" element={<Navigate to="/hub" replace />} />
            <Route path="/notificaciones" element={<ProtectedRoute><Notificaciones /></ProtectedRoute>} />
            <Route path="/asistente" element={<ProtectedRoute><ModuleGate moduleKey="ai"><AsistenteIA /></ModuleGate></ProtectedRoute>} />
            <Route path="/conocimiento" element={<ProtectedRoute><ModuleGate moduleKey="ai"><BaseConocimiento /></ModuleGate></ProtectedRoute>} />
            <Route path="/finanzas" element={<ProtectedRoute><ModuleGate moduleKey="finanzas"><Finanzas /></ModuleGate></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute><ModuleGate moduleKey="admin"><Admin /></ModuleGate></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
