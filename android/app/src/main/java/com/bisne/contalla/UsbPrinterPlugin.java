package com.bisne.contalla;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

/**
 * Impresión térmica por USB (cable OTG del teléfono a la impresora).
 *
 * Manda los bytes ESC/POS que arma la app por el canal de salida ("bulk OUT") de la
 * impresora. No necesita driver ni permisos en el manifiesto: Android pide el permiso al
 * usuario la primera vez ("¿Permitir que Senio acceda al dispositivo USB?").
 *
 * Los errores se rechazan con un código corto (NO_DEVICE, PERMISSION_DENIED, WRITE_FAILED...)
 * que la app traduce a un mensaje en español.
 */
@CapacitorPlugin(name = "UsbPrinter")
public class UsbPrinterPlugin extends Plugin {

    private static final String ACTION_USB_PERMISSION = "com.bisne.contalla.USB_PERMISSION";
    private static final int USB_CLASS_PRINTER = 7;
    private static final int CHUNK = 4096;
    private static final long PERMISSION_TIMEOUT_MS = 60_000;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private BroadcastReceiver permissionReceiver;

    // Una sola petición de permiso a la vez (la app encola las impresiones de una en una).
    private PluginCall pendingCall;
    private UsbDevice pendingDevice;
    private byte[] pendingBytes;
    private int pendingTimeout;
    private Runnable pendingTimeoutTask;

    /** Interfaz + canal de salida por donde se le escribe a la impresora. */
    private static class Target {
        final UsbInterface intf;
        final UsbEndpoint out;
        final boolean isPrinter;

        Target(UsbInterface intf, UsbEndpoint out, boolean isPrinter) {
            this.intf = intf;
            this.out = out;
            this.isPrinter = isPrinter;
        }
    }

