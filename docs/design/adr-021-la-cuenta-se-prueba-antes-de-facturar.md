# ADR-021 · Una cuenta se prueba antes de facturar, y se puede dar de baja

_2026-10-17. Decide cómo un comercio prueba su TPV **en su propia cuenta y en su propio aparato**
sin emitir ni una factura, cómo se deja eso a cero las veces que haga falta, cómo empieza a
facturar, y cómo se elimina la cuenta de un cliente que se va. Es el escalón que
[ADR-019](./adr-019-cada-caja-es-un-sif.md) dejó pendiente: allí cada caja pasó a ser un SIF y
cada venta a llevar su registro; aquí se decide **desde cuándo**._

---

## 0. Tesis en una frase

«Activada» y «facturando» eran la misma cosa y no lo son: entre las dos hay un **ensayo** —el TPV
funciona entero y nada de lo que cobra es una factura— y lo que lo distingue es una columna,
`fiscal_go_live_at`, cuya ausencia significa «todavía no». De ahí se sigue todo lo demás: antes
de arrancar **no hay ningún registro fiscal que borrar**, así que resetear el ensayo no toca
nunca `fiscal_records` y el append-only de ADR-019 sigue sin puertas.

## 1. Contexto

Tres hechos, con fecha:

- **06-10-2026, La Maestranza.** La auditoría del AP13 se hizo cobrando sobre la cuenta ya
  activada. Las facturas `C1/000002` y `C1/000003` **no se pueden borrar** —`fiscal_records` es
  append-only (ADR-019 §4)— y hubo que montar una cuenta nueva desde cero esa misma noche. La
  regla que salió de ahí fue «después de activar, nadie prueba en la cuenta», y es una regla que
  se cumple hasta que alguien tiene prisa.
- **17-10-2026, Cafetería Sirope.** Cuenta ACTIVE desde junio, sin una sola venta real, fuera de
  Holded desde el 13-10. Queríamos ver su TPV de verdad en un terminal físico —su catálogo, su
  sala, su cobro— antes de la visita, y **no había forma**: «Probar TPV» sólo funciona en DRAFT y
  sólo en el navegador, y cualquier cobro desde un terminal emparejado habría sido la factura
  `C1/1` real de la titular.
- **Siempre.** Cuentas nuestras de pruebas y de desarrollo que no se pueden limpiar, y clientes
  que se van sin que exista «eliminar cuenta» — con lo que seguimos siendo responsables de datos
  que ya no tenemos por qué tener (art. 17 RGPD).

`verifactu-1b` ya había resuelto una parte del problema: la sesión del **modo prueba** no emite,
y lo que decide es el `purpose: test-cashier` del JWT. Pero eso es una sesión del super-admin en
un navegador. Lo que hacía falta es que **la cuenta entera** esté en ensayo, para que pueda
probarla la cajera, con su PIN, en el terminal del cliente. Este ADR es esa generalización.

## 2. Lo que NO se decide aquí (frontera dura)

**La remisión de registros a la AEAT** (V2 de verifactu) y las **rectificativas** (V3). El QR
tributario sigue apagado por la decisión del 15-10 (`QR_TRIBUTARIO_EN_FACTURA`). El **alta de
cuentas** (`POST /activate`) no se reorganiza: sigue creando el propietario y sigue siendo lo
que hace que la cuenta pase de DRAFT a ACTIVE. Y la **destrucción de una historia clínica**: ver
§6.

## 3. Decisión: una fecha, no un estado más

**Alternativas descartadas:**

