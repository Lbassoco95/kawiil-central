# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Kawiil OS is a React + Vite + TypeScript SPA (single-page application) that connects to a **remote Supabase** backend (`qppfampapbxdgednkofc.supabase.co`). No local database, Docker, or backend server is needed.

### Node.js

The environment uses **nvm** located at `/home/ubuntu/.nvm`. Before running any node/npm command:

```bash
export NVM_DIR="/home/ubuntu/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
```

### Key commands

| Action | Command |
|--------|---------|
| Install deps | `npm install` |
| Dev server | `npm run dev` (port 8080) |
| Lint | `npm run lint` |
| Tests | `npm run test` |
| Build | `npm run build` |

### Notes

- The `.env` file is already committed with the correct Supabase credentials. **Do not modify** these values (see `.cursor/rules/supabase-config.mdc`).
- ESLint will report pre-existing warnings/errors (`@typescript-eslint/no-explicit-any`, `react-hooks/exhaustive-deps`). These are known and do not indicate a broken setup.
- The dev server binds to `::` (all interfaces) on port 8080 with HMR overlay disabled.
- Authentication requires a valid Supabase account on the `qppfampapbxdgednkofc` project. Without test credentials, you can verify the app loads the login page but cannot go further.
- Edge Functions are deployed remotely; they don't run locally during frontend development.
