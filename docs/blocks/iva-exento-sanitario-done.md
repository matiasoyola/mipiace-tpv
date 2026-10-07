# Bloque iva-exento-sanitario · hecho

Rama `iva-exento-sanitario`, worktree
`~/Developer/Claude/Projects/mipiacetpv-iva-exento-sanitario`, desde
`origin/master` = `ed3a0be`. Cuatro commits, 64 ficheros.

**Rosario marca una vez «Exento · sanitario» en sus servicios y se olvida.**
Cada cobro sale con el desglose correcto y la leyenda de la exención, y la
crema que vende en el mostrador sigue llevando su 21 % en el mismo ticket.

Los dos tickets del mockup, cobrados de verdad en el TPV del banco el
07-10 y sacados por el endpoint real de impresión
(`docs/qa/2026-10-07-iva-exento-sanitario`):

```
         SÓLO SESIÓN                        SESIÓN + CREMA
  ----------------------------------  ----------------------------------
  Quiropodia                          Quiropodia
  1 x 35,00 €              35,00 €    1 x 35,00 €              35,00 €
                                      Crema urea 20%
                                      1 x 12,00 €              12,00 €
  ----------------------------------  ----------------------------------
  Exento                   35,00 €    Exento                   35,00 €
  IVA                       0,00 €    Base 21 %                 9,92 €
                                      IVA 21 %                  2,08 €
  TOTAL                    35,00 €    TOTAL                    47,00 €
  Tarjeta                  35,00 €    Tarjeta                  47,00 €

  ****************************        ****************************
  Operación exenta de IVA             Quiropodia: operación exenta de IVA
  art. 20.Uno.3º Ley 37/1992          art. 20.Uno.3º Ley 37/1992
  ****************************        ****************************
```

Y sus dos registros de facturación, leídos de `fiscal_records.payload`:

```
C1/000001   DetalleDesglose: [
              { Impuesto:"01", ClaveRegimen:"01",
                OperacionExenta:"E1", BaseImponibleOimporteNoSujeto:"35.00" } ]

C1/000002   DetalleDesglose: [
              { Impuesto:"01", ClaveRegimen:"01",
                OperacionExenta:"E1", BaseImponibleOimporteNoSujeto:"35.00" },
              { Impuesto:"01", ClaveRegimen:"01", CalificacionOperacion:"S1",
                TipoImpositivo:"21.00", BaseImponibleOimporteNoSujeto:"9.92",
                CuotaRepercutida:"2.08" } ]
```

---

## 1 · La decisión de fondo: un 0 % sujeto y un exento NO son lo mismo

Es lo que explica todo lo demás de este bloque.

| | 0 % **sujeto** | **exento** |
| --- | --- | --- |
| `CalificacionOperacion` | `S1` | **no se informa** |
| `OperacionExenta` | no se informa | `E1` |
| `TipoImpositivo` | `0.00` | **no se informa** |
| `CuotaRepercutida` | `0.00` | **no se informa** |

Los dos suman cero euros de cuota y son **dos operaciones distintas** ante
la AEAT. Hasta este bloque el TPV no tenía forma de decir «exento»: un
producto sólo tenía `taxRate`, y `buildDesglose` declaraba TODO como `S1`.
Un ticket de Rosario habría salido mal en el papel y mal en el registro —
y nadie se habría enterado, **porque los importes cuadran**.

De ahí salen las tres piezas del bloque:

1. **El tramo deja de ser «por tasa» y pasa a ser «por (tasa, causa)».**
2. **`DetalleDesglose` deja de ser una interfaz y pasa a ser una UNIÓN** de
   dos formas que no comparten ni un campo opcional, para que «declarar un
   E1 con `TipoImpositivo`» no compile.
3. **`exento ⇒ tax_rate = 0` lo garantiza el motor**, con un CHECK en
   `products` y otro en `ticket_lines`.

---

## 2 · Las reglas de la AEAT, con fuente

Las tres fuentes, consultadas para este bloque y no citadas de memoria:

- **Diseño de registro** `DsRegistroVeriFactu.xlsx`
  (<https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/DsRegistroVeriFactu.xlsx>).
- **`SuministroInformacion.xsd`**
  (<https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SuministroInformacion.xsd>).
- **Validaciones · Sistemas Informáticos de Facturación y Sistemas
  VERI\*FACTU**, versión **1.2.2 (08-04-2026)**
  (<https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Validaciones_Errores_Veri-Factu.pdf>).

### 2.1 · Exactamente UNO de `CalificacionOperacion` / `OperacionExenta`

Lo dicen las dos primeras, y las dos dicen lo mismo.

**Diseño de registro**, hoja `2)D. Registro Facturación Alta`, filas de
`DetalleDesglose`: `CalificacionOperacion¹` y `OperacionExenta¹` comparten
el **fondo coloreado** que la hoja `7)Leyenda` define como

> (Fondo coloreado) | Campo de selección (alternativo)

y los dos llevan el **superíndice 1** de «Campo obligatorio». O sea:
exactamente uno de los dos.

**`SuministroInformacion.xsd`**, `DetalleType` — lo mismo, en código:

```xml
<choice>
  <element name="CalificacionOperacion" type="sf:CalificacionOperacionType"/>
  <element name="OperacionExenta"       type="sf:OperacionExentaType"/>
</choice>
```

