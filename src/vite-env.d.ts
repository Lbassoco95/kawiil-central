/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SAVIO_FINANCE_MAX_PAGES?: string;
  readonly VITE_SAVIO_FINANCE_PORTFOLIO_MAX_PAGES?: string;
  /** Panel web Savio (prod o sandbox), p. ej. https://app.savio.mx */
  readonly VITE_SAVIO_APP_URL?: string;
  /** Banner DEMO del portal; no fuerza fixtures. */
  readonly VITE_PORTAL_DEMO_MODE?: string;
  /** Ocultar is_test en sesión auth (default oculto; solo false opt-out). */
  readonly VITE_PORTAL_HIDE_DIDACTIC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