    @Override
    public void load() {
        permissionReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (ACTION_USB_PERMISSION.equals(intent.getAction())) onPermissionResult();
            }
        };
        IntentFilter filter = new IntentFilter(ACTION_USB_PERMISSION);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(permissionReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(permissionReceiver, filter);
        }
    }

    @Override
    protected void handleOnDestroy() {
        try {
            if (permissionReceiver != null) getContext().unregisterReceiver(permissionReceiver);
        } catch (IllegalArgumentException ignored) {
            // no estaba registrado
        }
        permissionReceiver = null;
        failPending("CANCELLED");
    }

    private UsbManager manager() {
        return (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
    }

    /** Busca por dónde escribir: primero una interfaz de clase "impresora", si no, cualquier salida bulk. */
    private static Target findTarget(UsbDevice device) {
        Target fallback = null;
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface intf = device.getInterface(i);
            for (int e = 0; e < intf.getEndpointCount(); e++) {
                UsbEndpoint ep = intf.getEndpoint(e);
                if (ep.getType() != UsbConstants.USB_ENDPOINT_XFER_BULK) continue;
                if (ep.getDirection() != UsbConstants.USB_DIR_OUT) continue;
                if (intf.getInterfaceClass() == USB_CLASS_PRINTER) return new Target(intf, ep, true);
                if (fallback == null) fallback = new Target(intf, ep, false);
                break;
            }
        }
        return fallback;
    }

    private static String nameOf(UsbDevice device) {
        String product = null;
        String maker = null;
        try {
            product = device.getProductName();
            maker = device.getManufacturerName();
        } catch (SecurityException ignored) {
            // sin permiso todavía: se muestra un nombre genérico
        }
        StringBuilder sb = new StringBuilder();
        if (maker != null && !maker.trim().isEmpty()) sb.append(maker.trim());
        if (product != null && !product.trim().isEmpty()) {
            if (sb.length() > 0) sb.append(' ');
            sb.append(product.trim());
        }
        return sb.length() > 0 ? sb.toString() : "Dispositivo USB";
    }

    /** Dispositivos USB conectados a los que se les puede escribir, las impresoras primero. */
    private List<UsbDevice> candidates() {
        List<UsbDevice> printers = new ArrayList<>();
        List<UsbDevice> others = new ArrayList<>();
        UsbManager m = manager();
        if (m == null) return printers;
        for (UsbDevice d : m.getDeviceList().values()) {
            Target t = findTarget(d);
            if (t == null) continue;
            if (t.isPrinter) printers.add(d); else others.add(d);
        }
        printers.addAll(others);
        return printers;
    }

    @PluginMethod
    public void list(PluginCall call) {
        JSArray devices = new JSArray();
        UsbManager m = manager();
        for (UsbDevice d : candidates()) {
            Target t = findTarget(d);
            JSObject o = new JSObject();
            o.put("vendorId", d.getVendorId());
            o.put("productId", d.getProductId());
            o.put("name", nameOf(d));
            o.put("isPrinter", t != null && t.isPrinter);
            o.put("hasPermission", m != null && m.hasPermission(d));
            devices.put(o);
        }
        JSObject result = new JSObject();
        result.put("devices", devices);
        call.resolve(result);
    }

    @PluginMethod
    public void print(final PluginCall call) {
        final String data = call.getString("data");
        final Integer vendorId = call.getInt("vendorId");
        final Integer productId = call.getInt("productId");
        final int timeout = call.getInt("timeoutMs", 5000);

        if (data == null) {
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

        final UsbManager m = manager();
        if (m == null) {
            call.reject("NO_USB");
            return;
        }

        // La impresora elegida en Ajustes; si no se eligió ninguna (o ya no está), la primera que haya.
        UsbDevice device = null;
        List<UsbDevice> found = candidates();
        if (vendorId != null && productId != null) {
            for (UsbDevice d : found) {
                if (d.getVendorId() == vendorId && d.getProductId() == productId) {
                    device = d;
                    break;
                }
            }
        }
        if (device == null && !found.isEmpty()) device = found.get(0);
        if (device == null) {
            call.reject("NO_DEVICE");
            return;
        }

        if (m.hasPermission(device)) {
            writeAsync(call, device, bytes, timeout);
            return;
        }

        // Pedir permiso al usuario y continuar cuando responda.
        synchronized (this) {
            if (pendingCall != null) {
                call.reject("BUSY");
                return;
            }
            pendingCall = call;
            pendingDevice = device;
            pendingBytes = bytes;
            pendingTimeout = timeout;
            pendingTimeoutTask = () -> failPending("PERMISSION_TIMEOUT");
            mainHandler.postDelayed(pendingTimeoutTask, PERMISSION_TIMEOUT_MS);
        }
        Intent intent = new Intent(ACTION_USB_PERMISSION).setPackage(getContext().getPackageName());
        PendingIntent pi = PendingIntent.getBroadcast(getContext(), 0, intent, PendingIntent.FLAG_IMMUTABLE);
        try {
            m.requestPermission(device, pi);
        } catch (RuntimeException e) {
            failPending("PERMISSION_DENIED");
        }
    }

    /** El usuario respondió al diálogo de permiso (no se usa el intent: se pregunta al sistema). */
    private void onPermissionResult() {
        final PluginCall call;
        final UsbDevice device;
        final byte[] bytes;
        final int timeout;
        synchronized (this) {
            if (pendingCall == null) return;
            call = pendingCall;
            device = pendingDevice;
            bytes = pendingBytes;
            timeout = pendingTimeout;
            clearPending();
        }
        UsbManager m = manager();
        if (m != null && m.hasPermission(device)) writeAsync(call, device, bytes, timeout);
        else call.reject("PERMISSION_DENIED");
    }

    private void failPending(String code) {
        final PluginCall call;
        synchronized (this) {
            call = pendingCall;
            clearPending();
        }
        if (call != null) call.reject(code);
    }

    /** Llamar con el candado tomado. */
    private void clearPending() {
        if (pendingTimeoutTask != null) mainHandler.removeCallbacks(pendingTimeoutTask);
        pendingTimeoutTask = null;
        pendingCall = null;
        pendingDevice = null;
        pendingBytes = null;
    }

    private void writeAsync(final PluginCall call, final UsbDevice device, final byte[] bytes, final int timeout) {
        // Nunca en el hilo de la UI: una impresora sin papel deja la escritura esperando.
        getBridge().execute(() -> {
            String error = write(device, bytes, timeout);
            if (error == null) call.resolve(new JSObject());
            else call.reject(error);
        });
    }

    /** Escribe todo por el canal de salida. Devuelve null si salió bien, o el código del error. */
    private String write(UsbDevice device, byte[] bytes, int timeout) {
        UsbManager m = manager();
        Target target = findTarget(device);
        if (m == null || target == null) return "NO_DEVICE";

        UsbDeviceConnection connection;
        try {
            connection = m.openDevice(device);
        } catch (RuntimeException e) {
            return "OPEN_FAILED";
        }
        if (connection == null) return "OPEN_FAILED";

        try {
            if (!connection.claimInterface(target.intf, true)) return "OPEN_FAILED";
            int offset = 0;
            while (offset < bytes.length) {
                int length = Math.min(CHUNK, bytes.length - offset);
                int sent = connection.bulkTransfer(target.out, bytes, offset, length, timeout);
                // <0: error o tiempo agotado (sin papel, tapa abierta, cable suelto). 0: no avanzó.
                if (sent <= 0) return "WRITE_FAILED";
                offset += sent;
            }
            return null;
        } finally {
            try {
                connection.releaseInterface(target.intf);
            } catch (RuntimeException ignored) {
                // ya desconectada
            }
            connection.close();
        }
    }
}