Sin `minOccurs`, así que elegir es obligatorio.

**Esta regla no está en el documento de validaciones**, y por eso hizo
falta ir al diseño de registro y al XSD: §15.5 enumera lo que NO se puede
informar con `OperacionExenta` y `CalificacionOperacion` **no está en esa
lista**. Quedarse en las validaciones habría dado un registro con los dos
campos, que el XSD rechaza antes de llegar a ninguna validación de
negocio.

### 2.2 · §15.5 · con `OperacionExenta` no se informan tipo ni cuota

> Si el campo OperacionExenta está cumplimentado no se pueden informar
> ninguno de estos campos: TipoImpositivo, CuotaRepercutida,
> TipoRecargoEquivalencia y CuotaRecargoEquivalencia.

### 2.3 · §15.5 · la lista L10, y **E2/E3 prohibidas en régimen general**

> Si Impuesto = "01" (IVA) o no se cumplimenta (considerándose "01" - IVA),
> el valor de OperacionExenta deberá estar contenido en lista L10.

> Si Impuesto = "01" (IVA), "03" (IGIC) o no se cumplimenta (considerándose
> "01" - IVA), y **ClaveRegimen es igual a "01", no pueden marcarse los
> valores de OperacionExenta "E2" y "E3"**.

**Lista L10** (hoja `6)Listas` del diseño de registro), literal:

| | |
| --- | --- |
| E1 | Exenta por el artículo 20 |
| E2 | Exenta por el artículo 21 |
| E3 | Exenta por el artículo 22 |
| E4 | Exenta por los artículos 23 y 24 |
| E5 | Exenta por el artículo 25 |
| E6 | Exenta por otros |

(El IGIC admite además `E7` y `E8`, §15.5. Este SIF no emite IGIC:
`Impuesto` es siempre `"01"`.)

### 2.4 · §16 y §17 · los totales, y por qué siguen cuadrando

> **§16 CuotaTotal.** Se validará que sea igual a Ʃ (CuotaRepercutida +
> CuotaRecargoEquivalencia) de todas las líneas de detalle de desglose. En
> caso contrario se devolverá un aviso de error (no generará rechazo),
> admitiéndose un margen de error de +/- 10,00 euros.

> **§17 ImporteTotal.** Se validará que sea igual a Ʃ (
> BaseImponibleOimporteNoSujeto + CuotaRepercutida +
> CuotaRecargoEquivalencia) de todas las líneas de detalle de desglose. […]
> margen de error de +/- 10,00 euros.

El tramo exento no informa `CuotaRepercutida`, así que **no suma a
`CuotaTotal`**; sí suma su importe a `ImporteTotal`, por el campo
`BaseImponibleOimporteNoSujeto`, que el diseño de registro describe como
«Magnitud dineraria sobre la que se aplica el tipo impositivo / **Importe
no sujeto**». Los dos se cumplen **exactos**, sin gastar nada del margen.

### 2.5 · §15.7 y §15.8, que no cambian

§15.7 (`[CuotaRepercutida] = ([BaseImponibleOimporteNoSujeto] *
TipoImpositivo) / 100 +/- 10,00 euros`) sigue aplicando **sólo a los tramos
sujetos** — es la regla de ticket-con-iva y sigue con su margen intacto.
§15.8 (`F2`: Ʃ (Base + Cuota) ≤ 3.000,00 €) no se toca.

### 2.6 · Y por qué una factura exenta SÍ se expide