| Alternativa | Por qué no |
|---|---|
| Un tercer valor en `onboardingState` (`DRAFT` / `ENSAYO` / `FACTURANDO`) | Mezcla dos preguntas que tienen respuestas independientes: «¿hay propietario?» y «¿esto son facturas?». Una cuenta en ensayo tiene propietario, catálogo y terminal — es ACTIVE en todo lo que ese enum significa hoy. Y obligaría a repasar los `if (onboardingState === "ACTIVE")` de todo el código. |
| Un booleano `facturando` | No contesta «¿desde cuándo?», que es justo lo que hace falta para el backfill (los comercios de hoy facturan desde su primera factura, no desde que se despliegue esto) y para el panel. |
| Deducirlo de `count(fiscal_records) > 0` | Circular y falso por los dos lados: un comercio con Holded no tiene registros y factura, y un comercio que acaba de arrancar no tiene registros **todavía**. Además ataría el camino de cobro a un `count()` por venta. |
| Deducirlo de «tiene ventas reales» | Es la regla del **backfill**, no del estado. Como estado haría que la primera venta real decidiera retroactivamente que la cuenta ya facturaba. |

**Decisión:** `Tenant.facturaDesde DateTime? @map("fiscal_go_live_at")`, nullable y **sin
default**.

- `null` → **EN ENSAYO.** Se vende con normalidad desde cualquier terminal y con cualquier
  cajero (mesas, comanda, cobro, devolución, arqueo, cierre), pero todo ticket nace `TEST`, no
  sube a Holded, no manda email y **no lleva registro fiscal**: `GET /tpv/fiscal/head` contesta
  `emite: false` y el servidor descarta cualquier registro que llegue.
- con fecha → **FACTURANDO.** Exactamente lo de siempre.

Y `Tenant.esDePruebas Boolean @default(false)`: las cuentas del equipo (PRUEBAS MIPIACE, la de
ensayo de La Maestranza) **no pueden arrancar nunca** y se resetean cuando haga falta. Su
invariante vive en la base: `tenants_pruebas_no_facturan_ck`.

### 3.1 `facturaDesde` es OBLIGATORIO en `TenantFiscalMode`

No es opcional, y eso es parte de la decisión. Si fuera `facturaDesde?: Date | null`, un `select`
nuevo que se olvidara de la columna leería «en ensayo» en un comercio que está facturando — y sus
ventas nacerían `TEST`, no subirían a Holded y no llevarían registro, **todo en silencio**. Que
lo pida el compilador es la garantía de que ningún camino de cobro lo olvide; al introducirlo
cazó los dos únicos sitios donde faltaba. Es el mismo criterio con el que `destination` es
obligatorio en `shouldEnqueueHoldedUpload` (ADR-017 addendum 3).

### 3.2 El ensayo entra en `emiteMipiacetpv`, no en cada llamante

Son cinco los sitios que preguntan quién emite: el head del terminal, las dos rutas de anulación,
el gate de la venta y el panel del super-admin. Si el ensayo fuera un `if` suelto en cada uno, el
sexto que llegue lo olvidaría. Lo que **sí** va en el llamante es el mensaje: «aquí no se emite
porque factura Holded» y «porque esta cuenta no ha arrancado» no se cuentan igual, y las rutas de
anulación las distinguen antes de llamar (`TENANT_EN_ENSAYO`, no `FISCAL_MODE_OFF`).

## 4. Decisión: el ensayo se DESCARTA, no se rechaza

Un registro de facturación que llegue de una cuenta en ensayo **se descarta y la venta sigue**.
Ni 409 ni ingesta. Es exactamente el criterio del addendum 1b de verifactu, por la misma razón:
el ensayo existe para validar el flujo de cobro en el aparato del cliente, y un 409 lo dejaría
sin poder cobrar por un dato que sobra. **Cobrar siempre se puede.**

Las dos rutas de **anulación** sí rechazan con 409. La asimetría es la de siempre: una anulación
no cobra a nadie, así que rechazarla no deja a nadie sin poder cobrar.

## 4.b Decisión: una venta ANULADA no es una venta real

Añadido el 18-10, tras la foto de producción. El backfill (regla 3.b) y el guardián del reseteo
comparten una definición, y es ésta:

```
venta real  =  no es DRAFT, ni TEST, ni VOIDED
            OR  tiene holded_document_id
```

