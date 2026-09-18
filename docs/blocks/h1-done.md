# H1 · la empresa sin caja (Holded opcional, nivel 1) — DONE

Origen: el prompt de Matías del 12-09-2026. Rama `holded-opcional-1-empresa-sin-caja`,
worktree `mipiacetpv-h1`. Base: `4078655` (S1, B-5 y B-6a dentro). **Sin push, sin deploy.**
**Con migración** — ver §7.

Frente 0: `docs/blocks/h1-plan.md`. Decisión estructural: `docs/design/adr-016-la-caja-es-un-modulo.md`.

**El muro eran dos líneas.** `POST /super-admin/tenants` exigía `holdedApiKey`, y
`apps/admin/src/App.tsx:143` mandaba a `/onboarding` a toda empresa sin clave. Un colegio no podía
existir, y si existía no salía de la pantalla de conectar Holded. Las 92 rutas que gatean y las
veinte pantallas que esconden son consecuencia; el muro era eso.

Este bloque **no trae el fichaje**. Trae que una empresa pueda **existir, activarse y entrar**.

---

## 1 · Lo que hay ahora

| Pieza | Dónde |
|---|---|
| **La capability** — `caja_enabled BOOLEAN NOT NULL DEFAULT true` | `schema.prisma:458` |
| **El sync que no aplica** — `InitialSyncStatus.NOT_APPLICABLE` | `schema.prisma:128-141` |
| La migración, aditiva y con backfill por DEFAULT | `migrations/20260912000000_h1_la_caja_es_un_modulo/` |
| **La puerta** — 403 `CAJA_DISABLED`, patrón ADR-R6 | `apps/api/src/lib/caja-gate.ts` |
| Las 92 rutas que la llevan | 20 ficheros, §2 del plan (`h1-plan.md`) |
| Alta con dos caminos (con y sin Holded) | `superadmin/tenants.ts:429-750` |
| Los módulos en el alta y en el PATCH | `superadmin/tenants.ts` |
| **La salud por dependencias** — `requires` + `applies`, `ready = filter(applies).every(ok)` | `superadmin/onboarding-health.ts` |
| Activación sin PIN de cajero + `cashierPinIssued` | `superadmin/tenants.ts:1470-1620` |
| El email que no habla de PIN ni de Holded | `superadmin/welcome-email.ts` |
| **La redirección que ya no es un muro** | `apps/admin/src/App.tsx` (`RootRouter`, `landingSinCaja`) |
| El sidebar por capability (`agenda` \| `caja` \| `holded`) | `apps/admin/src/AdminShell.tsx` |
| `<CajaGate>` — diez pantallas envueltas | `apps/admin/src/CajaGate.tsx` |
| El banner rojo de Holded y el badge, callados sin caja | `AdminShell.tsx` |
| La pantalla del alta con la pregunta primero | `superadmin/CreateTenantPage.tsx` |
| Los tres estados del check (cumple / falla / no aplica) | `superadmin/TenantDetailPage.tsx` (`CheckRow`) |
| **El TPV que lo dice** — estado `cajaDisabled`, sin bucle | `tpv-web/src/hooks/useDeviceBootstrap.ts`, `App.tsx` (`CajaDisabledScreen`) |
| `cajaEnabled` en el catálogo y su caché | `tpv-catalog/routes.ts` · `tpv-web/src/lib/catalog.ts` |
| Holded más tarde: `NOT_APPLICABLE` → `PENDING` + sync | `superadmin/tenants.ts` · `auth/routes.ts` |

**Tests nuevos: 8 ficheros, 116 casos.**