No es una interpretación: es la excepción expresa de la AEAT
(<https://sede.agenciatributaria.gob.es/Sede/iva/facturacion-registro/facturacion-iva/excepciones-obligacion-facturar.html>).
Las operaciones exentas del art. 20 de la Ley 37/1992 están excepcionadas
de la obligación de facturar

> con excepción de las operaciones relacionadas con los **servicios
> sanitarios y de hospitalización**

y a Rosario le vale la factura simplificada (≤ 400 € IVA incluido), que es
la `F2` que este TPV emite.

### 2.7 · Lo que contradice al prompt, y manda la AEAT

El enunciado pedía «modela el dato para que mañana quepan **E2–E6** sin
migración de esquema». **No se puede del todo**: §15.5 prohíbe `E2` y `E3`
con `ClaveRegimen = "01"`, que es la única clave de régimen que este SIF
declara. Un producto marcado así produciría un registro **rechazado**, con
la factura ya entregada.

Así que se parte en dos, y el reparto es el que tiene sentido:

- **La COLUMNA admite los seis** (el CHECK lleva los seis códigos de L10),
  y por tanto no hace falta migración ninguna el día que cambie el régimen.
- **La APLICACIÓN admite cuatro** (`E1`, `E4`, `E5`, `E6`): es quien sabe
  con qué `ClaveRegimen` declara. `normalizeExemptionCause` rechaza `E2` y
  `E3` con una frase que nombra la razón, y `buildDesglose` vuelve a
  comprobarlo como última red (ver §4.3).
- **Y la UI ofrece UNA**, `E1`, que es lo que la decisión 2 del prompt pide.

---

## 3 · Qué cambia

### A · El dato

`packages/db/prisma/migrations/20261007020000_iva_exento_sanitario`. Una
sola migración, aditiva, dos columnas y **cuatro CHECK**:

```sql
ALTER TABLE "products"     ADD COLUMN "exemption_cause" TEXT;
ALTER TABLE "ticket_lines" ADD COLUMN "exemption_cause" TEXT;

-- en las DOS tablas:
CHECK ("exemption_cause" IS NULL
       OR "exemption_cause" IN ('E1','E2','E3','E4','E5','E6'));   -- …_en_l10
CHECK ("exemption_cause" IS NULL OR "tax_rate" = 0);               -- …_sin_iva
```

**Por qué TEXTO VALIDADO y no un `enum`**, que es lo que el enunciado
dejaba elegir: con los seis códigos escritos en el CHECK desde hoy, admitir
una causa nueva de la lista es **desplegar y no migrar**. Un `enum` de
Postgres sólo crece —`ALTER TYPE … DROP VALUE` no existe— y cada valor
nuevo obliga a partir la migración en dos, que es lo que clinica-1, -2 y -3
pagaron tres veces.

**Por qué el CHECK y no un `if`:** hay CUATRO puertas de escritura a
`products` (el alta del panel, la carga de fichero del super-admin, el
upsert del sync de Holded y el `psql` de una implantación) y sólo el motor
cubre las cuatro.

**Y está escrito en los dos sentidos sin querer serlo.** No dice «si hay
causa el IVA es 0»: dice que la PAREJA (causa, IVA≠0) es imposible, así que
también rechaza el camino por el que esto se rompería de verdad — un
`UPDATE` que suba el `tax_rate` de un producto ya marcado. Probado en los
dos órdenes contra Postgres (§5, sabotaje 6).

**El snapshot en la línea** (`ticket_lines.exemption_cause`) es lo que hace
que **lo cobrado no cambie si mañana se edita el producto**. Si Rosario
desmarca «Exento · sanitario» el mes que viene, sus facturas de este mes
siguen diciendo lo que dijeron — y su registro de facturación ya declaró
`OperacionExenta` el día del cobro, así que una reimpresión que leyera el
catálogo de hoy no coincidiría ni con el papel que la paciente tiene en la
mano ni con lo que la AEAT recibió. Misma razón que `nameSnapshot`,
`unitPrice` y `taxRate`.

Ni un `DEFAULT`: «sin causa» **es** el NULL, y un default aquí declararía
exenta alguna operación.

### B · El tramo, que ya no es «por tasa»

`packages/ticket-model/src/exencion.ts` — nuevo. La lista L10 con su
descripción literal, las cuatro que admite el régimen general, la
presentación («Exento · sanitario», «art. 20.Uno.3º Ley 37/1992»),
`claveTramo(rate, causa)` y la leyenda.

`claveTramo` es **LA** clave del tramo en esta casa y la usan los tres
agregadores: `buildTicketDocument` (el documento), `computeCartTaxBuckets`
(el carrito del TPV) y `computeTicket` (el servidor). En `computeTicket` no
hace falta para que los totales salgan bien —un exento y un 0 % sujeto
aportan los mismos cero euros— y está igual **a propósito**: dos funciones
que agrupan la misma venta con claves distintas son el sitio donde, el día
que alguien añada un campo al tramo, lo añada en una sola.

El parámetro de `claveTramo` es `string` y no `CausaExencion`, y también es
deliberado: es una clave de AGRUPACIÓN, no una declaración. Un código que
esta versión del código no reconozca tiene que **seguir separando su
tramo** — colarlo por un `esCausaExencion` y agruparlo como sujeto por no
reconocerlo sería meter una operación exenta en un tramo al 21 %.

### C · El cuadre, y dónde cae el céntimo

`cuadrarDesglose` mantiene **las tres garantías de ticket-con-iva** y añade
dos:

1. `subtotal === Σ buckets[].base`
2. `subtotal + Σ buckets[].tax === total`
3. `total` entra y sale igual
4. **un tramo exento tiene cuota 0 SIEMPRE** y nunca recibe céntimos de
   reparto
5. **con tramo sujeto, el importe exento es exactamente la suma de sus
   líneas** y no se le toca un céntimo

El residuo va donde iba: a las cuotas, que es donde nace el redondeo.

**Lo que hubo que decidir: dónde cae cuando NO hay ningún tramo sujeto.**
No hay ninguna cuota donde ponerlo. Y entonces cae **en el importe del
tramo exento**, que no es una excepción a la regla de la base única sino la
misma regla: en una factura íntegramente exenta `ImporteTotal = Σ
BaseImponibleOimporteNoSujeto` (§17) y **sin margen que gastar porque no
hay cuotas**, así que ese importe TIENE que ser lo que se cobró. Un céntimo
de diferencia entre los 35,00 € que pagó la paciente y los 34,99 €
declarados no es un redondeo: es una factura que no cuadra consigo misma.

El reparto lo hace la misma `repartirCuotas` —resto mayor, y a igualdad de
resto el de mayor importe—, aplicada a las bases.

### D · El registro

`packages/verifactu/src/tipos.ts`: `DetalleDesglose` pasa a ser

```ts
type DetalleDesglose = DetalleDesgloseSujeta | DetalleDesgloseExenta;
```

y las dos mitades llevan `?: never` en los campos de la otra. No es gusto
por los tipos: es la única manera de que **«declarar un E1 con
`TipoImpositivo`» no compile**. Con una interfaz de campos opcionales, un
`E1` con `TipoImpositivo: "0.00"` compilaría, pasaría los tests que miran
importes —porque los importes cuadran— y lo rechazaría la AEAT meses
después, con las facturas ya entregadas. Está probado: el sabotaje 2
necesita un `as never` para siquiera compilar (§5).

Las claves prohibidas van **AUSENTES, no a `undefined`**: lo que se guarda
en `fiscal_records.payload` es lo que V2 serializará a XML sin volver a
tocarlo (FAQ §5), y hay un test que lo comprueba después de un viaje de ida
y vuelta por JSON.

**La huella no cambia de fórmula, y está comprobado y no dicho:** se
calcula sobre ocho campos y ninguno es del desglose. El test construye dos
registros con el mismo `CuotaTotal` y el mismo `ImporteTotal` y desgloses
completamente distintos (uno exento de 35,00 € y otro sujeto al 0 % de
35,00 €) y comprueba que la huella y la cadena de entrada son **idénticas**
— y que el desglose, en cambio, no lo es. Que la huella no distinga esas
dos facturas no es un fallo: es que la AEAT no la hizo depender del
desglose. Lo que las distingue es el registro, que viaja completo.

### E · El papel, por los tres caminos

**Sin tramo exento, el papel no cambia ni un carácter.** Los quince
comercios de hoy entran por la rama de siempre: `IVA X% s/base` +
`Subtotal`. No es prudencia — ticket-con-iva arregló esos dos renglones el
06-10 con el Bar La Maestranza a dos días de desplegar, y volver a moverlos
para un bloque de clínica sería cambiarle el papel a quince clientes por
una razón que no es la suya.

**Con tramo exento**, el del mockup validado:

```
Exento                   35,00 €      ← un renglón por tramo exento
IVA                       0,00 €      ← si NO hay tramos sujetos
Base 21 %                 9,92 €      ← si los hay, dos por tramo
IVA 21 %                  2,08 €
```

**Y no se imprime «Subtotal».** El mockup no lo lleva, y la razón es más
que de maquetación: «Subtotal» es LA BASE IMPONIBLE del documento
(ticket-con-iva), y Σ bases en un papel mixto sumaría una base imponible
con el importe de una operación exenta — `35,00 + 9,92 = 44,92` no es un
número que signifique nada, y un papel fiscal no puede llevar uno. **La
invariante `subtotal === Σ bases` SIGUE cumpliéndose en el dato**
(`cuadrarDesglose` la garantiza y el barrido de mil tickets la fija); lo
que no se hace es imprimirla donde miente.

**La leyenda**, en recuadro y después de los pagos, que es donde la pone el
mockup. No es decoración: el art. 6.1.j) del RD 1619/2012 obliga a
mencionar «la referencia a las disposiciones correspondientes». Tres
formas, las tres del mockup:

