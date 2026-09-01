# Pruebas físicas AP11-1006 · ronda 2 · 2026-09-01

Terminal Smart-tpv **AP11-1006** (Android 11, 1920×1200, densidad 240 → viewport 1280×800),
sobre la **APK Capacitor** `es.mipiace.tpv` compilada desde `master` (front de v1.12, el mismo
que producción `c7c67eb`). Tenant **Cafetería Sirope**, cajero `mipiacetpv-test-2e5c19f9`.
Capturas: `docs/qa/2026-09-01-ap11-ronda2/` (50 ficheros).

Ronda 1: `docs/qa/2026-08-27-pruebas-fisicas-ap11.md`.

---

## Veredicto

**Los cuatro criterios de comportamiento de v1.12 pasan en el hierro.** El ciclo de caja completo
se ejecutó de punta a punta sin un solo error de consola.

Pero la ronda destapó **tres fallos que no estaban en ningún inventario**, dos de ellos
bloqueantes para la vía APK y uno que toca la ruta del dinero.

---

## Bloqueantes encontrados (no conocidos antes de hoy)

### B1 · La APK no podía hablar con la API — `VITE_API_URL` no se inyecta

`apps/tpv-web/src/api.ts` resuelve `BASE_URL = import.meta.env.VITE_API_URL ?? "/api"`.
`infra/Dockerfile` la inyecta para la web; **el `build:web` de `tpv-android` no**. En la APK el
fallback `/api` lo sirve el propio servidor de Capacitor, que **devuelve `index.html` con 200 a
todo**.

Cadena de síntomas observada:

- `TypeError: Cannot read properties of undefined (reading 'name')` + `[error-boundary]` en logcat.
- `localStorage['mipiacetpv-device-me']` conteniendo **el HTML de index.html**. Es una cadena JSON
  válida, así que `JSON.parse` devuelve un *string* y `state.data.register` queda `undefined`.
- El código de emparejamiento **no se consumía** y no aparecía dispositivo nuevo en el admin.

Arreglo: exportar `VITE_API_URL=https://api.mipiacetpv.com` en el build.
**Pendiente de raíz**: fijarlo en `apps/tpv-android/package.json` para que no dependa de la memoria
de quien compile.

### B2 · CORS rechazaba el origen de la APK

`apps/api/src/server.ts:119` usa lista blanca por coincidencia exacta contra `CORS_ORIGINS`. El
origen por defecto de Capacitor en Android es `https://localhost`, que no está en la lista:

```
Access to fetch at 'https://api.mipiacetpv.com/devices/pair' from origin 'https://localhost'
has been blocked by CORS policy
```

**Arreglo elegido**: `server.hostname: "mipiacetpv.com"` en `capacitor.config.ts`. El WebView sirve
el bundle local bajo el origen de producción y CORS pasa **sin tocar el servidor**. Descartado meter
`https://localhost` en `CORS_ORIGINS` del VPS, que abriría la API a cualquier página servida en
`https://localhost` en la máquina de un tercero.

Verificado: con los dos arreglos, la vinculación entra a la primera.

### B3 · El teclado propio queda inerte en los campos pre-rellenos

**El fallo más importante de la ronda, y está en la ruta del dinero.**

`applyKey` es correcto: si el valor ya tiene `maxDecimals` decimales, no hay hueco y devuelve el
valor intacto (`if (room <= 0) return v`). El problema es la costura: **varios campos llegan
pre-rellenos con dos decimales**, así que el pad no puede escribir nada.

| Campo | Llega con | Pad |
|---|---|---|
| Efectivo en cobro mixto | vacío | **escribe bien** |
| Fondo de caja (abrir turno) | `0,00` | **inerte** |
| Resto en cobro mixto (Tarjeta) | `3,00` | **inerte** |
| Denominaciones del arqueo | placeholder `0` | **escribe bien** |

Para el cajero el teclado *parece roto*: toca el campo, pulsa números y no pasa nada. Sólo revive
pulsando `C` primero, y eso no lo adivina nadie.

Agravante: en cobro mixto el texto de ayuda dice literalmente **"Resto de la cuenta · escribe
encima si no cuadra"** — invita justo a lo que no se puede hacer.

Reproducción: campo con `50,00` → pulsar `3` → sigue `50,00`. Pulsar `C` → pulsar `5` → escribe `5`.

Comprobado que **no** es artefacto de los toques sintéticos de adb: los chips de importe rápido
(50/100/150/200 €) sí actualizan el campo con el mismo tipo de toque.

---

## Criterios de v1.12

| # | Criterio | Resultado |
|---|---|---|
| 1 | Sin teclado de Android en cobro ni arqueo | **PASA** — `mInputShown=false` verificado por `dumpsys input_method` en abrir turno, cobro, cobro mixto y arqueo. Sale el `CashPad` en los cuatro. |
| 2 | Controles diarios ≥ 48 px | **PASA con una desviación** — ver abajo |
| 4 | El Atrás no saca de la aplicación | **PASA** — 4 pulsaciones seguidas sin salir; el `ActivityRecord` conserva el mismo id, la actividad ni se destruye ni se recrea |
| 5 | Sin soporte de `gap` sale la pantalla de bloqueo | **NO PROBADO** — ya no hay Chrome 81 en el terminal (ver "Entorno") |

