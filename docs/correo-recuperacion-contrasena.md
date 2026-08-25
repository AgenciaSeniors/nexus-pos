# Correo de recuperación de contraseña (código de 6 dígitos)

Esta guía explica por qué el código de recuperación puede **no llegar** aunque
la app lo pida correctamente, y cómo dejarlo funcionando en producción.

## Cómo funciona en la app

1. El usuario entra en **¿Olvidaste tu contraseña?** y escribe su correo.
2. La app llama a `supabase.auth.resetPasswordForEmail(email)` (`src/App.tsx`).
3. Supabase envía el correo con la plantilla **Reset Password**, que debe
   contener la variable `{{ .Token }}` — el código de 6 dígitos.
   La plantilla lista para pegar está en
   `supabase/email-templates/reset-password.html`.
4. El usuario escribe el código + la nueva contraseña y la app llama a
   `verifyOtp({ type: 'recovery' })` y luego a `updateUser({ password })`.

El paso 3 lo hace el servidor de Supabase, **no la app**. Si ahí falla, la app
solo puede mostrar el error: no hay nada que arreglar en el código del cliente.

## Por qué el código no se envía

### 1. El proyecto usa el correo integrado de Supabase (causa más común)

El servicio de correo que Supabase trae por defecto es solo para desarrollo:

- **Solo entrega a las direcciones del equipo** del proyecto en Supabase. A
  cualquier otro correo, la petición devuelve `500 Error sending recovery email`.
- Tiene un tope de **2 correos por hora** para todo el proyecto.

Es decir: a los clientes reales **nunca** les llega el código.

**Solución:** configurar SMTP propio en
`Authentication → Emails → SMTP Settings` (Resend, Brevo, SendGrid,
Amazon SES…). Hay que dar de alta y verificar el dominio del remitente
(SPF/DKIM) en el proveedor; si no, los correos entran en spam o se rechazan.

Después de configurarlo, subir los límites en
`Authentication → Rate Limits → Emails` (por defecto quedan muy bajos).

### 1-bis. El error aparece como `Failed to fetch`

`Failed to fetch` (o `NetworkError`) es lo que lanza `fetch` cuando **no pudo
leer la respuesta** del servidor. No siempre significa "sin internet":

- Si el dispositivo está **sin conexión**, es literal.
- Si el dispositivo está **en línea** (el usuario puede iniciar sesión con
  normalidad), lo habitual es que `/auth/v1/recover` haya devuelto un `500`
  del envío SMTP **sin cabeceras CORS**: el navegador bloquea la lectura y la
  app solo ve `Failed to fetch`. Por fuera parece un problema de red; por
  dentro es el punto 1 de este documento.

Cómo distinguirlos: si el login funciona pero el envío del código no, la red
está bien y el fallo es del servidor de correo. Confírmalo en los Auth Logs.

### 2. Límite de un correo cada 60 segundos por usuario

Supabase devuelve `429` con *"For security purposes, you can only request this
after N seconds"* si se pide otro código antes de tiempo. La app ya lo evita:
tras un envío correcto bloquea el botón 60 s con cuenta atrás.

### 3. La plantilla no tiene `{{ .Token }}`

Si la plantilla **Reset Password** solo trae `{{ .ConfirmationURL }}`, el correo
llega pero **sin código**, y en el APK el enlace no sirve. Pegar la plantilla de
`supabase/email-templates/reset-password.html`.

### 4. El correo no existe como usuario

Supabase no revela si un correo está registrado. Si el usuario se equivocó al
escribirlo, la app responde igual que si todo hubiera ido bien y no llega nada.

## Cómo comprobarlo

- **Supabase Dashboard → Logs → Auth Logs**: buscar `recover`. Ahí aparece el
  error real del envío (SMTP rechazado, rate limit, dirección no autorizada).
- **En el dispositivo**: la app escribe el error crudo en consola con el
  prefijo `[reset-password]` (visible con `adb logcat` o Chrome DevTools).
- **Prueba rápida**: pedir el código con el correo de un miembro del equipo de
  Supabase. Si a ese sí le llega y a un cliente no, el problema es el punto 1.