| Fichero | Casos |
|---|---|
| `apps/api/test/h1-migracion-caja.test.ts` | 6 |
| `apps/api/test/h1-caja-gate.test.ts` | 36 |
| `apps/api/test/h1-alta-sin-holded.test.ts` | 15 |
| `apps/api/test/h1-salud-modulos.test.ts` | 17 |
| `apps/api/test/h1-activacion-sin-caja.test.ts` | 9 |
| `apps/api/test/h1-caja-al-tpv.test.ts` | 4 |
| `apps/api/test/h1-holded-mas-tarde.test.ts` | 12 |
| `apps/admin/test/h1-panel-sin-caja.test.tsx` | 10 |
| `apps/tpv-web/test/h1-caja-apagada.test.tsx` | 10 |
| `apps/api/test-e2e/h1-empresa-sin-caja.e2e.ts` | 13 |

**Suite: 190 ficheros, 1747 verdes, 3 saltados** (`pnpm test` desde la raíz).
Base de master: 181 / 1628 / 3. **Los 181 ficheros de master siguen verdes sin tocar ni una línea
de ellos.** Los 3 saltados son los de siempre: `super-admin.test.ts:566`, un `describe.skip` del
flujo legacy de B-SuperAdmin, anterior a este bloque.

**e2e: 6 ficheros, 64 verdes** contra `mipiacetpv_h1_e2e` (51 de antes + 13 de H1). Base borrada al
terminar.

### La rama ya lleva B-reservas-7a dentro (12-09-2026)

`master` (`3e218b4`, el merge de **B-reservas-7a** · horario del centro, días especiales y retícula)
se ha fusionado en `holded-opcional-1-empresa-sin-caja`. Dos conflictos, los dos aditivos por ambos
lados y resueltos quedándose **todo** de las dos ramas:

- **`packages/db/prisma/schema.prisma`** — conviven el `cajaEnabled` de H1 y el `agendaSlotMinutes`
  de 7a en `Tenant`, más las relaciones `centerHours` / `centerDays` y los modelos `CenterHours` /
  `CenterDay`. Las dos migraciones son independientes y quedan en orden
  (`20260911…_b_reservas_7a_horario_centro` → `20260912…_h1_la_caja_es_un_modulo`).
- **`apps/admin/src/App.tsx`** — los dos imports (`AgendaHorarioPage` y `CajaGate`) y todas las rutas
  de ambos lados. La ruta `/admin/agenda-hours` va **sin `<CajaGate>`**: es agenda, no caja, y la
  regla §2.11 dice que lo que no cuelga de la caja no se envuelve (misma decisión que
  `/admin/agenda-catalog`). Las que H1 envolvió siguen envueltas.

El sidebar de `AdminShell.tsx` se auto-fusionó bien: la entrada "Agenda · Horario" lleva
`capability: "agenda"`, no `"caja"`, así que un tenant con agenda y sin caja la sigue viendo.

Recuento después del merge, sin arreglar nada (nada se puso rojo):

| | Antes (H1 solo) | Después (H1 + 7a) |
| --- | --- | --- |
| Suite (`pnpm test` raíz) | 190 ficheros · 1747 verdes · **3 saltados** | 196 ficheros · 1865 verdes · **3 saltados** |
| e2e (`mipiacetpv_h1_e2e`) | 6 ficheros · 64 verdes | 7 ficheros · 85 verdes |

Los 3 saltados son los mismos de siempre (`super-admin.test.ts:566`): ni el merge ni 7a añaden
saltos nuevos. Los +118 verdes de la suite y los +21 de e2e son los de 7a.

---

## 2 · Decisiones tomadas sin preguntar, una a una

### 2.1 Las del prompt, confirmadas y sin choques

`cajaEnabled` hermana de las otras dos y no un `businessType` ni un plan; `NOT_APPLICABLE` en vez de
un booleano "usa Holded"; la caja no se apaga desde el panel del cliente; el bloque no toca el
catálogo local, ni el fichaje, ni el camino de cobro. **Ninguna chocó con nada.** El porqué de cada
una, con las alternativas descartadas, está en ADR-016.

### 2.2 El esquema JSON del alta pasa a `required: []`, y las reglas las impone el handler

Hay **dos altas** y un esquema JSON no sabe distinguirlas. Si `holdedApiKey` sigue siendo `required`
no hay alta sin Holded; si se relaja `holdedAccountId` a secas, se puede crear un tenant con clave y
sin id de cuenta, que rompe el deep-link del hub.