- **todo exento** → «Operación exenta de IVA»;
- **mixta con UNA línea exenta** → «Quiropodia: operación exenta de IVA»
  (sin el sujeto delante, una leyenda en un papel con una crema al 21 %
  diría que el ticket entero está exento);
- **mixta con varias** → «Servicios sanitarios: operación exenta de IVA»
  (enumerar tres nombres de tratamiento en 42 columnas no cabe, y
  recortarlos miente más que agruparlos).

**El texto lo redacta `leyendaExencion` una sola vez** para los tres
caminos. Tres redacciones de la misma frase legal acaban discrepando, y la
que el cliente tiene en la mano no sería la que su reimpresión le enseña.

Los tres caminos: **ESC/POS** (`escpos-builder/src/ticket.ts`), **PDF**
(`ticket-pdf/src/render.ts`) y **la vista del histórico**
(`TicketsHistoryPage.tsx`). Esta última nunca ha llevado desglose de IVA y
este bloque no se lo añade: lo que añade es lo que un documento exento no
puede dejar de decir, el tramo y la leyenda. Importa porque **desde esa
ficha se reimprime**: si el térmico lleva la leyenda y la pantalla desde la
que se pide la copia no, el cajero no puede comprobar que lo que va a salir
es lo que tiene que salir.

### F · El editor de catálogo

`apps/admin/src/pages/CatalogoPage.tsx`. El selector de IVA pasa de un
`<select>` a **chips**, que es el selector del mockup validado: la opción
de la exención no es un número —es «Exento · sanitario  art. 20.Uno.3º»— y
eso no cabe en un `<option>` de 90 px al lado del precio. Se conservan los
cuatro tramos peninsulares **y la vía de escape «Otro…»** del addendum 2 de
catalogo-local: sin ella, un comercio canario (IGIC 7 / 3 / 0 %) se queda
sin poder dar de alta su producto.

El chip ancho **sólo aparece con `clinicalRecordsEnabled`**. Un bar no lo
ve: una clínica es un tenant de quince, y un chip de exención sanitaria en
el catálogo de La Maestranza es una invitación a dejar de cobrar el IVA de
las cañas. Y si un producto exento llegara a un comercio sin clínica (no
debería), **el chip se pinta igualmente, marcado, para poder quitarlo**: una
ficha que cobra exento con una pantalla que dice que lleva el 21 % es peor
que una opción de más.

**El rótulo del campo de precio cambia a «Precio»** cuando hay exención.
Con exento no hay «precio con IVA» distinto del precio (decisión 4), y
mantener el rótulo sería volver a poner una etiqueta que no describe el
campo — que es exactamente el bug que catalogo-en-alta vino a arreglar.

