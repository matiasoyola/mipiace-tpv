# Bloque puesta-en-marcha · probar en la cuenta real, resetear y arrancar a facturar

## Por qué existe este bloque

Tropezamos con lo mismo en cada implantación:

- **06-10, La Maestranza**: la auditoría del AP13 cobró sobre la cuenta ya activada. Las facturas
  C1 #000002 y #000003 no se pueden borrar (`fiscal_records` es append-only) y hubo que montar una
  cuenta nueva desde cero esa misma noche.
- **17-10, Sirope**: cuenta ACTIVE desde junio, sin una sola venta real, fuera de Holded desde el
  13-10. Queríamos ver su TPV de verdad en un terminal físico (su catálogo, su sala, su cobro) antes
  de la visita, y **no hay forma**: «Probar TPV» sólo funciona en DRAFT y sólo en el navegador, y
  cualquier cobro desde un terminal emparejado sería la factura `C1/1` real de la titular.
- **Siempre**: cuentas nuestras de pruebas y desarrollo que no se pueden limpiar, y clientes que se
  van sin que exista «eliminar cuenta».

¿Y qué? Hoy no podemos llegar a un cliente con su TPV probado en su propia cuenta y su propio
aparato. Con este bloque, una cuenta se prueba entera **en el hierro del cliente**, se resetea las
veces que haga falta y **arranca a facturar el día de la visita con un botón**, con la serie en `C1/1`.

## La regla que lo hace limpio (no reabrir)

**Antes de la puesta en marcha, el TPV no genera ningún registro fiscal. Nunca.** El reseteo borra
tickets de ensayo, turnos y mesas, y **no puede borrar una factura porque no la hay**. La cadena de
`fiscal_records` sigue siendo intocable, el trigger append-only no se toca y no se abre ninguna
puerta para borrar registros. Lo que la Ley Antifraude prohíbe es borrar facturas y seguir
facturando en la misma serie; aquí eso no puede pasar por construcción.

## Leer antes

1. `apps/api/src/fiscal/mode.ts` entero: `emiteMipiacetpv`, `comprobarGateFiscal` y el addendum 1b
   (una venta de prueba no genera registro ni gasta número). **Este bloque generaliza el 1b**: hoy
   «prueba» = JWT `purpose: test-cashier`; después, «prueba» = la cuenta todavía no ha arrancado.
2. `apps/api/src/superadmin/test-cashier.ts`: `provisionTestCashier`, `issueTestCashierSession`,
   `purgeTestData`. El reseteo reutiliza y amplía `purgeTestData`, no lo duplica.
3. `apps/api/src/superadmin/tenants.ts`: `/activate` (crea el OWNER con contraseña temporal; con un
   email ya existente devuelve `EMAIL_TAKEN`) y la ficha del tenant.
4. `apps/api/src/fiscal/routes.ts`: `GET /tpv/fiscal/head` (`emite: false` para la sesión de prueba).
5. `packages/db/prisma/migrations/20260924000000_verifactu_1_registro/migration.sql`: el append-only,
   `devices_revoke_previous` y la identidad fiscal de la caja.
6. `docs/implantaciones/checklist-sirope.md` (17-10) y `checklist-maestranza.md` (06-10).
7. `docs/blocks/holded-desconectar-done.md`: el patrón de previsualización + confirmación tecleando
   el nombre del comercio, que aquí se repite.

## Base de rama

Rama `puesta-en-marcha` **desde `master`**. PR contra `master`.

## Decisiones ya tomadas (no reabrir)

- **Activar la cuenta y empezar a facturar son dos cosas.** `onboardingState` (DRAFT/ACTIVE) sigue
  diciendo si hay propietario. Lo nuevo es **la fecha de arranque fiscal**: `Tenant.facturaDesde`
  (`fiscal_go_live_at`), nullable.
  - `null` → **en ensayo**. Se vende con normalidad (mesas, comanda, cobro, devolución, arqueo,
    cierre) desde cualquier terminal y con cualquier cajero, pero **todo ticket nace `TEST`**, no
    sube a Holded, no manda email y **no lleva registro fiscal**: `/tpv/fiscal/head` contesta
    `emite: false` y el servidor descarta cualquier registro que llegue (espejo del 1b).
  - con fecha → **facturando**. Exactamente lo de hoy.
