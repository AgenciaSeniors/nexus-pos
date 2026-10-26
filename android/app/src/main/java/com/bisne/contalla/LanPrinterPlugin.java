package com.bisne.contalla;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.OutputStream;
import java.net.ConnectException;
import java.net.InetSocketAddress;
import java.net.NoRouteToHostException;
import java.net.Socket;
import java.net.SocketTimeoutException;

/**
 * Impresión térmica por red: abre un socket TCP "raw" (puerto 9100) contra la impresora
 * y le manda los bytes ESC/POS que arma la app. Sin librerías ni permisos extra
 * (INTERNET ya está en el manifiesto).
 *
 * Los errores se rechazan con un código corto (TIMEOUT, REFUSED, UNREACHABLE, INVALID)
 * que la app traduce a un mensaje en español.
 */
@CapacitorPlugin(name = "LanPrinter")
public class LanPrinterPlugin extends Plugin {

    @PluginMethod
    public void print(final PluginCall call) {
        final String host = call.getString("host");
        final Integer port = call.getInt("port", 9100);
        final String data = call.getString("data");
        final Integer timeout = call.getInt("timeoutMs", 5000);

        if (host == null || host.trim().isEmpty() || data == null || port == null || port < 1 || port > 65535) {
            call.reject("INVALID");
            return;
        }

        final byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("INVALID");
            return;
        }

        // Nunca en el hilo de la UI: conectar a una IP inexistente tarda segundos.
        getBridge().execute(() -> {
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(host.trim(), port), timeout);
                socket.setSoTimeout(timeout);
                OutputStream out = socket.getOutputStream();
                out.write(bytes);
                out.flush();
                call.resolve(new JSObject());
            } catch (SocketTimeoutException e) {
                call.reject("TIMEOUT");
            } catch (ConnectException e) {
                String m = String.valueOf(e.getMessage());
                call.reject(m.contains("refused") ? "REFUSED" : "UNREACHABLE");
            } catch (NoRouteToHostException e) {
                call.reject("UNREACHABLE");
            } catch (IOException e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }
}
