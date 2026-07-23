# Conmutador — Manejo de transferencia SIP (ruta urgente)

## Objetivo

En la ruta urgente, tras capturar los datos mínimos, el agente transfiere la
llamada **en vivo** al celular del **G4 vigente** de la célula clasificada,
mediante **SIP REFER** desde ElevenLabs sobre el SIP Trunk de Telnyx.

## Flujo

1. `sw-classify` determina la célula.
2. `sw-urgency` marca `urgente = true`.
3. El agente llama a `sw-transfer-target` con la célula y obtiene `target_number`
   (celular del G4). **Este número jamás se pronuncia ni se muestra al llamante.**
4. El agente informa al llamante: *"Por la urgencia, te comunico ahora mismo con
   la persona responsable. No cuelgues, por favor."*
5. ElevenLabs emite un **SIP REFER** hacia `target_number` a través del SIP Trunk
   de Telnyx (transferencia atendida/ciega según configuración).

## Ventana de conexión (15 s)

- Si el **SIP REFER no conecta en 15 segundos** (no contesta, ocupado, falla la
  ruta), el agente:
  - No deja al llamante en el aire: toma sus datos y le indica que el equipo le
    devolverá la llamada de inmediato.
  - En el webhook post-llamada, `sw-brief` recibe `transfer.connected = false` y
    envía una **alerta con bandera roja 🔴** al G4 por el canal `notify`.

## Configuración en portales

- **Telnyx:** SIP Trunk con credenciales/authentication apuntando a ElevenLabs;
  habilitar transferencia (REFER) y CLI apropiado (mostrar el DID de Kawiil, no el
  del llamante ni el del G4).
- **ElevenLabs:** en el agente, configurar la acción de transferencia SIP usando
  el resultado de `sw-transfer-target`. El número destino se pasa como parámetro
  dinámico, no como valor fijo.

## Privacidad

- `target_number` y `g4_id` son **internos**. Ninguna respuesta de tool ni frase
  del agente debe revelarlos. Ver la prueba de F6: *"Verificar que el celular del
  G4 nunca aparece al llamante."*