La regla queda en el handler: **con clave, `holdedAccountId` sigue siendo obligatorio**; sin clave,
ninguno de los dos. Media configuración → 400 `HOLDED_PARTIAL_CONFIG`. Efecto lateral buscado: el
test existente `onboarding-v2.test.ts:725` ("rechaza sin holdedAccountId con 400") **sigue verde sin
tocarlo**, porque sólo afirma el 400.

### 2.3 Sin Holded, la razón social pasa a obligatoria

Hoy sale de `def.name` (el almacén default). Sin Holded no hay de dónde derivarla, y un tenant sin
nombre no se puede ni listar. El mensaje del 400 cambia según el caso: sin Holded dice "se introduce
a mano", no "crea un almacén con nombre en la cuenta Holded del cliente".

### 2.4 `fiscalProfile.source` distingue el alta manual

`super_admin_manual` en vez de `super_admin_draft`. Dentro de un año, mirando una fila, hay que poder
saber si esos datos vienen del almacén de Holded o los tecleó un implantador. Cuesta una constante.

### 2.5 El invariante "al menos un módulo" se comprueba DESPUÉS del cambio

En el PATCH no basta con rechazar "apagar los tres a la vez": hay que rechazar quedarse sin ninguno,
que es lo que pasa **apagando de uno en uno**. Se calcula el estado resultante y se valida ése.

### 2.6 `sync-done` depende de HOLDED, no de la caja

El prompt agrupa los checks que "no aplican sin caja" e incluye el sync inicial. Lo he separado: una
empresa **con caja y sin Holded** (caja local — el nivel 2, la peluquería) no debe quedar bloqueada
por un sync que nunca va a correr. La dependencia real de ese check es la clave, no la caja. Con el
cliente 0 el resultado es idéntico (no tiene ninguna de las dos); con el nivel 2, no.

### 2.7 Dos checks nuevos, y el fiscal detecta el hueco, no revalida el dígito

`modules-enabled` y `fiscal-minimum`. El segundo comprueba **presencia** de razón social y NIF,
aceptando los alias históricos (`legalName`/`businessName`, `taxId`/`nif`/`fiscalNif`). No revalida
el dígito de control: eso ya lo hace el alta con `validateSpanishTaxId`, y el fallo real que se ve en
implantación es el hueco —el implantador no lo sabía y lo dejó vacío—, no un NIF inventado.

### 2.8 La lectura del gate es **tolerante** y falla hacia "caja encendida"

La decisión más discutible del bloque, así que va con su medición.

`ensureCajaEnabled` compara con `=== false` (no con `!`), y si el modelo `tenant` no está disponible
o la lectura lanza, **no bloquea**.

**Por qué, en términos de producto:** `caja_enabled` es `@default(true)`. Esto es una *capability*,
no la frontera de aislamiento —ésa la hacen `requireCashierSession`, `requireDeviceToken` y
`requireOwner`, y ninguna depende de esta función—. Fallar hacia "apagado" dejaría **sin cobrar a un
cliente que cobra**: es lo peor que este bloque puede romper. Fallar hacia "encendido" deja
exactamente el comportamiento de master.

**Por qué, en términos medidos:** con una lectura ingenua, cablear las 92 puertas dejó **213 tests
rojos en 31 ficheros**. Ninguno era un fallo de producto: 29 bancos de `apps/api/test` montan un
Prisma falso **sin modelo `tenant`**, y otros sólo exponen `findUniqueOrThrow`. La restricción del
prompt es que los tests existentes sigan verdes **sin tocarlos**, y ésta es la forma de cumplirla que
además es correcta por sí misma. Con la lectura tolerante quedó **un solo rojo**, y era legítimo
(§2.9).

**Lo que se paga:** si algún día `cajaEnabled` tuviera que ser una frontera de seguridad, esta
función no sirve. Está dicho en el propio fichero y en ADR-016 §6.

