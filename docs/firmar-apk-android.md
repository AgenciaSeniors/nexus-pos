# Firmar el APK de Android (para poder actualizar encima)

## El problema que resuelve

Hasta ahora el APK se compilaba con `assembleDebug`, que lo firma con el
**keystore de depuración**. Ese keystore lo genera **nuevo cada runner de
GitHub**, así que la firma cambia en cada build.

Android exige que la firma coincida para instalar una actualización encima. Con
firma distinta responde **"Aplicación no instalada"** y la única salida es
desinstalar — y al desinstalar **se borra la base local del teléfono**: se
pierde todo lo que no estuviera sincronizado (ventas offline, la cola sin subir,
el turno abierto).

Con una clave fija ese problema desaparece para siempre: actualizar encima
funciona y los datos se quedan donde están.

> ⚠️ **La clave se genera UNA vez y no se pierde nunca.** Si se pierde, los
> teléfonos que ya tengan la app instalada **no podrán volver a actualizarla**:
> habrá que desinstalar y reinstalar en cada uno. Guarda el archivo y las
> contraseñas en sitio seguro, fuera del repositorio.

---

## 1. Generar la clave (una sola vez)

Necesitas `keytool`, que viene con cualquier JDK. Si tienes Android Studio, ya
lo tienes.

```bash
keytool -genkeypair -v \
  -keystore bisne-release.keystore \
  -alias bisne \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storetype PKCS12
```

Te pedirá una contraseña y algunos datos (nombre, organización, país). Anota:

| Dato | Ejemplo | Va al secret |
|---|---|---|
| Contraseña del almacén | *la que pusiste* | `ANDROID_KEYSTORE_PASSWORD` |
| Alias | `bisne` | `ANDROID_KEY_ALIAS` |
| Contraseña de la clave | *normalmente la misma* | `ANDROID_KEY_PASSWORD` |

**Guarda `bisne-release.keystore` fuera del repositorio.** No debe commitearse
nunca: quien lo tenga puede publicar actualizaciones que los teléfonos aceptarán
como tuyas.

## 2. Convertirlo a texto para GitHub

Los secrets solo guardan texto, así que el archivo se codifica en base64:

```bash
base64 -w 0 bisne-release.keystore > keystore.b64
```

En Windows con PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("bisne-release.keystore")) | Set-Content keystore.b64
```

## 3. Crear los cuatro secrets

En **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Valor |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | el contenido de `keystore.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | la contraseña del almacén |
| `ANDROID_KEY_ALIAS` | `bisne` |
| `ANDROID_KEY_PASSWORD` | la contraseña de la clave |

Borra `keystore.b64` del disco cuando termines.

## 4. Comprobar

El workflow detecta los secrets solo. En el siguiente build:

- **Con secrets**: compila `assembleRelease` firmado con tu clave.
- **Sin secrets**: compila `assembleDebug` como antes y deja un aviso en el run
  diciendo que ese APK no se podrá instalar encima.

Para forzar un build: **Actions → Android APK → Run workflow**.

## 5. La primera vez hay que desinstalar

El APK firmado con la clave nueva **no se puede instalar encima** de uno de
depuración: son firmas distintas. En los teléfonos que ya tengan la app:

1. Abrir la app con internet y esperar a que **la cola de sincronización quede
   vacía** (Ajustes muestra el estado).
2. Desinstalar.
3. Instalar el APK nuevo y entrar: la nube devuelve los datos.

Es un corte único. A partir de ahí, todas las actualizaciones se instalan encima
sin perder nada.
