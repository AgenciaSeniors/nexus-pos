package com.bisne.contalla;

import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

/**
 * Sacar archivos del teléfono (respaldo JSON, Excel/CSV de inventario, ventas, clientes…).
 *
 * El WebView de Android no sabe "descargar" un archivo generado dentro de la app: el enlace de
 * descarga no hacía nada. Aquí el archivo se escribe en la caché de la app y se abre el menú de
 * compartir del sistema, donde el usuario elige a dónde va: WhatsApp, Drive, Archivos, correo…
 */
@CapacitorPlugin(name = "FileExport")
public class FileExportPlugin extends Plugin {

    private static final String DIR = "exports";

    @PluginMethod
    public void share(PluginCall call) {
        String name = call.getString("name");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        String data = call.getString("data");
        String title = call.getString("title", "Guardar o enviar");

        if (name == null || name.trim().isEmpty() || data == null) {
            call.reject("INVALID");
            return;
        }
        // Solo el nombre: sin rutas ni caracteres raros para el sistema de archivos.
        String safeName = name.replaceAll("[\\/:*?\"<>|]", "_").trim();

        byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("INVALID");
            return;
        }

        File dir = new File(getContext().getCacheDir(), DIR);
        if (!dir.exists() && !dir.mkdirs()) {
            call.reject("WRITE_FAILED");
            return;
        }
        // Se limpian exportaciones anteriores: en la caché no deben acumularse respaldos.
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) //noinspection ResultOfMethodCallIgnored
            f.delete();

        File file = new File(dir, safeName);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        } catch (IOException e) {
            call.reject("WRITE_FAILED");
            return;
        }

        Uri uri;
        try {
            uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
        } catch (IllegalArgumentException e) {
            call.reject("WRITE_FAILED");
            return;
        }

        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType(mimeType);
        send.putExtra(Intent.EXTRA_STREAM, uri);
        send.putExtra(Intent.EXTRA_SUBJECT, safeName);
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        Intent chooser = Intent.createChooser(send, title);
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(chooser);
        } catch (RuntimeException e) {
            call.reject("NO_APP");
            return;
        }
        JSObject result = new JSObject();
        result.put("path", file.getAbsolutePath());
        call.resolve(result);
    }
}
