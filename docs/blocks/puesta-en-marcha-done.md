# puesta-en-marcha · se prueba en la cuenta real, se resetea y se arranca — DONE

_Rama `puesta-en-marcha`, commits pequeños en español: siete del bloque, tres de arreglo (los dos que salieron por el camino y el tope de las transacciones) y los de documentación. ADR-021. 2026-10-17/18._

Lo que había que poder hacer y no se podía: **llegar a un cliente con su TPV probado en su propia
cuenta y en su propio aparato**. Hasta este bloque, «activada» y «facturando» eran la misma cosa,
así que el primer cobro de ensayo en la cuenta de la titular era ya su factura `C1/1` — y una
factura emitida no se borra (La Maestranza, 06-10: cuenta nueva desde cero esa misma noche).

Ahora una cuenta se prueba entera en el hierro del cliente, se resetea las veces que haga falta y
**arranca a facturar con un botón**, con la serie en `C1/1`.

---

## 0 · Lo primero, porque cambia cómo se lee todo lo demás

**Este bloque no abre ninguna puerta para borrar facturas, y no por cuidado: por construcción.**

Antes de arrancar, `fiscal_records` está **vacía**. El reseteo del ensayo no toca esa tabla en
ninguna línea de código, y no podría: el trigger `fiscal_records_append_only` sigue exactamente
como lo dejó verifactu-1. Lo que la Ley Antifraude prohíbe —borrar facturas y seguir facturando
en la misma serie— no puede ocurrir aquí porque la factura no existía.

La **única** operación de la casa que borra un registro de facturación es la eliminación de la
cuenta entera (§6), y pasa por el append-only con una marca de transacción que **nombra al
tenant**, sólo autoriza `DELETE`, muere con la transacción y termina en `DELETE FROM tenants`.
El e2e lo sabotea por los tres lados: a pelo, con la marca de otro tenant y con un `UPDATE`.

---

## 1 · Lo que hay ahora

### 1.1 La forma final del dato

```prisma
model Tenant {
  // puesta-en-marcha (ADR-021) · DESDE CUÁNDO factura esta cuenta.
  facturaDesde DateTime? @map("fiscal_go_live_at") @db.Timestamptz()
  // ¿es una cuenta NUESTRA de pruebas? No arranca nunca.
  esDePruebas  Boolean   @default(false) @map("es_de_pruebas")
}
```

```sql
ALTER TABLE tenants ADD CONSTRAINT tenants_pruebas_no_facturan_ck CHECK (
  es_de_pruebas = false OR fiscal_go_live_at IS NULL
);
```

El `IS NOT NULL` no está escrito a ojo: un CHECK que evalúa a NULL **pasa**, así que el predicado
se escribe en positivo para que las tres combinaciones den `true` o `false` y ninguna NULL.

- `facturaDesde = null` → **EN ENSAYO**. Se vende entero; nada es una factura.
- con fecha → **FACTURANDO**. Lo de siempre.

### 1.2 Qué pasa en una cuenta en ensayo, en orden

1. `GET /tpv/fiscal/head` → `{ emite: false, ensayo: true }`. Sin serie, sin número de
   instalación y sin cabeza de cadena: **el terminal no genera nada y no gasta número**. Éste es
   el corte de verdad.
2. Si llega un registro igual (APK vieja, outbox con cola de antes), el servidor lo **descarta** y
   la venta sigue. Cobrar siempre se puede. Queda en el log como
   `fiscal.registro_de_prueba_descartado`.
3. El ticket nace `TEST` al cobrar, en los dos caminos (venta rápida y cobro de mesa). No sube a
   Holded y no manda email: eso ya lo hacía `TEST`.
4. Las dos rutas de anulación contestan **409 `TENANT_EN_ENSAYO`** — código propio, no el del modo
   prueba: lo que hay que hacer es distinto (pulsar «Empezar a facturar», no salir de un modo).
5. El TPV pinta una banda fija («ENSAYO · estos cobros no son facturas») encima de todas las
   pantallas con cajero dentro, el papel y el PDF salen con «TICKET DE PRUEBA · SIN VALIDEZ
   FISCAL» en cabecera, y el panel del propietario lleva su propia banda azul.