Elegir el chip **fuerza `taxRate: 0`** en los tres sitios: la pantalla, la
API (`validateLocalProduct`) y el motor. Tres puertas, una regla.

### G · El cobro de la sesión, y el bono

**La sesión**: `agenda/checkout.ts` lee `exemptionCause` del producto y lo
persiste en la línea del borrador. Es el camino por el que la quiropodia
exenta llega a la caja: la sesión cerrada de clinica-3 dice QUÉ se hizo, y
el catálogo dice con qué fiscalidad se cobra. Comprobado de punta a punta
en `iva-exento-sesion.test.ts` y, de verdad, en el banco visual.

**El pie de la sesión deja de decir «IVA 0 %».** clinica-3 dejó escrito en
su propio código por qué no podía decir «exento» todavía:

> el IVA exento en Verifactu está fuera de alcance (`registro.ts` sigue
> declarando `S1`), así que escribir «exento» en una pantalla cuyo ticket
> va a declarar otra cosa sería escribirlo en el sitio donde más se cree.

Ya no es verdad. `textoDelIva` agrupa ahora por (tipo, causa) —la misma
clave que el desglose— y dice «Exento · sanitario». Es la pantalla donde la
podóloga comprueba lo que va a cobrar, y era el único sitio del producto
que seguía llamando «0 % de IVA» a una exención.

Esto le da a `@mipiacetpv/clinica-sesion` **su primera dependencia de
paquete**: `@mipiacetpv/ticket-model`. Es igual de puro que él —ni Prisma,
ni Fastify, ni React, ni reloj— y es donde vive el vocabulario fiscal de la
casa; la alternativa era una segunda redacción de «Exento · sanitario», y
la lección que ticket-con-iva dejó escrita sobre las tres copias del mismo
redondeo vale igual para las dos copias del mismo rótulo.

**El bono: NO EXISTE, y eso hay que decirlo.** El enunciado pedía
«localiza dónde se vende el bono y que la exención llegue a su línea». No
hay dónde. El módulo de bonos es el bloque **reservas-8** («programa
multisesión»), que está **escrito como prompt y sin implementar**:

- no hay `Tenant.bonosEnabled`, que es el flag de capacidad que su propio
  prompt fija;
- no hay tabla de bonos ni de saldos: lo único que existe es la columna
  reservada `appointments.voucher_id`, que B-reservas-4 dejó puesta con el
  comentario «Canje de bono (B5, fuera de alcance en B4; sólo la columna)»;
- `GET /clients/:id/vouchers` devuelve una lista vacía con contrato estable
  desde B-reservas-1, y nada la rellena.

Lo que este bloque SÍ hace es que **la venta de un bono nazca exenta el día
que exista**, y no es una promesa: es una consecuencia de dónde vive la
causa. La exención es **del producto** (decisión 1), y un bono de sesiones
de un servicio exento se vende como una línea de ticket de ese producto,
por la misma puerta que todas. Hay tres tests que lo fijan —incluido uno
que cobra un «Bono 10 sesiones de quiropodia» por el camino de la agenda y
comprueba que su línea sale con `E1`— y uno que se pondrá **rojo el día
que el módulo de bonos entre en el esquema**, para que quien escriba
reservas-8 tenga que mirar esta conversación.

---

## 4 · Tres cosas que no se ven en el diff

### 4.1 · El `select` que se olvida de una columna

**Un sabotaje no se puso rojo.** Quitar `exemptionCause: true` del `select`
de `print.ts` **compila sin una queja**: el campo es opcional en
`TicketForPrint`, el `as` del final de `loadTicketForPrint` acepta un
objeto al que le falta, y los tests de papel construyen su propia fixture
en vez de pasar por la consulta. Resultado del sabotaje: **la reimpresión
de una factura exenta sale sin su leyenda, y en verde**.

No es un problema de este campo: es la clase de bug de «un `select` se
olvida de una columna», que el typecheck no ve nunca porque un objeto con
menos campos sigue siendo asignable. Hacerlo obligatorio en el tipo no lo
arregla (el `as` lo salta igual).

Se cierra fijando **la CONSULTA**, leyendo la fuente, en los cuatro sitios
por los que la causa viaja (`print.ts`, `tpv-catalog/routes.ts`,
`agenda/checkout.ts`, `catalog/local-products.ts`) — la misma mecánica con
la que los bancos de migración leen el SQL. Y se comprueba que
`build-document.ts` sigue trayendo la línea entera sin enumerar columnas.

### 4.2 · El recuadro del PDF, que lo encontró el bucle visual

La primera versión dibujaba el borde de la leyenda con un **alto FIJO de
dos renglones** en una posición relativa al cursor. En la primera captura
del ticket mixto se ve lo que eso daba: el borde de arriba **pisaba el
separador de los pagos** y el de abajo **cortaba por la mitad la línea del
precepto**.

Ningún test lo veía, y no por descuido: los tres bancos del PDF leen el
TEXTO con `pdf-parse`, y el texto estaba entero. Lo que estaba mal era
dónde se pintaba la caja.

El arreglo calcula el rectángulo de los renglones que va a contener, y
`computeLineCount` reserva el alto con el MISMO `wrapText` que el render.
Queda un test que cubre la mitad que un test puede cubrir: que el alto
crece cuando el título se parte en dos.

