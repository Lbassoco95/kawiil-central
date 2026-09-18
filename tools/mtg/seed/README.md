# Loaders de seed Múuch'

- `load-demo.ts` — cliente sintético local.
- `load-grupo-sylon.ts` — requiere `SEED_JSON` apuntando a un JSON **fuera del repo**.

```bash
SEED_JSON=$HOME/Downloads/mtg-seed-grupo-sylon-2026-09-17.json \
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
npx tsx tools/mtg/seed/load-grupo-sylon.ts
```

No commitear archivos `.json` aquí.
