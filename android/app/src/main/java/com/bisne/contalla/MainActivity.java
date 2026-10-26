package com.bisne.contalla;

import android.content.SharedPreferences;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

import java.io.File;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "Senio";
    private static final String PREFS = "senio_web_cache";
    private static final String KEY_LAST_UPDATE = "last_update_time";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // ANTES de que exista el WebView: nada lo está usando todavía.
        limpiarCopiaViejaSiSeActualizo();
        // Los plugins propios se registran ANTES de super.onCreate (así lo exige Capacitor).
        registerPlugin(LanPrinterPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /**
     * Tras instalar un APK encima, el WebView puede seguir mostrando la VERSIÓN ANTERIOR de la
     * app (con su nombre, su logo y sus pantallas) aunque el APK ya traiga los archivos nuevos:
     * guarda una copia propia en el caché de su service worker y en el caché HTTP. Los
     * archivos nuevos van con otro nombre, así que además salen imágenes rotas.
     *
     * Cada vez que Android registra una instalación/actualización nueva (lastUpdateTime cambia,
     * aunque la versión sea la misma) se borran SOLO esos dos cachés. NO se tocan IndexedDB ni
     * el almacenamiento local: ahí están las ventas, los productos y la sesión.
     */
    private void limpiarCopiaViejaSiSeActualizo() {
        try {
            long actualizado = getPackageManager().getPackageInfo(getPackageName(), 0).lastUpdateTime;
            SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
            if (prefs.getLong(KEY_LAST_UPDATE, -1L) == actualizado) return;

            File sw = new File(getDataDir(), "app_webview/Default/Service Worker");
            File http = new File(getCacheDir(), "WebView");
            borrar(sw);
            borrar(http);
            Log.i(TAG, "App actualizada: caché viejo del WebView borrado (service worker y HTTP)");

            prefs.edit().putLong(KEY_LAST_UPDATE, actualizado).apply();
        } catch (Throwable t) {
            // Si algo falla, la app arranca igual: esto es solo una limpieza.
            Log.w(TAG, "No se pudo limpiar el caché viejo del WebView", t);
        }
    }

    private static void borrar(File f) {
        if (f == null || !f.exists()) return;
        File[] hijos = f.listFiles();
        if (hijos != null) {
            for (File hijo : hijos) borrar(hijo);
        }
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}