### 1.3 Las rutas del super-admin

| Ruta | Qué hace |
|---|---|
| `GET …/puesta-en-marcha` | El plan: estado, qué se borraría con sus números, qué se conserva con los suyos, cómo están las cajas, y qué impide arrancar. Sólo lee. |
| `POST …/resetear-ensayo` | Borra el ensayo. **409 `TENANT_FACTURANDO`** si ya factura. |
| `POST …/empezar-a-facturar` | Resetea, comprueba las cuatro precondiciones y fija la fecha. Una vez. |
| `GET …/eliminar-cuenta` | El plan de la baja, y si el export está descargado. |
| `GET …/export.zip` | El paquete que se le entrega al titular. Queda en el audit. |
| `POST …/eliminar-cuenta` | Borra la cuenta entera. Exige el export. |

Las tres que ESCRIBEN piden **teclear el nombre del comercio**, como «Dejar Holded» (ADR-020), y
las tres quedan en el registro de auditoría del super-admin con la foto de lo que había. El export
también deja su apunte, porque ese apunte es lo que habilita la baja (§6.2).

---

## 2 · La migración y su backfill

Dos migraciones aditivas:

- `20261017000000_puesta_en_marcha` — las dos columnas, el CHECK y el backfill.
- `20261017010000_eliminar_cuenta` — la escapatoria de los cinco guardias (§6).

### 2.1 Las tres reglas del backfill

| Regla | Qué hace | A quién afecta |
|---|---|---|
| 3.a | Tiene registros fiscales → factura desde `min(fecha_expedicion)` | el que ya emite con nuestro TPV |
| 3.b | Tiene ventas reales (ni `DRAFT` ni `TEST`) → factura desde `min(paid_at)` | Sole, Cachitos y cualquiera con Holded |
| 3.c | Cuenta nuestra de pruebas → `es_de_pruebas = true`, en ensayo | PRUEBAS MIPIACE, ensayo de La Maestranza |
| 3.d | Ni registros ni ventas reales → se queda en ensayo (`null`) | Sirope, Fouzia, La Maestranza real, Rosario, Thalía |

**3.b NO filtra por `holded_enabled`**, aunque la tabla del prompt hable de «con Holded». La
pregunta que decide no es quién emite, es **si este comercio ha vendido de verdad alguna vez**: un
comercio sin Holded con ventas reales y sin registros (una APK anterior a verifactu-1) también
tiene que seguir facturando. El error de este lado es que una cuenta de pruebas de alguien acabe
marcada como facturando —se arregla pidiendo una cuenta nueva—; el del otro es que un cliente que
está vendiendo deje de facturar sin que nadie se entere.

Y **3.c comprueba antes de marcar**: si una de las dos cuentas de pruebas tuviera facturas o
ventas reales, la migración **PARA** con un mensaje que dice cuál y qué mirar, en vez de dejar que
el CHECK la rechace hablando de una restricción.

### 2.2 La foto real de producción — PENDIENTE DE MATÍAS

**No tengo acceso a producción y no lo quiero.** La consulta de sólo lectura que saca la tabla
cuenta a cuenta está escrita y probada; la lanza Matías y su salida va aquí, debajo, antes de
desplegar:

```bash
ssh root@76.13.142.28
cd /opt/mipiacetpv   # donde viva el compose
docker compose exec -T postgres psql -U mipiacetpv -d mipiacetpv \
  -f - < docs/blocks/puesta-en-marcha-select.sql
```

La consulta devuelve, por cuenta: `registros_fiscales`, `ventas_reales`, `tickets_test`,
`borradores`, la `regla` que le va a aplicar (3.a / 3.b / 3.c / 3.d / `¿?`), el
`factura_desde_quedaria` y el `es_de_pruebas_quedaria`. **Si alguna fila sale con `regla = '¿?'`,
PARAR**: esa cuenta no encaja en ninguna regla y no se adivina.

