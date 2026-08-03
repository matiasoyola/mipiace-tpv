package es.mipiace.tpv;

import android.Manifest;
import android.content.pm.PackageManager;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * A2-Android · Frente 1 · permiso NATIVO de cámara para el escáner.
 *
 * El escaneo de código de barras lo hace zxing (getUserMedia) dentro del
 * WebView, pero Android exige además el permiso de cámara en runtime. Este
 * plugin lo comprueba/pide; el lado JS vive en
 * `apps/tpv-web/src/platform/camera/CameraPermission.ts` — ningún
 * componente de pantalla toca el bridge.
 *
 * Usamos el flujo de permisos idiomático de Capacitor (@Permission alias +
 * requestPermissionForAlias) en vez del BroadcastReceiver manual del
 * UsbPrinterPlugin, porque CAMERA es un permiso estándar de app (no un
 * permiso por-device del bus USB).
 */
@CapacitorPlugin(
        name = "CameraPermission",
        permissions = {
                @Permission(alias = "camera", strings = {Manifest.permission.CAMERA})
        })
public class CameraPermissionPlugin extends Plugin {

    private boolean hasCamera() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED;
    }

    private JSObject grantedResult() {
        JSObject ret = new JSObject();
        ret.put("granted", hasCamera());
        return ret;
    }

    /** Estado actual del permiso, sin abrir diálogo. */
    @PluginMethod
    public void check(PluginCall call) {
        call.resolve(grantedResult());
    }

    /**
     * Pide el permiso si no lo tiene. Si ya está concedido resuelve directo;
     * si no, lanza el diálogo del sistema y resuelve en el callback.
     */
    @PluginMethod
    public void request(PluginCall call) {
        if (hasCamera()) {
            call.resolve(grantedResult());
            return;
        }
        requestPermissionForAlias("camera", call, "cameraPermsCallback");
    }

    @PermissionCallback
    private void cameraPermsCallback(PluginCall call) {
        call.resolve(grantedResult());
    }
}
