# Auditoría de UX por procesos · 2026-09-02

Ejecutada sobre el **AP11-1006 físico**, APK propia `versionCode 11410` / `versionName 1.14.1`,
bundle `build 2705a3a` (el mismo que producción), viewport **1280 × 800** a DPR 1,5,
WebView Chrome 151, tenant **Sirope** con el catálogo real y cajero `mipiacetpv-test-2e5c19f9`
en modo prueba.

Instrumentación: DevTools sobre el WebView del terminal (`adb forward` + CDP). Todas las medidas
de tamaño, oclusión y tiempo son del hierro, no estimaciones. Los tiempos son *toque → primer
frame pintado tras el cambio de DOM*.

Capturas: `docs/qa/2026-09-02-auditoria-procesos/`.

**Protocolo cumplido**: dos tickets emitidos, ambos con badge PRUEBA y "No se sube a Holded ni se
envía email". Filtros de la lista de tickets: Sincronizados 0 · Pendientes 0 · Fallidos 0 — no hay
nada encolado hacia Holded. Queda que Matías eche un ojo al Holded del cliente para cerrar el punto.
Los PIN los tecleó Matías.

---

## Toques por recorrido

| Recorrido | Toques | De los que evitables |
|---|---|---|
| **R1** Arranque en frío hasta poder vender | 8 (cajero + 4 dígitos + Entrar + fondo + Abrir turno) | 0 |
| **R2** Barra: 2 productos, efectivo con vuelta | 7 | 1 |
| **R3** Mesa: abrir + 3 productos + enviar comanda | 6, +1 forzado por el fallo de impresora | 2 |
| **R4** Cobrar mesa con pago mixto tecleado | 9 aceptando el reparto automático; **16** si hay que sobrescribir la tarjeta | 7 |
| **R5** Cierre de turno + arqueo (1 denominación) | 8 | 0 |
| **R6** Vincular un terminal nuevo | **imposible desde el propio terminal** | — |

El esqueleto de los recorridos es bueno. Abrir mesa, meter tres cosas y mandar la comanda son seis
toques y ninguno sobra. Lo que falla no es el número de toques: es lo que la pantalla deja de
contar en los tres momentos en que hay dinero de por medio.

## Tiempo hasta la confirmación visual (§1.3, presupuesto 100 ms)

| Acción | Pintado |
|---|---|
| Abrir mesa desde el mapa | 58 ms |
| Cambiar de categoría | 86 ms |
| Enviar comanda | 53 ms |
| Confirmar el cobro | 41–56 ms |
| **Añadir un producto** | 65 / 86 / **101 / 102 / 105 / 113 / 117** ms |
| Abrir el modal de cobro | 105–117 ms |
| Cuadrar caja | 152 ms · Hecho: 194 ms |
| **Tocar "últ. 4" de tarjeta (teclado del SO)** | **1389 ms** |

---

# Reparto en los tres cajones

## 🔴 Bloquea implantación

### B1 · El cierre de día cuenta lo entregado, no lo cobrado: la vuelta se suma a las ventas y al cajón

Los dos tickets del turno fueron **#000019 = 4,70 €** y **#000020 = 3,00 €**. Ventas reales: **7,70 €**.
La #000020 se pagó con un billete de 5 y se devolvieron 2,00 €.

El cierre reporta:

```
VENTAS DEL DÍA        9,70 €     (real: 7,70 €)
EFECTIVO              7,00 €     (real: 5,00 €)
Efectivo esperado en el cajón   7,00 €
MÉTODO     BRUTO    DEVOL.   NETO
Efectivo   7,00 €      —     7,00 €
```

9,70 − 7,70 = **2,00 €**, exactamente la vuelta. El efectivo esperado suma el billete entregado
(5,00) en lugar de la venta (3,00). Al contar el cajón con sus 5,00 € reales, el arqueo escupe
**"Llevas contado 5,00 € · descuadre −2,00 €"**.

Los tickets están bien y Holded no se contamina: el fallo está en la agregación del turno. Pero el
informe Z es el papel con el que el cliente cuadra su caja. Con esto, **el descuadre de cada día es
la suma de todas las vueltas del turno**, y quien esté en la barra aparece con un faltante que no ha
causado. Es el hallazgo más grave de la auditoría.

