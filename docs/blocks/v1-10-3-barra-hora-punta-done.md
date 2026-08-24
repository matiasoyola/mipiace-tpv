# Bloque v1.10.3 · La barra en hora punta — DONE

**Rama:** `v1-10-3-barra-hora-punta` (worktree `../mipiacetpv-v1-10-3-barra`)
**Origen:** `docs/qa/2026-08-20-simulacion-hora-punta-sirope.md` — recorrido completo del flujo de bar sobre producción, ventana 1280×800, cajero real, catálogo real. El motor de sala aguantó todo (tres mesas a la vez, mover, agrupar, cobrar el grupo, arqueo al céntimo). Falló lo que sólo aparece con prisa y con los dedos.
**Estado:** cerrado. `pnpm vitest run` (workspace) verde — **1151 passing + 3 skipped**, antes 1124. `tsc -b` limpio. `vite build` de `tpv-web` OK. Sin push, sin merge, sin deploy.

---

## Resumen de números

- **Tests:** +27 en 4 ficheros nuevos — `checkout-mixed-payment.test.tsx` (8), `cart-line-undo-remove.test.tsx` (4), `money-format.test.ts` (10), `elapsed-human-units.test.ts` (5).
- **Ficheros nuevos de producción:** `apps/tpv-web/src/lib/money.ts`.
- **Migración:** ninguna. **Endpoints nuevos:** ninguno. **Camino de cobro a Holded (ADR-010):** intacto.
- **v1.10.2 respetado:** el diff de `SalePage.tsx` no toca ni una línea de `sendToKitchen`, `KitchenErrorBanner` ni `escposPrint`. `escposPrint.ts` no se ha tocado.

---

## 1 · El cobro mixto no se podía completar (BLOQUEANTE)

### La causa

No era aritmética. `paymentsSum` sumaba bien; lo que no llegaba a existir era **la segunda fila de pago**.

El reparto vivía en `MixedSplitStep`, un mini-step montado al final del `<main>` scrollable del modal. El pie del modal era `flex-shrink-0` y medía ~360 px (filas de pago + atajos de efectivo + importe exacto + tabs de método + total + Cobrar). Con la ventana del AP12 el modal se queda en `90vh` = 720 px, la cabecera se lleva ~130 y al body le tocaban ~230: el mini-step caía por debajo del recorte y el `overflow-hidden` del contenedor lo borraba de la pantalla.

El cajero, entonces, hacía lo único que veía: teclear 10 en la fila de efectivo del pie. Una sola fila, 10 de 14 → **"Falta 4,00 €"** y Cobrar en gris, para siempre. Nunca pulsaba un "Aplicar mixto" que no estaba en pantalla.

### El arreglo

**El cobro sube al principio del body y el pie adelgaza.** Nuevo orden del modal:

| Zona | Antes | Ahora |
|---|---|---|
| Cabecera (fija) | Volver · título · nº líneas · subtotal/IVA | igual, el contador suelto se muda al encabezado de Artículos |
| Body (scroll) | Artículos → notas → **mixto oculto** → opciones | **Cobro** (métodos, filas, atajos, estado del reparto) → Artículos → notas → opciones |
| Pie (fijo) | filas + atajos + exacto + métodos + total + Cobrar (~360 px) | Falta/Cambio + TOTAL + Cobrar (+ Fiado) (~140 px) |

Lo que no puede quedar fuera de pantalla es lo que ahora vive en el pie: el dinero y el botón. Todo lo demás scrollea de verdad, porque el body ha recuperado su altura.

**`MixedSplitStep` desaparece.** "Mixto" ya no abre un paso intermedio: **añade la segunda fila ahí mismo**, con su propio selector de método. Tres taps para el caso de barra:

1. **Mixto** → dos filas: Efectivo (vacía) y Tarjeta con el total.
2. Teclear `10` en efectivo → **Tarjeta pasa a 4,00 € sola**.
3. **Cobrar**.