- **El ensayo se ve, siempre.** Banda fija en el TPV («ENSAYO · estos cobros no son facturas»),
  ticket impreso y PDF con «TICKET DE PRUEBA · SIN VALIDEZ FISCAL» en cabecera y sin número de serie,
  y en el panel del propietario un aviso con el botón de arrancar. Nadie puede creer que ha facturado.
- **Arrancar es irreversible** y lo hace **el super-admin** (en la visita, con el cliente delante).
  Previsualización y confirmación tecleando el nombre del comercio, como «Dejar Holded». Al
  confirmar, en una transacción: (1) resetea el ensayo, (2) comprueba que **cada caja tiene 0
  registros**, datos fiscales completos (razón social y NIF) y al menos un terminal emparejado,
  (3) fija `facturaDesde = now()`. La siguiente venta es la `C1/1`. Sin botón de deshacer.
- **Resetear el ensayo** (super-admin, cuando quiera, sólo con la cuenta en ensayo): borra tickets
  `TEST` y lo que cuelga de ellos (líneas, pagos, devoluciones, email jobs, comandas de cocina),
  turnos y arqueos, mesas abiertas y borradores. **Conserva** catálogo, sala, cajeros, terminales,
  impresoras, datos fiscales y contactos. Con la cuenta facturando, el endpoint devuelve 409
  `TENANT_FACTURANDO`: no hay camino, ni con flag.
- **Cuentas nuestras de pruebas**: `Tenant.esDePruebas` (boolean, por defecto false). Una cuenta de
  pruebas **no puede arrancar** (siempre en ensayo) y se resetea cuando se quiera. PRUEBAS MIPIACE y la
  de ensayo de La Maestranza (`m.oyola+maestranza-ensayo`) se marcan en la migración.
- **Cuentas con Holded**: el ensayo funciona igual (los tickets `TEST` no suben a Holded). Arrancar
  sólo fija la fecha; Holded sigue siendo quien factura.
- **Eliminar cuenta** (baja): ver parte C.

## Migración (los datos de hoy)

Una migración aditiva y su backfill, **cuenta a cuenta y comprobado en el `-done`**:

| Cuenta | `facturaDesde` | `esDePruebas` |
|---|---|---|
| Con algún `fiscal_record` | fecha del primer registro | false |
| Con Holded y algún ticket real (Sole, Cachitos…) | fecha del primer ticket real | false |
| PRUEBAS MIPIACE, ensayo de La Maestranza | `null` | **true** |
| Sin registros ni ventas reales (**Sirope**, Fouzia, La Maestranza real, Rosario, Thalía) | `null` (en ensayo) | false |

Antes de escribirla, saca la tabla real de producción con un `SELECT` de sólo lectura y ponla en el
`-done`. Si una cuenta no encaja en ninguna fila, **para y pregunta**: no se adivina.

## Alcance

### A · Ensayo en la cuenta real

1. Columna, backfill y exposición en los DTO de tenant (super-admin, panel, TPV).
2. Gate fiscal: `emiteMipiacetpv` y `comprobarGateFiscal` pasan a mirar **también** el ensayo.
   `/tpv/fiscal/head` contesta `emite: false` en ensayo. El servidor descarta (y anota) cualquier
   registro que llegue de una cuenta en ensayo, igual que hoy con la sesión de prueba.
3. Al cobrar en ensayo, el ticket nace `TEST` (no lo marca el worker después). Upload a Holded y
   email, saltados como hoy con `TEST`.
4. TPV: banda de ensayo y ticket impreso de prueba (ESC/POS y PDF).
5. «Probar TPV» deja de exigir DRAFT: vale para cualquier cuenta en ensayo.

### B · Resetear y arrancar (super-admin)

1. Ficha del tenant, sección «Puesta en marcha»: estado (en ensayo / facturando desde dd-mm-aaaa),
   cuántos tickets de ensayo hay, y dos botones: **Resetear ensayo** y **Empezar a facturar**.
2. Los dos con previsualización (qué se borra, cuántas filas, qué se conserva) y confirmación
   tecleando el nombre. Los dos en el log de auditoría del super-admin.
