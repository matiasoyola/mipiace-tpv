package es.mipiace.tpv;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

/**
 * kds-2-wifi · EL PUENTE DEL CAMINO DIRECTO.
 *
 * <p>Un solo plugin para los dos papeles, porque es la MISMA APK:
 *
 * <ul>
 *   <li><b>En la tablet de cocina</b>: {@code arrancar}, {@code parar},
 *       {@code publicar}, {@code recibidos}, {@code estado}.
 *   <li><b>En el terminal de caja</b>: {@code enviar} y {@code descubrir}.
 * </ul>
 *
 * <p><b>Un terminal de caja no escucha en ningún puerto</b> (lección A5), y
 * eso se sostiene en tres sitios a la vez:
 *
 * <ol>
 *   <li>el JS sólo llama a {@code arrancar} desde la pantalla de cocina, que
 *       sólo se monta cuando {@code /kitchen/me} dijo {@code KITCHEN};
 *   <li>{@code arrancar} exige una clave de tienda, y el servidor sólo la da
 *       a un {@code KITCHEN};
 *   <li>y la base de datos no admite ni apuntar que un {@code TERMINAL}
 *       escuche: CHECK {@code devices_kitchen_lan_solo_cocina}.
 * </ol>
 *
 * <p>Las tres son la misma regla dicha tres veces, y es a propósito: la
 * primera se puede olvidar en un refactor del front, la segunda depende de
 * que el servidor no se equivoque, y la tercera no se puede olvidar.
 *
 * <p>El lado JS vive en {@code apps/tpv-web/src/platform/KitchenLan.ts};
 * ningún componente de pantalla habla con el bridge, como en el resto de
 * plugins.
 *
 * <p>── POR QUÉ EL ENVÍO PASA POR AQUÍ ───────────────────────────────────
 *
 * <p>Porque una página {@code https://} no puede llamar a
 * {@code http://192.168.1.44:8787}: el navegador lo bloquea por contenido
 * mixto, y eso no se arregla con una cabecera. El POST lo hace el código
 * nativo, que no tiene esa regla. Es la razón por la que este bloque
 * necesita una pieza nativa y no se puede hacer entero en el WebView.
 */
@CapacitorPlugin(name = "KitchenLan")
public class KitchenLanPlugin extends Plugin {

    private static final String TAG = "mipiacetpv";

    /** Cuánto se espera a la tablet. Es la wifi del local: o contesta ya, o no está. */
    private static final int TIMEOUT_ENVIO_MS = 2_500;

    /** El servicio que la tablet anuncia y el terminal busca. */
    private static final String TIPO_NSD = "_mipiacekds._tcp.";

    private final KitchenLanServer servidor = new KitchenLanServer();

    private NsdManager nsd;
    private NsdManager.RegistrationListener registro;
    private NsdManager.DiscoveryListener descubrimiento;
    /** Lo encontrado por NSD: nombre → "ip:puerto". */
    private final ConcurrentHashMap<String, String> encontrados = new ConcurrentHashMap<>();

    @Override
    public void load() {
        servidor.avisarCon((enCola) -> {
            JSObject data = new JSObject();
            data.put("enCola", enCola);
            // Un aviso, no el mensaje: el JS vacía la cola con `recibidos`.
            // Mandar el mensaje por el evento obligaría a que el JS estuviera
            // escuchando en el instante exacto, y un WebView que se recarga
            // (A4) perdería la comanda.
            notifyListeners("mensaje", data);
        });
    }

    // ── LA TABLET DE COCINA ──────────────────────────────────────────────

