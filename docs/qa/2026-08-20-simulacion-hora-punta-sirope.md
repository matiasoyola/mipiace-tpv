# Simulación de hora punta · Cafetería Sirope · 2026-08-20

Recorrido completo del flujo de bar sobre **producción** (`4669bfa`), con cajero real (login con PIN, no modo
prueba), dispositivo emparejado desde cero, catálogo real de Holded. Ventana 1280×800 — el tamaño del AP12.

Todos los tickets nacieron con etiqueta **PRUEBA** (`User.isTestCashier` → `upload-ticket` corta con
`skipped: test_mode`), así que **no se creó ningún documento en el Holded de la clienta**.

## Lo que funcionó, sin un tropiezo

| Paso | Resultado |
|---|---|
| Emparejar dispositivo (código de 6 dígitos) | ✅ |
| Login de cajero con PIN | ✅ primera vez desde el despliegue de v1.10 |
| Cerrar turno colgado (41 días abierto) | ✅ |
| Abrir turno con presets | ✅ |
| 3 mesas abiertas a la vez con bebidas | ✅ |
| Sumar y restar unidades (`+` / `−`) | ✅ |
| Eliminar línea | ✅ pero ver hallazgo #2 |
| **Mover mesa** (M6 → T4, con sus líneas) | ✅ impecable |
| **Agrupar mesas** (T4 + M3 + M5 = 14,00 €) | ✅ suma exacta, aparece "Desagrupar" |
| Cobrar el grupo | ✅ banner "Mesa cobrada · Ticket 000015", salida directa al mapa, mesas liberadas |
| Cerrar turno con arqueo | ✅ esperado 214,00 = contado 214,00, descuadre +0,00 € |
| IVA | ✅ 10 % en refrescos, 21 % en alcohol, al céntimo |
| Totales del mapa | ✅ "16,00 € en sala" = 6,50 + 3,50 + 6,00 |

## Hallazgos

### 1. El cobro mixto no se puede completar (BLOQUEANTE)

Con el grupo de 14,00 €: se elige **Mixto**, se pone Efectivo 10 y Tarjeta 4 — y el modal sigue diciendo
**"Falta 4,00 €"** con el botón Cobrar deshabilitado. El importe del segundo método no se contabiliza.

Además la fila del reparto **queda tapada por el panel inferior fijo** del modal: la zona scrollable pasa por
detrás del bloque de importe/métodos/TOTAL. En un bar, "mitad y mitad" es diario.

### 2. La papelera de línea sólo acepta el segundo toque en 1,5 segundos

`CartLineItem.tsx`: `TRASH_ARM_WINDOW_MS = 1500`. El primer toque arma, el segundo borra — pero si tardas más de
segundo y medio se desarma **sin decir nada**. Pulsé varias veces con 2-4 s de separación y parecía un botón
muerto; con dos toques seguidos borró a la primera.

Para un camarero en hora punta, con la mano ocupada, esa ventana es corta y el fallo es mudo. O se amplía, o se
avisa ("pulsa otra vez para borrar"), o se cambia por deshacer de 4 s, que es el patrón de la propia metodología.

### 3. En el layout compacto no se llega a las líneas del ticket

Por debajo de ~1280 px CSS la venta usa un bottom-sheet cuyo contenido **no scrollea**: ni rueda ni arrastre. Se
ven cabecera, acciones y totales; las líneas empiezan justo en el borde inferior y son inalcanzables. El AP12
(1280 px) se salva por los pelos: cualquier pantalla más estrecha pierde el acceso a las líneas.

### 4. La comanda falla honestamente; el ticket no

Enviar comanda sin impresora → **"No se pudo enviar la comanda · Falta configurar impresora WIFI para la sección
SALON en este register"**. Perfecto.

El mismo escenario en la impresión de ticket dice **"Enviado a impresora"**. El patrón correcto ya existe en la
casa: hay que replicarlo (ver `bloque-v1-10-2-impresion-honesta.md`).

### 5. La tarjeta de mesa se rompe con contadores largos

T1, abierta hace 1037 h: el contador ocupa toda la línea, el importe **"0,00 €" parte en dos líneas** y el nombre
del cajero se trunca a "m..". Es el test de estrés de layout de la metodología (§4.4) fallando con datos reales.

### 6. Importes con punto en los modales

`3.50` y `6.50` en el modal de cobro y en el de agrupar, frente a `3,50 €` en el resto de la app.

### 7. La lista de artículos del modal de cobro se corta sin avisar

Con 6 líneas enseña 2, sin ninguna señal de que hay más.

## Estado en que queda Sirope

Turno cerrado, arqueo cuadrado, mesas del test liberadas. Siguen abiertas las **cuatro mesas zombi** anteriores
(M1, M2, M4 de `gemmamgc72` desde el 9 de julio y T1), a 0,00 €.
