package es.mipiace.tpv;

import android.app.Activity;
import android.content.Context;
import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;
import android.view.PixelCopy;
import android.view.View;
import android.view.Window;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStreamReader;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayDeque;
import java.util.Collections;
import java.util.Deque;
import java.util.Enumeration;

/**
 * A5 · lo que el terminal sabe de sí mismo y el WebView no puede saber.
 *
 * <p>El canal de soporte lo lleva el JS (`lib/supportChannel`), que es donde
 * están la cola offline, el turno y la versión del bundle. Tres datos no los
 * puede contestar: en qué red está, con qué IP local, y desde cuándo lleva
 * encendido. Los tres se piden aquí.
 *
 * <p>El lado JS vive en `apps/tpv-web/src/platform/SupportAgent.ts`; ningún
 * componente de pantalla habla con el bridge, como en el resto de plugins.
 *
 * <p>Este plugin NO pide permisos en runtime: ACCESS_NETWORK_STATE es de
 * instalación, y la enumeración de interfaces es información del propio
 * proceso. Nada de lo que devuelve identifica a una persona.
 */
@CapacitorPlugin(name = "SupportAgent")
public class SupportAgentPlugin extends Plugin {

    private static final String TAG = "mipiacetpv";

    /**
     * Estado del terminal para el heartbeat.
     *
     * <p>NUNCA falla: cada dato va en su propio try/catch y lo que no se pueda
     * averiguar se devuelve como null. El panel pinta «—» en una columna vacía;
     * un error aquí dejaría al terminal sin anunciarse, que es peor que no
     * saber su IP.
     */
    @PluginMethod
    public void info(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("network", leerRed());
        ret.put("localIp", leerIpLocal());
        ret.put("bootedAt", leerArranque());
        call.resolve(ret);
    }

    /**
     * A5 · Frente 3 · las últimas líneas del logcat DE ESTA APP.
     *
     * <p>Desde Android 4.1 el demonio de log filtra por UID: sin el permiso
     * READ_LOGS una app sólo ve sus propias líneas. Es exactamente lo que
     * queremos —no leemos el sistema ni otras apps— y es lo que hace legítimo
     * ejecutar `logcat` desde aquí.
     *
     * <p>Esto complementa al diario de consola del WebView, que vive en JS:
     * aquí salen las líneas nativas (Capacitor, el rescate de A4, el plugin
     * USB de la impresora) que el JS no puede ver, y que son justo las que
     * faltan cuando lo que falla es el arranque.
     *
     * <p>Si `logcat` no está disponible o falla, se devuelve vacío con el
     * motivo. Un comando de soporte no puede lanzar.
     */
    @PluginMethod
    public void logs(PluginCall call) {
        int lineas = Math.min(Math.max(call.getInt("lines", 300), 1), MAX_LOGCAT_LINES);
        JSObject ret = new JSObject();
        try {
            ret.put("logcat", leerLogcat(lineas));
            ret.put("error", (String) null);
        } catch (Throwable t) {
            Log.w(TAG, "A5 SupportAgent: no pude leer el logcat", t);
            ret.put("logcat", "");
            ret.put("error", String.valueOf(t.getMessage()));
        }
        call.resolve(ret);
    }

    /**
     * A5 · Frente 3 · reinicia la app recreando la Activity.
     *
     * <p>Recrear la Activity vuelve a ejecutar `MainActivity.onCreate` —con el
     * rescate de A4 incluido— y levanta un WebView nuevo, así que sirve incluso
     * con el JS colgado, que es cuando se pide. NO mata el proceso.
     *
     * <p>Matar el proceso y relanzarlo (el patrón ProcessPhoenix) se ha
     * descartado a propósito: exige una Activity en un proceso aparte para que
     * el relanzamiento no se cancele, y sin ella es inconstante. Un terminal
     * que no vuelve a arrancar deja una barra sin caja, y eso es peor que
     * cualquier cosa que este comando pretenda arreglar.
     *
     * <p>La cola de ventas pendientes vive en IndexedDB y sobrevive; ningún
     * cobro se pierde por esto.
     */
    @PluginMethod
    public void restart(PluginCall call) {
        Activity actividad = getActivity();
        if (actividad == null) {
            call.reject("sin activity");
            return;
        }
        // Se contesta ANTES de recrear: después de `recreate()` el bridge se
        // reconstruye y esta respuesta no llegaría nunca al servidor, que lo
        // vería como un comando sin respuesta.
        JSObject ret = new JSObject();
        ret.put("restarted", true);
        call.resolve(ret);
        actividad.runOnUiThread(actividad::recreate);
    }