### 2.9 `/tpv/catalog/products` gatea DENTRO del handler, y es la única

Es el único rojo legítimo que dejó el cableado: `tpv-catalog-business-type.test.ts:158` afirma que el
tenant se consulta **sólo en la primera página**. Es correcto y viene de B4: un `preHandler`
añadiría una consulta por **cada cursor** de paginación. La puerta se movió al handler, sobre el
tenant que la primera página ya lee. Consecuencia asumida: las páginas 2+ no vuelven a mirar. El
cajero no llega ahí sin cruzar `/shift/cashier-login`, que sí lleva la puerta.

### 2.10 Tres rutas se quedan sin puerta a propósito

| Ruta | Por qué |
|---|---|
| `POST /shift/cashier-logout` | Salir tiene que funcionar **siempre**, también en el instante en que apagan la caja con un cajero dentro. Un 403 aquí lo deja atrapado en la pantalla de venta. |
| `/admin/stores` (CRUD) | La ficha fiscal del local es del negocio, no del TPV. Lo que cuelga de la caja **dentro** de la tienda (cajas registradoras, mesas, entrega de ticket) sí gatea. |
| `POST /devices/pair` | No tiene auth: el tenant sale del código de emparejamiento. Generar códigos (`/admin/pairing-codes`) **sí** gatea, así que sin caja no hay código que canjear. |

### 2.11 Ajustes NO va envuelto en `<CajaGate>`

Dentro vive "Módulos del negocio" (CRM y agenda), que es justo lo que una empresa sin caja viene a
tocar. La propia pantalla esconde sus secciones de caja. Si lo hubiera envuelto, `StaffPage` mandaría
al propietario de una academia a "Ir a Ajustes" y se encontraría una puerta cerrada.

### 2.12 El TPV cachea `cajaEnabled` con el default AL REVÉS que sus hermanos

`getCachedCrmEnabled()` devuelve `true` sólo si hay un `"1"`. `getCachedCajaEnabled()` devuelve
`true` salvo que haya un `"0"`. La columna es `@default(true)` y un TPV que **se esconde a sí mismo**
por no tener el flag en localStorage —primer arranque, caché limpiada, modo privado— sería el peor
fallo posible. La asimetría está comentada en el fichero y hay un test que la fija.

### 2.13 El 403 del arranque NO purga el device token

`caja-disabled` es una decisión nueva, no `purge`. El dispositivo sigue emparejado y su token sigue
siendo bueno: el día que le enciendan la caja a la empresa, **recargar basta**. Purgar obligaría a
volver a emparejar por una decisión comercial que se puede revertir en un clic.

### 2.14 Encender Holded más tarde: sólo desde `NOT_APPLICABLE`

Las dos rutas que ya guardaban una clave (super-admin y propietario) aprenden el salto, pero **sólo
desde `NOT_APPLICABLE`**. Desde cualquier otro estado la semántica de **rotación** se conserva: un
resync sorpresa a Thalía o La Maestranza por cambiar una clave comprometida sería un efecto colateral
caro. El encolado va **después** de persistir la clave: con la cola caída, la clave queda guardada y
el implantador reintenta con "Re-sync" sin volver a teclearla, y la respuesta lo dice
(`initialSyncQueued`).

### 2.15 El super-admin no se hace responsive, y se dice

`SuperAdminShell.tsx:121` tiene una barra lateral fija de 240 px sin variante móvil. Viene de
`b623f5c` y **no la he tocado**: es una herramienta de escritorio (el propio `superadmin/api.ts` dice
"la consola la usa Matías desde su equipo"). A 390 y 320 la consola entera es ilegible, en master
igual que en esta rama. Lo que sí he hecho es que **mi** formulario no añada desbordamiento por su
cuenta (`min-w-0`, grids que apilan). Arreglar el shell es otro bloque; está en §4.

### 2.16 Fuera de alcance, arreglado porque está en el camino: la razón social del panel

