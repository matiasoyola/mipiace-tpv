package es.mipiace.tpv;

/**
 * hierro-sirope (B) · LA DECISIÓN DE «ESTO NO VA A PINTAR».
 *
 * <h3>Qué pasó el 18-10</h3>
 *
 * {@code am force-stop es.mipiace.tpv} y volver a abrir deja el D8 en
 * BLANCO indefinidamente (capturas 51 y 52). En logcat:
 *
 * <pre>
 * ActivityManager: Unable to launch app es.mipiace.tpv/10110 for service
 *   Intent { cmp=es.mipiace.tpv/org.chromium.content.app.SandboxedProcessService0:0 }:
 *   process is bad
 * </pre>
 *
 * El renderer del WebView nunca arranca, así que **no corre ni una línea de
 * JavaScript**: el vigilante de arranque de `auditoria-sirope`
 * ({@code apps/tpv-web/src/lib/vigilante-arranque.ts}) no puede actuar, por
 * la misma razón por la que el rescate de A4 tuvo que ser nativo. Sólo lo
 * saca un reinicio del aparato. Mismo síntoma en el N1 desde la segunda
 * apertura.
 *
 * <h3>Por qué el proceso es «bad» (la causa, y hasta dónde llega)</h3>
 *
 * El renderer del WebView corre en un <b>proceso aislado</b>. Los servicios
 * {@code SandboxedProcessServiceN} los declara el paquete del WebView con
 * {@code android:externalService="true"} y el embebedor los enlaza con
 * {@code BIND_EXTERNAL_SERVICE}: por eso el proceso aislado cuelga de NUESTRO
 * uid (10110) y por eso el mensaje nombra a {@code es.mipiace.tpv}.
 *
 * El texto «process is bad» no significa que nuestro proceso esté corrupto.
 * Lo escribe {@code ActiveServices.bringUpServiceLocked} de AOSP cuando
 * {@code startProcessLocked} devuelve {@code null} — <b>cualquier</b> motivo
 * por el que AMS no haya podido crear el proceso del servicio se reporta con
 * esa misma frase. Para un proceso aislado el camino que devuelve
 * {@code null} es {@code ProcessList.newProcessRecordLocked}: o no queda
 * rango de uid aislado que asignar, o {@code allocateIsolatedUidLocked}
 * devuelve −1 porque están todos en uso. Esos rangos viven en memoria de
 * AMS, y por eso lo único que lo arregla es reiniciar el aparato.
 *
 * Qué los deja ocupados: el {@code force-stop} mata nuestro proceso y AMS
 * empieza a desmontar su renderer; la apertura siguiente pide enlazar el
 * servicio antes de que ese desmontaje termine, y la petición se queda
 * colgada con {@code app=null}. Está reportado con el mismo logcat por
 * terceros (freekiosk #280, donde el disparador era una app que se relanzaba
 * matándose a sí misma) y el arreglo que les funcionó fue <b>esperar</b>
 * antes de volver a arrancar.
 *
 * Que el AP11 no lo sufra encaja: lleva WebView 155 de Google sobre Android
 * 11; el D8 lleva el WebView 101 de AOSP, de 2022, que no se actualiza.
 *
 * <h3>Lo que hace esta clase</h3>
 *
 * Nada de Android: es la máquina de estados, para poder probarla en la JVM
 * sin emulador (mismo criterio que {@link WebViewRescue} y
 * {@link OrientacionPorTamano}). Dice sólo QUÉ hacer:
 *
 * <ol>
 *   <li>se arma al crear la actividad;
 *   <li>{@link #pintado()} la desarma — la página cargó, el renderer vive;
 *   <li>si salta el plazo o muere el renderer, decide: la PRIMERA vez
 *       {@link Decision#RECREAR} (un intento de recuperación), la segunda
 *       {@link Decision#RENDIRSE} (pantalla nativa con qué hacer).
 * </ol>
 *
 * Un solo intento de recuperación, y es deliberado: si el rango de uids
 * aislados está agotado, recrear en bucle deja la caja parpadeando para
 * siempre y esconde el mensaje que dice cómo salir. Mejor una pantalla fea
 * que diga la verdad.
 */
