package es.mipiace.tpv;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * A1-Android · Frente 2 · plugin USB Host para impresión ESC/POS.
 *
 * WebUSB no existe en el WebView; este plugin da acceso al bus USB del
 * terminal Android todo-en-uno de los pilotos (impresora térmica USB,
 * clase 7). Replica el MISMO algoritmo que la rama WebUSB de tpv-web:
 * filtro de clase impresora, endpoint bulk OUT, transferencia del binario.
 *
 * ADR-011: sólo ESC/POS estándar sobre bulk OUT; cero SDK de fabricante.
 *
 * Emparejamiento persistente: guardamos vendor/product/serial en
 * SharedPreferences para reabrir la impresora ya autorizada sin volver a
 * pedir permiso (paralelo al localStorage + getDevices() de WebUSB).
 */
@CapacitorPlugin(name = "UsbPrinter")
public class UsbPrinterPlugin extends Plugin {

    private static final String ACTION_USB_PERMISSION = "es.mipiace.tpv.USB_PERMISSION";
    private static final String PREFS = "mipiacetpv_usb_printer";
    private static final int TRANSFER_TIMEOUT_MS = 5000;

    // Pulso kick ESC/POS estándar: ESC p 0 25 250 (pin 2, on 50ms, off 500ms).
    private static final byte[] CASH_DRAWER_KICK =
            new byte[] {0x1b, 0x70, 0x00, 0x19, (byte) 0xfa};

    // Llamada de pair() en espera del diálogo de permiso USB.
    private PluginCall pendingPermissionCall;
    private BroadcastReceiver permissionReceiver;