La primera versión contaba las anuladas («se cobró y se anuló después, pero el día que esta cuenta
empezó a facturar ya había pasado»). **Cafetería Sirope** enseñó que es falso: 20 tickets `VOIDED`
—16 del cajero de pruebas, 4 de la demostración con la dueña—, ninguno en Holded, y una cuenta que
no ha vendido nunca. Con la regla vieja habría arrancado a facturar sola en el despliegue.

`VOIDED` no dice «se cobró»: dice «esto no cuenta». Lo que sí demuestra que un comercio facturó,
aunque el ticket esté anulado después, es `holded_document_id` — lo escribe el worker cuando Holded
**crea** el documento, así que existió una factura con número en la contabilidad del cliente y
anular el ticket aquí no la deshace.

## 5. Decisión: el reseteo se lleva TODOS los tickets, y no puede borrar una factura

Resetear el ensayo borra **todos los tickets de la cuenta** —`TEST`, `VOIDED`, `DRAFT` y cualquier
otro— y lo que cuelga de ellos, los turnos con sus arqueos y sus informes Z, las agrupaciones de
mesas y el contador de referencia interna de cada caja. **Conserva** el catálogo, la sala, los
cajeros, los terminales, las impresoras, los datos fiscales y los contactos.

**Todos, y no sólo los `TEST`**, porque en una cuenta en ensayo nada es real: es la invariante de
este ADR. Un reseteo por estados deja dentro justo lo que ensucia —las anuladas de una
demostración, un borrador a medias— y el cliente se lo encuentra el día que empieza.

Con su puerta, que va **antes de borrar una sola fila**: si algún ticket tiene
`holded_document_id` o un registro fiscal detrás, no se borra nada y se contesta 409
`VENTA_REAL_EN_ENSAYO` **diciendo cuál**. Y la última puerta en la base: la excepción que el
guardián del sello (S1) necesita para dejar borrar un ticket sellado son **tres condiciones**
—la cuenta no factura, el ticket no tiene registro fiscal, el ticket no llegó a Holded—, no «la
cuenta está en ensayo, borra lo que sea».

Lo que lo hace limpio no es que esté bien escrito: es que **antes de arrancar `fiscal_records`
está vacía**. El reseteo no toca esa tabla en ninguna línea, y no podría —el trigger
`fiscal_records_append_only` sigue intacto—. Lo que la Ley Antifraude prohíbe (borrar facturas y
seguir facturando en la misma serie) no puede pasar aquí por construcción.

Y con la cuenta facturando, el reseteo contesta **409 `TENANT_FACTURANDO`**. No hay camino, ni
con flag de entorno: con una factura emitida detrás, borrar tickets es borrar contabilidad.

### 5.1 Arrancar es irreversible, y lo hace el super-admin

Cuatro precondiciones, comprobadas **dentro** de la transacción: que ninguna caja tenga registros
fiscales, que los datos fiscales estén completos (razón social y NIF válido), que haya al menos
un terminal emparejado —el registro lo genera el terminal (ADR-019), así que una cuenta sin
ninguno no puede emitir— y que no sea una cuenta de pruebas. Devuelve **todos** los bloqueos, no
el primero: quien está delante del cliente los resuelve de una pasada.

El orden es: resetear, comprobar, fijar la fecha. Resetear **antes** y no después, porque lo que
quedara sin borrar pasaría a ser histórico de un comercio que factura — y entonces ya no se puede
borrar sin tocarle la contabilidad.

No hay botón de deshacer, y no lo hay por construcción: quitar la fecha dejaría a un comercio con
facturas emitidas **y** en ensayo, que es el único estado en el que el reseteo borraría
facturación. El CHECK de la base y el 409 son las dos cerraduras de esa puerta.

## 6. Decisión: eliminar una cuenta pasa por el append-only con una marca que NOMBRA al tenant

El problema es un círculo: `fiscal_records` sólo deja borrar «si el tenant ya no existe» (la
escapatoria de la cascada, ADR-019 §4), y el tenant no se puede borrar primero porque una docena
de claves ajenas son `RESTRICT`.

**Alternativas descartadas:**

