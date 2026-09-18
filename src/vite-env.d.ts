/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SAVIO_FINANCE_MAX_PAGES?: string;
  readonly VITE_SAVIO_FINANCE_PORTFOLIO_MAX_PAGES?: string;
  /** Panel web Savio (prod o sandbox), p. ej. https://app.savio.mx */
  readonly VITE_SAVIO_APP_URL?: string;
  /** Módulo Múuch' (juntas con clientes). true | 1 para mostrar pestaña Juntas. */
  readonly VITE_MTG_JUNTAS_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
