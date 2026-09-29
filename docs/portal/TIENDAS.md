# Del PWA a App Store y Google Play (Capacitor)

Estado hoy: el portal es una PWA instalable (`portal/public/manifest.webmanifest`, `sw.js` solo en línea, iconos 192/512/maskable/apple-touch). Este documento lista lo que falta para empaquetarla con Capacitor. **No se creó ninguna cuenta de tienda** (depende de Kawiil).

## 1. Empaquetado
1. `npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android` y `npx cap init "Kawiil" mx.kawiil.portal --web-dir=dist-portal`.
2. `npm run build:portal && npx cap sync`.
3. En la app nativa, Supabase Auth necesita el esquema profundo (`mx.kawiil.portal://`) en *Auth → URL Configuration → Redirect URLs* para confirmación y recuperación de contraseña. Hoy los enlaces van a `PORTAL_PUBLIC_URL`.
4. El service worker no se usa dentro de Capacitor; la pantalla «Sin conexión» debe replicarse con `@capacitor/network`.

## 2. Funciones nativas necesarias
| Función | Plugin | Uso en el portal | Texto de permiso (español de México) |
|---|---|---|---|
| Cámara | `@capacitor/camera` | Fotografiar tickets (hoy `<input capture>`) | «Kawiil usa la cámara para fotografiar sus tickets de gasto.» |
| Fotos | `@capacitor/camera` | Elegir tickets de la galería | «Kawiil necesita acceso a sus fotos para subir tickets que ya fotografió.» |
| Push | `@capacitor/push-notifications` (APNs + FCM) | Respuesta del equipo, documento nuevo, ticket facturado. Hoy se avisa por correo (`portal-notify`); falta tabla de tokens y envío. | — |
| Biometría | p. ej. `@capgo/capacitor-native-biometric` | Desbloqueo rápido guardando el refresh token en el llavero (Keychain/Keystore), nunca en `localStorage` | «Use Face ID / huella para entrar a su portal.» |
| Archivos | `@capacitor/filesystem` + `share` | Abrir XML/PDF descargados (enlaces firmados de 120 s) | — |

## 3. Requisitos de las tiendas
- **Política de privacidad pública** en una URL estable (Apple y Google la piden en la ficha). Hoy existe `/legal/aviso_privacidad` dentro del portal con el texto **marcador**: Kawiil debe publicar el definitivo (LFPDPPP) y esa URL.
- **Eliminación de cuenta desde la app**: hecha (Cuenta → «Eliminar mi cuenta», `v1/cuenta.eliminar`, con bitácora). Google Play pide además una **URL web** para solicitar la eliminación sin instalar la app: falta publicarla (puede ser una página que explique «Ingrese al portal → Cuenta → Eliminar»).
- **Cuenta de prueba para el revisor**: crear un cliente sintético (sin datos reales) con emisión en modo prueba, documentos de ejemplo publicados y un hilo de mensajes; dar usuario y contraseña en *App Review Information* / *Play Console → App access*. No usar clientes piloto.
- **Etiquetas de privacidad** (Apple «Privacy Nutrition Labels» / Google «Data safety»): datos de contacto (correo, nombre), datos financieros (facturas, tickets), identificadores (RFC), fotos (tickets). Sin rastreo publicitario. Cifrado en tránsito; eliminación a solicitud.
- **Inicio de sesión con terceros**: no hay; si se agrega Google, Apple exige «Sign in with Apple».
- **Cifrado de exportación** (Apple): solo HTTPS estándar → declarar exención.
- Pantalla de arranque: en Capacitor con `@capacitor/splash-screen` (fondo `#0000A1`, logotipo blanco). En la PWA, Android la genera del manifest; iOS necesita `apple-touch-startup-image` por tamaño (pendiente).

## 4. Riesgos de rechazo
| Riesgo | Tienda | Mitigación |
|---|---|---|
| «Es solo un sitio web empaquetado» (Guideline 4.2) | Apple | Cámara nativa, push, biometría y archivos nativos antes de enviar. |
| Textos legales marcadores | Ambas | Sustituir los cuatro marcadores (`portal_legal_documents`) antes de enviar. |
| El revisor no puede entrar (cuenta pendiente de vinculación) | Ambas | Cuenta de prueba ya vinculada; explicar en notas que el registro público queda pendiente hasta que Kawiil vincula. |
| Facturas «de prueba» visibles como si fueran reales | Ambas | Ya se marcan «Prueba sin validez fiscal»; en la cuenta del revisor, dejarlo explícito en las notas. |
| Funciones de pago dentro de la app (nivel básico «contratar») | Apple (3.1.1) | El portal no cobra: «contratar» abre un hilo con Kawiil. No agregar pagos dentro de la app sin revisar reglas de compras integradas. |
| Falta la URL web de eliminación de cuenta | Google | Publicarla (ver §3). |
| Permisos sin explicación | Ambas | Textos de §2 en `Info.plist` / `AndroidManifest`. |
| Datos sensibles (RFC, facturas) sin declarar | Google | Completar *Data safety* igual que §3. |
