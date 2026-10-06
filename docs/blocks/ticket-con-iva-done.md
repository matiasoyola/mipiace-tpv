# Bloque ticket-con-iva · hecho

Rama `ticket-con-iva`, desde `master` = `6e6f0df`. Escrito el 06-10-2026, para estar en producción
**antes del miércoles 08-10**, que es el despliegue del Bar La Maestranza — su primera venta real,
serie C1, VERI\*FACTU.

El ticket del bar ya se lee como la carta y la base imponible tiene un único valor en todo el
documento. El total no se ha movido ni un céntimo: sigue siendo entrada autoritativa.

---

## 1 · Lo que decía el papel y lo que dice ahora

La venta de PRUEBA del 06-10 en producción (tenant `81f2177b`): café con leche de 1,60 + dos cañas
de 1,30 + una ración de 10,40, todo al 10 %, **14,60 €**. Los dos papeles son reales: salen de
correr el mismo constructor de bytes sobre `6e6f0df` y sobre esta rama.

```
                    ANTES (6e6f0df)                         DESPUÉS
  ----------------------------------------   ----------------------------------------
  Cafe con leche                             Cafe con leche
  1 x 1,45 €                       1,60 €    1 x 1,60 €                       1,60 €
  Cana                                       Cana
  2 x 1,18 €                       2,60 €    2 x 1,30 €                       2,60 €
  Racion de la casa                          Racion de la casa
  1 x 9,45 €                      10,40 €    1 x 10,40 €                     10,40 €
  ----------------------------------------   ----------------------------------------
  IVA 10% s/13,26 €                1,33 €    IVA 10% s/13,26 €                1,34 €
  Subtotal                        13,27 €    Subtotal                        13,26 €
  TOTAL                           14,60 €    TOTAL                           14,60 €
  Efectivo                        14,60 €    Efectivo                        14,60 €
```

Todo lo demás del papel es **byte a byte el mismo**: cabecera fiscal, NIF, dirección, número,
cajero, mesa, separadores, el TOTAL, los pagos y el QR del ticket digital. El `diff` de los dos
papeles son **cinco renglones** y ni uno más: los tres de las líneas, el del tramo de IVA y el del
subtotal.

Las dos cosas que estaban mal:

1. **El unitario en neto.** `1,45 €` por un café que la carta vende a 1,60 €. El modelo guarda NETO
   con cuatro decimales (`Decimal(12,4)`, b30 — es lo que Holded factura y lo que hace que el total
   del TPV y el de Holded coincidan al céntimo), y el papel imprimía ese neto tal cual. El cliente
   no podía cuadrar sus líneas con su total.
2. **La base imponible con dos valores.** `s/13,26` arriba y `Subtotal 13,27` abajo, en el mismo
   papel. `cuadrarDesglose` repartía el céntimo residual entre el `subtotal` **y** las cuotas, y
   dejaba las bases de los tramos sin tocar — así el subtotal impreso se separaba de Σ bases. El
   comentario del propio fichero ya decía que «el céntimo se reparte donde nace, que es el redondeo
   de la cuota»; el código no lo cumplía con el subtotal.

Y una tercera que no se veía en el papel y era la peor: ese céntimo **también** salía del registro
de facturación. `generarRegistroDeVenta` informa `BaseImponibleOimporteNoSujeto` con la base de cada
tramo y `ImporteTotal` con el total; con el céntimo en el subtotal, **Σ BaseImponible +
Σ CuotaRepercutida ≠ ImporteTotal**. Se declaraba una factura que no cuadraba consigo misma, y lo
único que lo salvaba era la tolerancia de ±10 € de la AEAT.

---

## 2 · La tolerancia de la AEAT, con fuente

**Documento:** «Validaciones · Sistemas Informáticos de Facturación y Sistemas VERI\*FACTU»,
Departamento de Informática Tributaria, Subdirección General de Aplicaciones. **Versión 1.2.2,
08-04-2026.**
<https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Validaciones_Errores_Veri-Factu.pdf>

