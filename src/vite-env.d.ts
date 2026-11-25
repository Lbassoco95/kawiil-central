/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SAVIO_FINANCE_MAX_PAGES?: string;
  readonly VITE_SAVIO_FINANCE_PORTFOLIO_MAX_PAGES?: string;
  /** Panel web Savio (prod o sandbox), p. ej. https://app.savio.mx */
  readonly VITE_SAVIO_APP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** true solo en vistas previas y desarrollo: habilita el modo de prueba del módulo Agentes (src/pruebas). */
declare const __PRUEBA_DISPONIBLE__: boolean;