    /**
     * Abre el servidor local. Idempotente.
     *
     * <p>Devuelve siempre, también cuando falla: {@code listening: false} con
     * el motivo. El JS lo manda en el latido y el TPV se enfrenta a la
     * verdad en vez de reintentar contra un puerto que no escucha.
     */
    @PluginMethod
    public void arrancar(PluginCall call) {
        String storeId = call.getString("storeId");
        String clave = call.getString("key");
        String deviceId = call.getString("deviceId");
        int puerto = call.getInt("port", KitchenLanProtocol.PUERTO_POR_DEFECTO);
        long offset = call.getLong("offsetMs", 0L);
        JSObject ret = new JSObject();
        try {
            servidor.arrancar(storeId, clave, deviceId, puerto, offset);
            registrarEnNsd(servidor.puerto(), deviceId);
            ret.put("listening", true);
            ret.put("port", servidor.puerto());
            ret.put("ip", KitchenLanServer.ipLocal());
            ret.put("error", null);
        } catch (IOException e) {
            Log.w(TAG, "kds-2: el servidor de cocina no arrancó", e);
            ret.put("listening", false);
            ret.put("port", 0);
            ret.put("ip", KitchenLanServer.ipLocal());
            // El mensaje real, para que el botón «Probar conexión directa»
            // pueda decir «el puerto 8787 está ocupado» y no «no funciona».
            ret.put("error", String.valueOf(e.getMessage()));
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void parar(PluginCall call) {
        desregistrarDeNsd();
        servidor.parar();
        call.resolve(new JSObject().put("listening", false));
    }

    /** Actualiza la clave rotada y el desvío de reloj sin reiniciar. */
    @PluginMethod
    public void refrescar(PluginCall call) {
        servidor.refrescar(call.getString("key"), call.getLong("offsetMs", 0L));
        call.resolve(new JSObject().put("ok", true));
    }

    /** Deja la instantánea con la que se contesta a un SONDEO. */
    @PluginMethod
    public void publicar(PluginCall call) {
        String json = call.getString("snapshotJson");
        servidor.publicar(json);
        call.resolve(new JSObject().put("ok", true));
    }

    /** Vacía la cola de mensajes ya verificados. */
    @PluginMethod
    public void recibidos(PluginCall call) {
        String[] mensajes = servidor.recoger();
        JSArray arr = new JSArray();
        for (String m : mensajes) {
            arr.put(m);
        }
        call.resolve(new JSObject().put("mensajes", arr));
    }

    @PluginMethod
    public void estado(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("listening", servidor.escuchando());
        ret.put("port", servidor.puerto());
        ret.put("ip", KitchenLanServer.ipLocal());
        ret.put("lastRequestAt", servidor.ultimaPeticionMs());
        ret.put("accepted", servidor.aceptados());
        ret.put("rejected", servidor.rechazados());
        ret.put("queued", servidor.enCola());
        call.resolve(ret);
    }

    // ── EL TERMINAL DE CAJA ──────────────────────────────────────────────

    /**
     * El POST a la tablet, desde nativo.
     *
     * <p>No lanza por un fallo de red: devuelve {@code status: 0} con el
     * motivo. El TPV tiene que poder decidir si saca papel, y para eso
     * necesita una respuesta, no una excepción.
     */
    @PluginMethod
    public void enviar(PluginCall call) {
        final String ip = call.getString("ip");
        final int puerto = call.getInt("port", KitchenLanProtocol.PUERTO_POR_DEFECTO);
        final String cuerpo = call.getString("bodyJson");
        final int timeout = call.getInt("timeoutMs", TIMEOUT_ENVIO_MS);
        if (ip == null || ip.isEmpty() || cuerpo == null) {
            call.resolve(new JSObject().put("status", 0).put("error", "SIN_DESTINO"));
            return;
        }
        new Thread(() -> {
            JSObject ret = new JSObject();
            long t0 = System.currentTimeMillis();
            HttpURLConnection con = null;
            try {
                URL url = new URL("http://" + ip + ":" + puerto + "/kds");
                con = (HttpURLConnection) url.openConnection();
                con.setRequestMethod("POST");
                con.setConnectTimeout(timeout);
                con.setReadTimeout(timeout);
                con.setDoOutput(true);
                con.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                byte[] bytes = cuerpo.getBytes(StandardCharsets.UTF_8);
                con.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream out = con.getOutputStream()) {
                    out.write(bytes);
                }
                int http = con.getResponseCode();
                ret.put("status", http);
                ret.put("bodyJson", leerTodo(con, http));
                ret.put("error", null);
            } catch (Exception e) {
                // `status: 0` = no se llegó. Es el único caso en que el TPV
                // tiene que mirar el otro camino (la nube) antes de decidir
                // si saca papel.
                ret.put("status", 0);
                ret.put("bodyJson", null);
                ret.put("error", String.valueOf(e.getMessage()));
            } finally {
                if (con != null) {
                    con.disconnect();
                }
            }
            ret.put("elapsedMs", System.currentTimeMillis() - t0);
            call.resolve(ret);
        }, "kds-lan-envio").start();
    }

    /**
     * Redescubrimiento en la red local (NSD).
     *
     * <p>Para cuando el router le cambia la IP a la tablet SIN internet: el
     * servidor no se puede enterar, así que el terminal pregunta en la
     * propia red. Se devuelve lo encontrado hasta ahora más lo que aparezca
     * durante {@code waitMs}.
     *
     * <p>Y es lo SEGUNDO que se prueba, no lo primero: primero la última IP
     * conocida, que casi siempre sigue valiendo y cuesta 20 ms. NSD en una
     * red de bar tarda entre medio segundo y varios, y el camarero ya pulsó
     * «Enviar».
     */
    @PluginMethod
    public void descubrir(PluginCall call) {
        final int espera = call.getInt("waitMs", 1_500);
        arrancarDescubrimiento();
        new Thread(() -> {
            try {
                Thread.sleep(Math.max(0, Math.min(espera, 8_000)));
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            JSArray arr = new JSArray();
            for (String destino : new ArrayList<>(encontrados.values())) {
                arr.put(destino);
            }
            call.resolve(new JSObject().put("destinos", arr));
        }, "kds-lan-nsd").start();
    }

    // ── NSD ──────────────────────────────────────────────────────────────

    private synchronized void registrarEnNsd(int puerto, String deviceId) {
        if (registro != null || puerto <= 0) {
            return;
        }
        try {
            nsd = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE);
            if (nsd == null) {
                return;
            }
            NsdServiceInfo info = new NsdServiceInfo();
            // El nombre lleva el id del aparato: en un local con dos
            // pantallas (cocina y barra), el terminal tiene que poder saber
            // a cuál está hablando.
            info.setServiceName("mipiace-kds-"
                    + (deviceId == null ? "0" : deviceId.substring(0, Math.min(8, deviceId.length()))));
            info.setServiceType(TIPO_NSD);
            info.setPort(puerto);
            registro = new NsdManager.RegistrationListener() {
                @Override
                public void onServiceRegistered(NsdServiceInfo info) {
                    Log.i(TAG, "kds-2: NSD registrado " + info.getServiceName());
                }

                @Override
                public void onRegistrationFailed(NsdServiceInfo info, int code) {
                    // El camino directo sigue funcionando sin NSD: la IP va
                    // en el latido. NSD es el plan B para cuando cambia.
                    Log.w(TAG, "kds-2: NSD no registró, code=" + code);
                }

                @Override
                public void onServiceUnregistered(NsdServiceInfo info) {
                    Log.i(TAG, "kds-2: NSD desregistrado");
                }

                @Override
                public void onUnregistrationFailed(NsdServiceInfo info, int code) {
                    Log.w(TAG, "kds-2: NSD no desregistró, code=" + code);
                }
            };
            nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, registro);
        } catch (Exception e) {
            Log.w(TAG, "kds-2: NSD no disponible", e);
            registro = null;
        }
    }