> **Tabla real de producción (pegar aquí la salida del SELECT):**
>
> ```
> (pendiente — la saca Matías antes del despliegue)
> ```

Lo que sí está medido, contra Postgres real (la base del e2e, migrada desde cero con las 81
migraciones): las tres reglas hacen lo que dicen. El e2e las ejecuta **leyendo el SQL de la propia
migración**, así que si alguien las cambia lo que se pone rojo es el despliegue de verdad
(`test-e2e/puesta-en-marcha.e2e.ts` §6).

---

## 3 · Decisiones tomadas sin preguntar

### 3.1 `facturaDesde` es obligatorio en `TenantFiscalMode`

Podía haber sido opcional para no tocar los `select` existentes. No lo es, y es la decisión más
importante del bloque después del propio dato: un `select` que se olvide de la columna leería «en
ensayo» en un comercio que factura, y sus ventas nacerían `TEST`, no subirían a Holded y no
llevarían registro **en silencio**. Al introducirlo, el compilador cazó los dos sitios donde
faltaba y ninguno más. Ver ADR-021 §3.1.

### 3.2 El ensayo entra en `emiteMipiacetpv`, el MENSAJE en el llamante

Cinco sitios preguntan quién emite. El ensayo va dentro de la función para que el sexto no lo
olvide; el texto va fuera, porque contarle «el emisor es Holded» a la cajera de una cafetería que
no usa Holded la manda a mirar donde no es. De ahí `RECHAZO_ANULACION_EN_ENSAYO`, con su propio
código.

### 3.3 La marca del papel sale del ESTADO DEL TICKET, no del tenant

`esDeEnsayo = (status === "TEST")`. El papel tiene que decir lo que pasó **el día que se cobró**:
un comercio que arrancó el martes y reimprime el lunes siguiente un ticket de su ensayo sigue
teniendo que ver que aquello era un ensayo. Y como el estado ya viajaba hasta el constructor de
bytes, no hace falta tocar ni una llamada: cualquier camino que imprima un `TEST` sale marcado sin
que nadie se acuerde de pasar un flag.

### 3.4 El panel del propietario NO lleva botón de arrancar

El prompt pedía «un aviso con el botón de arrancar». Lleva el aviso y **no** el botón, y es
deliberado: arrancar es irreversible y lo hace el super-admin con el cliente delante (decisión del
propio prompt). Un botón ahí sería o un botón que no hace nada, o la puerta a que un propietario
empiece a facturar sin que nadie haya comprobado sus datos fiscales ni que sus cajas tienen la
cadena limpia. El aviso dice qué puede hacer, qué no cuenta para Hacienda y a quién llamar.

### 3.5 La banda del ensayo se lee de una CACHÉ, y su default es «no está en ensayo»

Lo escribe el **login** (y lo refrescan el catálogo y el paquete offline), así que está puesta
antes de que nadie pueda cobrar y vale sin red. Su default es asimétrico al de sus vecinas
(`cajaEnabled`, `holdedEnabled`): se compara con `"1"`, no con `"0"`. El error de este lado es no
pintar la banda en un ensayo —se arregla al primer refresco, y el servidor no emite nada de todas
formas—; el del otro sería pintar «estos cobros no son facturas» encima de la venta de Sole.

### 3.6 `purgeTestData` se amplía, no se duplica — y de paso se arregla un fallo latente

El reseteo llama a la misma función que usa la activación, con dos opciones nuevas (los
borradores, que los pide el reseteo y no la activación; y el cajero técnico, que lo mata la
activación y no el reseteo).

Y al escribirlo salió un fallo que estaba desde v1.9.5: `purgeTestData` borraba los tickets `TEST`
**sin borrar antes sus devoluciones**, y `Refund.originalTicket` es `onDelete: Restrict`. O sea
que la purga de la activación **lanzaba** en cuanto el ticket de prueba tenía un abono — y
devolver un ticket `TEST` se puede desde v1.9.5-formacion, precisamente para poder ensayar la
devolución. Nadie lo había visto porque el `activate` se come el error en un `try` de
best-effort: el ticket de prueba **sobrevivía a la activación** y se quedaba en la cuenta del
cliente como una venta cobrada de verdad. Lo cazó el test de onboarding-v2 al añadirle el
`refund` al Prisma falso.