### Criterio 2 · medidas reales (1 px CSS = 1,5 físicos)

| Control | Medido | Veredicto |
|---|---|---|
| Teclas del `CashPad` | 95 × 56 px | ≥ 48 ✓ |
| Casillas del código de vinculación | 55 × 64 px | ≥ 48 ✓ |
| CTA "Vincular dispositivo" | 367 × 56 px | ≥ 48 ✓, pero **el sistema visual manda 64-72 px para CTA primaria** |

Desviación anotada: no es un fallo de accesibilidad, es incoherencia con el propio estándar. O se
cumple o se cambia el estándar.

---

## Lo que también se validó

- **`goToMap()` unificado**: abrir mesa vacía → Atrás de Android → vuelve al mapa **y suelta la
  mesa** (`0 abiertas · 23 libres`, sin DRAFT huérfano). Es el addendum `96d29e2` funcionando.
- **`ConfirmSheet`**: "Cancelar" en una mesa con líneas saca una hoja propia ("Vaciar mesa", con la
  consecuencia explicada y botones Volver / Vaciar mesa). **Cero `window.confirm` nativo.**
- **Cobro mixto tecleando importes**: Efectivo 2 € + Tarjeta 3,00 € = 5,00 € · cuadra. Cobrado, y
  vuelta al mapa con la mesa liberada. Era el camino que en la ronda 1 se quedaba en "Falta 1,00 €".
- **Arqueo por denominaciones**: el cierre **NO se dispara solo** mientras se teclea — el fallo más
  grave de la ronda 1 está cerrado. Se ven 6-7 denominaciones por pantalla con scroll interno
  (ronda 1: 3 de 15) y "Total contado" fijo al pie, actualizándose en vivo.
- **Ciclo de caja completo**: fondo 50 € → venta 5,00 € mixta → esperado 52,00 € → contado 52,00 €
  → **turno cerrado con descuadre +0,00 €**. Aritmética correcta en cada paso.
- **IVA mixto**: 3,50 € al 21 % + 1,50 € al 10 % → subtotal 4,26 + IVA 0,74 = 5,00 €. Al céntimo.
- **Modo inmersivo**: sin barra de estado ni de navegación; 1280×800 limpios. Los ~250 px que se
  comía el cromo de Chrome desaparecen.
- **Icono**: el adaptativo corregido (commit `11f26af`) se ve completo en el splash del terminal.
- **`gap`**: la cabecera "Sala · 0 abiertas · 23 libres · 0,00 € en sala" se pinta con sus espacios.
  En Chrome 81 salía pegada.

---

## Hallazgos menores

1. **`PairScreen` no usa `CashPad`.** Al tocar la casilla del código sale el teclado del sistema, que
   arranca en y≈612 de 1200 (**49 % de la pantalla**) y **tapa entero** el botón "Vincular
   dispositivo" (y 688-771). v1.12 convirtió cobro y arqueo y dejó fuera la pantalla de
   emparejamiento — que es la primera que ve todo terminal nuevo.
2. **El Atrás no cierra el diálogo de cierre de día.** Esa capa no está en la pila del `useBackGuard`;
   hay que salir por "Cancelar".
3. **"Volver a selección de cajero" vive justo debajo de la CTA primaria** en abrir turno, y el bloque
   entero se desplaza ~110 px al cerrar el `CashPad`. Pisotón fácil para alguien con prisa.
4. **La APK no hereda el emparejamiento del navegador** (almacenamiento propio). Un terminal que ya
   funcionaba por web hay que volver a vincularlo al instalar la APK.
5. El error boundary dice *"La venta en curso no se pierde: el carrito se restaura"* incluso en la
   pantalla de vinculación, donde no hay ni venta ni carrito.

---

## Entorno · lo que cambió respecto a la ronda 1

- **Chrome se autoactualizó del 81 al 151** el 31-08 a las 11:15. El terminal tiene Play Store y GMS.
  Con Chrome moderno el problema de `gap` **se cura solo**. No elimina la APK como vía —un terminal
  recién sacado de la caja o sin Play sigue en 81— pero la degrada de única vía a vía fiable.
  Para probar el criterio 5 hay que revertir con `pm uninstall-system-updates com.android.chrome`.
- **El "Modo de depuración de red" no sobrevive al reinicio** y el interruptor puede verse activado
  con `adbd` caído. Comprobar el puerto, no el interruptor.
- **El terminal se cae de la LAN cuando está ocioso** (deja de responder hasta a ping) y vuelve al
  tocarlo. `svc power stayon true` no lo evita. En un bar, con el TPV en offline, esto hay que
  entenderlo antes de entregar terminales.
- **macOS bloquea la red local al proceso que lanza adb desde el MCP**: `No route to host` en toda la
  LAN aunque el ping pase. Hay que arrancar el servidor de adb desde Terminal.app.

---

## Pendiente

- Criterio 5 (pantalla de bloqueo por `gap`) revirtiendo Chrome al 81.
- Convertir `PairScreen` a `CashPad`.
- Arreglar B3 (campos pre-rellenos) — decidir si el campo llega vacío o si el pad reemplaza el valor
  al primer dígito tras recibir foco.
- Fijar `VITE_API_URL` en el `build:web` de `tpv-android`.
- Commitear `capacitor.config.ts` (el `hostname`), que sigue sin commitear.