**§15.7 CuotaRepercutida** (pág. 14) — la que importa para la decisión de este bloque. Si
`CalificacionOperacion` es `S1` y `BaseImponibleACoste` no está cumplimentada (nuestro caso: factura
simplificada `F2`, régimen general, IVA):

> ▪ CuotaRepercutida y BaseImponibleOimporteNoSujeto deben tener el mismo signo.
> ▪ `[CuotaRepercutida] = ([BaseImponibleOimporteNoSujeto] * TipoImpositivo) / 100 +/- 10,00 euros`

El margen es **±10,00 €**, y es plano: la revisión 1.0.2 del documento (24-02-2025) dice
literalmente «Se unifica el tratamiento de CuotaRepercutida, independientemente del importe de la
Base Imponible (únicamente margen +/- 10 euros)». No es un porcentaje de la base.

**§17 ImporteTotal** (pág. 15):

> Se validará que sea igual a Ʃ (BaseImponibleOimporteNoSujeto + CuotaRepercutida +
> CuotaRecargoEquivalencia) de todas las líneas de detalle de desglose. En caso contrario se
> devolverá un aviso de error (no generará rechazo), admitiéndose un margen de error de +/- 10,00
> euros.

**§16 CuotaTotal** (pág. 15): idéntico, sobre Ʃ (CuotaRepercutida + CuotaRecargoEquivalencia), con
el mismo margen de ±10,00 €.

**La decisión, entonces:** mover un céntimo a la cuota cae dentro con tres órdenes de magnitud de
holgura. En la venta del 06-10 el desvío es `|1,34 − 13,26 × 10 %| = 0,014 €` frente a un margen de
10,00 €. **No hace falta pararse.**

Y hay una razón de fondo para elegir la cuota y no la base, además de que quepa: la cuota es el
único de los tres números que no es ni lo que se vendió ni lo que se cobró, sino un producto
calculado (`base × tipo / 100`, que casi nunca cae en un número exacto de céntimos). La base es una
suma de importes de línea y el total es lo que pasó por la caja: ninguno de los dos tiene nada que
redondear. Nótese además que los §16 y §17 son **avisos, no rechazos** — cumplirlos exactamente no
nos lo exigía nadie; cumplirlos es que la factura cuadre consigo misma.

---

## 3 · Qué cambió

### A · Base única

**`packages/ticket-model/src/desglose.ts`.** La regla, ahora: **subtotal impreso = Σ bases de los
tramos, siempre**. El residuo para que `Σ bases + Σ cuotas === total` se reparte **sólo entre las
cuotas**. `cuadrarDesglose` garantiza tres cosas al céntimo:

1. `subtotal === Σ buckets[].base`
2. `subtotal + Σ buckets[].tax === total`
3. `total` entra y sale igual

El reparto ya no usa `allocateRoundingRemainder` (v1.9.4) sino un `repartirCuotas` propio, y por una
razón concreta: `allocateRoundingRemainder` ajusta **como mucho un céntimo por componente**, que era
todo lo que hacía falta cuando repartía entre el subtotal y unas cuotas recién calculadas. Aquí el
desajuste puede ser de varios céntimos con un solo tramo donde colocarlos, porque la base de un
tramo es la suma de los importes de línea **ya redondeados** (`TicketLine.subtotal`) mientras que el
total viene de agregar los netos **crudos** de cuatro decimales y redondear una sola vez
(`computeTicket`, b30). Las dos cosas son correctas y en un ticket de quince líneas pueden
separarse media docena de céntimos. `repartirCuotas` hace un reparto plano primero y luego el resto
mayor, así que ningún tramo carga con el desajuste de los demás.

**Cuánto se desvía la cuota, medido:** en el barrido de 1.000 tickets de hasta 15 líneas, el peor
caso es **0,0230 €** (ticket 214, de 14 líneas). El test fija el techo en 0,03 € para no clavar el
decimal exacto. Margen AEAT: 10,00 €.

El campo `subtotal` de la entrada de `cuadrarDesglose` se queda (lo usa el caso sin tramos) pero
**ya no decide el subtotal impreso**, y está documentado así en la firma: dos fuentes para la base
imponible es exactamente el bug que este bloque cierra.

