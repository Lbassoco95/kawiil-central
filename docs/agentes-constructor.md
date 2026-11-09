# Constructor de agentes (módulo Agentes)

Pestañas nuevas en `/agentes` (solo Dirección, mismo permiso `admin` estricto del módulo):

- **Crear agente**: chat especializado (`supabase/functions/agente-constructor`, acción `chat`). Hace las preguntas que faltan (rol, cliente, fuentes, informes, límites) y entrega una *propuesta* estructurada. Nada se crea hasta pulsar «Crear agente» (acción `crear`).
- **Instrucciones**: elegir un agente y mandarle una tarea por el despacho existente (`dispatch-to-agent` → VM `kawiil-agents`).
- Oficina: filtro nuevo **Mi equipo** (agentes con `config.origen = 'constructor_agentes'`).

## Qué escribe «crear»
Una fila en `agent_registry` (`kind='consultable'`, `status='idle'`, org global) con la misma forma que los agentes existentes: `config.system_prompt`, `tono`, `entregables`, `limites`, más `fuentes`, `cadencia`, `cliente`, `mision`, `creado_por`. El prompt lo arma el servidor (`_shared/agenteConstructor.ts`) con reglas fijas (solo lectura, borradores, sin secretos, escalar dudas legales); el modelo del chat no escribe nada. Sin migraciones ni cambios de RLS.

## Pendiente / a confirmar
- La VM `kawiil-agents` debe leer `config.system_prompt` (así lo hacen los agentes sembrados) y respetar `config.fuentes`/`cadencia`; declarar una fuente **no** da acceso por sí sola. Verificarlo en el repo `kawiil-agents`.
- Despliegue: `deploy-supabase.yml` publica la función al fusionar a `main` (no entre 6:30 y 7:00 CDMX). Requiere `ANTHROPIC_API_KEY` (ya usado por otras funciones).
- Siguientes pasos naturales: editar instrucciones permanentes de un agente ya creado, informes programados por agente y coordinación entre agentes del equipo Vizum.

## Internet y 1Password (añadido)
- La propuesta incluye `dominios_permitidos` (lista cerrada; se rechazan IP, localhost y redes internas), `paginas` (solo https, sin usuario ni contraseña) y `credenciales` (**solo referencias** `op://Bóveda/Elemento/campo`).
- **Ninguna contraseña se guarda en Kawiil.** `config.credenciales_1password` contiene solo referencias. Un mensaje del chat que parezca contener una clave se bloquea en el navegador y en la función, y no llega al modelo.
- El prompt del agente le ordena: visitar solo esos dominios, tratar lo que lea en internet como no confiable (inyección de instrucciones), usar cada acceso solo en su dominio y no hacer pagos, firmas ni envíos a autoridades.
- **Esto declara la política; la VM `kawiil-agents` debe hacerla cumplir:** navegar solo a los dominios permitidos (filtro de red, no solo el prompt), resolver `op://` con un *service account* de 1Password y mantener el valor fuera del modelo (que el navegador de la VM lo escriba directo en el formulario).
- Recomendado en 1Password: una bóveda dedicada «Agentes-Kawiil», service account de solo lectura sobre esa bóveda, cuentas de solo consulta en los portales y, para SAT/CNBV/bancos, que cualquier trámite lo haga una persona. El token del service account vive solo en el entorno de la VM, nunca en este repo ni en Supabase.

## Accesos de 1Password (punto 4)
- Cada acceso lleva `etiqueta`, `referencia` (`op://Bóveda/Elemento`) y **dominio obligatorio**. La VM solo lo usa en ese sitio.
- **Autorización por tarea:** en la pestaña «Instrucciones», al elegir un agente con accesos aparecen casillas «Autorizo usar …». Solo los marcados viajan en `input_context.accesos_aprobados`; sin eso el agente no puede iniciar sesión.
- El agente solo consulta (sin formularios, pagos ni firmas) y nunca ve la contraseña. Detalle y preparación de la VM: `ACCESOS-1PASSWORD.md` en `kawiil-agents`.