public final class VigilanteNativo {

    /** Qué hacer cuando el WebView no ha pintado. */
    public enum Decision {
        /** Todavía no toca: ya pintó, o ya nos rendimos y no hay más que hacer. */
        NADA,
        /** Un intento: tirar el WebView y recrear la actividad. */
        RECREAR,
        /** Pantalla nativa: «reinicia el terminal». */
        RENDIRSE
    }

    /**
     * Cuánto se espera a que el WebView pinte en el PRIMER arranque.
     *
     * <p>12 s. El arranque medido del D8 con la caché fría —el caso del
     * rescate de A4, que acaba de borrarla— se va a 6-7 s, y un terminal
     * cansado puede pasar de 8. Equivocarse por abajo es enseñar «reinicia el
     * terminal» a una caja que iba a abrir sola, que es peor que el fallo:
     * el cajero reinicia y pierde otro minuto. Por arriba se pagan unos
     * segundos de pantalla blanca que hoy son infinitos.
     */
    public static final long ESPERA_MS = 12_000L;

    /**
     * Y tras el intento de recuperación, 10 s.
     *
     * <p>Menos, porque ya no hay caché fría que justifique la espera larga:
     * el WebView se está creando por segunda vez en el mismo arranque.
     */
    public static final long ESPERA_TRAS_RESCATE_MS = 10_000L;

    private boolean pintado;
    private boolean rescatado;
    private boolean rendido;

    public VigilanteNativo() {
        this(false);
    }

    /**
     * @param rescateGastado el intento de recuperación ya se usó en ESTE
     *     proceso. Hace falta porque recuperarse es {@code recreate()}, que
     *     construye una actividad nueva: un vigilante que naciera siempre
     *     con el intento disponible recrearía para siempre y la caja se
     *     quedaría parpadeando en vez de decir cómo salir.
     */
    public VigilanteNativo(boolean rescateGastado) {
        this.rescatado = rescateGastado;
    }

    /** ¿Se ha gastado ya el intento de recuperación? */
    public boolean rescateGastado() {
        return rescatado;
    }

    /** ¿Cuánto hay que esperar en este intento? */
    public long esperaMs() {
        return rescatado ? ESPERA_TRAS_RESCATE_MS : ESPERA_MS;
    }

    /** La página cargó. A partir de aquí el vigilante no hace nada más. */
    public void pintado() {
        pintado = true;
    }

    public boolean haPintado() {
        return pintado;
    }

    public boolean seHaRendido() {
        return rendido;
    }

    /**
     * Saltó el plazo sin pintar, o murió el renderer.
     *
     * <p>Idempotente a propósito: el plazo y {@code onRenderProcessGone}
     * pueden llegar los dos, y en cualquier orden. Lo que no puede pasar es
     * que dos avisos del mismo fallo gasten los dos intentos.
     */
    public Decision noPinta() {
        if (pintado || rendido) {
            return Decision.NADA;
        }
        if (!rescatado) {
            rescatado = true;
            return Decision.RECREAR;
        }
        rendido = true;
        return Decision.RENDIRSE;
    }

    /**
     * El texto de la pantalla nativa. Vive aquí —y no en el XML— porque es
     * parte de la decisión y se prueba con ella.
     *
     * <p>Dice qué pasa y qué hacer, en ese orden, sin una palabra técnica: lo
     * lee alguien que está detrás de una barra con gente delante.
     */
    public static final String TITULO_RENDICION = "El TPV no puede abrir";

    public static final String CUERPO_RENDICION =
            "La pantalla del terminal se ha quedado en blanco y no es culpa de la "
                    + "conexión: tus ventas y tu caja están a salvo.\n\n"
                    + "Reinicia el terminal:\n"
                    + "mantén pulsado el botón de encendido → Reiniciar.\n\n"
                    + "Cuando vuelva a encenderse, abre el TPV como siempre.";

    /** El botón. Un intento más antes de obligar a nadie a reiniciar. */
    public static final String BOTON_RENDICION = "Volver a intentarlo";
}