### B2 · El día se cierra con mesas abiertas y nadie avisa

Se cerró el turno con **5 mesas abiertas y 19,60 € en sala**. Ni aviso, ni lista, ni bloqueo, ni
mención en el Z. Al abrir el turno siguiente esas 5 mesas y esos 19,60 € siguen ahí, heredados de un
turno ya archivado. Con el catálogo real de Sirope ya hay mesas etiquetadas "1 día".

### B3 · "Enviar comanda" falla con un mensaje de administrador y no deja rastro

Al enviar la comanda de la M3 salió, tapando el título "Mesa M3" del panel del ticket:

> **Sin impresora configurada** — Falta configurar impresora WIFI para la sección SALON en este
> register. Se configura en el panel de administración → Impresoras.  [Entendido]

- **"register"** sin traducir y **"SALON"** en crudo de base de datos, en la cara de un camarero.
- La única salida es **"Entendido", de 83 × 32 px**.
- Tras descartarlo **el ticket queda idéntico**: ni marca de "pendiente de enviar", ni reintento, ni
  forma de saber si la cocina tiene la comanda.
- El **mismo** fallo de impresora, al emitir el ticket de venta, aparece como una nota gris tranquila
  dentro del "Ticket emitido". Dos tratamientos opuestos para la misma causa.

### B4 · Dos productos distintos se dibujan iguales: el corte del nombre se come "(Sin gluten)"

El catálogo de Sirope tiene **diez pares** `Desayuno N` / `Desayuno N (Sin gluten)`. La tarjeta mide
157 × 104 px con la caja del nombre de 127 px y recorte a dos líneas: en pantalla las dos leen
**"Desayuno 1 · Café + Tostada manteq…"**. Sólo el precio las separa —

y **Desayuno 4 · Café + Croissant Plancha** y **Desayuno 4 · … (Sin gluten)** cuestan **los dos
3,00 €**: en pantalla son literalmente el mismo botón.

En la línea del ticket la caja del nombre es de 96 px, así que tampoco se puede verificar después de
pulsarlo. Un celíaco puede acabar comiendo gluten y el TPV no ofrece ninguna forma de comprobarlo.

### B5 · Vincular un terminal exige un segundo dispositivo, y el teclado del sistema tapa el botón

`PairScreen` usa seis `<input inputMode="numeric">` reales, así que abre el **teclado del SO**.
Medido en el AP11: al abrirse el viewport pasa de 800 a **362 px — el teclado se come el 55 % de la
pantalla** — y empuja "Vincular dispositivo" por debajo. El propio copy pide "un código de 6 dígitos
desde el admin": hace falta otro dispositivo con sesión de encargado. Sin resolver esto no se entrega
un terminal a un cliente.

### B6 · Keystore de release (A3 frente 7)

Ya inventariado, sigue en pie y ahora en camino crítico: sin él no hay APK entregable y actualizar el
terminal de Sole exige ir con un cable.

---

## 🟠 Cuesta dinero en hora punta

### C1 · La pantalla de "Ticket emitido" no dice cuánto hay que devolver

Se cobran 3,00 €, el cliente da 5, y la confirmación muestra: número interno #000020, badge PRUEBA,
el aviso de impresora, *Mostrar QR · Descargar PDF · Ver ticket* y *Nueva venta*. **Ni el total, ni lo
entregado, ni la vuelta.** El único sitio donde apareció "Cambio 2,00 €" fue la pantalla anterior, y
en cuerpo más pequeño que el "TOTAL 3,00 €" que ya no hace falta. El dato que el camarero necesita
en ese segundo exacto desaparece justo en ese segundo.

### C2 · El teclado propio no escribe sobre un campo pre-relleno; hay que pulsar C, y nada lo dice

Mixto sobre 4,70 €. Escribir 2,00 en Efectivo recalcula Tarjeta a 2,70 al instante — eso funciona
perfecto. Pero con la tarjeta ya rellena, pulsar **3, 1, 9, 0** no cambia nada: el campo sigue en
2,70. Sólo tras pulsar **C** admite dígitos. Y el texto de ayuda del propio campo dice
*"Resto de la cuenta · escribe encima si no cuadra"*.

Es el B3 de la ronda 2, vivo en v1.14.1 y en la ruta del dinero. La decisión que quedaba abierta:
**recomendado (b) — el primer dígito sustituye al pre-relleno**.

