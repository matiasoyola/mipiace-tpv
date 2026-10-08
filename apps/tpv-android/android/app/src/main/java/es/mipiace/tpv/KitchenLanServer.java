package es.mipiace.tpv;

import android.util.Log;

import java.io.BufferedOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Enumeration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * kds-2-wifi · EL SERVIDOR DE LA TABLET DE COCINA.
 *
 * <p>Un socket que escucha en la wifi del local y acepta mensajes firmados
 * de los terminales de SU tienda. Es lo que hace que, con internet caído,
 * la cocina siga recibiendo comandas.
 *
 * <p><b>Sólo lo arranca una pantalla de cocina.</b> Quien llama es
 * {@link KitchenLanPlugin#arrancar}, y el lado JS sólo lo invoca desde el
 * arranque de la pantalla de cocina, que a su vez sólo existe cuando
 * {@code /kitchen/me} ha dicho que este aparato es un {@code KITCHEN}. Y
 * además: sin clave de tienda no arranca, y la clave sólo la da el servidor
 * a un {@code KITCHEN}. Un terminal de caja no tiene de dónde sacarla.
 *
 * <p>── POR QUÉ UN {@code ServerSocket} Y NO UN SERVIDOR DE VERDAD ───────
 *
 * <p>{@code com.sun.net.httpserver} no está en Android, y meter NanoHTTPD o
 * Ktor por una ruta sería arrastrar una dependencia entera —con su
 * superficie y sus actualizaciones— para parsear dos cabeceras. Lo que se
 * atiende aquí es <b>una sola ruta</b> ({@code POST /kds}) con un cuerpo
 * JSON y {@code Content-Length}: el parseo cabe en cuarenta líneas y lo que
 * no encaje se contesta con un 400 y se cierra.
 *
 * <p>── CÓMO HABLA CON EL WEBVIEW ────────────────────────────────────────
 *
 * <p>No hay llamada síncrona al JS: el socket encola lo que llega y el JS lo
 * vacía ({@code recibidos()}), avisado por un evento del plugin. Y para
 * poder CONTESTAR a un sondeo sin preguntarle al JS, éste le deja aquí una
 * instantánea ({@code publicar()}) con lo que tiene listo. Así:
 *
 * <ul>
 *   <li>una comanda que llega mientras el WebView está ocupado repintando
 *       no se pierde: está en la cola;
 *   <li>un sondeo del TPV se contesta en milisegundos, sin despertar al JS;
 *   <li>y si el WebView se recarga (A4), la cola sigue en memoria del
 *       proceso y el JS la recoge al montar.
 * </ul>
 *
 * <p>── LA HORA ───────────────────────────────────────────────────────────
 *
 * <p>El reloj de una tablet que lleva horas sin internet no vale para
 * rechazar por «demasiado viejo». Así que el JS, que sí conoce el
 * {@code serverTime} de cada {@code GET /kitchen/comandas}, le pasa el
 * DESVÍO ({@code offsetMs}) y aquí se cuenta con la hora corregida. Es la
 * diferencia entre rechazar un mensaje porque es viejo y rechazarlo porque
 * la tablet tiene el reloj mal, que son cosas muy distintas el día que se
 * cae internet.
 */
public final class KitchenLanServer {

    private static final String TAG = "mipiacetpv";

    /** Cuántos mensajes se guardan sin que el JS los recoja. */
    private static final int MAX_COLA = 500;

    /** Lo que se acepta de cuerpo. Una comanda de una mesa no llega a 8 KB. */
    private static final int MAX_CUERPO = 64 * 1024;

    /** Un cliente que no manda nada se cierra: no se ocupa un hilo gratis. */
    private static final int TIMEOUT_SOCKET_MS = 5_000;

    /** La única ruta. */
    private static final String RUTA = "/kds";

    private final AtomicBoolean vivo = new AtomicBoolean(false);
    private final Deque<String> cola = new ArrayDeque<>();
    private final KitchenLanProtocol.MemoriaDeOperaciones memoria =
            new KitchenLanProtocol.MemoriaDeOperaciones();

    private ServerSocket socket;
    private ExecutorService hilos;
    private Thread aceptador;

    private volatile String storeId;
    private volatile String claveTienda;
    private volatile String deviceId;
    private volatile long offsetMs;
    /** La instantánea cifrada que se contesta a un SONDEO, o null. */
    private volatile String respuestaJson;

    private volatile int puerto;
    private volatile long ultimaPeticionMs;
    private volatile int rechazados;
    private volatile int aceptados;

    public interface AvisoDeMensaje {
        void nuevo(int enCola);
    }

    private volatile AvisoDeMensaje aviso;

    public synchronized boolean escuchando() {
        return vivo.get();
    }

    public int puerto() {
        return puerto;
    }

    public long ultimaPeticionMs() {
        return ultimaPeticionMs;
    }

    public int rechazados() {
        return rechazados;
    }

    public int aceptados() {
        return aceptados;
    }

    public int enCola() {
        synchronized (cola) {
            return cola.size();
        }
    }

    public void avisarCon(AvisoDeMensaje aviso) {
        this.aviso = aviso;
    }

    /**
     * Arranca el servidor. Idempotente: llamarlo dos veces no abre dos
     * sockets, y actualizar la clave o el desvío no lo reinicia.
     *
     * @throws IOException si el puerto está ocupado. Quien llama lo
     *     convierte en «el servidor local no arrancó», que viaja al latido
     *     como {@code lanListening: false}: el TPV tiene que saber que ahí
     *     no hay nadie escuchando en vez de reintentar contra el vacío.
     */
    public synchronized void arrancar(String storeId, String claveTienda,
                                      String deviceId, int puertoPedido,
                                      long offsetMs) throws IOException {
        if (storeId == null || storeId.isEmpty()
                || claveTienda == null || claveTienda.isEmpty()) {
            // Sin clave NO se escucha. Una tablet que aceptara sin clave
            // aceptaría cualquier cosa de cualquiera que esté en la wifi del
            // bar, que es exactamente el ataque que este bloque evita.
            throw new IOException("sin tienda o sin clave no se abre el puerto");
        }
        this.storeId = storeId;
        this.claveTienda = claveTienda;
        this.deviceId = deviceId;
        this.offsetMs = offsetMs;
        if (vivo.get()) {
            return;
        }
        int p = puertoPedido > 0 ? puertoPedido : KitchenLanProtocol.PUERTO_POR_DEFECTO;
        socket = new ServerSocket(p);
        socket.setReuseAddress(true);
        puerto = socket.getLocalPort();
        hilos = Executors.newFixedThreadPool(4);
        vivo.set(true);
        aceptador = new Thread(this::bucle, "kds-lan");
        aceptador.setDaemon(true);
        aceptador.start();
        Log.i(TAG, "kds-2: servidor de cocina escuchando en " + puerto);
    }

    /** Para el servidor. Idempotente. */
    public synchronized void parar() {
        vivo.set(false);
        try {
            if (socket != null) {
                socket.close();
            }
        } catch (IOException ignored) {
            // Cerrar un socket ya cerrado no es un problema de nadie.
        }
        socket = null;
        if (hilos != null) {
            hilos.shutdownNow();
            hilos = null;
        }
        aceptador = null;
        puerto = 0;
        Log.i(TAG, "kds-2: servidor de cocina parado");
    }

    /** Actualiza la clave (se rotó) y el desvío de reloj, sin reiniciar. */
    public void refrescar(String claveTienda, long offsetMs) {
        if (claveTienda != null && !claveTienda.isEmpty()) {
            this.claveTienda = claveTienda;
        }
        this.offsetMs = offsetMs;
    }

    /** Lo que se contesta a un SONDEO. Lo compone el JS y lo deja aquí. */
    public void publicar(String respuestaJson) {
        this.respuestaJson = respuestaJson;
    }

    /** Vacía la cola de mensajes verificados. Lo llama el JS. */
    public String[] recoger() {
        synchronized (cola) {
            String[] out = cola.toArray(new String[0]);
            cola.clear();
            return out;
        }
    }

    /** La IPv4 privada de esta tablet, o null. Mismo criterio que A5. */
    public static String ipLocal() {
        try {
            Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
            while (ifaces != null && ifaces.hasMoreElements()) {
                NetworkInterface iface = ifaces.nextElement();
                if (!iface.isUp() || iface.isLoopback()) {
                    continue;
                }
                Enumeration<InetAddress> dirs = iface.getInetAddresses();
                while (dirs.hasMoreElements()) {
                    InetAddress dir = dirs.nextElement();
                    if (dir instanceof Inet4Address && dir.isSiteLocalAddress()) {
                        return dir.getHostAddress();
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "kds-2: no pude leer la IP local", e);
        }
        return null;
    }

    private void bucle() {
        while (vivo.get()) {
            final Socket cliente;
            try {
                cliente = socket.accept();
            } catch (IOException e) {
                if (vivo.get()) {
                    Log.w(TAG, "kds-2: accept falló", e);
                }
                return;
            }
            final ExecutorService pool = hilos;
            if (pool == null) {
                cerrar(cliente);
                return;
            }
            try {
                pool.execute(() -> atender(cliente));
            } catch (RuntimeException e) {
                // El pool está saturado o cerrándose. Se cierra el cliente y
                // el TPV reintenta: nunca se cae el bucle de accept, que es
                // lo que dejaría la cocina sorda hasta reiniciar la tablet.
                cerrar(cliente);
            }
        }
    }

    private void atender(Socket cliente) {
        ultimaPeticionMs = System.currentTimeMillis();
        try {
            cliente.setSoTimeout(TIMEOUT_SOCKET_MS);
            InputStream in = cliente.getInputStream();
            Peticion pet = Peticion.leer(in);
            if (pet == null || !"POST".equals(pet.metodo) || !RUTA.equals(pet.ruta)) {
                responder(cliente, 404, "{\"error\":\"RUTA\"}");
                return;
            }
            String cuerpo = pet.cuerpo;
            KitchenLanMensaje.Resultado r = KitchenLanMensaje.procesar(
                    cuerpo, claveTienda, storeId, deviceId,
                    System.currentTimeMillis() + offsetMs, memoria, respuestaJson);
            if (r.aceptado) {
                aceptados++;
                if (r.paraElJs != null) {
                    boolean encolado;
                    synchronized (cola) {
                        while (cola.size() >= MAX_COLA) {
                            // Se tira la MÁS ANTIGUA: si el JS lleva 500
                            // mensajes sin recoger, la tablet está colgada y
                            // lo último que llegó es lo que el cocinero
                            // necesita ver.
                            cola.pollFirst();
                        }
                        cola.addLast(r.paraElJs);
                        encolado = true;
                    }
                    AvisoDeMensaje a = aviso;
                    if (encolado && a != null) {
                        a.nuevo(enCola());
                    }
                }
            } else {
                rechazados++;
            }
            responder(cliente, r.http, r.respuesta);
        } catch (IOException e) {
            // Un cliente que se va a medias no es asunto de la cocina.
        } catch (RuntimeException e) {
            Log.w(TAG, "kds-2: petición rara", e);
            try {
                responder(cliente, 400, "{\"error\":\"MALFORMADO\"}");
            } catch (IOException ignored) {
                // nada que hacer
            }
        } finally {
            cerrar(cliente);
        }
    }

    private static void responder(Socket cliente, int http, String cuerpo)
            throws IOException {
        byte[] bytes = (cuerpo == null ? "{}" : cuerpo).getBytes(StandardCharsets.UTF_8);
        BufferedOutputStream out = new BufferedOutputStream(cliente.getOutputStream());
        String cabecera = "HTTP/1.1 " + http + " " + razon(http) + "\r\n"
                + "Content-Type: application/json; charset=utf-8\r\n"
                + "Content-Length: " + bytes.length + "\r\n"
                // Sin CORS a propósito: a esto no se llama desde ninguna
                // página, se llama desde el puente nativo del TPV. Un
                // `Access-Control-Allow-Origin: *` abriría la cocina a
                // cualquier web que el móvil de un cliente tuviera abierta.
                + "Connection: close\r\n\r\n";
        out.write(cabecera.getBytes(StandardCharsets.US_ASCII));
        out.write(bytes);
        out.flush();
    }

    private static String razon(int http) {
        switch (http) {
            case 200: return "OK";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 408: return "Request Timeout";
            case 409: return "Conflict";
            case 500: return "Internal Server Error";
            default: return "Error";
        }
    }

    private static void cerrar(Socket s) {
        try {
            s.close();
        } catch (IOException ignored) {
            // nada
        }
    }

    /**
     * Lo mínimo de HTTP/1.1 que hace falta: método, ruta y un cuerpo con
     * {@code Content-Length}.
     *
     * <p>Sin {@code Transfer-Encoding: chunked} y sin keep-alive: el único
     * cliente de este servidor es nuestro propio puente nativo, que manda un
     * POST con largo conocido y cierra. Soportar más sería soportar más
     * superficie de la que nadie usa.
     */
    static final class Peticion {
        String metodo;
        String ruta;
        String cuerpo;

        static Peticion leer(InputStream in) throws IOException {
            StringBuilder cabeceras = new StringBuilder();
            int anterior = -1;
            int seguidos = 0;
            while (cabeceras.length() < 8 * 1024) {
                int b = in.read();
                if (b < 0) {
                    return null;
                }
                cabeceras.append((char) b);
                if (b == '\n' && anterior == '\r') {
                    seguidos++;
                    if (seguidos == 2) {
                        break;
                    }
                } else if (b != '\r') {
                    seguidos = 0;
                }
                anterior = b;
            }
            String[] lineas = cabeceras.toString().split("\r\n");
            if (lineas.length == 0) {
                return null;
            }
            String[] primera = lineas[0].split(" ");
            if (primera.length < 2) {
                return null;
            }
            Peticion p = new Peticion();
            p.metodo = primera[0];
            p.ruta = primera[1];
            int largo = 0;
            for (int i = 1; i < lineas.length; i++) {
                String l = lineas[i];
                int dosPuntos = l.indexOf(':');
                if (dosPuntos < 0) {
                    continue;
                }
                if (l.substring(0, dosPuntos).trim().equalsIgnoreCase("content-length")) {
                    try {
                        largo = Integer.parseInt(l.substring(dosPuntos + 1).trim());
                    } catch (NumberFormatException e) {
                        return null;
                    }
                }
            }
            if (largo < 0 || largo > MAX_CUERPO) {
                return null;
            }
            byte[] cuerpo = new byte[largo];
            int leidos = 0;
            while (leidos < largo) {
                int n = in.read(cuerpo, leidos, largo - leidos);
                if (n < 0) {
                    return null;
                }
                leidos += n;
            }
            p.cuerpo = new String(cuerpo, StandardCharsets.UTF_8);
            return p;
        }
    }
}