### 3.7 El contador de referencia interna vuelve a cero

No es el número de la factura —ése lo da la cadena de la caja, que está vacía— pero sí lo que el
cliente ve impreso. Arrancar con «TICKET 000014» después de un ensayo de trece ventas es contarle
al cliente que ya había vendido. El e2e lo comprueba: la primera venta de verdad es `C1/1` **y**
`000001`.

### 3.8 «Probar TPV» exige ENSAYO, no DRAFT

La condición vieja era correcta mientras activada y facturando fueran lo mismo. Ahora Sirope lleva
activada desde junio sin vender, y probar su TPV en un terminal de verdad es justo lo que hay que
poder hacer. Lo que sigue cerrado es probar sobre la operación real de quien factura: **409
`TENANT_FACTURANDO`**.

### 3.9 Las tres transacciones llevan tope propio

El de Prisma son 5 s y las tres se pasan en un comercio de verdad: resetear un
ensayo largo, arrancar (que resetea dentro) y, sobre todo, eliminar la cuenta
entera —dos años de ventas en cascada—. Con el default no se borra nada (la
transacción se deshace, que es lo correcto), pero el implantador se queda con
un P2028 delante del cliente y la baja de un cliente grande sería imposible.
Dos minutos los dos primeros, cinco el borrado.

### 3.10 La eliminación se BLOQUEA en una cuenta con historia clínica o residentes

Sus triggers no tienen ninguna escapatoria y no se les añade. Ver ADR-021 §6.2. El export sí
funciona, y la devolución de datos del centro clínico ya existía.

---

## 4 · Las dos cosas que el ensayo NO puede ensayar (medidas, no supuestas)

1. **Un fiado.** `nuevoTicketStatus` mira el ensayo antes del crédito, así que un fiado en ensayo
   nace `TEST` y no `ON_CREDIT`: la pantalla de Deudas no lo verá. Cambiar el orden sería peor
   (un `ON_CREDIT` en ensayo acabaría en `PAID` al saldarse y subiría a Holded). Si hace falta
   ensayar fiado, se ensaya después de arrancar con una venta que luego se devuelve.
2. **Un cobro sin red.** El papel sin conexión lo arma el dispositivo y **exige** un registro de
   facturación (`venta-local.ts`, `verifactu`), que en ensayo no existe. Un cobro de ensayo sin
   red cobra y no saca papel — igual que hoy un comercio con Holded. No bloqueaba la visita.

Ninguna de las dos se esconde en el código: las dos están dichas donde se decide
(`venta-local.ts` lleva su comentario y `esDeEnsayo: false` explícito).

---

## 5 · Tabla de sabotaje

Cada fila: se rompe el código, se corre el test que debe caer, y se restaura. **Los mensajes son
los reales, copiados de la salida.**