El reparto automático tiene una regla única y explicable: **la última fila lleva el resto mientras el cajero no escriba en ella**. En cuanto escribe, queda fijada (`lastRowPinned`) y no se vuelve a tocar — 6 + 8 se respeta tal cual. La fila autocompletada lo dice en voz alta: *"Resto de la cuenta · escribe encima si no cuadra"*. Un importe que se mueve solo y sin explicación asusta más de lo que ayuda.

**Una sola frase de verdad sobre el reparto.** Antes cada fila CASH pintaba su propio "Falta X" calculado contra las demás, así que en mixto una fila podía decir "Falta 4,00 €" mientras la cuenta cuadraba. Ahora hay una línea, bajo las filas, que dice lo mismo que decide el botón:

- `Falta 4,00 €` (coral) — y **el pie repite el "Falta"**, porque en 320×568 esa línea queda por encima del pliegue y "Cobrar en gris sin decir por qué" es exactamente el pecado que este bloque vino a arreglar.
- `14,00 € · cuadra` (verde) con el reparto nombrado: *"Efectivo + Tarjeta"*.
- `15,00 € · sobran 1,00 €` cuando hay exceso sin efectivo.

**Fuera la papelera por fila.** En 320 px robaba 56 px al importe y lo dejaba ilegible; el propio botón "Mixto" ya deshace el reparto. Un control, no dos.

**ADR-010 intacto:** cambia cómo se **componen** los pagos en el cliente. El payload (`payments: [{method, amount, meta}]`), el `externalId`, el outbox y la conciliación no se han tocado.

## 2 · La papelera exigía un segundo toque en 1,5 s

`TRASH_ARM_WINDOW_MS = 1500`: primer toque armaba, segundo borraba, y pasado segundo y medio se desarmaba **en silencio**. Con la mano ocupada parecía un botón muerto.

**Salida elegida: borrado directo + deshacer de 4 s** — la preferencia de producto y el patrón UX de la casa. Las otras dos opciones se descartaron por lo mismo:

- *Ampliar la ventana a 4 s y decirlo*: sigue siendo un doble toque contrarreloj sobre un target de 44 px. Alarga el problema, no lo quita.
- *Doble toque con temporizador visible*: pinta una cuenta atrás en la papelera de **cada línea**. Ruido permanente en la zona más densa del ticket para un caso que ocurre pocas veces.

El deshacer no exige puntería, y la penalización de equivocarse pasa de "no puedo borrar" a "borro y lo repongo".

- `CartLineItem.tsx`: fuera `trashArmed`, `armTimerRef`, `disarm()` y la constante. El `aria-label` pasa a `Eliminar <artículo>` (antes era el genérico "Eliminar línea") y el `title` avisa del deshacer. El hint de la papelera al pulsar `−` con cantidad 1 se mantiene.
- `SalePage.tsx`: `removeLine` guarda la línea **y su posición**, y arma la ventana. El banner es `role="status"`, va **arriba** en compacto (`top-3`) y abajo en escritorio (`lg:bottom-5`): abajo se comía el bloque fijo de totales + Cobrar del bottom-sheet, y tapar el total —aunque sean 4 s— es justo lo que este bloque vino a arreglar. `z-[55]`: por encima del sheet (z-40) y por debajo de los modales a pantalla completa (z-[60]).

**Deshacer en venta rápida vs. en mesa.** En venta rápida la línea vuelve a su índice original — es estado local. **En mesa el DELETE ya viajó al servidor**, así que deshacer es un alta nueva: se re-crea con `newId()` porque el `lineExternalId` viejo lo gastó la línea borrada, y el DRAFT server-side manda en la reconciliación. Consecuencia honesta: en mesa la línea repuesta **vuelve al final de la cuenta**, no a su sitio. Es el precio de no inventarse una resurrección server-side que el backend no ofrece.