**El registro VERI\*FACTU** (`packages/verifactu/src/registro.ts`) no se ha tocado: ya tomaba la
base y la cuota del mismo `DesgloseCuadrado` que el papel (`apps/tpv-web/src/lib/fiscal.ts`
`generarRegistroDeVenta`). Lo que se ha arreglado es el cuadre de ese desglose, y con él
`ImporteTotal = Σ BaseImponible + Σ CuotaRepercutida` pasa a cumplirse **exactamente**, no dentro de
la tolerancia.

**Huella:** no se toca ningún registro ya emitido. `fiscal_records` es append-only y aquí no hay
migración ni backfill. Sólo afecta a lo que se emita a partir del deploy.

### B · Precio de línea con IVA

**De dónde sale el unitario.** Para un producto LOCAL el propietario da de alta el precio de carta
(bruto) y el admin persiste el neto de 4 decimales (`grossToNet`); para un producto de Holded el
neto llega de Holded con su precisión. En los dos casos `netToGross(neto, tipo)` devuelve el bruto
original — por eso el neto tiene cuatro decimales y no dos (b30). El café con leche: carta 1,60 →
neto 1,4545 → impreso `netToGross(1.4545, 10) = 1,60`. El round-trip está cubierto por los 143 casos
de `apps/tpv-web/test/price-override-gross.test.ts`, que siguen verdes.

Los tres papeles imprimen ahora **unitario y total de línea con IVA**, y el desglose de abajo sigue
mostrando base y cuota por tramo:

- **ESC/POS** (`packages/escpos-builder/src/ticket.ts`): `TicketLineEscpos.unitPrice` pasa a llamarse
  **`unitPriceGross`**. El rename es deliberado: el campo cambia de significado y así es un error de
  compilación en todos los callers en vez de un neto que se cuela por descuido.
- **PDF** (`packages/ticket-pdf/src/render.ts`), que es el ticket digital de la pantalla post-cobro
  y el que va por email. Era el peor de los tres: pintaba el unitario neto **y** el importe de línea
  neto (`line.subtotal`), así que ninguna de sus dos columnas tenía que ver con el total pagado.
- **`TicketLine`** del modelo gana `unitPriceGross` y `totalGross` (obligatorios, validados en el
  schema zod). `unitPrice` y `subtotal` siguen ahí en neto: son los que sostienen el desglose y lo
  que va a Holded.

**Cómo se cuadra la columna de la derecha.** El total del ticket no es Σ de los brutos de línea:
`computeTicket` agrega los netos crudos por tramo y redondea una vez al final, mientras que el bruto
de cada línea se redondea por línea. Pueden diferir en ±0,01 (con muchas líneas, ±0,02). Un ticket
cuya columna no suma el TOTAL es un ticket roto, así que **se cuadra** con
`cuadrarLineasImpresas` (`packages/ticket-model/src/lineas.ts`), mismo método del resto mayor y
mismo objetivo: el TOTAL. El céntimo se lo lleva la línea de mayor importe, que es donde menos se
nota.

Con un límite explícito: **el ajuste es de como mucho un céntimo por línea**. Eso es todo lo que el
redondeo por línea puede producir (el error de redondear a dos decimales es < 0,005 €). Un desajuste
mayor no viene del redondeo sino de que los importes de línea y el total no son de la misma venta, y
ahí se imprimen los importes tal como llegan y la columna no suma — que es la verdad de lo que hay
en los datos, en vez de repartir un euro entre las líneas y falsear los importes.

Lo que **no** se cuadra es el unitario: `units × unitario` no tiene por qué dar el total de la línea
en cuanto hay más de una unidad o un descuento, y forzarlo mentiría sobre el precio de la carta, que
es el dato que el cliente reconoce.

