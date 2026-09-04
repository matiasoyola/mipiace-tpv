package es.mipiace.tpv;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.SystemClock;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;
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