El backend escribe la razón social como `legalName` desde B-OnboardingV2; "Mi cuenta" sólo leía
`businessName`/`name`, así que salía **"—"**. Es anterior a este bloque y afecta a todos los
clientes, pero se notaba poco mientras el dato venía de Holded. Con el alta manual de H1 es lo que el
implantador acaba de teclear y **lo primero que mira el propietario al entrar** — exactamente el
criterio de hecho nº 1. Se añade el alias a la **lectura**; el guardado sigue escribiendo
`businessName`. Visible en `f6-panel-sin-caja-*.png`.

### 2.17 Ninguna columna extra, y ningún cron tocado

El prompt pedía justificar una tercera columna antes de crearla: **no hace falta ninguna**.
`usesHolded` se deriva de `holdedApiKeyCiphertext != null`, que es lo que ya mira todo el sistema.

Y ningún worker ni cron necesita cambio, **medido, no razonado**: los dos que barren tenants filtran
por `initial_sync_status = 'DONE'` **y** por clave presente; el resto parte de actividad (tickets,
turnos, `holded_upload`) que una empresa sin caja no genera. El e2e ejecuta la MISMA `where` del
worker contra Postgres con las dos filas delante.

---

## 3 · Sabotaje → test rojo

Doce roturas a propósito, cada una revertida después. Comando por fila; los mínimos que pedía el
prompt son S1, S2, S3, S4, S5 y S6.

| # | Qué rompo | Qué se pone rojo |
|---|---|---|
| **S1** | `required: ["holdedApiKey"]` en el alta | `h1-alta-sin-holded` → **10 de 15 rojos** |
| **S2** | `ready = checks.every(ok)` (sin filtrar por `applies`) | `h1-salud-modulos` → **2 rojos** ("está lista pese al catálogo vacío", "caja local") |
| **S3** | Quitar la rama `cajaEnabled === false` del `RootRouter` | `h1-panel-sin-caja` → **2 rojos** (los dos destinos sin caja) |
| **S4** | Quitar `ensureCajaEnabled` de `/cashiers` (sección escondida) | `h1-caja-gate` → **1 rojo** ("cashiers/routes.ts gatea 5 rutas") |
| **S5** | No mandar `cajaEnabled` en `/tpv/catalog/products` | `h1-caja-al-tpv` → **1 rojo** |
| **S6** | `DEFAULT false` en el `ADD COLUMN` de la migración | `h1-migracion-caja` → **2 rojos** (el contrato del SQL y el "nada de DEFAULT false") |
| **S7** | `estrenaHolded = true` (encolar también en una rotación) | `h1-holded-mas-tarde` → **3 rojos** (las dos rotaciones y el audit) |
| **S8** | `issueCashierPin = true` (PIN sin caja) | `h1-activacion-sin-caja` → **3 rojos** (PIN nulo, email sin PIN, audit) |
| **S9** | `CAJA_DISABLED` vuelve a decidir `retry` (el bucle del TPV) | `h1-caja-apagada` → **2 rojos** |
| **S10** | Invertir el default de la caché del TPV (`=== "1"`) | `h1-caja-apagada` → **2 rojos** (sin dato y valor basura) |
| **S11** | Quitar el invariante "al menos un módulo" del PATCH | `h1-alta-sin-holded` → **1 rojo** ("ni apagando de uno en uno") |
| **S12** | Quitar el corte de `<CajaGate>` | `h1-panel-sin-caja` → **1 rojo** |

El script vive en el scratchpad y **no entra en el repo** (es la herramienta, no el producto).
Aviso para quien lo repita: hace `git checkout <fichero>` para restaurar, así que hay que correrlo
con el árbol limpio — a mí me borró cambios sin commitear de `App.tsx` y tuve que rehacerlos.

---

## 4 · Lo que la suite NO cubre

Cruzado con los clientes reales, como pedía el prompt.

