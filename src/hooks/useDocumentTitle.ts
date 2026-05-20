import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/clientes': 'Clientes',
  '/proyectos': 'Proyectos',
  '/tareas': 'Tareas',
  '/microsoft365/calendario': 'Calendario',
  '/microsoft365/correo': 'Correo',
  '/documentos': 'Documentos',
  '/hub': 'Hub',
  '/notificaciones': 'Notificaciones',
  '/comunicacion': 'Comunicación',
  '/asistente': 'Asistente IA',
  '/conocimiento': 'Conocimiento',
  '/finanzas': 'Finanzas',
  '/pipeline': 'Pipeline · Tablero',
  '/pipeline/dashboard': 'Pipeline · Dashboard',
  '/pipeline/list': 'Pipeline · Lista',
  '/pipeline/leads': 'Pipeline · Lead',
  '/pipeline/activities': 'Pipeline · Actividades',
  '/pipeline/templates': 'Pipeline · Plantillas',
  '/pipeline/sequences': 'Pipeline · Secuencias',
  '/pipeline/settings': 'Pipeline · Ajustes',
  '/contabilidad/plantillas': 'Contabilidad · Plantillas',
  '/configuracion': 'Configuración',
  '/accesibilidad': 'Accesibilidad',
};

function resolveTitle(pathname: string): string | null {
  // Coincidencia exacta primero
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname];

  // Prefijo más largo que coincida (para rutas dinámicas como /clientes/:id)
  const sorted = Object.keys(ROUTE_TITLES).sort((a, b) => b.length - a.length);
  for (const route of sorted) {
    if (route !== '/' && pathname.startsWith(route + '/')) {
      return ROUTE_TITLES[route];
    }
  }

  return null;
}

export function useDocumentTitle() {
  const { pathname } = useLocation();

  useEffect(() => {
    const title = resolveTitle(pathname);
    document.title = title ? `${title} | Kawiil OS` : 'Kawiil OS';
  }, [pathname]);
}