## 3 · Por debajo de 1024 px no se llegaba a las líneas

En el bottom-sheet handheld los cuatro bloques del `TicketPanel` eran hermanos `shrink-0` salvo el listado, que era `flex-1 min-h-0 overflow-y-auto`. Cuando cabecera + chips + totales medían más que el `88dvh` del sheet, al listado le tocaban **0 px**: las líneas arrancaban justo en el borde inferior y no había forma de llegar a ellas, ni con rueda ni con arrastre. En el aside de escritorio nunca pasó porque ahí sobra alto.

`TicketPanel` gana un prop `layout: "aside" | "sheet"` y compone los mismos cuatro bloques de dos formas:

- **`aside`** (≥1024 px): idéntico a antes. Bloques fijos arriba, scroll sólo en el listado. El layout que validó Sole no se toca.
- **`sheet`** (handheld): cabecera, chips y **líneas** dentro de un único contenedor scrollable —así el listado siempre tiene su alto natural, nunca cero— y el bloque de totales + Cobrar anclado abajo, que es lo que no puede perderse de vista.

Verificado en el banco visual: a 320×568 el contenedor da `scrollHeight 721 / clientHeight 245` y se llega a las 6 líneas; a 390 y 768, ídem, con Cobrar siempre en pantalla.

## 4 · La tarjeta de mesa se rompía con contadores largos

Tres cosas, una causa común: nadie había medido la tarjeta con datos feos.

- **Unidades humanas.** `formatElapsed` pasaba de horas a nunca: T1, abierta 1037 h, pintaba `1013 h 28 m` y se comía la línea entera. Nueva escala: `ahora` → `45 min` → `3 h 20 m` → `1 día` → `42 días`. Peor caso realista 8 caracteres, frente a 11-12. El contador va además acotado a media tarjeta con `truncate` y con la duración completa en `title`.
- **El importe no se parte.** Le faltaba `shrink-0 whitespace-nowrap`: con la tarjeta estrecha, `0,00 €` caía en dos líneas. El dinero es lo que no se puede leer a medias.
- **El camarero deja de ser "m..".** El pie de la tarjeta es ahora `flex-wrap` con `min-w-[92px]` en el alias: si el camarero y el importe no caben en la misma línea, el camarero se lleva una línea entera. Con importes normales siguen en la misma fila, como hasta ahora. El nombre completo va en `title`.

Comprobado con los datos de la simulación: T1 (43 días · `matias.oyola.san…` · `0,00 €`) y M5 (1 día · `jose.antonio.per…` · `1240,00 €`) ya no rompen nada.

## 5 · Un solo formateador de importes

`const formatEur = (n) => n.toFixed(2).replace(".", ",") + " €"` estaba copiado **doce veces**, y unas cuantas pantallas pintaban directamente `n.toFixed(2) + " €"` → `3.50 €` con punto: modal de cobro, agrupar mesas, partir cuenta, arqueo y cierre forzado.

`apps/tpv-web/src/lib/money.ts`:

- `formatEur(n)` / `formatAmount(n)` — coma decimal, 2 decimales, `-0` normalizado a `0,00 €`, y `NaN`/`Infinity` a `0,00 €` en vez de escupir "NaN €" en pantalla.
- `parseAmount(s)` — acepta coma o punto, tolera `€` y espacios, resuelve el separador de millares por el **último** separador (`1.234,50` y `1,234.50` dan 1234.5) y **devuelve 0, nunca NaN**: una fila a medio escribir no puede envenenar la suma de pagos.

Las doce copias se sustituyen por el import. Los `<input>` de importe (línea, partir cuenta, deudas) se siembran con `formatAmount` y se leen con `parseAmount`, así que lo que se ve y lo que se parsea usan la misma convención.

**Redondeo:** se conserva el `toFixed(2)` de siempre —`1.005` es `1.00499…` en binario y baja— y queda **fijado por test a propósito**, para que nadie lo "arregle" y descuadre respecto a los importes ya emitidos.

