package es.mipiace.tpv;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/**
 * residencia-4 (D-66) · EL PUENTE DEL MÓVIL DE GUARDIA.
 *
 * <p>Tres métodos y nada más: {@code empezar}, {@code parar}, {@code
 * estado}. Todo lo que decide qué suena y cuándo vive en
 * {@link GuardiaService}; esto sólo lo enciende con el token que el
 * WebView acaba de conseguir.
 *
 * <p><b>El plugin no sabe de residentes.</b> Lo que le pasa el WebView es
 * la base de la API, el token del dispositivo, la sesión de guardia, el
 * canal y el nombre de quien la lleva — para la notificación permanente
 * («De guardia: Lucía»), que es lo único que la barra enseña sin
 * desbloquear.
 *
 * <p><b>En navegador no hace nada</b>, igual que el resto de los plugins
 * de la casa: una pestaña de Chrome no puede mantener un servicio en
 * primer plano. El lado JS lo dice y la pantalla sigue funcionando con su
 * propio sondeo — lo que se pierde es sonar con la pantalla apagada, que
 * es justo para lo que está la APK.
 */
@CapacitorPlugin(
        name = "GuardiaAlarm",
        permissions = {
                // Android 13+ · sin esto la notificación de la alarma no se
                // pinta. Se pide al ponerse de guardia y no al arrancar la
                // app: pedir permisos en una pantalla en la que no se
                // entiende para qué son es la forma de que se denieguen.
                @Permission(alias = "notificaciones", strings = {"android.permission.POST_NOTIFICATIONS"})
        })
public class GuardiaAlarmPlugin extends Plugin {

    @PluginMethod
    public void empezar(PluginCall call) {
        String apiBase = call.getString("apiBase");
        String deviceToken = call.getString("deviceToken");
        String sesion = call.getString("sesion");
        if (apiBase == null || deviceToken == null || sesion == null) {
            call.reject("faltan apiBase, deviceToken o sesion");
            return;
        }
        // ── EL PERMISO DE NOTIFICACIONES, CON SU CONSECUENCIA DICHA ──
        //
        // Si no está concedido, el servicio arranca IGUAL: el sondeo
        // sigue, la sesión sigue viva y la pantalla sigue enseñando los
        // avisos. Lo que se pierde es que suene con el móvil guardado.
        //
        // Se devuelve `permisoDeNotificaciones: false` para que la
        // pantalla lo diga con una frase, en vez de que alguien descubra
        // en un turno de noche que el móvil nunca sonó.
        boolean permiso = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permiso = ContextCompat.checkSelfPermission(
                    getContext(), Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED;
            if (!permiso) {
                requestPermissionForAlias("notificaciones", call, "trasElPermiso");
                return;
            }
        }
        arrancar(call, permiso);
    }

    /** Vuelve aquí tras el diálogo del sistema. */
    @com.getcapacitor.annotation.PermissionCallback
    private void trasElPermiso(PluginCall call) {
        boolean permiso =
                Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                        || ContextCompat.checkSelfPermission(
                                        getContext(), Manifest.permission.POST_NOTIFICATIONS)
                                == PackageManager.PERMISSION_GRANTED;
        arrancar(call, permiso);
    }

    private void arrancar(PluginCall call, boolean permiso) {
        GuardiaService.empezar(
                getContext(),
                call.getString("apiBase"),
                call.getString("deviceToken"),
                call.getString("sesion"),
                call.getString("canal", ""),
                call.getString("quien", ""));
        JSObject res = new JSObject();
        res.put("activo", true);
        res.put("permisoDeNotificaciones", permiso);
        call.resolve(res);
    }

    @PluginMethod
    public void parar(PluginCall call) {
        GuardiaService.parar(getContext());
        JSObject res = new JSObject();
        res.put("activo", false);
        call.resolve(res);
    }

    /**
     * ¿Está concedido el permiso de notificaciones?
     *
     * <p>Lo pregunta la pantalla en reposo para pintar el aviso de «este
     * móvil no va a sonar» sin tener que ponerse de guardia primero.
     */
    @PluginMethod
    public void estado(PluginCall call) {
        boolean permiso =
                Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                        || ContextCompat.checkSelfPermission(
                                        getContext(), Manifest.permission.POST_NOTIFICATIONS)
                                == PackageManager.PERMISSION_GRANTED;
        JSObject res = new JSObject();
        res.put("permisoDeNotificaciones", permiso);
        call.resolve(res);
    }
}