| Hueco | ¿Toca a alguien? | Qué haría |
|---|---|---|
| **La lectura tolerante del gate (§2.8)** no se ejercita contra un Prisma que lanza *en producción*. Los tests cubren "sin modelo", "fila ausente" y "columna ausente". | **A nadie hoy.** El fallo es hacia "encendido" = comportamiento de master. | Nada. Está declarado y es la dirección correcta. |
| **Las páginas 2+ del catálogo del TPV no llevan puerta** (§2.9). | **A nadie.** Sin caja no se obtiene sesión de cajero: `/shift/cashier-login` gatea. | Nada, salvo que algún día se pueda paginar sin login. |
| **Un cajero con sesión viva al que le apagan la caja** ve un 403 en la siguiente llamada, pero la frase la pinta el manejador genérico de error de cada pantalla, no una pantalla propia. No hay test. | **A Sole, Thalía, Cachitos y La Maestranza** — sólo si les apagásemos la caja, que es exactamente lo que no va a pasar. | Si alguna vez se apaga una caja en caliente, hacerlo con el turno cerrado. |
| **El super-admin a 390 y 320** es ilegible (§2.15). Pre-existente, en master igual. | **A Matías**, si alguna vez da de alta desde el móvil. | Un bloque de responsive para `SuperAdminShell`. No es éste. |
| **`/admin/contacts-import` no gatea por Holded en el servidor**: se esconde del sidebar, pero la ruta sigue viva y aborta con el error del worker. | **A nadie con Holded.** Al colegio, sólo si teclea la URL. | Una línea cuando exista un `ensureHoldedEnabled`; hoy no existe y no lo invento para esto. |
| **Los e2e no arrancan un worker de verdad**: se comprueba QUÉ se encola, no que BullMQ lo procese. | A nadie: es el mismo alcance que los e2e de S1 y B-5. | Nada. |
| **El flujo del TPV con caja apagada se prueba a nivel de decisión y de caché, no montando la PWA** en jsdom. La pantalla se verificó en el bucle visual (§5). | A nadie. | Un test de `App.tsx` del TPV si el estado se complica. |
| **Sole (caja + agenda)** y **Thalía / Cachitos / La Maestranza (caja + Holded)**: ningún hueco les toca. El e2e ejerce el alta con Holded, su TPV recibiendo catálogo y el backfill que les deja la caja encendida. | — | — |
| **El colegio (ni caja ni Holded)**: le falta su módulo, no una prueba. Ver §8. | — | — |

---

## 5 · Bucle visual

Chrome vía `playwright-core` en el scratchpad (no entra en el repo), a **1280×800, 390 y 320**,
`deviceScaleFactor: 2`, contra API + admin + TPV reales sobre una base propia
(`mipiacetpv_h1_visual`). Capturas en `docs/blocks/h1-shots/` (18).

| Captura | Qué enseña |
|---|---|
| `f3-alta-sin-holded-*` | La pregunta primero ("¿La empresa tiene Holded?"), los campos de Holded fuera, los tres módulos con caja apagada y la razón social obligatoria. |
| `f4-salud-no-aplica-*` | Los tres estados a la vez: dos en verde con "Cumple", cinco en gris con "No aplica · sin caja" / "· sin Holded". Chips de módulos encima. "Activar cuenta" habilitado. |
| `f5-activacion-sin-caja-*` | El banner verde con la contraseña y **la frase que dice que no hay PIN y por qué**. Sin hueco vacío ni `null`. |
| `f6-panel-sin-caja-*` | El panel del colegio: Tiendas, Personal, Importar clientes, Agenda, Mi cuenta, Seguridad. Sin banner rojo, sin Holded, sin PIN. |
| `f6-panel-con-caja-*` | La comparativa con Sole: sidebar completo, Holded "Conectada correctamente", PIN de respaldo. **Nada ha cambiado para ella.** |
| `f7-tpv-caja-apagada-*` | Una frase, un icono y "Reintentar". Sin spinner, sin vuelta al PIN. |

