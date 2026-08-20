# Bloque v1.10.3 · La barra en hora punta

> Sale de la simulación de hora punta del 2026-08-20 sobre producción (ver
> `docs/qa/2026-08-20-simulacion-hora-punta-sirope.md`). El motor de sala aguantó todo: tres mesas a la vez,
> mover, agrupar, cobrar el grupo, arqueo cuadrado al céntimo. **Lo que falla son tres cosas que sólo aparecen
> con prisa y con los dedos.**

## Contexto (leer antes)

- `docs/qa/2026-08-20-simulacion-hora-punta-sirope.md` — el recorrido completo con capturas.
- `apps/tpv-web/src/pages/CheckoutPage.tsx` — modal de cobro, incluido el reparto Mixto.
- `apps/tpv-web/src/pages/CartLineItem.tsx` — stepper y papelera de línea.
- `apps/tpv-web/src/pages/SalePage.tsx` — layout de venta: aside (≥1280 px) vs bottom-sheet.
- Principios UX de la metodología: deshacer de 4 s, feedback <100 ms, prueba de estrés de layout a 320 px.

## Alcance

### 1. El cobro mixto no se puede completar (BLOQUEANTE, va primero)

Reproducción: cuenta de 14,00 € → **Mixto** → Efectivo 10, Tarjeta 4 → el modal sigue diciendo
**"Falta 4,00 €"** y el botón Cobrar queda deshabilitado. El importe del segundo método no entra en la suma de
pagos.

Y encima: **la fila del reparto queda tapada por el panel inferior fijo** del modal. La zona scrollable pasa por
detrás del bloque de importe/métodos/TOTAL, así que el cajero ni siquiera ve lo que está rellenando.

Arreglar las dos cosas: que el pago mixto sume, y que el reparto sea visible sin pelearse con el scroll. En un bar,
"mitad y mitad" es diario; hoy esa cuenta no se puede cobrar.

### 2. La papelera de línea sólo acepta el segundo toque en 1,5 segundos

`CartLineItem.tsx`: `TRASH_ARM_WINDOW_MS = 1500`. Primer toque arma, segundo borra, y pasado segundo y medio se
desarma **en silencio**. Parece un botón muerto.

Tres salidas posibles, a elegir por quien implemente y justificar en el `done.md`:

- Ampliar la ventana a 4 s y **decirlo** ("pulsa otra vez para borrar" visible, no sólo en `aria-label`).
- Sustituir por el patrón de la casa: borrar directo + **banner de deshacer 4 s**. Es el principio UX de Mi Piace
  y evita el doble toque en un target de 44 px con la mano ocupada.
- Mantener el doble toque pero con temporizador visible.

Preferencia del responsable de producto: **el deshacer de 4 s**, salvo que aparezca una razón de peso.

### 3. Por debajo de 1280 px no se llega a las líneas del ticket

En el layout compacto (bottom-sheet) el contenido **no scrollea**: ni rueda ni arrastre. Se ven cabecera, acciones
y totales, y las líneas empiezan justo en el borde inferior, inalcanzables. El AP12 (1280 px) se salva por un
píxel; cualquier pantalla más estrecha —o el mismo AP12 en vertical— deja al camarero sin poder tocar las líneas.

Arreglar el scroll del sheet y verificar a 320, 390, 768 y 1024 px.

### 4. La tarjeta de mesa se rompe con contadores largos

Mesa abierta hace 1037 h: el contador ocupa la línea entera, el importe **"0,00 €" parte en dos** y el nombre del
cajero se trunca a "m..". Además el propio contador debe pasar a unidades humanas: **"42 días"**, no "1013 h 28 m".

### 5. Importes con punto en los modales

`3.50` y `6.50` en el modal de cobro y en el de agrupar, frente a `3,50 €` en el resto de la app. Un solo
formateador para toda la app.

### 6. La lista de artículos del modal de cobro se corta sin avisar

Con 6 líneas enseña 2 y no da ninguna señal de que hay más.

## Restricciones

- **No tocar el camino de cobro a Holded** (ADR-010): el mixto cambia cómo se **componen** los pagos en el
  cliente, no cómo se envían ni cómo se concilian.
- Tap targets ≥ 44 px, `tabular-nums` en todo importe.
- Worktree propio (`../mipiacetpv-v1-10-3-barra`), verificado con `git worktree list`. Devuelve el hash del commit
  al cerrar. No push.

## Entregables

- Cobro mixto funcional y visible.
- Borrado de línea sin trampa de tiempo.
- Sheet scrollable en compacto.
- Tarjeta de mesa que aguanta 4 dígitos de duración y nombres largos, con duración en unidades humanas.
- Formateador único de importes.
- Test que cobre una cuenta con dos métodos y verifique que la suma de pagos = total.
- `docs/blocks/v1-10-3-barra-hora-punta-done.md`.
- **Criterio de "funciona"**: se cobra una cuenta 10 € efectivo + 4 € tarjeta; se borra una línea sin acertar un
  doble toque de 1,5 s; y a 390 px se llega a todas las líneas del ticket.

## Fuera de alcance (explícito)

- Impresión (va en `bloque-v1-10-2-impresion-honesta.md`).
- Cierre de día (va en `bloque-v1-11-cierre-de-dia.md`).
- Partir cuenta: no se probó en la simulación, no se toca a ciegas.
- Barrido de mesas y turnos zombi: es un job de servidor, bloque aparte.

## Bucle visual (obligatorio antes de cerrar)

Screenshots con Playwright del modal de cobro mixto, de la lista de líneas y de la tarjeta de mesa con una
duración de 4 dígitos: 320 px, 390 px, 1280 px, un estado de error y la pantalla final.