## 6 · La lista de artículos del modal se cortaba sin avisar

Con 6 líneas se veían 2 y ninguna señal de que hubiera más. Ahora la lista tiene caja propia (`max-h-[168px]`, scroll con `overscroll-contain`) y el encabezado dice la verdad: `6 líneas · ↓ 2 sin ver`, en coral, más un degradado de recorte cuando hay algo debajo.

El aviso va en la **cabecera**, no debajo del cuadro: debajo caería fuera de pantalla justo cuando hace falta.

El recuento se mide con rects contra el **pliegue más alto de los dos** que pueden cortar: la propia caja (muchas líneas) o el borde inferior del body scrollable (pocas líneas pero el modal no llega). El bug original era del segundo tipo, así que contar sólo contra la caja habría vuelto a mentir. Un `ResizeObserver` sobre el body re-mide al girar la tablet, al abrir el teclado virtual y al cambiar de layout.

---

## Bucle visual

No hay Playwright instalado en el repo y montar el stack entero (API + Postgres + Holded + emparejar dispositivo) para mirar tres pantallas no compensa. En su lugar, **banco visual de desarrollo** en `apps/tpv-web/visual/`: monta las pantallas **reales** (`CheckoutOverlay`, `SalePage`, `TableMapScreen`) con `fetch` interceptado y fixtures deterministas —incluida la cuenta de 14,00 € del grupo T4+M3+M5 y la mesa zombi T1 de 1037 h—.

```
pnpm --filter @mipiacetpv/tpv-web dev
http://localhost:5173/visual/index.html?screen=checkout|sale|mapa
```

**No entra en producción:** `vite build` sólo toma `index.html` como entrada; verificado, `dist/` no contiene rastro del banco.

Capturas en `docs/blocks/v1-10-3-barra-shots/`:

| Fichero | Qué prueba |
|---|---|
| `checkout-1280.png` | modal de cobro completo, `6 líneas · ↓ 2 sin ver` |
| `mixto-1280.png`, `mixto-390.png`, `mixto-320.png` | Efectivo 10 + Tarjeta 4,00 = cuadra, **sin scrollear**, en los tres anchos |
| `falta-320.png` | **estado de error**: 6 + 4, `Falta 4,00 €` en el pie fijo, Cobrar bloqueado |
| `sheet-390.png` / `sheet-390-fondo.png` | bottom-sheet a 390: se llega a las 6 líneas, totales + Cobrar anclados |
| `sheet-320.png` / `sheet-320-fondo.png` | ídem a 320×568, el peor caso |
| `deshacer-390.png` | banner "Línea eliminada · Deshacer" sin tapar el total |
| `mapa-390.png`, `mapa-1280.png` | tarjetas con 4 dígitos de duración: `43 días`, `1 día`, `1240,00 €` en una línea |
| `aside-1024.png` | el aside de escritorio, sin cambios |
| `final-390.png` | **pantalla final**: "Ticket emitido · #000015" tras el cobro mixto |

La captura del deshacer se tomó congelando **sólo** el temporizador de 4 s desde la consola: el MCP tarda más de 4 s entre llamadas. El comportamiento real de la ventana lo cubre el test con fake timers.

## Criterio de "funciona"

| Escenario del guion | Resultado |
|---|---|
| Cobrar 14,00 € con 10 efectivo + 4 tarjeta | ✅ 3 taps, sin scrollear, `Σ pagos = total` verificado en el POST (`checkout-mixed-payment.test.tsx`) |
| Borrar una línea sin acertar un doble toque de 1,5 s | ✅ un toque borra; 4 s para deshacer |
| A 390 px llegar a todas las líneas del ticket | ✅ y también a 320 y 768 |

## Decisiones y deuda

