# Agentes · modo de prueba con datos de ejemplo

Para revisar la pantalla del módulo Agentes sin tocar datos reales. **Solo existe en vistas previas (Vercel preview) y en desarrollo. No existe en producción.**

## Cómo se usa
1. En la vista previa, inicia sesión como siempre y abre `/agentes/prueba` (solo Dirección, igual que `/agentes`).
2. Te lleva a `/agentes` con datos de ejemplo y una franja amarilla arriba: «DATOS DE EJEMPLO · no se envía ni se guarda nada». «Salir del modo de prueba» la apaga.
3. Dura lo que dure la pestaña del navegador; se pierde al recargar la sesión o al cerrarla. Los cambios que hagas (enviar un mensaje, pausar, habilitar, aprobar un plan) viven solo en la memoria de esa pestaña.

## Qué trae
Seis agentes inventados (Vizumi, Nelli, Vigilante SITI —creado por Vizumi, en Solo lectura—, Revisor de sanciones —creado por Vizumi y ya habilitado—, Amatl y Atl); conversaciones terminadas, en curso, con error y en espera de aprobación (con un plan propuesto); un reporte en PDF; una llamada entre agentes y otra con error. Ningún identificador, correo ni texto es real (`src/pruebas/datosEjemplo.ts`).

## Qué sustituye y qué no
- **Sustituye:** la lectura de `agent_registry`, `agent_tasks` y `agent_activity_logs`, y las funciones `agente-seguimiento`, `agente-constructor`, `dispatch-to-agent` y `agente-memoria`. Responden con el ejemplo y nunca salen a la red. Pausar, habilitar, enviar mensajes y aprobar planes **funcionan sobre el ejemplo**; crear agentes, programar, enseñar y memoria responden «Modo de prueba: no se guarda nada».
- **Bloquea:** cualquier escritura directa a cualquier otra tabla (`insert`, `update`, `upsert`, `delete`) mientras el modo esté activo.
- **No toca:** el resto de la app (correo, calendario, etc.) sigue normal y puede escribir como siempre si navegas fuera de Agentes.

## Por qué no existe en producción
- `vite.config.ts` define `__PRUEBA_DISPONIBLE__`: **true solo si el build es de desarrollo o `VERCEL_ENV=preview`**. En cualquier otro caso (producción de Vercel, Railway, cualquier otro) es `false`, y el código del modo de prueba (importado de forma dinámica detrás de esa constante) se elimina del paquete.
- Verificado el 26 nov 2026 compilando tres veces y buscando el modo de prueba en los archivos resultantes (`agentes-modo-prueba`, `DATOS DE EJEMPLO`, `/agentes/prueba`, `vigilante_siti`…):
  | Build | Aparece |
  |---|---|
  | `VERCEL_ENV=preview` | sí (1 archivo) |
  | `VERCEL_ENV=production` | no (0 archivos) |
  | sin variable (como Railway) | no (0 archivos) |
- Pruebas automáticas (`src/test/agentesPrueba.test.ts`): nada sale a la red, las demás tablas no se escriben y ningún archivo de la app importa el modo de prueba salvo `main.tsx` y `App.tsx`, de forma dinámica y detrás de la constante.
- Para comprobarlo tú: en la dirección de producción, `/agentes/prueba` debe abrir la pantalla de «página no encontrada».