| Alternativa | Por qué no |
|---|---|
| Una columna `tenants.eliminando` que el trigger mire | Es un estado persistente: se puede quedar puesto. Un bug, un `UPDATE` a mano o una transacción que muere y la puerta queda abierta sin que nadie lo vea. |
| Una variable de entorno / un flag de la aplicación | Lo mismo pero peor: abre la puerta para todos los tenants a la vez y durante todo el proceso. |
| `ALTER TABLE … DISABLE TRIGGER` dentro de la transacción | Desactiva el guardia **entero** —también para las filas de otros comercios de la misma transacción— y requiere ser dueño de la tabla. Es un interruptor, que es justo lo que no queremos. |
| `DELETE FROM tenants` y confiar en el orden de las cascadas | El orden entre cascadas hermanas no está garantizado, y la FK `RESTRICT` de `fiscal_records.ticket_id` rebota. Probado: falla. |

**Decisión:** una marca de **transacción** que nombra al tenant,
`SET LOCAL mipiacetpv.eliminar_tenant = '<uuid>'`, leída por los cinco guardias que hacen falta a
través de una única función, `mipiacetpv_eliminando_este_tenant(uuid)`. Cinco propiedades, y las
cinco son el motivo de que esto **no** sea una puerta para borrar facturas:

1. **Nombra al tenant.** Autoriza las filas de ese comercio y de ningún otro.
2. **Es `SET LOCAL`.** Muere con la transacción; fuera de una transacción no hace nada, así que el
   descuido deja el guardia **cerrado**.
3. **Sólo `DELETE`.** Ni un `UPDATE`: una huella no se reescribe en ninguna circunstancia.
4. **Es todo o nada.** La única operación que la usa termina en `DELETE FROM tenants`. No existe
   ningún camino que borre un registro y deje la cuenta viva.
5. **Deja rastro antes de empezar.** El borrado exige que el **export** esté descargado, y lo
   comprueba contra el registro de auditoría del super-admin — no contra la pantalla.

### 6.1 El export es una precondición, no un consejo

Un ZIP con los registros de facturación enteros (huella, huella anterior, la cadena exacta sobre
la que se calculó y el payload del terminal), las ventas, las devoluciones, los fichajes y la
**comprobación de integridad** pedida al propio motor. Es lo que el titular tiene que conservar
cuatro años (arts. 66 y 70 LGT; art. 34.9 ET para el registro de jornada), y después de eliminar
la cuenta es la única copia que existe.

### 6.2 Lo que NO se elimina desde aquí

Una cuenta con **historia clínica** o con **residentes**. Las tablas de clinica-1 y de
residencia-1 no tienen ninguna escapatoria en sus triggers, y **no se les añade**: una historia
clínica se conserva por la Ley 41/2002 y su destrucción es una decisión con su propio marco legal
y su propio bloque. La eliminación se bloquea con el motivo escrito; el export sí funciona, y
para el centro clínico ya existe su propia devolución de datos (art. 28.3.g,
`clinica/exportacion.ts`).

## 7. Consecuencias

**Lo que cambia para quien ya factura:** nada. El backfill le pone a cada comercio con facturas
emitidas la fecha de su primera factura, y a cada comercio con ventas reales la de su primera
venta. Sole y Cachitos siguen exactamente igual.

**Lo que cambia en la implantación:** la regla «después de activar, nadie prueba en la cuenta» se
sustituye por un guion —probar, resetear, arrancar— en
`docs/implantaciones/como-se-pone-en-marcha-un-comercio.md`. Activar ya no es empezar a facturar.

**Lo que cambia en «Probar TPV»:** deja de exigir DRAFT y pasa a exigir **ensayo**. Lo que sigue
cerrado es probar sobre la operación real de un cliente que factura.

**Lo que este ADR deja pendiente:** en ensayo no se puede ensayar un **fiado** (el ticket nace
`TEST` antes de llegar a `ON_CREDIT`), y un cobro de ensayo **sin red** no saca papel, porque el
camino local exige un registro de facturación que en ensayo no existe. Las dos cosas están
medidas y dichas en el `-done`; ninguna bloqueaba la visita del 17-10.
