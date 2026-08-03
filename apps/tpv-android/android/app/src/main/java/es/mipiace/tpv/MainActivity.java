package es.mipiace.tpv;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * A1-Android · Frente 2 · registra el plugin USB Host de impresión
     * ANTES de super.onCreate (así el bridge lo conoce al cargar el
     * WebView). Es un plugin local del proyecto, no un paquete npm.
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UsbPrinterPlugin.class);
        // A2-Android · Frente 1 · permiso nativo de cámara para el escáner.
        registerPlugin(CameraPermissionPlugin.class);
        super.onCreate(savedInstanceState);
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