| # | Sabotaje | Qué cayó | Mensaje real |
|---|---|---|---|
| 1 | `esCobroDeEnsayo` mira sólo la sesión (`return sesion?.isTest === true`) | 4 unitarios + 6 del e2e | `expected false to be true` · y en el e2e: `expected 'PAID' to be 'TEST'`, `expected 409 to be 201`, y el reseteo ni arranca: `const turnos = await tx.shift.deleteMany(` → FK contra los tickets que ya no son `TEST` |
| 2 | `emiteMipiacetpv` ignora el ensayo | `en ensayo NO emite…` y `GET /tpv/fiscal/head · en ensayo` | `expected true to be false` |
| 3 | El ticket de ensayo nace con `esPrueba: cashier.isTest` | 4 del e2e | `expected 'PAID' to be 'TEST'` |
| 4 | Se quita la puerta de `resetearEnsayo` | `con la cuenta FACTURANDO lanza y no borra nada` | `promise resolved "{ ticketsBorrados: 1, …(7) }" instead of rejecting` |
| 5 | El reseteo borra también el catálogo | `NO toca el catálogo, la sala, los cajeros…` (+2 del e2e) | `expected 1 to be undefined` · y en el e2e `expected +0 to be 1` en los productos conservados, más un **500 en la primera venta tras arrancar** porque el producto ya no existe |
| 6 | Se quita el bloqueo `CAJA_CON_REGISTROS` | 2 unitarios | `expected { …(3) } to be an instance of ArranqueBloqueadoError` |
| 7 | Se quita el bloqueo `TENANT_DE_PRUEBAS` | 2 unitarios | `expected [ 'CAJA_CON_REGISTROS', …(2) ] to include 'TENANT_DE_PRUEBAS'` |
| 8 | El reseteo no pone a cero el contador de la caja | 2 del e2e | `expected '000005' to be '000001'` |
| 9 | La marca del append-only deja de nombrar al tenant (`IF TG_OP = 'DELETE' THEN RETURN OLD`) | 5 del e2e | `expected '' to contain 'REGISTRO_FISCAL_VIOLADO'` (las tres formas: a pelo, con la marca de otro tenant y el `UPDATE`) |
| 10 | Se quita el bloqueo `SIN_EXPORT` | `sin el export descargado, no hay camino` | `expected true to be false` |

El nº 1 y el nº 5 son los que más enseñan:

- **El nº 1** no deja «una venta de ensayo que factura»: deja un **409** (el gate ve
  `emite = false` por Holded y un registro encima, y rechaza) o un ticket `PAID`. O sea que
  romper el ensayo rompe el cobro, no lo deja pasar en silencio. Y el reseteo posterior **ni
  arranca**: la FK `RESTRICT` de los turnos lo para.
- **El nº 5** cae por los dos lados a la vez: por el test que cuenta lo que se conserva y por la
  primera venta de después, que se cae con un 500 porque el producto ya no existe.

---

## 6 · La baja de un cliente (parte C)

### 6.1 El export

```
facturas/registros.json   los registros ENTEROS: huella, huella anterior, la cadena exacta
                          sobre la que se calculó (`huellaInput`) y el payload del terminal.
                          Con esto un tercero puede RECALCULAR las huellas.
facturas/registros.csv    los mismos, en tabla, para el asesor.
facturas/cadena.txt       el veredicto del MOTOR (`mipiacetpv_fiscal_chain_summary`), caja por
                          caja, en el momento de exportar.
ventas/tickets.json       las ventas con sus líneas y sus pagos.
ventas/tickets.csv        las mismas, en tabla.
ventas/devoluciones.csv   los abonos.
fichajes/fichajes.csv     el registro de jornada, si lo había.
LEEME.txt                 qué es, qué hay que conservar y cuánto (arts. 66 y 70 LGT; 34.9 ET).
```

Se escribe con el `Zip` de clinica-7 (sin comprimir, escrito a mano, sin dependencias nuevas) y se
suelta a la respuesta **por trozos**: un comercio con dos años de ventas no pasa por memoria dos
veces.

### 6.2 La precondición

El apunte del export en el **registro de auditoría** es lo que habilita el borrado, y se escribe
cuando todos los bytes están fuera —no antes—: un export que se cayó a mitad no habilita nada. Lo
comprueba el servidor, no la pantalla.

### 6.3 El orden del borrado, que lo imponen las FK y los triggers

```
SET LOCAL mipiacetpv.eliminar_tenant = '<uuid>'
1. fiscal_records   (su FK a tickets es RESTRICT)
2. refunds          (idem)
3. tickets          → cascada: líneas, pagos, correcciones, cocina, pases, emails
4. shifts           (Ticket.shift es RESTRICT) → cascada: arqueos e informes Z
5. time_entries, employees
6. public_links     (FK RESTRICT al tenant)
7. DELETE FROM tenants → cascada: catálogo, tiendas, cajas, terminales, cajeros,
                         contactos, clientes, agenda, cocina, sala
```

Todo en una transacción. Si algo falla por el camino no queda media cuenta: queda la cuenta.

---

## 7 · El fallo que este bloque encontró en un trigger ajeno