**Comercios con Holded: no se rompe nada.** Su papel no lleva parte fiscal (ni QR tributario ni
«Factura C1/…») y sigue sin llevarla — eso está fijado en test. Lo que sí cambia es el cuerpo del
ticket, igual que al comercio que emite sus facturas, y es a propósito: el cliente del bar que
factura con Holded también quiere leer la carta en su ticket. El snapshot antes/después del §1 es
precisamente el de un comercio con Holded.

**Un agujero que apareció al hacer B, y se cierra aquí.** `TicketLine.unitPrice` es el precio BASE y
los deltas de los modificadores (B-Bar-Modifiers) viven en el snapshot `modifiers`. El dispositivo
armaba su unitario del carrito, con los deltas dentro; el servidor lo armaba del `unitPrice`
persistido, **sin ellos**. Mientras los dos imprimían neto, el fallo era un dígito perdido entre dos
columnas que no cuadraban de todas formas; con el unitario en bruto es un café con leche con avena
anunciado a 1,60 € y cobrado a 2,10 €. `ticketToEscposInput` y `loadTicketDocument` suman ahora los
deltas, igual que `computeTicket` al cobrar. El invariante byte-a-byte de
`verifactu-un-solo-papel.test.ts` no lo cogía porque su fixture no tenía modificadores; ahora tiene
un caso que sí.

### C · «Mi cuenta» sin Holded

`apps/admin/src/App.tsx`: el panel «Conexión con Holded» se oculta cuando
`me.tenant.holdedEnabled === false`. La condición es `holdedEnabled !== false` y **no**
`hasHoldedKey`: un comercio que sí va a usar Holded y todavía no ha pegado la clave tiene algo que
conectar y sigue viendo el panel. Misma distinción que catalogo-local (addendum 3) hizo para el muro
de `/onboarding`, y mismo `!== false` que los módulos de H1 para que un front por delante del
backend no esconda el panel a quien lo usa. El Bar La Maestranza veía «Conexión con Holded · No
conectada» con un check verde y dos botones que no le sirven de nada.

### De paso: un sitio para la conversión neto↔bruto

`netToGross`, `grossToNet` y `round2` se mueven a `packages/ticket-model/src/precios.ts` y
`apps/tpv-web/src/lib/cart.ts` los re-exporta (su contrato público no cambia: quien los importaba de
ahí sigue importándolos de ahí). Hasta este bloque la conversión vivía sólo en la capa de entrada
del cajero; ahora la necesitan los tres renderers, y tres copias del mismo redondeo acaban
separándose. Es el mismo movimiento que V1-verifactu hizo con el reparto del céntimo.

Y en el PDF se borra la **segunda implementación de la regla del céntimo**: `render.ts` llamaba por
su cuenta a `allocateRoundingRemainder` con la lista de componentes montada ahí mismo, en vez de a
`cuadrarDesglose`. Dos implementaciones de la misma regla fiscal — al cambiarla, una se habría
quedado atrás.

---

## 4 · Los tests de sabotaje

Los cuatro que pedía el bloque, en **`apps/api/test/ticket-con-iva.test.ts`** (13 tests). Viven en
`apps/api/test` y no en el package porque es el único sitio del repo desde el que se puede recorrer
la cadena entera de la venta del servidor con las funciones de verdad, sin mockear nada:

```
computeTicket  →  Ticket.total / TicketLine.{subtotal,total}  →  buildTicketDocument
               →  cuadrarDesglose + cuadrarLineasImpresas
               →  ticketToEscposInput + buildTicketReceipt   (el papel)
```

**1 · La venta real del 06-10.** Reconstruida de punta a punta desde los precios de carta: 14,60 €,
Σ de netos de línea redondeados = 13,26, tramo único al 10 %. Comprueba base única 13,26 en el tramo
**y** en el subtotal, cuota 1,34, `subtotal + cuota = 14,60`, el desvío dentro de la tolerancia
AEAT, los tres unitarios en bruto (`1 x 1,60 €`, `2 x 1,30 €`, `1 x 10,40 €`), que **no** aparece
ninguno de los netos de antes, y que los importes de línea leídos del papel suman 14,60.

