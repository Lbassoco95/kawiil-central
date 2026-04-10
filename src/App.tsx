import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
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
import Comunicacion from "./pages/Comunicacion";
import AsistenteIA from "./pages/AsistenteIA";
import BaseConocimiento from "./pages/BaseConocimiento";
import Finanzas from "./pages/Finanzas";
import NotFound from "./pages/NotFound";
import PipelineLayout from "./pages/pipeline/PipelineLayout";
import PipelineBoard from "./pages/pipeline/PipelineBoard";
import PipelineList from "./pages/pipeline/PipelineList";
import LeadDetailPage from "./pages/pipeline/LeadDetailPage";
import PipelineAnalytics from "./pages/pipeline/PipelineAnalytics";
import EmailTemplates from "./pages/pipeline/EmailTemplates";
import EmailSequences from "./pages/pipeline/EmailSequences";
import PipelineSettings from "./pages/pipeline/PipelineSettings";
import PipelineActivities from "./pages/pipeline/PipelineActivities";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <ErrorBoundary>
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/cambiar-contrasena" element={<CambiarContrasena />} />
              <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/dashboard" element={<ProtectedRoute><Navigate to="/" replace /></ProtectedRoute>} />
              <Route path="/clientes" element={<ProtectedRoute><Clientes /></ProtectedRoute>} />
              <Route path="/clientes/:id" element={<ProtectedRoute><ClienteDetalle /></ProtectedRoute>} />
              <Route path="/proyectos" element={<ProtectedRoute><Proyectos /></ProtectedRoute>} />
              <Route path="/proyectos/:id" element={<ProtectedRoute><ProyectoDetalle /></ProtectedRoute>} />
              <Route path="/tareas" element={<ProtectedRoute><Tareas /></ProtectedRoute>} />
              <Route
                path="/calendario"
                element={
                  <ProtectedRoute>
                    <ModuleGate moduleKey="calendario">
                      <Navigate to="/microsoft365/calendario" replace />
                    </ModuleGate>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/correo"
                element={
                  <ProtectedRoute>
                    <ModuleGate moduleKey="correo">
                      <Navigate to="/microsoft365/correo" replace />
                    </ModuleGate>
                  </ProtectedRoute>
                }
              />
              <Route path="/microsoft365" element={<Navigate to="/microsoft365/calendario" replace />} />
              <Route path="/microsoft365/calendario" element={<ProtectedRoute><ModuleGate moduleKey="calendario"><Microsoft365Calendario /></ModuleGate></ProtectedRoute>} />
              <Route path="/microsoft365/correo" element={<ProtectedRoute><ModuleGate moduleKey="correo"><Microsoft365Correo /></ModuleGate></ProtectedRoute>} />
              <Route path="/documentos" element={<ProtectedRoute><ModuleGate moduleKey="documentos"><Documentos /></ModuleGate></ProtectedRoute>} />
              <Route path="/hub" element={<ProtectedRoute><ModuleGate moduleKey="hub"><Hub /></ModuleGate></ProtectedRoute>} />
              <Route path="/despacho" element={<Navigate to="/hub" replace />} />
              <Route path="/notificaciones" element={<ProtectedRoute><Notificaciones /></ProtectedRoute>} />
              <Route path="/comunicacion" element={<ProtectedRoute><Comunicacion /></ProtectedRoute>} />
              <Route path="/asistente" element={<ProtectedRoute><ModuleGate moduleKey="ai"><AsistenteIA /></ModuleGate></ProtectedRoute>} />
              <Route path="/conocimiento" element={<ProtectedRoute><ModuleGate moduleKey="conocimiento"><BaseConocimiento /></ModuleGate></ProtectedRoute>} />
              <Route path="/finanzas" element={<ProtectedRoute><ModuleGate moduleKey="finanzas"><Finanzas /></ModuleGate></ProtectedRoute>} />
              <Route
                path="/pipeline"
                element={
                  <ProtectedRoute>
                    <ModuleGate moduleKey="pipeline">
                      <PipelineLayout />
                    </ModuleGate>
                  </ProtectedRoute>
                }
              >
                <Route index element={<PipelineBoard />} />
                <Route path="list" element={<PipelineList />} />
                <Route path="leads/:id" element={<LeadDetailPage />} />
                <Route path="analytics" element={<PipelineAnalytics />} />
                <Route path="activities" element={<PipelineActivities />} />
                <Route path="templates" element={<EmailTemplates />} />
                <Route path="sequences" element={<EmailSequences />} />
                <Route path="settings" element={<PipelineSettings />} />
              </Route>
              <Route path="/admin" element={<ProtectedRoute><ModuleGate moduleKey="admin"><Admin /></ModuleGate></ProtectedRoute>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