    private UsbManager usbManager() {
        return (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        boolean hasHost = getContext()
                .getPackageManager()
                .hasSystemFeature(PackageManager.FEATURE_USB_HOST);
        JSObject ret = new JSObject();
        ret.put("available", hasHost && usbManager() != null);
        call.resolve(ret);
    }

    // Empareja: localiza la primera impresora (clase 7) del bus, pide
    // permiso USB al usuario si no lo tiene, persiste y devuelve descriptor.
    @PluginMethod
    public void pair(PluginCall call) {
        UsbManager manager = usbManager();
        if (manager == null) {
            call.reject("USB Host no disponible en este dispositivo.", "UNSUPPORTED");
            return;
        }
        UsbDevice printer = findPrinterDevice(manager);
        if (printer == null) {
            call.reject(
                    "No se encontró ninguna impresora USB conectada.",
                    "NOT_PAIRED");
            return;
        }
        if (manager.hasPermission(printer)) {
            persist(printer);
            call.resolve(describe(printer));
            return;
        }
        // Sin permiso todavía → diálogo nativo del sistema. Guardamos la
        // llamada y la resolvemos cuando el usuario decide.
        requestPermission(call, manager, printer);
    }

    @PluginMethod
    public void isPaired(PluginCall call) {
        UsbManager manager = usbManager();
        JSObject ret = new JSObject();
        UsbDevice device = manager == null ? null : resolveStoredDevice(manager);
        ret.put("paired", device != null && manager.hasPermission(device));
        call.resolve(ret);
    }

    @PluginMethod
    public void print(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("Falta el binario ESC/POS (data).", "UNKNOWN");
            return;
        }
        byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("Binario ESC/POS inválido (base64).", "UNKNOWN");
            return;
        }
        sendBytes(call, bytes, true);
    }

    @PluginMethod
    public void openCashDrawer(PluginCall call) {
        sendBytes(call, CASH_DRAWER_KICK, false);
    }

    @PluginMethod
    public void forget(PluginCall call) {
        prefs().edit().clear().apply();
        call.resolve();
    }

    // --- Núcleo de entrega ------------------------------------------------

    private void sendBytes(PluginCall call, byte[] bytes, boolean isPrint) {
        UsbManager manager = usbManager();
        if (manager == null) {
            call.reject("USB Host no disponible.", "UNSUPPORTED");
            return;
        }
        UsbDevice device = resolveStoredDevice(manager);
        if (device == null) {
            call.reject("Impresora USB no emparejada.", "NOT_PAIRED");
            return;
        }
        if (!manager.hasPermission(device)) {
            call.reject(
                    "Permiso USB revocado; vuelve a emparejar la impresora.",
                    "PERMISSION_DENIED");
            return;
        }

        UsbInterface iface = findBulkOutInterface(device);
        UsbEndpoint endpoint = iface == null ? null : findBulkOutEndpoint(iface);
        if (iface == null || endpoint == null) {
            call.reject("La impresora no expone un endpoint bulk OUT.", "UNSUPPORTED");
            return;
        }

        UsbDeviceConnection connection = manager.openDevice(device);
        if (connection == null) {
            call.reject("No se pudo abrir la impresora USB.", "UNREACHABLE");
            return;
        }
        try {
            if (!connection.claimInterface(iface, true)) {
                call.reject("No se pudo reclamar el interface de la impresora.", "UNREACHABLE");
                return;
            }
            int sent = connection.bulkTransfer(
                    endpoint, bytes, bytes.length, TRANSFER_TIMEOUT_MS);
            if (sent < 0) {
                call.reject(
                        isPrint
                                ? "La impresora no respondió (¿apagada o desconectada?)."
                                : "No se pudo abrir el cajón (impresora sin respuesta).",
                        "UNREACHABLE");
                return;
            }
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("bytes", sent);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(
                    e.getMessage() == null ? "Error al imprimir por USB." : e.getMessage(),
                    "UNREACHABLE",
                    e);
        } finally {
            try {
                connection.releaseInterface(iface);
            } catch (Exception ignored) {
                // best-effort.
            }
            connection.close();
        }
    }

    // --- Selección de device / endpoint (mismo criterio que WebUSB) -------

    // Primera impresora del bus: device o interface de clase 7 (Printer).
    private UsbDevice findPrinterDevice(UsbManager manager) {
        for (UsbDevice device : manager.getDeviceList().values()) {
            if (device.getDeviceClass() == UsbConstants.USB_CLASS_PRINTER) {
                return device;
            }
            for (int i = 0; i < device.getInterfaceCount(); i++) {
                if (device.getInterface(i).getInterfaceClass()
                        == UsbConstants.USB_CLASS_PRINTER) {
                    return device;
                }
            }
        }
        return null;
    }

    private UsbInterface findBulkOutInterface(UsbDevice device) {
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface iface = device.getInterface(i);
            if (findBulkOutEndpoint(iface) != null) {
                return iface;
            }
        }
        return null;
    }

    private UsbEndpoint findBulkOutEndpoint(UsbInterface iface) {
        for (int i = 0; i < iface.getEndpointCount(); i++) {
            UsbEndpoint ep = iface.getEndpoint(i);
            if (ep.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK
                    && ep.getDirection() == UsbConstants.USB_DIR_OUT) {
                return ep;
            }
        }
        return null;
    }

    // Reabre el device autorizado por vendor/product(/serial) persistido.
    private UsbDevice resolveStoredDevice(UsbManager manager) {
        SharedPreferences p = prefs();
        if (!p.contains("vendorId")) return null;
        int vendorId = p.getInt("vendorId", -1);
        int productId = p.getInt("productId", -1);
        String serial = p.getString("serialNumber", null);
        for (UsbDevice device : manager.getDeviceList().values()) {
            if (device.getVendorId() != vendorId || device.getProductId() != productId) {
                continue;
            }
            if (serial == null) return device;
            // getSerialNumber requiere permiso; si aún no lo hay, casamos por
            // vendor:product (suficiente para un único modelo por terminal).
            if (!manager.hasPermission(device)) return device;
            String devSerial = device.getSerialNumber();
            if (serial.equals(devSerial)) return device;
        }
        return null;
    }

    private void persist(UsbDevice device) {
        String serial = null;
        try {
            serial = device.getSerialNumber(); // requiere permiso ya concedido
        } catch (SecurityException ignored) {
            // sin permiso todavía → guardamos sólo vendor/product.
        }
        prefs().edit()
                .putInt("vendorId", device.getVendorId())
                .putInt("productId", device.getProductId())
                .putString("serialNumber", serial)
                .putString("productName", device.getProductName())
                .apply();
    }

    private JSObject describe(UsbDevice device) {
        JSObject ret = new JSObject();
        ret.put("vendorId", device.getVendorId());
        ret.put("productId", device.getProductId());
        String serial = null;
        try {
            serial = device.getSerialNumber();
        } catch (SecurityException ignored) {
        }
        ret.put("serialNumber", serial);
        ret.put("productName", device.getProductName());
        return ret;
    }

    // --- Permiso USB (asíncrono) ------------------------------------------

    private void requestPermission(PluginCall call, UsbManager manager, UsbDevice device) {
        Context ctx = getContext();
        pendingPermissionCall = call;
        bridge.saveCall(call); // sobrevive a la pausa del diálogo del sistema

        permissionReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!ACTION_USB_PERMISSION.equals(intent.getAction())) return;
                unregisterPermissionReceiver();
                PluginCall pending = pendingPermissionCall;
                pendingPermissionCall = null;
                if (pending == null) return;

                boolean granted =
                        intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
                UsbDevice granted_device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                UsbDevice target = granted_device != null ? granted_device : device;
                if (granted && target != null) {
                    persist(target);
                    pending.resolve(describe(target));
                } else {
                    pending.reject(
                            "Permiso USB denegado por el usuario.",
                            "PERMISSION_DENIED");
                }
            }
        };

        IntentFilter filter = new IntentFilter(ACTION_USB_PERMISSION);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ctx.registerReceiver(permissionReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            ctx.registerReceiver(permissionReceiver, filter);
        }

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags |= PendingIntent.FLAG_MUTABLE;
        }
        Intent intent = new Intent(ACTION_USB_PERMISSION).setPackage(ctx.getPackageName());
        PendingIntent pi = PendingIntent.getBroadcast(ctx, 0, intent, flags);
        manager.requestPermission(device, pi);
    }

    private void unregisterPermissionReceiver() {
        if (permissionReceiver != null) {
            try {
                getContext().unregisterReceiver(permissionReceiver);
            } catch (IllegalArgumentException ignored) {
                // ya desregistrado.
            }
            permissionReceiver = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        unregisterPermissionReceiver();
        super.handleOnDestroy();
    }
}
