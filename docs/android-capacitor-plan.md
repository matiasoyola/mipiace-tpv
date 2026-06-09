# Plan técnico — App Android de mipiacetpv con Capacitor

> Objetivo: publicar `tpv-web` como app Android nativa en Play Store reutilizando el código React existente, resolviendo hardware de tienda (impresora, escáner, cajón) y offline.
> Dificultad estimada: **2-3 / 10**. Punto rojo único: WebUSB no funciona en el WebView de Android (ver Fase 3).

## Por qué es fácil en nuestro caso

`apps/tpv-web` ya tiene casi todo lo que Capacitor necesita:

- **React 19 + Vite 6 + Tailwind** → Capacitor envuelve un build estático de Vite sin tocar el código.
- **Ya es PWA** (`vite-plugin-pwa` + `workbox-window`) → el service worker y el cacheo offline ya existen; se reaprovechan.
- **Escaneo** con `@zxing/browser` (cámara) → funciona igual dentro del WebView.
- **Impresión** vía `escpos-builder` → la lógica de generar el buffer ESC/POS ya está; solo cambia el transporte.

Capacitor mete tu web en un WebView nativo y te da un puente JS↔nativo para lo que el navegador no puede hacer. No es un rewrite: es la misma app + plugins para hardware.

## Arquitectura

```
apps/tpv-web (React/Vite)  ──build──►  dist/
                                         │
                                         ▼
                              apps/tpv-android (Capacitor)
                                         │
                          ┌──────────────┼───────────────┐
                          ▼              ▼                ▼
                   Plugin Impresora  Plugin Cajón   Plugins core
                   (BT/USB/red)      (vía impresora) (Camera, etc.)
```

Nuevo paquete en el monorepo: `apps/tpv-android`. El frontend sigue siendo `tpv-web`; Android solo consume su `dist`.

## Fases

### Fase 0 — Scaffold (medio día)
- `pnpm add -D @capacitor/cli @capacitor/core` en `tpv-web` (o app dedicada).
- `npx cap init mipiacetpv es.mipiace.tpv --web-dir=dist`.
- `npx cap add android`.
- Build de Vite → `npx cap sync` → abrir en Android Studio → corre en emulador.
- **Hito:** el TPV se ve y navega dentro de la app Android.

### Fase 1 — Identidad de app + arranque (medio día)
- Icono, splash, nombre, `applicationId` definitivo.
- Forzar orientación (landscape para tablet de caja), ocultar barras, modo inmersivo.
- Pantalla de selección de tenant/login adaptada a táctil grande.
- **Hito:** app instalable que parece nativa, no una web.

### Fase 2 — Cámara / escáner (medio día)
- `@zxing/browser` ya usa `getUserMedia`; en Capacitor hay que pedir permiso de cámara nativo (`@capacitor/camera` o el plugin de permisos).
- Verificar rendimiento del escaneo en dispositivo real (no emulador).
- **Hito:** escaneo de código de barras de un producto desde la app.

### Fase 3 — Impresión (EL punto crítico, 2-4 días)
WebUSB **no** existe en el WebView de Android. Decisión de transporte:

| Transporte | Cobertura hardware | Esfuerzo |
|---|---|---|
| **Bluetooth** (recomendado) | Mayoría de impresoras de ticket modernas | Plugin BLE/SPP + envío del buffer ESC/POS |
| **Red / TCP 9100** | Impresoras Ethernet/WiFi (Epson, Star) | Socket TCP nativo, muy fiable |
| **USB nativo** | Impresoras solo-USB | Plugin USB Host de Android (más trabajo) |

- Reutilizar `escpos-builder` para generar el buffer; solo cambia cómo se envía.
- Plugin candidato: `@capacitor-community/bluetooth-le` o uno ESC/POS específico; evaluar uno y encapsular detrás de una interfaz `PrinterTransport` para no acoplar el TPV.
- **Hito:** ticket real impreso desde la app en una impresora de prueba.

### Fase 4 — Cajón portamonedas + periféricos (1 día)
- El cajón se abre con el comando ESC/POS de "kick drawer" a través de la impresora → casi gratis una vez funciona la Fase 3.
- Si hay datáfono, decidir si integración (Fase futura) o cobro manual.
- **Hito:** la venta abre el cajón al cobrar.

### Fase 5 — Offline robusto (1-2 días)
- Ya hay service worker; auditar que cubre el flujo de venta completo sin red.
- Cola de ventas pendientes de sincronizar con la API/Holded cuando vuelva la conexión (idempotencia ya la tenemos en el lado Holded).
- Probar: cortar red a media venta → terminar venta → imprimir → reconectar → sincroniza.
- **Hito:** una caja sin internet no se bloquea.

### Fase 6 — Publicación Play Store (1 día de trabajo + espera de revisión)
- Cuenta Google Play Developer (25 USD único).
- Generar `.aab` firmado, ficha, capturas, política de privacidad.
- Canal interno/cerrado primero (Thalía y pilotos) antes de producción.
- **Hito:** APK/AAB instalable por los pilotos.

## Estimación total
**~8-12 días de trabajo efectivo** para v1 sólida, con la Fase 3 (impresión) como mayor incógnita. Si los pilotos usan impresora Bluetooth o de red, baja a la parte buena del rango.

## Riesgos y mitigaciones
- **Impresión** → es el 70% del riesgo. Mitigar eligiendo 1 modelo de impresora "oficial" para pilotos y construir el `PrinterTransport` abstracto.
- **Fragmentación Android** → fijar versión mínima razonable (Android 9+) y probar en el hardware real de los pilotos, no solo emulador.
- **Mantener un solo código** → el frontend sigue siendo `tpv-web`; Android no debe forkear UI. Diferencias por capa de plataforma, no por copia.

## Lo que NO añade complejidad
- La capa fiscal vive en Holded, no en el cliente → la app no implementa nada fiscal.
- El backend (`api`) no cambia: la app consume los mismos endpoints que la web.
