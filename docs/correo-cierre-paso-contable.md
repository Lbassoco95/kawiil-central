# Correo → cierre del paso del periodo contable

Cuando se envía al cliente una **plantilla contable de declaraciones**, el paso
**«Envío de acuses al cliente»** del periodo correspondiente se cierra solo.

## Cómo funciona

| Pieza | Archivo | Rol |
|---|---|---|
| Lógica (única fuente de verdad) | `src/lib/accountingEmailStepSync.ts` | Mapea categoría → paso, elige el periodo, marca el paso y permite deshacer |
| Enganche de UI | `src/hooks/useAccountingEmailStepSync.ts` | Aviso, «Deshacer» e invalidación de queries |
| Pruebas | `src/lib/accountingEmailStepSync.test.ts` | Cubre la lógica pura |

Categorías que cierran el paso (`ACCOUNTING_EMAIL_STEP_BY_CATEGORY`):
`pagos_provisionales`, `declaracion_ceros`, `envio_anuales`,
`previos_provisionales`, `isn_imss`, `envio_nominas`.

### Qué periodo se cierra

Las declaraciones de un mes se presentan y se mandan al cliente el mes
**siguiente** (los acuses de julio se envían en agosto). Por eso el orden de
búsqueda es: **mes anterior → mes en curso → hasta 3 meses atrás**, y se toma el
primer periodo que tenga el paso pendiente.

> Antes se buscaba solo el mes en curso: por eso, al enviar los acuses de julio
> en agosto, el paso nunca se cerraba.

### Qué cliente / proyecto

En este orden:

1. El cliente elegido en «Plantillas contables».
2. `projectId` / `periodId` del contexto (correo compuesto desde el proyecto).
3. Los destinatarios del correo, contra `clients.email`.

## Contrato para quien toque la sección de Correo

**Todo punto de envío que pueda insertar una plantilla contable debe avisar tras
un envío exitoso.** Rutas ya enganchadas:

- `ComposeEmailDialog` → prop `onAfterSend` (`emitAfterSend`), disparada en las
  tres rutas: cuenta principal, cuentas vinculadas (Outlook/Gmail) y respuesta
  enganchada al hilo. El envío **programado** no la dispara a propósito: el
  correo todavía no sale.
- `ReplyForwardDialog` → prop `onTemplateApplied`; el padre (`EmailView`,
  `MailPreview`) guarda la info y llama al hook cuando la mutación de envío
  termina bien.
- `AccountingDashboard` («Enviar correo al cliente») → `onAfterSend`.

Si agregas un composer o una ruta de envío nueva:

```tsx
const syncAccountingStep = useAccountingEmailStepSync();
// ...tras el envío exitoso:
onAfterSend={(info) => void syncAccountingStep(info)}
```

No dupliques la lógica en el componente: si la vuelves a escribir a mano, se
pierde en el siguiente cambio de la sección de Correo (que es justo lo que
pasó antes de este documento).

## Qué ve el usuario

- Se cierra el paso, se registra `completed_at`, `completed_by` y una nota de
  auditoría con fecha, destinatarios, asunto y adjuntos.
- Aviso `«Envío de acuses al cliente» completado — Julio 2026` con botón
  **Deshacer** (10 s).
- Si no se pudo identificar cliente o periodo, el aviso lo dice y sugiere elegir
  el cliente en «Plantillas contables»; el correo siempre se envía igual.