**2 · Barrido de 1.000 tickets aleatorios.** 1–15 líneas, precios de carta de 0,50 a 30,00 € en
pasos de 5 céntimos, tipos 10 y 21 mezclados, descuentos de línea (0, 5, 10, 15 y 50 %). Generador
LCG determinista y calentado — un barrido que falla una vez cada cien ejecuciones no es una red de
seguridad, es una lotería. Las cuatro invariantes en los 1.000:

- `subtotal === Σ bases`
- `Σ bases + Σ cuotas === total`
- `|cuota − base × tipo / 100| ≤ 10,00 €` (§15.7)
- `Σ líneas impresas === total`

Más un test que comprueba que el barrido **es variado de verdad**: que hay tickets de 1 y de 15
líneas, que más de 700 llevan los dos tipos mezclados, y que en más de 100 **existe** el céntimo
residual (sin éstos el barrido pasaría con cualquier implementación). Y una muestra de 40 tickets
donde las invariantes se leen del **papel impreso**, no de los números: que lo que se calcula es lo
que se imprime.

**3 · La regla vieja, reintroducida.** `cuadrarDesgloseSaboteado` es `cuadrarDesglose` tal como
estaba en `6e6f0df` —el `subtotal` dentro del reparto— copiado dentro del test. Con ella, sobre los
mismos 1.000 tickets:

- **más de 100 rompen `subtotal === Σ bases`**;
- **más de 100 rompen `ImporteTotal = Σ bases + Σ cuotas`**, que es el §17;
- y la venta del 06-10 es uno de ellos: el test comprueba que reproduce exactamente el papel de
  producción, base 13,26 y subtotal **13,27**.

No es un caso de borde. Pasa en una fracción grande de las ventas de un bar, y el ticket del 06-10
fue el tercero que se miró.

**4 · El papel del comercio con Holded, antes y después.** El snapshot del §1 de este informe, con
los dos papeles generados de verdad (`git checkout 6e6f0df -- …` para el «antes»). El test fija los
seis renglones que cambian, que nada más cambia (cabecera, NIF, cajero, mesa, pagos, QR del ticket
digital), y que el comercio con Holded sigue sin parte fiscal. El `diff` real son cinco renglones.

**Más tests de este bloque:**

- `packages/ticket-pdf/test/ticket-pdf.test.ts` — la misma venta del 06-10 en el **ticket digital**
  (el del email y el de la pantalla post-cobro): unitarios en bruto y base imponible con un valor.
- `apps/api/test/verifactu-un-solo-papel.test.ts` — el byte-a-byte de los dos caminos, con `taxRate`
  en la fixture y un caso nuevo de modificador con precio.
- `apps/api/test/ticket-net-unit-price.test.ts` — la red de seguridad del override de v1.8, ahora
  sobre el bruto: un override de 4,13 € netos al 21 % se imprime 5,00 €, no los 6,20 € del catálogo.
- `apps/admin/test/mi-cuenta-sin-holded.test.tsx` — §C, los cinco casos (`holdedEnabled` false, true
  sin clave, true con clave, ausente, y sin caja).

**Suite:** 283 ficheros, **3.148 tests verdes** y 3 saltados. Antes del bloque: 281 ficheros, 3.127
verdes. Cero regresiones.

> Nota de entorno: un worktree nuevo no trae el cliente de Prisma generado y la suite se cae con
> `Cannot find module '.prisma/client/default'` en 68 ficheros. Se arregla con `pnpm db:generate`.
> No tiene nada que ver con la rama.

---

## 5 · Los tres comandos para Matías

```bash
# 1 · merge a master (en el repo principal, ~/Developer/Claude/Projects/mipiacetpv)
git checkout master && git pull --ff-only && git merge --no-ff ticket-con-iva && git push

# 2 · deploy (en el servidor, con el sha corto del commit de master que acaba de salir)
cd /opt/mipiacetpv && IMAGE_TAG=<sha-corto-de-master> bash infra/deploy.sh

# 3 · health
curl -fsS https://api.mipiacetpv.com/health | jq .
```