    private synchronized void desregistrarDeNsd() {
        try {
            if (nsd != null && registro != null) {
                nsd.unregisterService(registro);
            }
        } catch (Exception e) {
            Log.w(TAG, "kds-2: NSD unregister falló", e);
        }
        registro = null;
    }

    private synchronized void arrancarDescubrimiento() {
        if (descubrimiento != null) {
            return;
        }
        try {
            nsd = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE);
            if (nsd == null) {
                return;
            }
            descubrimiento = new NsdManager.DiscoveryListener() {
                @Override
                public void onDiscoveryStarted(String type) {
                    Log.i(TAG, "kds-2: NSD buscando " + type);
                }

                @Override
                public void onServiceFound(NsdServiceInfo info) {
                    if (!TIPO_NSD.equals(info.getServiceType())
                            && !info.getServiceType().startsWith("_mipiacekds")) {
                        return;
                    }
                    nsd.resolveService(info, new NsdManager.ResolveListener() {
                        @Override
                        public void onResolveFailed(NsdServiceInfo info, int code) {
                            Log.w(TAG, "kds-2: NSD no resolvió, code=" + code);
                        }

                        @Override
                        public void onServiceResolved(NsdServiceInfo resuelto) {
                            InetAddress host = resuelto.getHost();
                            if (host == null) {
                                return;
                            }
                            encontrados.put(resuelto.getServiceName(),
                                    host.getHostAddress() + ":" + resuelto.getPort());
                        }
                    });
                }

                @Override
                public void onServiceLost(NsdServiceInfo info) {
                    encontrados.remove(info.getServiceName());
                }

                @Override
                public void onDiscoveryStopped(String type) {
                    Log.i(TAG, "kds-2: NSD dejó de buscar");
                }

                @Override
                public void onStartDiscoveryFailed(String type, int code) {
                    Log.w(TAG, "kds-2: NSD no arrancó, code=" + code);
                }

                @Override
                public void onStopDiscoveryFailed(String type, int code) {
                    Log.w(TAG, "kds-2: NSD no paró, code=" + code);
                }
            };
            nsd.discoverServices(TIPO_NSD, NsdManager.PROTOCOL_DNS_SD, descubrimiento);
        } catch (Exception e) {
            Log.w(TAG, "kds-2: NSD no disponible", e);
            descubrimiento = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        desregistrarDeNsd();
        try {
            if (nsd != null && descubrimiento != null) {
                nsd.stopServiceDiscovery(descubrimiento);
            }
        } catch (Exception ignored) {
            // nada
        }
        descubrimiento = null;
        servidor.parar();
        super.handleOnDestroy();
    }

    private static String leerTodo(HttpURLConnection con, int http) {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(
                http >= 400 && con.getErrorStream() != null
                        ? con.getErrorStream() : con.getInputStream(),
                StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String linea;
            while ((linea = r.readLine()) != null && sb.length() < 256 * 1024) {
                sb.append(linea);
            }
            return sb.toString();
        } catch (IOException | NullPointerException e) {
            return null;
        }
    }
}