`CREATE OR REPLACE` **no mezcla: sustituye.** La escapatoria de la baja se añadió al
`mipiacetpv_public_link_guard` copiando el cuerpo de `enlaces_publicos` —la migración que CREÓ la
función— sin ver que `clinica_7_blindaje` la había reemplazado después para añadir dos reglas: el
código de 6 cifras del enlace es parte de la cerradura, y sus intentos fallidos sólo suben.

Resultado: las dos reglas desaparecían **en silencio**. El SQL es válido, el despliegue no se
queja, y lo habría echado de menos la siguiente auditoría de clinica-7. Lo cazaron sus dos e2e,
que es exactamente para lo que están:

```
× clinica-7 · el blindaje > CAMBIAR el código de un enlace → rechazado: es la cerradura
× clinica-7 · el blindaje > BAJAR los fallos → rechazado: sería regalar intentos
```

La regla queda escrita en la propia migración: antes de reemplazar un trigger ajeno,
`grep -rn "CREATE OR REPLACE FUNCTION <nombre>" packages/db/prisma/migrations` y copiar el cuerpo
de la fecha más alta. En este repo sólo `mipiacetpv_public_link_guard` está definido dos veces;
las otras cuatro funciones que este bloque reemplaza tienen una sola definición previa.

---

## 8 · Los tests

| Suite | Resultado |
|---|---|
| `pnpm vitest run` (desde la raíz) | **379 ficheros, 5275 tests verdes**, 10 saltados |
| `pnpm test:e2e` (`puesta-en-marcha.e2e.ts`) | **32 verdes** contra Postgres real |
| `pnpm test:e2e` (los 40 ficheros) | 36 verdes + 4 con los fallos de madrugada (§8.1) |
| El bucle visual | el panel y la banda, medidos (§8.2); un fallo encontrado y arreglado |

Nuevos: `apps/api/test/puesta-en-marcha-ensayo.test.ts` (14), `test/puesta-en-marcha-arranque.test.ts`
(15) y `test-e2e/puesta-en-marcha.e2e.ts` (32).

### 8.1 Los cuatro e2e que fallan de madrugada, y la prueba de que no son de este bloque

`f3-fichar`, `f8-colegio` y `agenda-suelo` fallan si la suite se lanza pasada la medianoche: sus
casos escriben «hace 6 horas» y eso cruza el día local, así que el cierre del fichaje devuelve
409. Está apuntado desde antes de este bloque.

Para no afirmarlo de boca, se corrió un **control sobre `master` sin ningún cambio**, a la misma
hora (00:35) y contra otra base:

```bash
# desde el worktree de master, con su propia base desechable
E2E_DATABASE_URL="postgresql://…/mipiacetpv_e2e_proofmaster" \
  pnpm exec vitest run --config vitest.e2e.config.ts \
  test-e2e/f8-colegio.e2e.ts test-e2e/agenda-suelo.e2e.ts test-e2e/f3-fichar.e2e.ts
# → el MISMO fallo: × entrada y salida: un tramo completo → expected 409 to be 200
```

A las 23:59, con la rama entera menos la parte C, los 39 ficheros del e2e salieron **verdes**.
Hay que volver a pasar la suite completa a una hora decente antes del PR; está en el guion (§10).

---

## 8.2 · El bucle visual, y el fallo que sólo se veía midiendo

Se montó la pila entera contra una base propia (`mipiacetpv_visual_pem`) con
una cuenta en ensayo sembrada —catálogo, sala, cajera con PIN, terminal
emparejado, impresora, tres tickets de ensayo, un borrador y un turno— y se
fotografiaron las pantallas con `playwright-core` desde el scratchpad.
Capturas en `docs/blocks/puesta-en-marcha-shots/`.

Lo que salió bien a la primera (medido, no mirado):

