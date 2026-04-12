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
