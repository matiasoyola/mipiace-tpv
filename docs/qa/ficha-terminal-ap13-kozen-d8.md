# Ficha del terminal · «AP13» = KOZEN D8 (para La Maestranza)

Sacada por adb el 06-10-2026, con el terminal recién salido de la caja.
Depuración inalámbrica en 192.168.5.136 (vinculado con el MacBook; `adb connect 192.168.5.136:5555`).

| Dato | Valor | Lectura |
|---|---|---|
| Fabricante / modelo | **KOZEN D8** (`ro.product.model=D8`) | Lo llamamos AP13, pero no es de la familia AP11/AP12 |
| Serie | AA55A232562600045 | |
| Android | **13** (API 33), build `D0861_kozenos_combo_V0.0.1_20250707` | Más nuevo que AP11 (11) y AP12 |
| Pantalla | 1920×1080 a densidad 213 → lienzo ≈ **1442×811** | La altura ya está en ~800. Densidad a decidir viendo la UI (240 daría 1280×720, que es bajo) |
| **WebView** | `com.android.webview` **101.0.4951.61** (AOSP) | ✅ ≥ 84: `gap` de flexbox funciona. **No se puede actualizar**: no hay Play Store |
| Chrome / Play Store | **No hay**. Único navegador: `com.android.browser` | La APK se instala por **adb** en el taller; `/apk` desde el navegador del sistema, sin probar |
| RAM / disco | 3,8 GB / 46 GB libres | Sobrado |
| **Impresora** | **Ninguna por USB** (USB en modo host, sin dispositivos). Hay puertos serie `/dev/ttyS0-3` y servicios propios `com.kozen.financial.service`, `com.kozen.terminalmanager.service` | ⚠️ Si la impresora va integrada, habla por serie o por el SDK de Kozen, **y nuestra APK sólo imprime ESC/POS por USB (A1)**. Riesgo de no-go para imprimir |
| MDM | `com.pos.mdmservice` preinstalado | A tener en cuenta con Device Owner (A5) |

## Lo que falta

- [x] Impresora: **se intentará usar la térmica que ya tiene el bar** (Matías, 06-10). Falta su modelo y cómo se conecta (USB o red).
- [x] APK de producción **1.21.0** instalada por adb el 06-10 (SHA-256 `b04bb4dc…dc31`, igual que el publicado en `/apk/latest.json`). Arranca, carga desde `https://mipiacetpv.com`, la pantalla de vinculación se ve bien a densidad 213 (`ap13-kozen-d8/01-arranque-1.21.0.png`). **Sin vincular**: se vincula a La Maestranza el día de la visita.
- [ ] Ticket de prueba desde la APK.