| | |
|---|---|
| Los dos botones del panel | existen, y nacen **deshabilitados** hasta que se teclea el nombre; después, habilitados |
| A 1280 y a 390 | alcanzables los dos (`alcanzable: true`), y a 390 sin desbordar a lo ancho (`scrollW === clientW === 390`) |
| Cuenta facturando | el botón de resetear **no existe** (`count: 0`) y la banda dice «Facturando desde el 01-06-2026» |
| Eliminar sin export | el botón de confirmar **no existe**, y el bloqueo se lee entero |
| La banda del TPV | `y: 0`, ancho completo, texto «ENSAYO · estos cobros no son facturas», y la caché escrita por el login (`mipiacetpv-tenant-ensayo = "1"`) |

**Y lo que salió MAL, y en la captura no se veía.** En el D8 (1280×800), con
la banda puesta:

```
venta-d8 {"cobrar":true,"top":757,"bottom":825,"ventana":800,
          "dentroSinScroll":false,"scrollH":840,"clientH":800}
```

El botón **COBRAR caía por debajo del borde de la pantalla**. La banda ocupa
41 px en el flujo y las pantallas del TPV son `min-h-screen`, así que la
página pasaba a medir `100vh + la banda`. En la foto salía una pantalla
normal con un botón que hay que buscar con el dedo — justo lo que la memoria
del bucle visual avisa: «una captura no dice si un elemento es ALCANZABLE».

Arreglado con una compensación que enciende la propia banda al montarse
(`body.con-banda-ensayo` en `index.css`): mientras está puesta, `100vh` pasa a
ser `100vh - 40px` para las utilidades que miden pantallas. **Tres selectores
y no dos**: `SalePage` no usa `h-screen` a secas sino la variante arbitraria
`[@media(min-width:1024px)_and_(min-height:700px)]:h-screen` —el candado de
v1.5-hotfix5—, que Tailwind compila a una clase propia; tras compensar las
otras dos, el D8 seguía midiendo 840. Después:

```
venta-d8 {"cobrar":true,"bottom":784,"ventana":800,
          "dentroSinScroll":true,"scrollH":800,"clientH":800}
venta-n1 {"cobrar":true,"bottom":591,"ventana":1280,
          "dentroSinScroll":true,"scrollH":1280,"clientH":1280}
```

De paso: **la banda del modo prueba (B-OnboardingV2) arrastra el mismo fallo
desde su bloque** y no está arreglada. Queda apuntado; no entra aquí porque
se arregla sola el día que use este mismo mecanismo.

### 8.3 · El papel, por el camino de verdad

Con la misma pila levantada, un `POST /tickets/:id/print/escpos` sobre un
ticket de ensayo devuelve los bytes que irían a la IPOS:

```
CAFETERÍA SIROPE SL
Cafetería Sirope
NIF: B45902186
C/ Mayor 10, 45600 Talavera
------------------------------------------
*** TICKET DE PRUEBA ***
SIN VALIDEZ FISCAL
------------------------------------------
000001  18/10/2026 00:37
```

La marca va **antes del número**, que es lo que se pedía. Y desde este bloque
está fijado por test en los dos constructores: los bytes ESC/POS y el PDF.

---

## 9 · La pasada en el hierro — PENDIENTE, Y POR QUÉ

El criterio de cierre del prompt pide una pasada en el **D8 emparejado a Cafetería Sirope · Caja
1**: entrar con un cajero, venta de mostrador, cobro en efectivo con vuelta, devolución, arqueo y
cierre, con la banda visible y 0 `fiscal_records` en Sirope. **Eso no lo puedo hacer yo**: hace
falta el aparato en la mano y la cuenta de producción, y producción la teclea Matías.

Lo que sí está hecho, y es el mismo recorrido contra Postgres de verdad: el e2e
`puesta-en-marcha.e2e.ts` §1 hace entrar a una cajera **real** con un terminal **real**
emparejado, vende, cobra, manda un registro que se descarta, devuelve, deja una mesa abierta,
cierra el turno con su Z, y comprueba `0 fiscal_records`. Después resetea y cuenta lo que queda y
lo que no. Lo que falta del criterio es el **papel saliendo de la IPOS de verdad y la banda vista en la
pantalla física del D8**: la banda y los bytes del papel están medidos en el bucle visual (§8.2 y
§8.3), pero sobre un Chrome de 1280×800 y un `POST …/print/escpos`, no sobre el aparato.