3. «Empezar a facturar» con las comprobaciones de arriba; si falta algo, dice qué en una frase.

### C · Eliminar cuenta (baja de un cliente)

1. **Exportar primero**: un ZIP con los registros fiscales (con su huella y encadenamiento) y los
   tickets en CSV/JSON. Es lo que el titular tiene que conservar 4 años; se le entrega a él.
2. **Eliminar** la cuenta **entera** (super-admin, a petición escrita del titular): sólo se habilita
   tras descargar el export, y se confirma tecleando el nombre. Borra el tenant y todo lo que cuelga,
   incluidos sus registros fiscales **sólo en esta operación de cuenta entera**. Diseña cómo pasa por
   el append-only sin abrirle una puerta general (por ejemplo, el trigger permite el `DELETE` sólo
   dentro de una transacción que ha marcado `SET LOCAL mipiacetpv.eliminar_tenant = '<id>'`, y sólo de
   ese tenant). Documenta la decisión en un ADR.
3. Una cuenta `esDePruebas` se elimina sin export obligatorio.

## Restricciones

- **No se abre ningún camino para borrar registros fiscales de una cuenta que sigue viva.** Ni
  resetear, ni SQL de soporte, ni flag de entorno.
- Producción no cambia de comportamiento para nadie que hoy factura: Sole, Cachitos y quien tenga
  registros siguen exactamente igual tras la migración.
- Nada de laboratorio en la APK de un cliente. Si la banda de ensayo necesita APK nueva, va en la
  1.27.x normal.
- El bloque toca dinero y facturas: commits pequeños y cada regla con su test.

## Verificación

Cada fila: se rompe el código, se ve el rojo, el mensaje real va al `-done`, y se restaura.

| Sabotaje | Debe caer |
|---|---|
| El gate fiscal ignora el ensayo | el test de que un cobro en ensayo no crea `fiscal_record` |
| `/tpv/fiscal/head` devuelve `emite: true` en ensayo | el test del head |
| El ticket de ensayo nace `PAID` | el test de que nace `TEST` |
| Resetear permitido con la cuenta facturando | el test del 409 `TENANT_FACTURANDO` |
| Resetear borra un producto o un cajero | el test de lo que se conserva |
| Arrancar con una caja con registros | el test de la precondición |
| Arrancar en una cuenta `esDePruebas` | el test de la precondición |
| La primera venta tras arrancar no es `C1/1` | el test e2e ensayo → reset → arrancar → venta |
| El trigger deja borrar un registro fuera de «eliminar cuenta» | el test del append-only |
| Eliminar sin export descargado | el test de la precondición |

### La pasada en el hierro (criterio de cierre)

- **D8** emparejado a **Cafetería Sirope · Caja 1** (en ensayo): entrar con un cajero, venta de
  mostrador, cobro en efectivo con vuelta, devolución, arqueo y cierre. Banda de ensayo visible.
  En la base, **0 `fiscal_records`** en Sirope.
- **Resetear ensayo** desde el super-admin: tickets y turnos de Sirope a 0, y su catálogo, su sala y
  su terminal intactos.
- **No se pulsa «Empezar a facturar» en Sirope**: eso lo hace Matías en el local, con Gemma.
- Sole: una consulta antes y después del despliegue que demuestre que no ha cambiado nada.

## Entregables

- Rama `puesta-en-marcha`, commits pequeños en español.
- ADR del arranque fiscal y de la eliminación de cuenta frente al append-only.
- `docs/blocks/puesta-en-marcha-done.md` con la estructura de siempre, la tabla de la migración con
  los datos reales, las decisiones tomadas sin preguntar una a una, y los sabotajes con su rojo.
- Guion de uso en `docs/implantaciones/`: «Cómo se pone en marcha un comercio» (probar → resetear →
  arrancar), que sustituye la regla «después de activar nadie prueba en la cuenta».
- **El push y el PR los hace Matías**: deja los comandos exactos al final.

## Fuera de alcance

- La remisión de registros a la AEAT (el QR sigue apagado por decisión del 15-10).
- Rectificativas (Verifactu V3).
- Reorganizar el alta de cuentas (`/activate`).
