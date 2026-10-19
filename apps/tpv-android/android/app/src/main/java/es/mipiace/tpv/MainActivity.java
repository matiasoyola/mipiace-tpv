package es.mipiace.tpv;

import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import java.io.File;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "mipiacetpv";

    /**
     * A1-Android · Frente 2 · registra el plugin USB Host de impresión
     * ANTES de super.onCreate (así el bridge lo conoce al cargar el
     * WebView). Es un plugin local del proyecto, no un paquete npm.
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // A4 · rescate de terminales envenenados. VA PRIMERO, antes de
        // registrar plugins y antes de super.onCreate(): a partir de ahí el
        // bridge crea el WebView, abre los ficheros del perfil y lo que haya
        // en el Service Worker ya está sirviendo la página. Borrar en caliente
        // no vale.
        rescatarWebViewSiCambioLaVersion();

        // n1-vertical · la orientación. VA DESPUÉS del rescate de A4 (que no
        // se toca) y ANTES de super.onCreate(), que es donde el bridge crea
        // el WebView: si se pidiera después, el WebView mediría la pantalla
        // en horizontal, el CSS repartiría con 360 px de alto y el giro
        // posterior sería un reflow a la vista del cajero.
        fijarOrientacionPorTamano();

        registerPlugin(UsbPrinterPlugin.class);
        // A2-Android · Frente 1 · permiso nativo de cámara para el escáner.
        registerPlugin(CameraPermissionPlugin.class);
        // A5 · lo que el terminal sabe de sí mismo y el WebView no: red, IP
        // local, arranque, y la captura de su propia ventana.
        registerPlugin(SupportAgentPlugin.class);
        // kds-2-wifi · el camino directo por la wifi del local. Los dos
        // papeles en el mismo plugin porque es la MISMA APK: la tablet de
        // cocina abre el servidor local y el terminal de caja manda por él.
        // Registrarlo NO abre ningún puerto: el servidor sólo arranca cuando
        // el JS de la pantalla de cocina lo pide con la clave de la tienda.
        registerPlugin(KitchenLanPlugin.class);
        // residencia-4 (D-66) · el móvil de guardia. Registrarlo NO
        // arranca ningún servicio ni pide ningún permiso: el servicio
        // sólo se enciende cuando alguien se pone de guardia con su PIN,
        // y eso sólo pasa en un dispositivo `GUARD`. Mismo criterio que
        // `KitchenLanPlugin`, que tampoco abre un puerto al registrarse.
        registerPlugin(GuardiaAlarmPlugin.class);
        super.onCreate(savedInstanceState);

        // hierro-sirope (B) · la pantalla blanca que sólo arregla un
        // reinicio. VA DESPUÉS de super.onCreate(): hasta aquí no existe el
        // bridge ni, por tanto, el WebView al que escuchar.
        armarVigilanteDelWebView();
    }

    // ── hierro-sirope (B) · EL VIGILANTE NATIVO ─────────────────────────
    //
    // Ver la cabecera de VigilanteNativo para la causa y la evidencia. Aquí
    // sólo está el cableado con Android: escuchar al WebView, contar el
    // tiempo y pintar la pantalla de rendición.
    //
    // Por qué nativo y no JavaScript: cuando el renderer no arranca NO SE
    // EJECUTA JAVASCRIPT. El vigilante de arranque de auditoria-sirope
    // (`apps/tpv-web/src/lib/vigilante-arranque.ts`) sigue en su sitio y
    // cubre lo otro —el bundle que carga y se cuelga—; esto cubre el caso
    // en que no llega a cargar nada.

    /**
     * El intento de recuperación se gasta UNA VEZ POR PROCESO, no una vez
     * por actividad: recuperarse es `recreate()`, que construye una
     * actividad nueva con un vigilante nuevo. Estático y no en el `Bundle`
     * porque lo que no puede repetirse es el intento dentro de este
     * arranque, y un proceso nuevo (reabrir la app) sí merece el suyo.
     */
    private static boolean rescateGastadoEnEsteProceso = false;

    private final VigilanteNativo vigilante =
            new VigilanteNativo(rescateGastadoEnEsteProceso);
    private final Handler vigilanteHandler = new Handler(Looper.getMainLooper());
    private Runnable vigilantePlazo;

    private void armarVigilanteDelWebView() {
        try {
            // `onPageLoaded` sólo llega si el renderer está vivo y la página
            // cargó: es exactamente «ha pintado». No vale `onPageStarted`,
            // que ocurre antes de que el renderer tenga nada que enseñar.
            //
            // `onRenderProcessGone` devolviendo `true` es la otra mitad y
            // vale por sí sola: le dice al sistema que la muerte del
            // renderer está GESTIONADA. Sin eso, Android se lleva por
            // delante el proceso de la app entera y la caja desaparece de
            // la pantalla sin decir nada.
            bridge.addWebViewListener(
                    new WebViewListener() {
                        @Override
                        public void onPageLoaded(WebView webView) {
                            desarmarVigilante();
                        }

                        @Override
                        public boolean onRenderProcessGone(
                                WebView webView, RenderProcessGoneDetail detail) {
                            Log.e(TAG, "hierro-sirope B: el renderer del WebView se fue");
                            decidirQueHacer();
                            return true;
                        }
                    });
            programarPlazo();
        } catch (Throwable t) {
            // Igual que el rescate de A4 y la orientación: esto corre en el
            // camino crítico del arranque de una caja. Sin vigilante se
            // arranca como hasta hoy.
            Log.e(TAG, "hierro-sirope B: no pude armar el vigilante; el arranque sigue", t);
        }
    }

    private void programarPlazo() {
        if (vigilantePlazo != null) {
            vigilanteHandler.removeCallbacks(vigilantePlazo);
        }
        vigilantePlazo =
                new Runnable() {
                    @Override
                    public void run() {
                        if (vigilante.haPintado()) {
                            return;
                        }
                        Log.e(
                                TAG,
                                "hierro-sirope B: el WebView no ha pintado en "
                                        + vigilante.esperaMs()
                                        + " ms");
                        decidirQueHacer();
                    }
                };
        vigilanteHandler.postDelayed(vigilantePlazo, vigilante.esperaMs());
    }

    private void desarmarVigilante() {
        vigilante.pintado();
        if (vigilantePlazo != null) {
            vigilanteHandler.removeCallbacks(vigilantePlazo);
            vigilantePlazo = null;
        }
    }

    private void decidirQueHacer() {
        VigilanteNativo.Decision decision = vigilante.noPinta();
        switch (decision) {
            case RECREAR:
                rescateGastadoEnEsteProceso = true;
                Log.w(TAG, "hierro-sirope B: un intento de recuperación (recreate)");
                try {
                    // El WebView muerto se tira ANTES de recrear: dejarlo
                    // colgado de la jerarquía mantiene viva su conexión con
                    // el servicio aislado, que es justo lo que hay que
                    // soltar para que el siguiente intento pida un hueco
                    // nuevo.
                    WebView wv = bridge != null ? bridge.getWebView() : null;
                    if (wv != null) {
                        ViewGroup padre = (ViewGroup) wv.getParent();
                        if (padre != null) {
                            padre.removeView(wv);
                        }
                        wv.destroy();
                    }
                } catch (Throwable t) {
                    Log.e(TAG, "hierro-sirope B: no pude tirar el WebView muerto", t);
                }
                try {
                    recreate();
                } catch (Throwable t) {
                    Log.e(TAG, "hierro-sirope B: recreate() falló; me rindo", t);
                    pintarRendicion();
                }
                return;
            case RENDIRSE:
                pintarRendicion();
                return;
            case NADA:
            default:
        }
    }

    /**
     * La pantalla de rendición, construida EN CÓDIGO.
     *
     * <p>Sin inflar un layout y sin una sola referencia al WebView: lo que
     * tiene que seguir funcionando cuando el WebView no funciona no puede
     * depender de nada que el WebView toque. Es la misma razón por la que el
     * rescate de A4 es Java puro.
     */
    private void pintarRendicion() {
        try {
            LinearLayout raiz = new LinearLayout(this);
            raiz.setOrientation(LinearLayout.VERTICAL);
            raiz.setGravity(Gravity.CENTER);
            raiz.setBackgroundColor(Color.parseColor("#12161F"));
            int pad = (int) TypedValue.applyDimension(
                    TypedValue.COMPLEX_UNIT_DIP, 32, getResources().getDisplayMetrics());
            raiz.setPadding(pad, pad, pad, pad);

            TextView titulo = new TextView(this);
            titulo.setText(VigilanteNativo.TITULO_RENDICION);
            titulo.setTextColor(Color.WHITE);
            titulo.setTextSize(TypedValue.COMPLEX_UNIT_SP, 30);
            titulo.setGravity(Gravity.CENTER);
            raiz.addView(titulo);

            TextView cuerpo = new TextView(this);
            cuerpo.setText(VigilanteNativo.CUERPO_RENDICION);
            cuerpo.setTextColor(Color.parseColor("#E6E8EC"));
            cuerpo.setTextSize(TypedValue.COMPLEX_UNIT_SP, 19);
            cuerpo.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams lp =
                    new LinearLayout.LayoutParams(
                            ViewGroup.LayoutParams.WRAP_CONTENT,
                            ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.topMargin = pad / 2;
            cuerpo.setLayoutParams(lp);
            raiz.addView(cuerpo);

            Button reintentar = new Button(this);
            reintentar.setText(VigilanteNativo.BOTON_RENDICION);
            reintentar.setAllCaps(false);
            reintentar.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
            LinearLayout.LayoutParams blp =
                    new LinearLayout.LayoutParams(
                            ViewGroup.LayoutParams.WRAP_CONTENT,
                            ViewGroup.LayoutParams.WRAP_CONTENT);
            blp.topMargin = pad;
            reintentar.setLayoutParams(blp);
            reintentar.setOnClickListener(
                    new View.OnClickListener() {
                        @Override
                        public void onClick(View v) {
                            recreate();
                        }
                    });
            raiz.addView(reintentar);

            // La línea de diagnóstico, pequeña y abajo: es lo que Matías
            // necesita leer por teléfono sin pedir un logcat.
            TextView pie = new TextView(this);
            pie.setText(diagnosticoDelWebView());
            pie.setTextColor(Color.parseColor("#8A93A6"));
            pie.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            pie.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams plp =
                    new LinearLayout.LayoutParams(
                            ViewGroup.LayoutParams.WRAP_CONTENT,
                            ViewGroup.LayoutParams.WRAP_CONTENT);
            plp.topMargin = pad;
            pie.setLayoutParams(plp);
            raiz.addView(pie);

            setContentView(raiz);
            Log.e(TAG, "hierro-sirope B: pantalla de rendición · " + diagnosticoDelWebView());
        } catch (Throwable t) {
            Log.e(TAG, "hierro-sirope B: ni la pantalla de rendición pude pintar", t);
        }
    }

    private String diagnosticoDelWebView() {
        String webview = "WebView desconocido";
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                PackageInfo p = WebView.getCurrentWebViewPackage();
                if (p != null) {
                    webview = p.packageName + " " + p.versionName;
                }
            }
        } catch (Throwable ignored) {
            /* el diagnóstico es un extra: nunca tumba la pantalla */
        }
        return webview + " · Android " + Build.VERSION.RELEASE;
    }

    /**
     * n1-vertical · única fuente de verdad de la orientación.
     *
     * <p>El atributo {@code android:screenOrientation} salió del manifiesto en
     * este bloque: con los dos sitios, el manifiesto gana al arrancar y el
     * código corrige después, lo que se ve como un giro en la cara del
     * cajero — y además deja dos números que pueden separarse sin que nada se
     * ponga rojo. La decisión vive en {@link OrientacionPorTamano}, que es lo
     * que se prueba.
     *
     * <p>Envuelto en try/catch entero por el mismo motivo que el rescate de
     * A4: esto corre en el camino crítico del arranque de una caja. Si algo
     * falla se pide horizontal, que es como han funcionado los quince
     * terminales de producción hasta hoy. Y si eso también falla, el arranque
     * sigue: una caja sin TPV es peor que una caja torcida.
     */
    private void fijarOrientacionPorTamano() {
        int orientacion = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
        try {
            Configuration config = getResources().getConfiguration();
            orientacion =
                    OrientacionPorTamano.paraSmallestScreenWidthDp(config.smallestScreenWidthDp);
            Log.i(TAG, "n1-vertical: "
                    + OrientacionPorTamano.describir(config.smallestScreenWidthDp)
                    + " -> orientacion " + orientacion);
        } catch (Throwable t) {
            Log.e(TAG, "n1-vertical: no pude medir la pantalla; me quedo en horizontal", t);
        }
        try {
            setRequestedOrientation(orientacion);
        } catch (Throwable t) {
            Log.e(TAG, "n1-vertical: setRequestedOrientation falló; el arranque sigue", t);
        }
    }

    /**
     * A4 · si el versionCode instalado cambió desde el último arranque, limpia
     * el almacenamiento de Service Workers y la caché del WebView.
     *
     * <p>Un terminal que ya tiene registrado el SW de producción seguiría
     * sirviendo producción aunque se le instale la APK nueva — el JS que se
     * ejecuta es el de producción, así que un rescate escrito en el front no
     * llegaría nunca a correr. Ver {@link WebViewRescue} para el detalle de
     * qué se borra y, sobre todo, de qué NO se borra (localStorage: ahí vive
     * la vinculación del terminal).
     *
     * <p>No recarga ni reinicia nada: se limita a dejar el disco limpio antes
     * de que el WebView arranque, así que no puede entrar en bucle. La
     * anotación en SharedPreferences lo hace idempotente entre arranques de la
     * misma versión.
     *
     * <p>Envuelto en try/catch entero: esto corre en el camino crítico del
     * arranque de una caja. Si falla, el terminal se queda como estaba, que es
     * malo pero conocido; una excepción aquí dejaría la barra sin TPV.
     */
    private void rescatarWebViewSiCambioLaVersion() {
        try {
            long instalada = leerVersionCodeInstalada();
            if (instalada == WebViewRescue.NUNCA_PURGADO) {
                // Sin versionCode fiable no hay condición de disparo posible:
                // purgar en cada arranque sería peor que no purgar.
                Log.w(TAG, "A4 rescate: no pude leer el versionCode; no purgo.");
                return;
            }

            SharedPreferences prefs =
                    getSharedPreferences(WebViewRescue.PREFS_NAME, MODE_PRIVATE);
            long ultima = prefs.getLong(
                    WebViewRescue.KEY_LAST_PURGED_VERSION_CODE, WebViewRescue.NUNCA_PURGADO);

            if (!WebViewRescue.shouldPurge(instalada, ultima)) {
                return;
            }

            File webViewDir = getDir("webview", MODE_PRIVATE);
            int borrados = WebViewRescue.purge(webViewDir);

            // La anotación se escribe SIEMPRE que se haya intentado, aunque no
            // hubiera nada que borrar: lo que marca es "esta versión ya pasó
            // por el rescate". Si se escribiera sólo al borrar algo, una
            // instalación limpia purgaría en cada arranque para siempre.
            prefs.edit()
                    .putLong(WebViewRescue.KEY_LAST_PURGED_VERSION_CODE, instalada)
                    .apply();

            Log.i(TAG, "A4 rescate: versionCode " + ultima + " -> " + instalada
                    + ", directorios purgados: " + borrados);
        } catch (Throwable t) {
            Log.e(TAG, "A4 rescate: fallo no fatal, el terminal arranca igual", t);
        }
    }

    /** versionCode del APK instalado, o {@link WebViewRescue#NUNCA_PURGADO}. */
    private long leerVersionCodeInstalada() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            // minSdk 28: getLongVersionCode() existe siempre, sin rama de
            // compatibilidad con el getter deprecado.
            return info.getLongVersionCode();
        } catch (PackageManager.NameNotFoundException e) {
            return WebViewRescue.NUNCA_PURGADO;
        }
    }

    /**
     * Modo inmersivo: el TPV es una app de caja a pantalla completa; las
     * barras de sistema reaparecen con un swipe desde el borde. Se aplica
     * en cada recuperación de foco porque Android las restaura al volver
     * de diálogos/teclado.
     */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (!hasFocus) {
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.systemBars());
                controller.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN);
        }
    }
}
