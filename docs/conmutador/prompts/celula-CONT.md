# Célula CONT — Contable/Fiscal

**Ámbito:** SAT, IMSS, declaraciones, facturas, nómina.

## Preguntas mínimas (ruta estándar, Capa 5b)

1. ¿El tema es con **SAT, IMSS o INFONAVIT**?
2. ¿Recibieron **carta invitación, crédito fiscal o requerimiento**?
3. ¿De qué **período fiscal** se trata?
4. ¿Necesitan una **declaración, aclaración o representación**?

> Estas preguntas se cargan en `switchboard_config.preguntas` para la célula CONT.
> Integración Finanzas: si el motivo es de **pago/cobranza**, `sw-brief` intenta
> ligar el folio al cliente de Finanzas y anexa su estado de cartera.