    /** Tope duro de líneas: el resultado viaja por el canal de soporte. */
    private static final int MAX_LOGCAT_LINES = 500;

    /**
     * Ancho máximo de una captura. La UI está diseñada para 1280×800, así que
     * a este ancho no se pierde nada legible y el PNG se queda en un tamaño
     * que cabe holgado en el canal.
     */
    private static final int MAX_CAPTURA_ANCHO = 1280;

    /**
     * A5 · Frente 4 · captura de NUESTRA PROPIA ventana.
     *
     * <p>Aquí está la libertad que no da ningún producto de terceros: no
     * estamos capturando el dispositivo, estamos capturando lo nuestro. Por eso
     * no hace falta MediaProjection, ni que nadie acepte un diálogo en la barra
     * después de cada reinicio, ni un plugin firmado por el fabricante del
     * terminal.
     *
     * <p><b>Vía elegida: PixelCopy sobre la ventana de la Activity.</b> La
     * alternativa era volcar el DOM del WebView. Se ha elegido PixelCopy por un
     * motivo que pesa más que cualquier otro: <b>funciona con el JS colgado</b>,
     * que es justo cuando alguien llama. Un volcado del DOM lo produce el mismo
     * JS que puede estar bloqueado, así que falla exactamente en el caso que
     * hay que diagnosticar. Además PixelCopy enseña el render de verdad —
     * incluidos los diálogos nativos de la propia app — y no una reconstrucción.
     *
     * <p><b>El límite, y hay que decirlo en voz alta:</b> PixelCopy copia el
     * Surface de NUESTRA ventana. El teclado de Android y los diálogos del
     * sistema son ventanas distintas y <b>no salen</b>. Un volcado del DOM
     * tampoco los vería. Verlos exigiría MediaProjection, que es lo que se
     * descartó por pedir consentimiento tras cada reinicio. Esto no se le
     * promete a ningún cliente: está escrito en el done-doc y en
     * `docs/implantacion/terminal-nuevo.md`.
     */
    @PluginMethod
    public void screenshot(PluginCall call) {
        Activity actividad = getActivity();
        if (actividad == null) {
            call.reject("sin activity");
            return;
        }
        Window ventana = actividad.getWindow();
        View decor = ventana.getDecorView();
        int ancho = decor.getWidth();
        int alto = decor.getHeight();
        if (ancho <= 0 || alto <= 0) {
            call.reject("la ventana todavía no tiene tamaño");
            return;
        }

        Bitmap bitmap = Bitmap.createBitmap(ancho, alto, Bitmap.Config.ARGB_8888);
        PixelCopy.request(
                ventana,
                bitmap,
                resultado -> {
                    if (resultado != PixelCopy.SUCCESS) {
                        bitmap.recycle();
                        call.reject("PixelCopy falló con código " + resultado);
                        return;
                    }
                    try {
                        JSObject ret = new JSObject();
                        Bitmap escalado = escalar(bitmap);
                        ret.put("pngBase64", aPngBase64(escalado));
                        ret.put("width", escalado.getWidth());
                        ret.put("height", escalado.getHeight());
                        if (escalado != bitmap) escalado.recycle();
                        call.resolve(ret);
                    } catch (Throwable t) {
                        Log.w(TAG, "A5 SupportAgent: no pude codificar la captura", t);
                        call.reject("no pude codificar la captura");
                    } finally {
                        bitmap.recycle();
                    }
                },
                new Handler(Looper.getMainLooper()));
    }