### 4.3 · Por qué `buildDesglose` lanza con E2/E3 y eso no tumba una venta

Es la última red del §2.7, y está donde el tope de doce tramos: si llegara,
que se vea al generar y no al remitir seis meses después. **El cobro no se
cae por ello**: `generarRegistroDeVenta` se llama dentro de un `try` que
deja pasar la venta y manda el fallo a Sentry (`CheckoutPage.tsx`). Es la
memoria de la casa — «cobrar siempre se puede»: una invariante rota nunca
tumba una venta, el fallo se ve después del cobro.

Hoy es inalcanzable: la única causa que el catálogo deja guardar es `E1`.

---

## 5 · La tabla de sabotajes

Cada sabotaje se aplicó de verdad sobre la línea de producción (o sobre la
migración, o sobre el motor) y se corrió la suite. Los mensajes son los
reales.

| # | Garantía | Qué se rompe | Qué se pone rojo | Mensaje real |
| - | -------- | ------------ | ---------------- | ------------ |
| 1 | **El tramo es (tasa, causa)** | `claveTramo(line.taxRate, null)` en `build.ts` | `iva-exento-sanitario` · **10 casos** | `expected [ { rate: +0, base: 35, tax: +0 } ] to deeply equal [ { rate: +0, base: 35, …(2) } ]` |
| 2 | **Un E1 no lleva `TipoImpositivo`** | añadir `TipoImpositivo` y `CuotaRepercutida` al detalle exento | **no compila**; con `as never`, 5 casos | `Type 'string' is not assignable to type 'undefined'` · `expected { Impuesto: '01', …(5) } to deeply equal { Impuesto: '01', …(3) }` |
| 3 | **La leyenda en el térmico** | `if (false && leyenda)` en `escpos-builder/ticket.ts` | `iva-exento-sanitario` · 3 casos | `expected '…' to contain 'Operación exenta de IVA'` |
| 4 | **…y en el PDF** | lo mismo en `ticket-pdf/render.ts` | `iva-exento-pdf` · 2 casos | `expected '…PODOLOGÍA ROSARIO…' to contain 'Operación exenta de IVA'` |
| 5 | **…y en el histórico** | `if (leyenda) return null` en `TicketsHistoryPage.tsx` | `iva-exento-historico` · 5 casos | `the given combination of arguments (null and string) is invalid` |
| 6 | **El CHECK «exento ⇒ sin IVA»** | quitarlo de la migración | `iva-exento-sanitario.e2e` · 3 casos | `El motor ACEPTÓ lo que no debía: INSERT INTO products …` y `… UPDATE products SET tax_rate = 21 WHERE id = …` |
| 7 | **El bono y la sesión heredan la exención** | `exemptionCause: null` en `agenda/checkout.ts` | `iva-exento-sesion` · 3 casos (uno es el del bono) | `expected null to be 'E1'` |
| 8 | **El pie de la sesión no dice «IVA 0 %»** | agrupar sólo por tasa en `textoDelIva` | `iva-exento-sesion` · 1 caso | `expected 'Exento · sanitario' to be 'IVA según cada tratamiento'` |
| 9 | **El chip sólo con clínica** | `const puedeExencion = true` | `iva-exento-catalogo` · 1 caso | `expected <button …> to be undefined` |
| 10 | **El céntimo no cae en el tramo exento** | repartir también entre los exentos | `iva-exento` + `iva-exento-sanitario` · 3 casos | `#15 cuota exenta: expected -0.01 to be +0` |
| 11 | **El papel exento no imprime «Subtotal»** | volver a imprimirlo | `iva-exento-sanitario` · 1 caso | `expected '…' not to contain 'Subtotal'` |
| 12 | **Los `select` no se olvidan del snapshot** | quitar `exemptionCause: true` de los cuatro | `iva-exento-sanitario` · 4 casos | `expected '// v1.4-Impresoras-Fase-1 …' to contain 'exemptionCause: true'` |

El 12 es el que **no se puso rojo a la primera** y de ahí salió el test de
§4.1. Los demás estaban cubiertos desde el principio.

---

## 6 · Los tests

**Ocho bancos nuevos en la suite (122 tests) y uno en la e2e (13).**
Suite: **303 ficheros, 3.572 verdes** y 3 saltados (antes del bloque: 295
ficheros, 3.450). E2E: **29 ficheros, 485 verdes**.

Y tres tests que YA EXISTÍAN se reescriben, no se borran:
`catalogo-local-pantalla.test.tsx` fijaba el `<select>` de IVA por su `id`.
Lo que comprobaban —los cuatro tramos peninsulares, la vía de escape del
IGIC y que un tipo fuera de rango no llega a la API— **no cambia**; sólo
cómo se toca. Los chips se localizan por `[role="group"][aria-label="IVA"]`
y no por una clase: lo que se fija es lo que un lector de pantalla y un
dedo encuentran, no el Tailwind de este mes.