### C3 · Un exceso de pago se pinta en verde y ofrece vuelta aunque el exceso sea de tarjeta

Efectivo 2,00 + Tarjeta 3,00 sobre un total de 4,70 → banda **verde** "5,00 € · sobran 0,30 €",
línea "Cambio 0,30 €" y **"Cobrar" activo**. En hora punta se lee el color, no el texto: verde es
"adelante". Y 0,30 € de más cargados en la tarjeta no se devuelven del cajón — es dinero que sale
por la puerta.

### C4 · El teclado del sistema entra por "últ. 4" de la tarjeta

Todos los campos de dinero son `readOnly` + `inputmode=none` (CashPad) **menos "Referencia Tarjeta"**,
que es un input normal sin `inputmode`. Abre el **QWERTY con letras** para meter cuatro dígitos, tapa
el 55 % de la pantalla y tarda **1389 ms** en responder: 14× el presupuesto de 100 ms y el peor
tiempo de toda la sesión. Es el agujero que queda en la protección del CashPad, y es el mismo
mecanismo que B5.

### C5 · "Más opciones" del cobro vive debajo del pie fijo

A 1280 × 800 el contenido del modal mide 561 px en una ventana de 466 px: **95 px ocultos**.
"Más opciones" (652 × 48, y=641..689) queda **íntegramente tapado** por la banda TOTAL/Cobrar —
`elementFromPoint` en sus tres puntos devuelve el pie, no el botón. Sólo se alcanza desplazando, y no
hay ninguna señal de que haya algo más abajo. Al desplegarlo, lo que aparece ("Enviar por email"…)
vuelve a quedar cortado. La casilla "Imprimir ticket" queda a medias bajo el pie.

### C6 · El catálogo va alfabético; lo que más se vende cae donde caiga

"Todos" son **107 productos en una rejilla de 2606 px sobre una ventana de 504 px: 5,2 pantallas**,
ordenados A→Z. A las 7 de la mañana, "Café con leche" se ve, pero "Croissant" queda fuera de la
primera pantalla y hay que ir a la categoría. Y sólo se ven **4 categorías**: las otras **7** están
tras "Más (7)". El rail vertical ya decidido resuelve la mitad; el orden por frecuencia, la otra.

### C7 · El hueco del panel del ticket no se llena nunca

Turno recién abierto — el caso de Sole a las 7: el panel derecho (360 × 576) tiene **~470 px de vacío**
con una sola frase gris. Es el 22 % de la pantalla sin hacer nada en el momento de más prisa.
La cascada propuesta en el guion (turno → mismo tramo horario de días anteriores → catálogo) sigue
siendo la respuesta correcta.

### C8 · Los −/+ de cantidad miden 44 × 36 px con el sistema mandando 48

Dos de los botones más repetidos del día, por debajo del mínimo. Y la **papelera (44 × 44) borra la
línea de un toque, sin confirmación y sin deshacer**, a 170 px del "−".

### C9 · "Cerrar turno" vive dentro de la zona de tecleo del arqueo

El botón coral está a **15 px** del "C" del pad y a la misma altura que su fila inferior. Es
exactamente el mecanismo del fallo de la ronda 1 (el cierre se disparó mientras se tecleaba el
arqueo). Además el **descuadre −2,00 € se pinta en gris neutro**, igual que un recuento perfecto, y
cerrar con descuadre no pide confirmación.

### C10 · En el arqueo, las denominaciones que se cuentan están nueve filas abajo

Quince filas de ~91 px empezando por **500 €**. En pantalla caben seis: 500, 200, 100, 50, 20, 10.
Los 5 €, 2 €, 1 € y todas las monedas — lo que de verdad hay en el cajón de un bar — exigen
desplazar. El orden es contable, no de recuento.

Lo que sí está bien: el pad va a la derecha y la lista a la izquierda, ambos visibles a la vez, con
"Contando 5 €" y el descuadre en vivo. Ese layout es el bueno; el del cobro debería parecerse a éste.

### C11 · "Cerrar el día": "Cancelar" se sale del modal, y con el detalle desplegado, de la pantalla