- **En mesa, la línea repuesta vuelve al final de la cuenta.** Ver §2. Restaurar la posición exige que el backend acepte reinsertar con un `lineExternalId` ya consumido, que hoy no ofrece.
- **Deshacer sólo cubre el borrado de línea**, no cambios de cantidad ni descuentos. El `−` con cantidad 1 sigue sin bajar a 0 y sigue apuntando a la papelera.
- **Deshacer no reabre el modal de cobro ni cancela un envío a cocina.** Si la comanda ya salió, borrar y deshacer una línea no le dice nada a la cocina — igual que antes. Es un problema de comandas, no de deshacer.
- **`splitBill` sólo cambia de formato.** El bloque decía "no se probó en la simulación, no se toca a ciegas": se ha limitado el cambio a pasar los importes por el formateador único y a leer el input con `parseAmount` (que sustituye a un `parseFloat` con el mismo contrato salvo por devolver 0 en vez de NaN, y el guard `> 0` ya estaba). Cero cambios de lógica.
- **A 1024×640 el aside cae al flujo natural de la página** y las líneas se alcanzan con el scroll del documento. Es el `v1.5-hotfix4` de siempre (`min-height:700px`), no se ha tocado.
- **La barra de zona BARRA y el taburete** recibieron sólo `whitespace-nowrap` en el importe, por el mismo motivo que la tarjeta.
- El aviso "↓ N sin ver" se recalcula con `ResizeObserver`; en jsdom no existe y el `useEffect` lo comprueba antes de instanciarlo.

## Ficheros tocados

```
NUEVO  apps/tpv-web/src/lib/money.ts
NUEVO  apps/tpv-web/test/checkout-mixed-payment.test.tsx
NUEVO  apps/tpv-web/test/cart-line-undo-remove.test.tsx
NUEVO  apps/tpv-web/test/money-format.test.ts
NUEVO  apps/tpv-web/test/elapsed-human-units.test.ts
NUEVO  apps/tpv-web/visual/index.html          (sólo dev, fuera del build)
NUEVO  apps/tpv-web/visual/main.tsx            (sólo dev, fuera del build)
       apps/tpv-web/src/pages/CheckoutPage.tsx
       apps/tpv-web/src/pages/CartLineItem.tsx
       apps/tpv-web/src/pages/SalePage.tsx
       apps/tpv-web/src/pages/TableMapScreen.tsx
       apps/tpv-web/src/hooks/useElapsedTime.ts
       apps/tpv-web/src/pages/SalePage.groupPicker.tsx
       apps/tpv-web/src/pages/SalePage.splitBill.tsx
       apps/tpv-web/src/pages/SalePage.lineSheet.tsx
       apps/tpv-web/src/pages/SalePage.modifierSelector.tsx
       apps/tpv-web/src/pages/SalePage.cartLineHelpers.tsx
       apps/tpv-web/src/pages/CheckoutPage.outboxChip.tsx
       apps/tpv-web/src/pages/CloseShiftModal.tsx
       apps/tpv-web/src/pages/ShiftForceCloseScreen.tsx
       apps/tpv-web/src/pages/TicketsHistoryPage.tsx
       apps/tpv-web/src/pages/DebtsScreen.tsx
       apps/tpv-web/src/pages/RefundPage.tsx
       apps/tpv-web/test/shift-force-close-sync-pending.test.tsx   (3.50 € → 3,50 €)
       .gitignore                                                  (.playwright-mcp/)
```

## Fuera de alcance, como estaba escrito

Impresión (v1.10.2, ya en master), cierre de día (v1.11), partir cuenta (sólo formato) y el barrido de mesas y turnos zombi — que **siguen ahí**: las cuatro mesas de Sirope (M1, M2, M4 de `gemmamgc72` desde el 9 de julio, y T1) continúan abiertas a 0,00 €. Es un job de servidor y va en bloque aparte. Lo que sí ha cambiado es que ahora la tarjeta de una mesa zombi se lee: pone `43 días`, no `1013 h 28 m`.
