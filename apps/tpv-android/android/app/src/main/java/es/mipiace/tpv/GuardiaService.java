package es.mipiace.tpv;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * residencia-4 (D-66) · <b>EL SERVICIO QUE HACE QUE EL MÓVIL SUENE DE
 * VERDAD.</b>
 *
 * <p>El prompt lo pide con estas palabras: «con el móvil bloqueado y la app
 * en segundo plano, con sonido de alarma y hasta que alguien lo acuse. Cómo
 * se consigue en Android lo decides tú y lo justificas en el done».
 *
 * <h2>Qué se eligió, y por qué</h2>
 *
 * <p><b>Un servicio en primer plano que SONDEA, no FCM.</b> Tres razones, y
 * la tercera es la que manda:
 *
 * <ol>
 *   <li><b>No depende de servicios de Google.</b> El prompt pide decirlo si
 *       dependiera, y la respuesta es que no: esto funciona en una tablet
 *       china sin Play Services y en un móvil con la cuenta de Google
 *       cerrada. El centro cero compra el hardware en una tienda de
 *       Talavera y nadie va a mirar si trae GMS.</li>
 *   <li><b>No añade una infraestructura más.</b> FCM obliga a un proyecto
 *       de Firebase, una clave de servidor que custodiar, un token por
 *       dispositivo que registrar y renovar, y un camino de entrega que no
 *       podemos probar en el VPS. Todo eso para avisar a dos teléfonos de
 *       un centro de 49 plazas.</li>
 *   <li><b>Se puede probar y se puede ver fallar.</b> Un sondeo que no
 *       llega se nota en el log y en la pantalla («Sin conexión: este móvil
 *       no está recibiendo avisos»). Una notificación de FCM que Google
 *       decide retrasar no se nota en ninguna parte — y lo único peor que
 *       un aviso que no llega es un aviso que no llega y nadie lo sabe.</li>
 * </ol>
 *
 * <p><b>Lo que cuesta, dicho:</b> un GET cada {@link #PERIODO_MS} ms con la
 * pantalla apagada. Es batería real. Se asume porque un móvil de guardia
 * vive en un bolsillo durante un turno y duerme en un cargador — y porque
 * el periodo es el mismo que el sondeo del WebView, así que el coste no se
 * duplica: cuando la app está delante, el que sondea es el WebView; cuando
 * se va a segundo plano, este servicio. <b>El día que un centro grande
 * necesite veinte móviles, esto se cambia por FCM</b> y la pantalla no se
 * entera: lo único que el WebView sabe es «empieza» y «para».
 *
 * <h2>Por qué un servicio en primer plano y no un WorkManager</h2>
 *
 * <p>Porque un {@code WorkManager} periódico tiene un mínimo de quince
 * minutos y Doze lo retrasa más. Quince minutos no es un aviso: es un
 * parte. Un servicio en primer plano con su notificación permanente es
 * exactamente el caso de uso que Android quiere que se declare — y el
 * usuario ve en su barra que el móvil está de guardia, que además es
 * información útil.
 *
 * <h2>Y lo que la notificación DICE</h2>
 *
 * <p>«Aviso N2 · habitación 112» y nada más (ver
 * {@link GuardiaAviso#textoDeLaNotificacion()}). El detalle está detrás del
 * desbloqueo y detrás de la sesión de guardia.
 */
public class GuardiaService extends Service {

    private static final String TAG = "mipiacetpv.guardia";

    /** El canal de la notificación permanente: silenciosa, de fondo. */
    public static final String CANAL_ESTADO = "guardia_estado";
    /** Y el de la ALARMA: importancia alta, sonido de alarma, vibración. */
    public static final String CANAL_ALARMA = "guardia_alarma";

    private static final int ID_PERMANENTE = 4401;
    /** Los avisos empiezan aquí para no pisar el permanente. */
    private static final int ID_BASE_AVISO = 4500;

    /**
     * Cada cuánto se pregunta. Diez segundos.
     *
     * <p>Es el número del bloque y conviene justificarlo: el escalado de un
     * N2 sin acusar son cinco minutos (D-66), así que un retraso de diez
     * segundos en que suene no cambia nada del protocolo; y bajarlo a dos
     * segundos multiplicaría por cinco la batería para ganar ocho segundos
     * en un aviso que una persona tarda treinta en atender.
     */
    private static final long PERIODO_MS = 10_000L;

    private Thread hilo;
    private volatile boolean vivo = false;
    private volatile String apiBase;
    private volatile String deviceToken;
    private volatile String sesion;
    private volatile String canal = "";
    private volatile String quien = "";

    /** Los avisos que ya hicieron sonar el móvil. Para no re-sonar en cada
     *  sondeo: Android re-notifica con el mismo id sin volver a sonar, pero
     *  este conjunto evita además reconstruir la notificación. */
    private final Set<String> yaSonaron = new HashSet<>();

    public static final String ACCION_EMPEZAR = "es.mipiace.tpv.GUARDIA_EMPEZAR";
    public static final String ACCION_PARAR = "es.mipiace.tpv.GUARDIA_PARAR";

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACCION_PARAR.equals(intent.getAction())) {
            pararTodo();
            return START_NOT_STICKY;
        }
        apiBase = intent.getStringExtra("apiBase");
        deviceToken = intent.getStringExtra("deviceToken");
        sesion = intent.getStringExtra("sesion");
        canal = intent.getStringExtra("canal");
        quien = intent.getStringExtra("quien");
        crearCanales();
        startForeground(ID_PERMANENTE, notificacionPermanente());
        arrancarHilo();
        // `START_STICKY`: si Android mata el proceso por memoria, el
        // servicio vuelve. Es un móvil de guardia — que se quede apagado
        // en silencio es el fallo que este bloque existe para evitar.
        // Vuelve SIN los extras (`intent == null` arriba), así que lo que
        // hace es pararse limpio y el WebView lo arranca otra vez al
        // volver: lo que no se puede es sondear con un token que ya no
        // vale.
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        pararTodo();
        super.onDestroy();
    }

    private void pararTodo() {
        vivo = false;
        if (hilo != null) {
            hilo.interrupt();
            hilo = null;
        }
        stopForeground(true);
        stopSelf();
    }

    private void crearCanales() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;

        NotificationChannel estado = new NotificationChannel(
                CANAL_ESTADO,
                "Guardia activa",
                NotificationManager.IMPORTANCE_LOW);
        estado.setDescription("Dice que este móvil está de guardia. No suena.");
        estado.setShowBadge(false);
        nm.createNotificationChannel(estado);

        // ── EL CANAL DE ALARMA ───────────────────────────────────────
        //
        // `IMPORTANCE_HIGH` + sonido de ALARMA (no de notificación) +
        // `USAGE_ALARM`. Lo de la usage no es cosmético: con
        // `USAGE_NOTIFICATION`, el sonido sale por el volumen de
        // notificaciones, que en un móvil personal está a cero la mitad
        // de las veces. Con `USAGE_ALARM` sale por el de alarmas, que es
        // el que nadie baja — es el que le despierta por la mañana.
        //
        // Y `setBypassDnd(true)`: «No molestar» no puede tapar un N4. El
        // usuario tiene que concederlo en ajustes la primera vez; si no
        // lo concede, el canal sigue sonando fuera de DND, que es la
        // mayor parte del tiempo.
        NotificationChannel alarma = new NotificationChannel(
                CANAL_ALARMA,
                "Avisos de guardia",
                NotificationManager.IMPORTANCE_HIGH);
        alarma.setDescription("Suena cuando hay un aviso que atender.");
        alarma.enableVibration(true);
        alarma.setVibrationPattern(new long[]{0, 600, 400, 600, 400, 600});
        alarma.setBypassDnd(true);
        alarma.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        Uri sonido = android.media.RingtoneManager.getDefaultUri(
                android.media.RingtoneManager.TYPE_ALARM);
        alarma.setSound(
                sonido,
                new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
        nm.createNotificationChannel(alarma);
    }

    private PendingIntent abrirLaApp() {
        Intent abrir = new Intent(this, MainActivity.class);
        abrir.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getActivity(this, 0, abrir, flags);
    }

    private Notification notificacionPermanente() {
        String texto = (quien == null || quien.isEmpty())
                ? "Este móvil está de guardia."
                : "De guardia: " + quien;
        return new NotificationCompat.Builder(this, CANAL_ESTADO)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle(
                        "ENFERMERIA".equals(canal) ? "Guardia de enfermería" : "Guardia de dirección")
                .setContentText(texto)
                .setOngoing(true)
                .setContentIntent(abrirLaApp())
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    private void arrancarHilo() {
        if (vivo) return;
        vivo = true;
        hilo = new Thread(() -> {
            // El `WakeLock` parcial es lo que mantiene la CPU despierta
            // entre sondeos con la pantalla apagada. Sin él, Doze alarga
            // los intervalos y un aviso de las cuatro de la mañana puede
            // tardar minutos.
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            PowerManager.WakeLock lock = pm == null
                    ? null
                    : pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "mipiacetpv:guardia");
            if (lock != null) lock.acquire();
            try {
                while (vivo && !Thread.currentThread().isInterrupted()) {
                    try {
                        sondear();
                    } catch (Exception e) {
                        // Sin red o el servidor caído. **No se para**: el
                        // sondeo siguiente lo intenta otra vez. Un móvil de
                        // guardia que deja de preguntar porque falló una
                        // vez es un móvil apagado.
                        Log.w(TAG, "sondeo fallido: " + e.getMessage());
                    }
                    try {
                        Thread.sleep(PERIODO_MS);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                    }
                }
            } finally {
                if (lock != null && lock.isHeld()) lock.release();
            }
        }, "mipiacetpv-guardia");
        hilo.setDaemon(true);
        hilo.start();
    }

    private void sondear() throws IOException, org.json.JSONException {
        if (apiBase == null || deviceToken == null || sesion == null) return;
        HttpURLConnection con =
                (HttpURLConnection) new URL(apiBase + "/residencia/guardia/avisos").openConnection();
        con.setRequestMethod("GET");
        con.setConnectTimeout(8000);
        con.setReadTimeout(8000);
        con.setRequestProperty("X-Device-Token", deviceToken);
        con.setRequestProperty("Authorization", "Bearer " + sesion);
        try {
            int codigo = con.getResponseCode();
            if (codigo == 401 || codigo == 403) {
                // La guardia caducó o el móvil se revocó. Se para y se
                // quita la notificación permanente: dejarla puesta diría
                // que el móvil está de guardia cuando no lo está, y eso es
                // peor que no tener nada.
                Log.i(TAG, "la guardia ya no vale (" + codigo + "): se para el servicio");
                pararTodo();
                return;
            }
            if (codigo != 200) return;
            StringBuilder sb = new StringBuilder();
            try (BufferedReader r = new BufferedReader(
                    new InputStreamReader(con.getInputStream(), StandardCharsets.UTF_8))) {
                String linea;
                while ((linea = r.readLine()) != null) sb.append(linea);
            }
            List<GuardiaAviso> avisos = GuardiaAviso.deLaRespuesta(sb.toString());
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm == null) return;

            Set<String> vivosAhora = new HashSet<>();
            for (GuardiaAviso a : avisos) {
                if (a.acusado || !a.esUrgente()) continue;
                vivosAhora.add(a.id);
                if (yaSonaron.contains(a.id)) continue;
                yaSonaron.add(a.id);
                nm.notify(idDeAviso(a.id), notificacionDeAviso(a));
            }
            // Y lo que ya no está vivo —lo acusó alguien, o se cerró la
            // incidencia— **deja de sonar**. Es la otra mitad de «hasta
            // que alguien lo acuse»: si la enfermera lo coge desde su
            // móvil, el de dirección tiene que callarse solo.
            for (String id : new HashSet<>(yaSonaron)) {
                if (vivosAhora.contains(id)) continue;
                yaSonaron.remove(id);
                nm.cancel(idDeAviso(id));
            }
        } finally {
            con.disconnect();
        }
    }

    /** Un id de notificación estable por aviso, para poder cancelarlo. */
    private int idDeAviso(String alertId) {
        return ID_BASE_AVISO + Math.abs(alertId.hashCode() % 1000);
    }

    private Notification notificacionDeAviso(GuardiaAviso a) {
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CANAL_ALARMA)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle(a.textoDeLaNotificacion())
                // Y el cuerpo, otra vez sin nada de salud: lo que hay que
                // hacer, no lo que pasa.
                .setContentText("Abre para verlo y pulsar «Voy».")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                // `ongoing`: no se quita deslizando. Se quita cuando
                // alguien lo acusa, que es lo que el prompt pide con
                // «hasta que alguien lo acuse».
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(abrirLaApp())
                // Con la pantalla apagada, esto la enciende con el aviso
                // delante. En N4 es la diferencia entre mirar el móvil y
                // no mirarlo.
                .setFullScreenIntent(abrirLaApp(), true);
        return b.build();
    }

    /** Arranca el servicio desde el plugin. */
    public static void empezar(
            Context ctx,
            String apiBase,
            String deviceToken,
            String sesion,
            String canal,
            String quien) {
        Intent i = new Intent(ctx, GuardiaService.class);
        i.setAction(ACCION_EMPEZAR);
        i.putExtra("apiBase", apiBase);
        i.putExtra("deviceToken", deviceToken);
        i.putExtra("sesion", sesion);
        i.putExtra("canal", canal);
        i.putExtra("quien", quien);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(i);
        } else {
            ctx.startService(i);
        }
    }

    public static void parar(Context ctx) {
        Intent i = new Intent(ctx, GuardiaService.class);
        i.setAction(ACCION_PARAR);
        ctx.startService(i);
    }
}