**Lo que el bucle encontró y el código no decía** (commit `420c83c`): el check **verde** sobre "No
conectada" en el panel del colegio; el PIN de respaldo de un TPV inexistente; ocho **403 en consola**
por pollear antes de saber si hay caja; "Modo prueba" con su nota ámbar sobre un sync que nunca
correrá; "Holded · Sin conectar" en **ámbar** —una alarma— para quien no lo usa; y la razón social en
"—" (§2.16).

---

## 6 · Frontera (no se ha cruzado)

Verificado con `git diff master...HEAD --stat`:

- **Camino de cobro**: `tickets/upload-ticket.ts`, `holded-upload-gate.ts`, `normalize-payments.ts`,
  `totals.ts`, `seal.ts` — **sin tocar**. En `tickets/routes.ts` sólo cambian las líneas de
  `preHandler`. Ni el GET-back, ni los 5 céntimos, ni `/pay`.
- **Triggers de S1**: ninguna migración los toca. La de H1 no menciona `tickets`, y hay un test que
  lo comprueba ("no toca ninguna tabla que no sea tenants").
- **Agenda**: `agenda/*`, `staff/*` — sin tocar. `agendaEnabled` sólo se lee.
- **Verifactu y posición fiscal**: sin tocar.
- **Catálogo local, fichaje, facturación del módulo, alta pública**: fuera, como pedía el prompt.

---

## 7 · Al desplegar

**La migración puede viajar sola. No necesita la ventana con la caja parada de S1.**

Son dos sentencias y ninguna toma un lock que se note:

1. `ALTER TYPE "InitialSyncStatus" ADD VALUE IF NOT EXISTS 'NOT_APPLICABLE'` — sólo escribe en el
   catálogo de tipos. Va primero y en su propio statement porque `ADD VALUE` no puede convivir con
   una sentencia que **lea** el valor nuevo; aquí no hay ninguna.
2. `ALTER TABLE "tenants" ADD COLUMN "caja_enabled" BOOLEAN NOT NULL DEFAULT true` — desde PG 11 un
   `ADD COLUMN NOT NULL DEFAULT <constante>` **no reescribe la tabla**: guarda el default en el
   catálogo y lo sirve a las filas antiguas. `ACCESS EXCLUSIVE` de milisegundos sobre `tenants`, que
   tiene decenas de filas.

A diferencia de S1, aquí **no hay `CREATE INDEX` ni `CREATE TRIGGER`**, que eran los que pedían
ventana.

Orden y comprobación:

```
pnpm --filter @mipiacetpv/db run migrate:deploy
# el backfill es el DEFAULT; se comprueba con:
SELECT name, caja_enabled, initial_sync_status FROM tenants ORDER BY created_at;
# los cinco de hoy tienen que salir con caja_enabled = t
```

Después del deploy, **nada cambia para nadie**: Sole, Thalía, Cachitos y La Maestranza quedan con
`caja_enabled = true` y su `initial_sync_status` intacto. El código nuevo sólo se activa cuando
alguien apaga la caja a propósito desde el super-admin.

**Si hubiera que volver atrás:** revertir el código basta. La columna sobra pero no molesta
(`DEFAULT true`), y `NOT_APPLICABLE` no se puede quitar de un enum en PG sin recrear el tipo — así
que **no se revierte la migración**, se revierte el despliegue.

---

## 8 · Qué hace falta para dar de alta al colegio

Hoy el colegio **se da de alta** (DRAFT, sin Holded, sin caja) y **no se puede activar**, porque el
invariante "al menos un módulo encendido" se lo impide: sus tres módulos son caja, CRM y agenda, y no
usa ninguno. **Su módulo, el control horario, no existe todavía.** Eso no es un fallo de este bloque:
es exactamente la frontera que el prompt puso.

Hay dos maneras de cerrarlo, y la primera es la mala:

1. **Encenderle el CRM** para que pase el check. Funciona hoy, sin tocar nada. Pero le da una sección
   de fichas de cliente que no va a usar y deja el sistema mintiendo sobre qué ha contratado. Vale
   como parche para una demo; no para facturar.