| Fichero | Qué fija |
| ------- | -------- |
| `apps/api/test/iva-exento-migracion.test.ts` | El contrato del SQL: aditiva, las columnas sin `DEFAULT`, los cuatro CHECK, la lista L10 entera y que los de las dos tablas son literalmente el mismo. |
| `apps/api/test/iva-exento-sanitario.test.ts` | **La cadena entera** con las funciones de verdad: `validateLocalProduct` → `computeTicket` → `buildTicketDocument` → `cuadrarDesglose` → `buildRegistroAlta` → `buildTicketReceipt`. Los dos tickets del mockup, el 0 % sujeto que no se mezcla, los cuatro `select` y la etiqueta duplicada del panel. |
| `packages/ticket-pdf/test/iva-exento-pdf.test.ts` | El ticket digital, leído con `pdf-parse`. Incluye que la página no sale cortada y que el recuadro crece con el título. |
| `apps/tpv-web/test/iva-exento-historico.test.tsx` | La vista del histórico: el tramo, la leyenda, y que un código fuera de L10 **no** pinta leyenda. |
| `packages/verifactu/test/iva-exento-registro.test.ts` | El `DetalleDesglose` exento, el `@ts-expect-error` que impide mezclar las formas, E2/E3, §16, §17 y **que la huella no cambia de fórmula**. |
| `packages/ticket-model/test/iva-exento.test.ts` | La lista L10 literal, la clave del tramo, la leyenda en sus cuatro formas, el cuadre, y un **barrido de 1.000 tickets** con siete invariantes. |
| `apps/admin/test/iva-exento-catalogo.test.tsx` | El chip: que **sólo** existe con clínica, que fuerza el 0 % incluso viniendo de «Otro… 7», que al desmarcarlo manda `null` y no `undefined`, y que la fila del listado no dice «IVA 0%». |
| `apps/api/test/iva-exento-sesion.test.ts` | El cobro de la sesión de clinica-3, el pie de la sesión, y el bono (que no existe). |
| `apps/api/test-e2e/iva-exento-sanitario.e2e.ts` | **Lo que el motor rechaza**, por SQL crudo: los dos sentidos del CHECK, la lista L10, que el 0 % sujeto sigue siendo legal, que los CHECK están `convalidated` y que el snapshot sobrevive a editar el producto. |

El barrido de mil tickets sigue el patrón de ticket-con-iva: LCG
determinista y calentado, y **un test que comprueba que el barrido es
variado de verdad** (más de 600 con tramo exento, más de 400 mixtos, más de
30 íntegramente exentos y más de 100 con céntimo residual). Sin ese
segundo test, el barrido pasaría con cualquier implementación.

---

## 7 · El bucle visual

`docs/qa/2026-10-07-iva-exento-sanitario`, con su README. Contra la stack
de verdad y sobre la clínica del banco, con base y Redis propios de este
worktree.

Los dos tickets **no son maquetas**: se cobraron tecleando el PIN en el
TPV y salen del `POST /tickets/:id/print/escpos` y del
`GET /tickets/:slug/pdf` de la API. Los registros de facturación de §0 son
los que esas dos ventas dejaron en `fiscal_records`.

El banco de la clínica (`apps/e2e-ui/seed/clinica-demo.ts`) gana lo que
hacía falta para poder mirarse, y las cuatro cosas eran deudas suyas:

- la **quiropodia exenta a 35 €** (el ticket del mockup; antes 30 € sin
  causa);
- una **crema al 21 %**, sin la cual el ticket mixto no existe;
- el catálogo en **`source = LOCAL`**, que es lo que una clínica sin Holded
  tiene de verdad — con el `HOLDED` por defecto el panel los listaba pero
  **no ofrecía editarlos**, así que la pantalla que este bloque cambia no se
  podía ni abrir;
- la **cabecera fiscal** (`fiscalProfile`), sin la cual el papel de un
  comercio que emite sus propias facturas salía con la razón social y el
  NIF vacíos.

---

## 8 · Al desplegar

**Hay migración.** Aditiva, y las dos columnas nacen NULL, así que los
quince tenants de hoy no cambian de comportamiento: cero productos con
causa, cero líneas con causa, y los cuatro CHECK se cumplen trivialmente en
todas las filas existentes.

**No añade ninguna variable de entorno.**

```bash
# 1 · merge a master (en el repo principal)
git checkout master && git pull --ff-only && git merge --no-ff iva-exento-sanitario && git push

# 2 · deploy (en el servidor, con el sha corto del commit de master)
cd /opt/mipiacetpv && IMAGE_TAG=<sha-corto-de-master> bash infra/deploy.sh

# 3 · health
curl -fsS https://api.mipiacetpv.com/health | jq .
```

**Ojo con el CHECK de `ticket_lines`:** `ADD CONSTRAINT … CHECK` hace un
seq scan de validación con `SHARE ROW EXCLUSIVE` sobre la tabla más grande
del esquema. Se acepta sin `NOT VALID` porque en el parque de hoy son
decenas de miles de filas (segundos) **y porque un CHECK `NOT VALID` no
comprueba las filas viejas** — que es justo lo que aquí interesa dejar
demostrado: ni una línea histórica se contradice. Si el parque creciera un
orden de magnitud, esto habría que partirlo en `NOT VALID` + `VALIDATE
CONSTRAINT`.

**Vuelta atrás:** `IMAGE_TAG=<sha-anterior> bash infra/deploy.sh`, y **sin
tirar la migración**. Las columnas vacías no molestan a la imagen anterior,
y tirarlas dejaría de poder explicar una factura exenta ya emitida —
`fiscal_records` es append-only y el registro de esa venta ya declaró su
`OperacionExenta` el día que se cobró.

**El humo, después del deploy (sin ventas reales):**

