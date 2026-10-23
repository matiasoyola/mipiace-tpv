# Bloque `hierro-sirope` · lo que la pasada de la 1.27.0 encontró en el hierro

Proyecto: mipiacetpv (`~/Developer/Claude/Projects/mipiacetpv`). Rama `hierro-sirope` desde `origin/master`.

## De dónde viene

El 18-10 por la noche se probó la APK 1.27.0 (bloque `auditoria-sirope`, PR #33) con la cuenta real de Cafetería Sirope **en ensayo**: D8 como caja (Sirope · Caja 2) y AP11-1006 como KDS «Cocina · Barra». Casi todo lo del bloque anterior funciona (cambio a devolver, Enviar en venta rápida, «Mostrador nº N», reparto por sección, Por recoger, devolución en ensayo, motivo de vaciado, cuadrar caja). Pero salieron dos rojos y varios amarillos.

**Lee primero** `docs/qa/2026-10-18-sirope-hierro/README.md` y mira las capturas que cita (numeradas `01`–`52` en esa carpeta). Son la especificación. Y `docs/blocks/auditoria-sirope-done.md` para saber qué decidió el bloque anterior.

Principio de producto que manda en todo lo de UI: la pantalla de venta la usa un camarero a toda velocidad y bajo estrés. Nada se mueve bajo el dedo, nada importante en gris pálido, nada que haya que leer dos veces.

---

## A · 🔴 Comandas huérfanas (lo más importante del bloque)

### Qué pasa (reproducido, capturas 37–41)
1. M5 con un café enviado a BARRA, **sin** marcar Lista.
2. «Vaciar mesa» → motivo Invitación. La mesa queda libre. La tarjeta sigue en el AP11 (correcto: «un plato en la plancha sigue en la plancha», decisión del bloque anterior, se mantiene).
3. Cocina pulsa «Lista» → la tarjeta pasa a «Listas» y **ahí se queda para siempre**: M5 sale con la etiqueta LISTO en el mapa estando libre, y la banda «M5 · listo para servir» se queda en todos los TPV encima de cualquier venta. Nadie la puede servir: su ticket ya no existe.

Es exactamente el estado de la T6 (9 horas «esperando» en el AP11 el 18-10) y de M1.

### Causa
`servirComandasListas` (`apps/api/src/kitchen/servir.ts`), llamada al cobrar (`tickets/routes.ts`) y al vaciar (`tables/void-draft.ts`), sólo sirve lo que **ya** tiene `readyAt`. Bien. Pero `readyAt` se pone después en dos sitios —`kitchen/routes.ts` (~525, el toque online del KDS) y `kitchen/lan.ts` (~308, la marca que llega por LAN/offline)— y ninguno mira si el ticket sigue vivo.

### La regla
**Una comanda cuyo ticket ya no está vivo (no es DRAFT) se sirve sola en el momento en que se marca Lista**, en la misma transacción que pone `readyAt`, con `servedByUserId = null`, y se emite `kitchen.order_served` igual que el toque del camarero. Así cocina ve que la ha terminado (sale de la columna de pendientes), y desaparece a la vez de «Listas», del mapa y de las bandas.

- Los dos caminos (`routes.ts` y `lan.ts`) pasan por **una sola función** — no dupliques la regla.
- Respeta el CHECK `kitchen_orders_cronologia` (`served_at >= ready_at`): usa el mismo instante.
- El «deshacer Lista» (~347–369 de `routes.ts`) no debe resucitar una comanda de ticket muerto como pendiente-de-servir; mira qué hace hoy y decide lo coherente (lo que sea bueno para el producto, decídelo y apúntalo en el `-done`).

### Y las que ya existen
- El **corte de día** (`shift/day-cut-run.ts` o donde viva el barrido de las 05:00) sirve también las comandas de tickets muertos, estén listas o no (las no listas: `readyAt = servedAt = ahora`), para que nunca sobreviva una huérfana al día siguiente.
- **Limpieza única** de las que hay hoy en producción: un script idempotente en `apps/api/scripts/` que liste (modo `--dry-run` por defecto) y, con `--apply`, sirva las comandas sin servir cuyo ticket no es DRAFT. Con resumen por tenant. **No se ejecuta en el bloque**: lo corre Matías/Claude contra producción después del despliegue.

---

## B · 🔴 La app se queda en blanco tras reiniciarla

### Qué pasa (capturas 51–52)
`am force-stop es.mipiace.tpv` y volver a abrir → pantalla blanca indefinida. logcat:

```
ActivityManager: Unable to launch app es.mipiace.tpv/10110 for service Intent { cmp=es.mipiace.tpv/org.chromium.content.app.SandboxedProcessService0:0 }: process is bad
```

WebView del sistema del D8: `com.android.webview 101.0.4951.61`. Mismo síntoma en el N1 (`claude/n1-vertical-cierre-2026-10-18.md`: «process is bad» desde la 2.ª apertura tras reiniciar). Sólo lo saca un reinicio del aparato. El vigilante de arranque del bloque anterior (`apps/tpv-web/src/lib/vigilante-arranque.ts`) no puede actuar: es JavaScript y el renderer nunca arranca.

### Lo que se pide
1. **Investiga la causa** antes de tocar nada: por qué Android marca «bad» el proceso aislado del renderer de *nuestro* uid tras un force-stop (crash del renderer en el arranque anterior, el sandbox aislado, `android:process`, multiproceso del WebView…). Lee lo que haga falta de AOSP/Chromium. Escribe en el `-done` qué es, con la evidencia.
2. **Defensa nativa** en `apps/tpv-android/android/app/src/main/java/es/mipiace/tpv/MainActivity.java`, independiente de la causa: si el WebView no pinta en N segundos o el renderer muere (`WebViewClient.onRenderProcessGone`, un temporizador nativo que el JS desarma al montar, lo que encuentres que funcione en WebView 101), la app no se queda en blanco: muestra una pantalla **nativa** que diga qué pasa y qué hacer («Reinicia el terminal: mantén pulsado el botón de encendido → Reiniciar») y, si hay forma segura de recuperarse sin reiniciar (recrear el WebView, relanzar la actividad), la intenta **una vez** antes de mostrarla.
3. Si la causa tiene arreglo de raíz razonable en la APK, arréglala también.

No se puede probar en el banco: dilo en el `-done` y deja escrito el procedimiento exacto para la pasada en el hierro (force-stop + abrir, 3 veces seguidas, en D8 y N1).

---

## C · 🟡 Las mesas vaciadas sólo están en el PDF del Z

`contarMesasVaciadas` (`apps/api/src/shift/mesas-vaciadas.ts`) va a `generateZReportPdf`, pero ni «Cerrar el día» ni «Turno cerrado» (pantallas del TPV, `CloseShiftModal.tsx` y compañía) lo enseñan. Quien cierra no ve que se tiraron 1,50 € de M5 (capturas 43, 44, 50).

→ Va en el resumen de pantalla, en el mismo golpe de vista que «2 tickets · 1 devolución» (p. ej. «· 1 mesa vaciada (1,50 €)»), y desglosado por motivo en «Ver detalle», con los mismos números que el PDF (una sola fuente). Si es 0, no sale.

## D · 🟡 Avisos de «listo»: duplicados, sin sección, y se comen el ticket

Captura 25: M3 con cocina y barra → dos bandas «M3 · listo para servir» idénticas. En «Listas» del AP11 (captura 24), dos «M3». Y las bandas se apilan encima del ticket: con tres, la segunda línea queda tapada por «Urgente».

- Una banda por **mesa/mostrador**, que diga qué está listo: «M3 · cocina y barra listas», «M3 · barra lista (cocina en marcha)». «Servido» sirve lo listo de esa mesa.
- En el AP11, la tarjeta de «Listas» lleva la sección si la pantalla muestra más de una.
- Las bandas no empujan el ticket sin límite: a partir de 2, se agrupan («3 listas · ver») o hacen scroll propio. El ticket y sus botones siempre visibles a 1442×811 CSS (D8).

## E · 🟡 «Mostrador nº 1» no cabe en el KDS

Captura 11: cabecera partida a mitad de palabra («Mostra / dor nº 1»). Captura 12c: en la columna «Listas», «Mostrado» cortado.
→ Nunca partir palabras. Etiqueta corta en el KDS si hace falta («Mostr. 1» o «M·1» — decide tú, que se lea a 2 m). Medido en el AP11 (1920×1200 físico, **densidad 240 → 1280×800 CSS**) y en la tarjeta estrecha de «Listas».

## F · 🟡 Cuadrar caja cambia de tamaño con el teclado

Capturas 45–47: al tocar un casillero el modal se ensancha (aparece el teclado propio a la derecha); al pulsar «Listo» se estrecha. Los casilleros se mueven bajo el dedo: tocar el siguiente sin mirar cae en otro sitio.
→ El modal tiene el mismo tamaño y posición con y sin teclado (reserva el hueco, o el teclado siempre visible). «Listo» pasa al siguiente casillero en vez de cerrar.

## G · 🟡 Numeración de tickets por caja sin distinguir

Captura 30: la Caja 2 empieza en #000001 y la Caja 1 va por #000028, en la misma lista. Con dos cajas habrá dos #000001.
→ No toques la numeración (puede tener implicaciones fiscales; la serie es por caja a propósito). Sólo que la lista, el detalle, la búsqueda y el ticket impreso los distingan cuando la tienda tiene más de una caja: prefijo o chip con la caja (p. ej. «C2·000001»). La búsqueda por «000001» debe devolver los dos.

## H · ⚪ Detalles

1. Gris casi invisible: precios de línea en el detalle de ticket (captura 31) y la cantidad del casillero en la devolución (32). Contraste AA mínimo.
2. El chip «×1» tapa el nombre del producto (09, 21: «Tostada York y», «Café Americano»). Que no pise el texto.
3. La línea del ticket sigue diciendo «EN COCINA» cuando ya está lista (13b) → «LISTO» (o el estado real por sección).
4. 15–30 s entre «Lista» en el AP11 y la banda en el TPV, y lo mismo para quitar el LISTO del mapa tras cobrar (13→13b, 27→29). Mira por qué no llega por evento (¿sólo sondeo?, ¿el D8 no está suscrito al bus de la tienda?). Si es barato que llegue en < 3 s, hazlo; si no, explica en el `-done` por qué.

---

## Fuera del bloque
- La impresora, la zona horaria de la tienda, el mapa a 360 px (`n1-hosteleria`).
- Cambiar la numeración fiscal.
- Ejecutar la limpieza de A contra producción.

## Verificación

- **Bancos** para toda la lógica: la regla de A en los dos caminos (online y LAN), el corte de día, el script en `--dry-run`/`--apply`, la agrupación de bandas de D, el recuento de C (pantalla = PDF), la etiqueta de G.
- **Medida en navegador** para lo visual (D, E, F, H1–H2) a **1442×811** (D8) y **1280×800** (AP11), con una tienda sembrada como Sirope: 23 mesas, familias reales, dos cajas, cocina con COCINA y BARRA.

### Sabotajes

Cada fila: rompes el código, ves el rojo, copias el mensaje real al `-done`, restauras.

| Sabotaje | Debe caer |
|---|---|
| La regla de A sólo en `routes.ts`, no en `lan.ts` | el banco del camino LAN |
| Servir al marcar Lista aunque el ticket siga DRAFT | el banco «mesa viva: Lista no sirve» |
| `servedAt` un ms antes que `readyAt` | el CHECK de cronología |
| El corte de día deja las no listas | el banco del barrido |
| El script escribe sin `--apply` | el banco del dry-run |
| El resumen de cierre cuenta las vaciadas distinto que el PDF | el banco de una sola fuente |
| Dos secciones listas → dos bandas | el banco de agrupación |
| El modal de cuadrar cambia de ancho al abrir el teclado | la medida (navegador) |
| «Mostrador nº 1» con `break-all` | la medida (navegador) |

### APK

Versión **1.28.0** (versionCode 12800) con `apps/tpv-android/scripts/build-release-apk.sh 1.28.0`. **No** se publica en `/apk`. Si en el worktree falta `apps/tpv-android/android/keystore.properties`, enlázalo al del repo principal (está en `.gitignore`; no lo leas ni lo imprimas).

## Cierre

- `docs/blocks/hierro-sirope-done.md`: qué se hizo por apartado, las decisiones que tomaste sin preguntar, la causa de B con su evidencia, la tabla de sabotajes con los mensajes reales, la tabla de medidas y el procedimiento de la pasada en el hierro.
- Suite verde y `tsc -b` limpio.
- Commits pequeños por apartado. **No hagas push ni abras PR**: eso lo hace Matías.