El guion de la pasada, para hacerla en diez minutos:

1. Desplegar la rama en PRUEBAS (o en producción tras el PR).
2. Super-admin → ficha de **Cafetería Sirope** → «Puesta en marcha». Tiene que decir **En
   ensayo** y listar 0 registros en su caja.
3. D8 emparejado a Sirope · Caja 1 → PIN de Gemma. **La banda azul «ENSAYO» tiene que estar
   arriba antes de poder tocar nada.**
4. Venta de mostrador, efectivo con vuelta → el papel tiene que salir con `*** TICKET DE PRUEBA
   *** / SIN VALIDEZ FISCAL` en cabecera y **sin** número de factura.
5. Devolución de esa venta, arqueo y cierre de turno.
6. Comprobar en la base: `SELECT count(*) FROM fiscal_records WHERE tenant_id = '<sirope>'` → **0**.
7. Super-admin → «Resetear ensayo», tecleando `Cafetería Sirope`. Tickets y turnos a 0; catálogo,
   sala y terminal intactos (la pantalla los cuenta).
8. **NO se pulsa «Empezar a facturar»**: eso lo hace Matías en el local, con Gemma.

Y el centinela de siempre, antes y después del despliegue:

```sql
-- Sole no se mueve ni un byte
SELECT t.name, t.fiscal_go_live_at, count(f.id) AS registros,
       count(*) FILTER (WHERE tk.status NOT IN ('DRAFT','TEST')) AS ventas_reales
  FROM tenants t
  LEFT JOIN fiscal_records f ON f.tenant_id = t.id
  LEFT JOIN tickets tk ON tk.tenant_id = t.id
 WHERE t.name ILIKE '%sole%'
 GROUP BY 1, 2;
```

---

## 10 · El guion de despliegue

### 10.1 Antes de tocar nada

```bash
# 1 · La foto de producción, cuenta a cuenta. Sólo lee.
ssh root@76.13.142.28
docker compose exec -T postgres psql -U mipiacetpv -d mipiacetpv \
  -f - < docs/blocks/puesta-en-marcha-select.sql > antes.txt
#    → si alguna fila sale con regla = '¿?', PARAR.
#    → la salida se pega en el §2.2 de este documento.

# 2 · La suite completa a una hora decente (no de madrugada: §8.1)
pnpm vitest run
E2E_DATABASE_URL="postgresql://mipiacetpv:mipiacetpv_dev@localhost:5432/mipiacetpv_e2e_pem" \
  pnpm --filter @mipiacetpv/api run test:e2e
```

### 10.2 El despliegue

```bash
# 3 · Las dos migraciones. La primera PUEDE ABORTAR a propósito si una cuenta
#     de pruebas tuviera facturas o ventas reales: es la comprobación del §2.1.
pnpm --filter @mipiacetpv/db run migrate:deploy

# 4 · Comprobar el backfill, cuenta a cuenta
docker compose exec -T postgres psql -U mipiacetpv -d mipiacetpv -c \
  "SELECT name, fiscal_go_live_at, es_de_pruebas FROM tenants ORDER BY 1"
#    → Sole y Cachitos CON fecha. Sirope, Fouzia, Maestranza, Rosario y Thalía a NULL.
#    → PRUEBAS MIPIACE y el ensayo de Maestranza con es_de_pruebas = true.
```

### 10.3 El push y el PR (los hace Matías)

```bash
cd /Users/matiasoyolasanchez/Developer/Claude/Projects/mipiacetpv-puesta-en-marcha

git log --oneline master..HEAD          # la rama entera, de un vistazo
git push -u origin puesta-en-marcha

gh pr create --base master --head puesta-en-marcha \
  --title "puesta-en-marcha · se prueba en la cuenta real, se resetea y se arranca" \
  --body-file docs/blocks/puesta-en-marcha-done.md
```

Y el worktree, cuando el PR esté mergeado:

```bash
git -C /Users/matiasoyolasanchez/Developer/Claude/Projects/mipiacetpv \
  worktree remove ../mipiacetpv-puesta-en-marcha
```