1. Entrar al panel con un comercio **sin clínica** (el Bar La Maestranza),
   Catálogo → Editar un producto. **Qué se mira:** los chips de IVA están
   (21 / 10 / 4 / 0 / Otro…) y **no hay chip de exención**; el campo dice
   «Precio con IVA».
2. Reimprimir desde el panel un ticket cualquiera de ese comercio.
   **Qué se mira:** el papel es **byte a byte** el de antes del deploy —
   `IVA X% s/base` y `Subtotal`.
3. Con la clínica piloto ya dada de alta: Catálogo → Editar el servicio
   sanitario. **Qué se mira:** el chip «Exento · sanitario  art.
   20.Uno.3º», el aviso verde, y el rótulo «Precio».

---

## 9 · Lo que este bloque NO hace

- **No existe el bono.** Ver §3.G: reservas-8 no está implementado. Lo que
  hay es la invariante y tres tests que la fijan.
- **No toca el modo VERI\*FACTU del comercio, ni el QR, ni la remisión.**
  El QR del mockup es un dibujo; el papel sigue sacando el QR y las
  leyendas que ya sacaba según el modo del comercio.
- **No mapea exenciones hacia Holded.** En comercios con Holded el IVA
  viene de Holded. La clínica piloto va sin Holded.
- **No hace factura completa (F1)** con NIF y domicilio del paciente. Es el
  bloque siguiente, y es lo que hace falta cuando la factura pasa de 400 €.
- **No toca las rectificativas.** Una devolución crea `RefundLine`, que es
  otra tabla y guarda su propio snapshot con FK a la línea original, así
  que la exención de lo devuelto sigue siendo recuperable. El registro de
  rectificación es V3.
- **No toca `tables/operativa.ts`** (las líneas de mesa del modo bar). Una
  clínica no usa mesas; el día que haga falta, la columna y el CHECK ya
  están y lo que falta es pasar el campo. **Anotado.**
- **No cambia el «Subtotal» que ve el cajero en pantalla.** Sigue siendo
  `round2(Σ netos crudos)`, como lo dejó ticket-con-iva. El papel es el que
  tiene que cuadrar, y cuadra.
- **No toca producción ni datos, y no ha hecho ninguna venta real.** Las
  dos ventas del bucle visual están en la base desechable del banco.

---

## 10 · Ficheros

```
packages/ticket-model/src/exencion.ts        nuevo · la lista L10, la clave del tramo, la leyenda
packages/ticket-model/src/desglose.ts        el tramo (tasa, causa) y dónde cae el céntimo
packages/ticket-model/src/build.ts           agrupa por tramo; el snapshot de la línea
packages/ticket-model/src/types.ts           TicketLine/TicketTaxBucket.exemptionCause
packages/ticket-model/src/schema.ts          la causa validada contra L10
packages/ticket-model/src/index.ts           exporta exencion.ts
packages/verifactu/src/tipos.ts              DetalleDesglose como UNIÓN; L10 del régimen general
packages/verifactu/src/registro.ts           buildDesglose emite las dos formas
packages/verifactu/src/index.ts              los tipos nuevos
packages/escpos-builder/src/ticket.ts        el desglose exento y la leyenda en recuadro
packages/escpos-builder/src/venta-local.ts   la causa viaja al papel sin red
packages/ticket-pdf/src/render.ts            lo mismo en el PDF, con el recuadro bien puesto
packages/clinica-sesion/src/sesion.ts        el pie de la sesión dice «Exento · sanitario»
packages/clinica-sesion/package.json         su primera dependencia: ticket-model
packages/db/prisma/schema.prisma             las dos columnas, con sus CHECK documentados
packages/db/prisma/migrations/20261007020000_iva_exento_sanitario/
apps/api/src/catalog/local-product-rules.ts  normalizeExemptionCause + «exento ⇒ 0 %»
apps/api/src/catalog/local-products.ts       el PATCH que no reinterpreta el campo no tocado
apps/api/src/tpv-catalog/routes.ts           la causa llega al carrito del TPV
apps/api/src/agenda/checkout.ts              la línea de la sesión hereda la exención
apps/api/src/clinica/tratamientos.ts         la causa llega al pie de la sesión
apps/api/src/tickets/totals.ts               computeTicket agrupa por (tasa, causa)
apps/api/src/tickets/routes.ts               POST /tickets persiste el snapshot; el serializador
apps/api/src/tickets/print.ts                el select del papel pide la causa
apps/api/src/tickets/escpos-input.ts         la causa llega a la línea del térmico
apps/api/src/tickets/build-document.ts       la causa llega al PDF
apps/admin/src/pages/CatalogoPage.tsx        los chips, el chip ancho y el rótulo del precio
apps/tpv-web/src/lib/cart.ts                 CartLine.exemptionCause; el tramo del carrito
apps/tpv-web/src/lib/catalog.ts              CatalogProduct.exemptionCause
apps/tpv-web/src/lib/fiscal.ts               la causa entra en el registro
apps/tpv-web/src/pages/SalePage.tsx          del catálogo a la línea del carrito
apps/tpv-web/src/pages/CheckoutPage.tsx      al POST y al papel sin red
apps/tpv-web/src/pages/TicketsHistoryPage.tsx el tercer camino
apps/e2e-ui/seed/clinica-demo.ts             el escenario del banco
```