    /** Reduce a MAX_CAPTURA_ANCHO conservando la proporción. */
    private Bitmap escalar(Bitmap original) {
        int ancho = original.getWidth();
        if (ancho <= MAX_CAPTURA_ANCHO) return original;
        int alto = Math.round(original.getHeight() * (MAX_CAPTURA_ANCHO / (float) ancho));
        return Bitmap.createScaledBitmap(original, MAX_CAPTURA_ANCHO, alto, true);
    }

    /**
     * PNG, no JPEG. La pantalla de un TPV es texto y color plano: el PNG
     * comprime mejor ahí y, sobre todo, no emborrona los importes ni los
     * nombres, que es lo que se va a leer en la captura.
     */
    private String aPngBase64(Bitmap bitmap) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }

    /** Últimas N líneas del log del propio proceso. */
    private String leerLogcat(int lineas) throws Exception {
        Process proceso = Runtime.getRuntime().exec(
                new String[] {"logcat", "-d", "-v", "time", "--pid=" + android.os.Process.myPid()});
        Deque<String> ultimas = new ArrayDeque<>();
        try (BufferedReader reader =
                     new BufferedReader(new InputStreamReader(proceso.getInputStream()))) {
            String linea;
            while ((linea = reader.readLine()) != null) {
                ultimas.addLast(linea);
                if (ultimas.size() > lineas) ultimas.removeFirst();
            }
        } finally {
            proceso.destroy();
        }
        return String.join("\n", ultimas);
    }

    /** "wifi" | "cellular" | "ethernet" | "none" | "unknown". */
    private String leerRed() {
        try {
            ConnectivityManager cm =
                    (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return "unknown";
            Network activa = cm.getActiveNetwork();
            if (activa == null) return "none";
            NetworkCapabilities caps = cm.getNetworkCapabilities(activa);
            if (caps == null) return "none";
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return "wifi";
            // El caso de Las Lomas: el terminal tirando de la compartición de
            // datos de un móvil. Distinguirlo del wifi del bar importa para
            // saber si lo que estamos viendo es un local sin internet fijo.
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) return "cellular";
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return "ethernet";
            return "unknown";
        } catch (Throwable t) {
            Log.w(TAG, "A5 SupportAgent: no pude leer la red", t);
            return "unknown";
        }
    }

    /**
     * Primera IPv4 privada de una interfaz activa que no sea loopback.
     *
     * <p>Es la que hace falta para un `adb connect` desde la misma LAN, así que
     * se filtra a IPv4: una IPv6 de enlace local no le sirve a nadie para eso.
     */
    private String leerIpLocal() {
        try {
            Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
            if (ifaces == null) return null;
            for (NetworkInterface iface : Collections.list(ifaces)) {
                if (!iface.isUp() || iface.isLoopback()) continue;
                for (InetAddress addr : Collections.list(iface.getInetAddresses())) {
                    if (addr.isLoopbackAddress()) continue;
                    if (!(addr instanceof Inet4Address)) continue;
                    return addr.getHostAddress();
                }
            }
            return null;
        } catch (Throwable t) {
            Log.w(TAG, "A5 SupportAgent: no pude leer la IP local", t);
            return null;
        }
    }

    /**
     * Instante del último arranque del terminal, en epoch millis.
     *
     * <p>Se calcula como «ahora menos el tiempo encendido» porque Android no
     * guarda la hora de arranque: `elapsedRealtime()` cuenta desde el boot e
     * incluye el tiempo dormido, que es lo que queremos. Ojo con el resultado:
     * hereda el reloj del terminal, así que si ese reloj está desviado, esta
     * marca lo está también — por eso el servidor guarda además el desvío.
     */
    private long leerArranque() {
        return System.currentTimeMillis() - SystemClock.elapsedRealtime();
    }
}