2. **`Tenant.fichajeEnabled`** — una columna hermana más, tres líneas en `computeOnboardingHealth`
   (`requires: "fichaje"`), una entrada en el sidebar y una en el alta. **Con eso el colegio se
   activa de verdad**, aunque el módulo esté vacío por dentro. Es media hora de trabajo y es lo que
   yo haría el primer día del bloque del fichaje.

Lo que **ya no hace falta** para el colegio, porque está hecho: el alta sin clave, la activación sin
PIN, la salud que no le exige un catálogo, el panel al que entra sin que le pidan Holded y el TPV que
no se queda girando.

---

## 9 · Qué falta para el bloque del fichaje

En orden, y con lo que este bloque ya deja resuelto entre paréntesis:

1. **`fichajeEnabled`** como capability (el patrón está: ADR-016 §3, una columna y un gate de 20
   líneas).
2. **El modelo**: jornada, fichaje de entrada/salida, incidencias, festivos y el cuadre mensual. Es
   lo único realmente nuevo.
3. **Quién ficha**: hoy `User` sirve al panel y a la caja. Un colegio tiene profesores que no son ni
   cajeros ni propietarios. Hay que decidir si el empleado es un `User` con rol nuevo o una entidad
   aparte — **es la primera decisión de producto del bloque, y no la tomo yo.**
4. **Dónde ficha**: el TPV es una caja; un colegio no la tiene. Hace falta una superficie propia
   (PWA de fichaje, QR, o el móvil del empleado), y eso arrastra su propio emparejamiento y su propio
   token. `/devices/pair` y el patrón de `deviceTokenHash` valen de plantilla.
5. **El informe**: el registro de jornada es una obligación legal con formato esperado. Antes de
   escribirlo hay que mirar qué exige la Inspección, igual que S1 miró Verifactu.
6. **La facturación del módulo**: hoy `plan` es un texto libre. Con dos productos que se venden por
   separado, deja de valer.

Lo que **ya no bloquea** al fichaje: que una empresa sin caja pueda existir, activarse y entrar en su
panel. Era el nivel 1, y está.

---

## 10 · Commits

| Hash | Frente |
|---|---|
| `ef22850` | Frente 0 · el plan y el inventario |
| `6048045` | F1 · datos (columna + enum + migración) |
| `ee468f5` | F2 · la puerta, 92 rutas |
| `1c704cd` | F3 · alta sin Holded + módulos |
| `301e594` | F4 · la salud por dependencias |
| `6bd2d54` | F5 · activación sin PIN |
| `da3916c` | F6 · el panel del cliente |
| `fb988c2` | F7 · el TPV |
| `6f65623` | F8 · Holded más tarde |
| `28f76c2` | e2e contra Postgres real |
| `0fcb2cb` | ADR-016 |
| `420c83c` | el bucle visual |
| _(el siguiente)_ | este documento |

**Último commit de código: `420c83c`.** Después va sólo este documento — su hash no puede
citarse aquí sin morderse la cola (`git log -1` lo da).

---

## 11 · Criterio de hecho, punto por punto

| Criterio | Cómo se comprueba |
|---|---|
| Alta sin clave, caja apagada, se activa y el OWNER entra sin que le pidan Holded ni vea el sync | `h1-empresa-sin-caja.e2e.ts` §3 (7 casos, Postgres real) + `f5` y `f6` |
| Esa empresa, desde el TPV, recibe un 403 con frase | e2e §3 + `h1-caja-gate` (36) + `f7-tpv-caja-apagada-*` |
| Un tenant de hoy se da de alta, se activa y opera igual que en master | e2e §1 (el backfill) y §4 + los 181 ficheros de master verdes sin tocar |
| Conectar Holded más tarde arranca el sync inicial de verdad | e2e §3 último caso + `h1-holded-mas-tarde` (12, las dos puertas) |
| Tabla de sabotaje con los seis mínimos | §3, doce roturas, las seis del prompt incluidas |