**Vuelta atrás:** `IMAGE_TAG=<sha-anterior> bash infra/deploy.sh`. No hay migración ni backfill en
este bloque, así que el rollback es limpio: vuelve el papel de antes y nada más. Los registros de
facturación ya emitidos no se tocan en ninguna de las dos direcciones.

**El humo, después del deploy (sin ventas reales):**

1. Reimprimir desde el panel el ticket de la venta de prueba del 06-10 del tenant `81f2177b`.
   **Qué se mira:** `1 x 1,60 €` en la primera línea y un único `13,26` entre el tramo y el
   subtotal.
2. Abrir su ticket digital por el QR. **Qué se mira:** las dos columnas en bruto y el mismo 13,26.
3. Entrar a «Mi cuenta» con el propietario del Bar La Maestranza. **Qué se mira:** no aparece
   «Conexión con Holded».

---

## 6 · Lo que este bloque NO hace

- **No imprime el descuento de línea en el térmico.** El PDF ya pinta `-X%` junto al unitario; el
  ESC/POS no, porque `TicketLineEscpos` no lleva el campo. Con descuento, `units × unitario` no
  cuadra con el total de la línea y el papel no dice por qué. Es estado previo (en el mundo neto
  pasaba lo mismo) y añadir una columna al térmico a dos días del despliegue es mover el layout por
  una razón que no es la de este bloque. **Anotado.**
- **No toca el «Subtotal» que ve el cajero en pantalla.** `CartTotals.subtotalNet` es
  `round2(Σ netos crudos)`, mientras que el del papel es Σ de las bases de los tramos: en un ticket
  con IVA mixto pueden diferir en un céntimo. El papel es el que tiene que cuadrar y cuadra; la
  pantalla del cajero no es un documento. **Anotado.**
- **No cambia cómo se calcula la base de un tramo.** Sigue siendo Σ de los importes de línea ya
  redondeados (`TicketLine.subtotal`), que es lo que se persiste y lo que el desglose declara. El
  bloque pedía que la base tuviera un único valor, no que se recalculara; moverla a los netos crudos
  cambiaría lo que se declara en todos los tickets y no es lo que nadie pidió. La consecuencia —que
  la cuota absorbe unos céntimos en tickets largos— está medida arriba y documentada en
  `desglose.ts`.
- **No toca producción ni datos, y no ha hecho ninguna venta real.** La venta del 06-10 se
  reconstruye en un test desde sus precios de carta; nada ha salido hacia Holded ni hacia la AEAT.
- **No cambia el registro de facturación ni la huella.** `registro.ts` está intacto.

---

## 7 · Ficheros

```
packages/ticket-model/src/precios.ts        nuevo · netToGross / grossToNet / round2
packages/ticket-model/src/lineas.ts         nuevo · cuadrarLineasImpresas
packages/ticket-model/src/desglose.ts       la regla: subtotal = Σ bases + repartirCuotas
packages/ticket-model/src/types.ts          TicketLine.unitPriceGross / .totalGross
packages/ticket-model/src/schema.ts         los dos campos, obligatorios
packages/ticket-model/src/build.ts          los calcula; round2 pasa a precios.ts
packages/ticket-model/src/index.ts          exporta precios.ts y lineas.ts
packages/escpos-builder/src/ticket.ts       unitPrice → unitPriceGross; cuadra las líneas
packages/escpos-builder/src/venta-local.ts  LineaTicketLocal.unitPriceGross
packages/ticket-pdf/src/render.ts           bruto en las dos columnas; usa cuadrarDesglose
apps/api/src/tickets/escpos-input.ts        bruto + deltas de modificadores
apps/api/src/tickets/print.ts               select: taxRate, modifiers
apps/api/src/tickets/build-document.ts      unitPrice con los deltas de modificadores
apps/tpv-web/src/lib/cart.ts                re-exporta los helpers; unitPriceGrossOf
apps/tpv-web/src/pages/CheckoutPage.tsx     el papel sin red, con el unitario bruto
apps/admin/src/App.tsx                      §C + AccountPage exportada para el test
```