## Programar (punto 5)
Pestaña **Programar** (solo Dirección): elegir un agente del constructor con cadencia diaria o semanal, hora (México), día, la instrucción que ejecutará cada vez y, si tiene accesos de 1Password, cuáles autoriza de forma **permanente** para las corridas sin nadie presente. La función `agente-constructor` (acción `programar`) guarda `config.programacion`; el planificador de la VM (`kawiil-agents/PLANIFICADOR.md`) hace el resto.
- Guardar **no ejecuta nada al instante**: corre desde el siguiente horario. Cambiar una programación activa reinicia `activada_en`.
- Pausar = quitar la marca «activa». Tras 3 errores seguidos la VM la pausa sola y aquí aparece «Pausada automáticamente».
- Sin migración; la función se despliega al fusionar a `main` (no entre 6:30 y 7:00 CDMX).

## Enseñar habilidades (pestaña «Enseñar»)
Dirección le enseña a un agente del constructor un procedimiento que se repite, como una *skill* de Claude:
1. Elegir el agente. Opcional: elegir una tarea que ya completó como **ejemplo real** (solo se ve fecha y tipo; el servidor lee título, instrucciones, resumen y páginas consultadas, nunca contraseñas).
2. Contarle al asistente cómo se hace (cuándo se usa, qué necesita, pasos, cómo se ve un buen resultado, qué cuidar). El asistente generaliza (quita datos de un cliente concreto) y **propone** una habilidad.
3. Revisarla y decidir: **Guardar como borrador** (no se usa) o **Aprobar y activar**. Se puede desactivar, archivar o mejorar (misma habilidad = versión nueva).

Cómo «aprende»: cada vez que corrija o dé un ejemplo nuevo, se guarda una versión mejorada que una persona aprueba. **El agente nunca crea ni cambia sus habilidades solo**: así una página web o un documento con instrucciones escondidas no puede enseñarle nada.

Garantías (en código): se guardan en `config.habilidades` (sin migración); la VM solo usa las `aprobada`, las limpia y las recorta otra vez, con presupuesto de caracteres, y las presenta **subordinadas** a los límites del agente (no dan permisos, dominios ni accesos). Una habilidad no puede incluir contraseñas, referencias `op://`, direcciones con usuario/clave ni intentos de cambiar las reglas del agente. Máximo 20 activas por agente. Acciones nuevas de `agente-constructor`: `ensenar`, `guardar_habilidad`, `estado_habilidad` (solo Dirección).

Fuera de alcance por ahora: grabar la pantalla o los clics de una persona (necesita una extensión de navegador y plantea riesgos de privacidad) y que el agente proponga mejoras por su cuenta tras cada tarea.

## Documentos de clientes: Google Drive y Microsoft (pestaña «Documentos»)
Define qué carpetas puede **leer** cada agente. Se guarda solo identificadores (`config.fuentes_docs`); la VM lee en solo lectura y **únicamente dentro de la carpeta de cada fuente** (se verifica la ascendencia de cada archivo que pide). Hay dos capas de permisos: lo que el cliente comparte con la identidad de la VM, y la carpeta que aquí se le asigna al agente. Quitar cualquiera lo revoca.
- **Google Workspace:** el dueño o gestor de la carpeta la comparte como *Lector* con el correo de la cuenta de servicio de la VM, y aquí se pega el enlace de la carpeta. No hace falta ser administrador, salvo que el administrador haya restringido compartir fuera de la organización.
- **Microsoft 365 (SharePoint/OneDrive):** requiere que un administrador del cliente autorice la aplicación (`Sites.Selected`) y dé lectura al sitio. Con el enlace de la carpeta, `docs_cli.py microsoft-enlace` (en la VM) entrega `drive_id` y `carpeta_id` para capturarlos aquí.
- Guía completa y texto para el administrador del cliente: `FUENTES-DOCUMENTOS.md` en `kawiil-agents`. Acción nueva de `agente-constructor`: `fuentes_documentos` (solo Dirección).