Colapsado, "Cancelar" se dibuja **por debajo de la tarjeta blanca**, encima de la rejilla de
productos, en gris claro. Desplegando "Ver detalle" —lo responsable antes de cerrar— el modal pasa a
medir 836 px en 800: **"Cancelar" cae a y=830 y `elementFromPoint` devuelve null**. La salida de una
acción irreversible desaparece justo cuando el usuario hace lo correcto.

### C12 · Añadir un producto tarda 101–117 ms

Mediana ~102 ms, por encima del presupuesto de 100 ms de §1.3, en la acción más repetida de la
jornada. El resto del recorrido va sobrado (41–86 ms).

---

## 🟡 Estética

- **E1 · Mapa de sala.** La misma mesa mide **427 × 118** en Salón, **124 × 118** en Terraza y
  **84 × 84** en Barra: **7,1× de diferencia de área** para el mismo objeto. Y **"BARRA" empieza en
  y=841: fuera de pantalla** (total 975 px sobre 800). La zona de más rotación de un bar exige
  desplazar. Tres tamaños para una misma cosa, y el área repartida al revés de la importancia.
- **E2 · Tarjeta de producto: 40 % de aire muerto** (41 px de 104) entre nombre y precio cuando el
  nombre es corto. La tarjeta está dimensionada para el peor caso y el caso común paga el hueco.
- **E3 · "Café con leche" se corta en la línea del ticket por 6 px** (caja 96 px, texto 102 px) con
  470 px de vacío inmediatamente debajo.
- **E4 · "Enviar comanda" es el botón más débil de la pantalla** (113 × 48, fondo transparente, texto
  slate) junto a "Cobrar" (181 × 64, coral sólido). En una mesa, enviar la comanda es lo que toca;
  cobrar llega veinte minutos después. La jerarquía está invertida para el flujo de sala.
- **E5 · "Cobrar 0,00 €" deshabilitado se pinta en coral pleno con texto blanco**, idéntico al
  habilitado. Invita a pulsarlo con el ticket vacío.
- **E6 · Copy roto.** "Ticket · 0·Ticket 1 del turno" (falta la unidad y el espacio).
  "Importe exacto · 1,70 €" cuando 1,70 no es el importe exacto sino el resto. Buscador de tickets:
  "Número interno, fiscal o **externalId**…". Menú: "Bloquear (mipiacetpv-t…" cortado a 240 px.
- **E7 · Los chips de zona no exponen estado** (sin `aria-selected` ni `role="tab"`).
- **E8 · Los tickets DRAFT se identifican por UUID** — "#D-5b9d4430-222a-4ae4-ae38-4130c1af02e8" —
  sin nombre de mesa en la fila.
- **E9 · La barra de estado dice "Caja abierta · Caja 1" con punto verde** mientras el modal encima
  dice "Turno cerrado".
- **E10 · "Mostrar PIN" mide 32 × 32 px.** El resto de la pantalla de entrada está bien: pad 99 × 64,
  "Entrar" 431 × 56, tarjeta de cajero 431 × 81.
- **E11 · El menú enseña `build 2705a3a`** (el bundle web) pero no la versión de la APK. Con A4 son
  dos entregas distintas y el técnico en sitio necesita las dos.
- **E12 · "Descargar PDF"** en un terminal Android sin gestor de archivos a la vista.

---

## Lo que funcionó sin un fallo

- El reparto automático del **cobro mixto**: escribir 2,00 en efectivo recalcula la tarjeta a 2,70 al
  instante y mantiene "cuadra". El bloqueo de la ronda 1 está resuelto.
- El **CashPad** cubre todos los campos de dinero salvo "últ. 4", y el arqueo lo usa bien.
- El **layout del arqueo** (lista + pad a la vez, descuadre en vivo).
- **Modo prueba**: dos tickets con badge PRUEBA, cero encolados hacia Holded.
- La APK ejecuta **su propio bundle** (`build 2705a3a`), como manda A4.
- El copy de mesas zombi: ya no dice "1181 h 53 m" sino "1 día".
- **Ningún error de consola** en todo el recorrido.

---

## Nada se construye hasta que Matías ordene el reparto

Los tres cajones están cerrados. Falta la ordenación dentro de cada uno y decidir el alcance del
primer bloque. Mi lectura, para discutir: **B1 va solo y va primero** — es el único hallazgo que
convierte el TPV en un problema contable para el cliente, y su arreglo es de agregación, no de UI.
