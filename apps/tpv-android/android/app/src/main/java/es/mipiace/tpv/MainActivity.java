package es.mipiace.tpv;

import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;

import com.getcapacitor.BridgeActivity;

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

        registerPlugin(UsbPrinterPlugin.class);
        // A2-Android · Frente 1 · permiso nativo de cámara para el escáner.
        registerPlugin(CameraPermissionPlugin.class);
        super.onCreate(savedInstanceState);
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
