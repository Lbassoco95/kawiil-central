# Worker Múuch' (Node)

Variables (documentar en `.env.example`, Polo las pone en la VM):

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
OPENCLAW_GATEWAY_URL=http://host.docker.internal:3000
OPENCLAW_GATEWAY_TOKEN=
MTG_GATEWAY_MOCK=0
MTG_GRAPH_MOCK=0
```

Compose propuesto (no aplicar sin Polo): `extra_hosts: host.docker.internal:host-gateway`.
