# verifactu-1b · el dispositivo del modo prueba no es un terminal de caja

**Rama:** `verifactu-1b` (sale de `master` en 2f31585) · **Estado:** hecho, sin push, sin merge, sin
desplegar.

Addendum de `verifactu-1`, encontrado en la revisión previa al despliegue del 24-09. Corrige dos
cosas que verifactu-1 no vio y que, juntas, habrían dejado a un comercio sin poder cobrar desde una
pantalla interna nuestra.

---

## 1 · El fallo

El «modo prueba» del super-admin (`apps/api/src/superadmin/test-cashier.ts`, B-OnboardingV2) crea un
dispositivo **técnico** —`name = "mipiacetpv · modo prueba"`, `userAgent =
"internal/mipiacetpv-test"`— **en la misma caja que el terminal real del cliente**. Sirve para
validar el flujo del TPV antes de activar al propietario: no cobra a nadie, no imprime a nadie, y
sus tickets se purgan al activar.

verifactu-1 introdujo tres piezas que dan por hecho que toda fila de `devices` es un terminal de
caja. Con esas tres piezas, el dispositivo técnico rompía:

| # | Qué pasaba | Consecuencia |
|---|---|---|
| 1 | **Alta por primera vez.** `prisma.device.create` dispara `devices_revoke_previous` (BEFORE INSERT), que revoca todo lo activo de esa caja | Activar el modo prueba **revoca el terminal real del cliente**. El comercio se queda sin poder cobrar. Misma clase de incidente que el 04-09 |
| 2 | **Reactivación.** `update … revokedAt: null` sobre uno revocado choca con `devices_one_active_per_register_key` | 500 en el super-admin |
| 3 | **La precondición de la migración** contaba también estos aparatos | Abortaba el despliegue de comercios que están perfectamente bien |

Y la pregunta que había que contestar leyendo el código:

> **Una venta hecha en modo prueba en un comercio sin Holded, ¿genera registro fiscal y gasta número
> de la serie?**

**Sí.** Y no había nada que lo impidiera. El camino, leído entero:

1. `GET /tpv/fiscal/head` (`fiscal/routes.ts`) sólo miraba `emiteMipiacetpv(tenant)`. Con una sesión
   de prueba de un comercio sin Holded devolvía `emite: true`, con su serie, su número de instalación
   y la cabeza de la cadena **real** de la caja.
2. `CheckoutPage.tsx` genera el registro cuando `fiscalConfig?.emite` — sin mirar quién cobra — y
   `generarRegistroDeVenta` **avanza la cabeza antes de devolver**: el número queda gastado pase lo
   que pase.
3. `POST /tickets` lo ingesta: `comprobarGateFiscal` sólo comparaba `holdedEnabled` contra la
   presencia del `fiscalRecord`, y `ingestFiscalRecord` no sabe nada de cajeros técnicos.

`fiscal_records` es append-only (`fiscal_records_append_only`) y `purgeTestData` borra los tickets
`TEST` al activar el comercio. Las dos cosas juntas no tienen arreglo posible: o queda **un número
gastado apuntando a un ticket que ya no existe**, o queda **una factura de prueba en la cadena real
del cliente**. Ninguna de las dos se deshace, porque un registro de facturación no se borra.

---

## 2 · Lo que queda

### 2.1 `devices.kind` · el tipo va en el dato

```prisma
enum DeviceKind {
  TERMINAL   // aparato del cliente, emparejado con un código
  TEST       // el dispositivo del modo prueba
}
```

`devices.kind`, `NOT NULL DEFAULT 'TERMINAL'`. El `DEFAULT` **es** el backfill de todo lo que ya
existe: lo emparejado con un código es un terminal.

Es la propuesta de partida del prompt y no encontré nada mejor. Lo importante es **por qué en el
dato y no en el nombre**: un invariante que se decide comparando cadenas de texto se rompe el día
que alguien traduce el nombre o toca el user-agent del arranque — y lo que se rompía aquí era el
terminal de un cliente.

Las tres piezas filtran `kind = 'TERMINAL'`:

| Pieza | Antes | Ahora |
|---|---|---|
| Índice único | `ON devices(register_id) WHERE revoked_at IS NULL` | `… WHERE revoked_at IS NULL AND kind = 'TERMINAL'` |
| Trigger, el que entra | revoca siempre | `IF NEW.kind <> 'TERMINAL' THEN RETURN NEW` |
| Trigger, el que sale | `WHERE register_id = NEW.register_id AND revoked_at IS NULL` | `… AND kind = 'TERMINAL'` |
| Precondición | contaba todo lo activo | `AND d.kind = 'TERMINAL'` |

Y `test-cashier.ts` crea con `kind: TEST`, **busca** por `kind` y **revoca** por `kind`, no por
nombre. Un `updateMany` por `name` que no acierte dejaría el modo prueba vivo en un comercio ya
activado.

**No hay unicidad sobre los TEST**, y es deliberado: un dispositivo que no escribe en la cadena no
necesita ser único, y `provisionTestCashier` ya reusa el suyo. Hay un test que lo fija, para que
nadie lo lea como un olvido.

### 2.2 El backfill, con OR y no con AND

```sql
UPDATE devices
   SET kind = 'TEST'
 WHERE user_agent = 'internal/mipiacetpv-test'
    OR name = 'mipiacetpv · modo prueba';
```

El `user_agent` sólo se escribe en el `create` y nunca se vuelve a tocar, así que un aparato dado de
alta por una versión que no lo ponía se queda con el nombre y nada más. Con `AND`, ese aparato se
quedaría en `TERMINAL` y volvería el fallo entero. Marcar de más no es un riesgo simétrico: ningún
terminal de un cliente se llama así ni se anuncia con ese user-agent.

**Honestamente: sobre los datos de producción de hoy el `OR` no cambia nada.** Los seis dispositivos
técnicos que hay llevan las dos marcas (ver §5.5). El `OR` es defensa, no rescate — pero el caso que
cubre es el que devuelve el fallo, así que se queda, y hay un test que lo demuestra con un
dispositivo marcado sólo por el nombre.

### 2.3 Una venta en modo prueba no entra en la cadena

Tres puertas, de fuera adentro. La primera es la que corta de verdad; las otras dos son el espejo.

| Dónde | Qué hace |
|---|---|
| `GET /tpv/fiscal/head` | Si `cashier.isTest`, devuelve `{ emite: false }` **aunque el comercio emita**. Sin serie, sin instalación y sin cabeza, el terminal no genera nada y no gasta número. Va antes de leer el tenant: lo que decide esto es quién llama, no cómo factura el comercio |
| `apps/tpv-web/src/lib/fiscal.ts` | En modo prueba **no lee, no escribe, no pregunta y no genera** |
| `POST /tickets` y `/tickets/:id/checkout` | Si llega un `fiscalRecord` de una sesión de prueba, **se descarta** y la venta sigue. Log `fiscal.registro_de_prueba_descartado` |
| `POST /tickets/:id/fiscal-void` y `POST /fiscal/anulaciones` | **409 `FISCAL_TEST_MODE`** |

**Por qué la venta se descarta y la anulación se rechaza.** Una venta de prueba existe para validar
el flujo de cobro: tumbarla con un 409 por un dato que sobra dejaría el modo prueba sin poder cobrar,
y *cobrar siempre se puede*. Una anulación no cobra a nadie, así que rechazarla no deja a nadie
colgado — y un ingest silencioso ahí sí metería un registro de prueba en la cadena real.

**Por qué el TPV no lee ni escribe, en vez de «leer y no generar».** El estado fiscal vive en
`localStorage`, que el modo prueba **comparte** con las sesiones reales del mismo navegador: sus
tokens van en `sessionStorage` justo para no contaminarlas. Si el modo prueba escribiera ahí, le
dejaría a un terminal real de ese navegador la configuración y la cabeza de cadena equivocadas —
y una cabeza de cadena equivocada re-emite números ya entregados a un cliente. Por eso `leerEstado`,
`escribirEstado` y `clearFiscalState` están cerrados, no sólo el generador.

### 2.4 La migración, corregida en su sitio

`20260924000000_verifactu_1_registro` se corrige **en su sitio** en vez de añadir una segunda.

**Comprobado, no supuesto.** Las migraciones sólo se aplican en dos sitios: `infra/deploy.sh` (a
mano, en el VPS) e `infra/bootstrap-hostinger.sh`. El job `e2e` de CI levanta un Postgres de servicio
nuevo y `global-setup.ts` hace `DROP SCHEMA public CASCADE` antes de migrar, así que nunca conserva
nada. Y la prueba dura: en la copia de producción del 24-09, `_prisma_migrations` termina en
`20260923010000_fichaje_1_registro`. **`verifactu_1_registro` no ha corrido.**

Por qué en su sitio y no una migración nueva: entre la migración mala y la buena habría una ventana
—minutos en un despliegue, semanas si alguien para a medias— con el índice y el trigger malos vivos.
Esa ventana es exactamente el fallo. Y una segunda migración tendría que empezar por `DROP INDEX` y
`CREATE OR REPLACE FUNCTION` sobre objetos que nunca han existido fuera de un portátil.

`prisma format` realineó tres modelos (`Register`, `Device`, `Product`) que arrastraban desalineo de
bloques anteriores. Va en su propio commit (`chore(db): prisma format`, sólo espacios: `git diff -w`
sale vacío) para que el diff de este bloque se pueda revisar.

### 2.5 `verifactu-1-done.md` §7.2

La consulta de comprobación agrupaba por **nombre** de tienda y de caja. Sobre la copia real, eso
devuelve exactamente esto:

```
       name       |  name  | count
------------------+--------+-------
 Tienda principal | Caja 1 |    13
```

Una fila. Los seis comercios vivos tienen su tienda llamada «Tienda principal» y su caja «Caja 1»,
así que la consulta sumaba los trece dispositivos de seis clientes distintos y no decía a quién
llamar. Ahora agrupa por `r.id`, enseña el comercio y excluye los técnicos. La precondición de la
migración siempre agrupó bien por `r.id` y se ha dejado así.

Lo que **sí** se ha cambiado de la precondición, y lo encontró el ensayo: el mensaje de aborto no
nombraba al comercio, así que decía dos veces «Tienda principal / Caja 1» y había que ir a buscar el
UUID a mano para saber a quién llamar. Ahora lleva el comercio delante.

---

## 3 · Criterio de hecho · tabla de sabotaje

Cada sabotaje se aplicó de verdad sobre el árbol, se corrió la suite que lo cubre y se revirtió.
`RC≠0` = rojo = el test cubre lo que dice cubrir.

| # | Sabotaje | Dónde | Qué se pone rojo | RC |
|---|---|---|---|---|
| S1 | Quitar `IF NEW.kind <> 'TERMINAL' THEN RETURN NEW` del trigger | migración | `activar el modo prueba › crea el dispositivo técnico SIN revocar el terminal real` (+5 más en cascada) | 1 |
| S2 | Quitar `AND kind = 'TERMINAL'` del índice único parcial | migración | `reactivar el modo prueba › un técnico revocado se reactiva con el terminal real activo` (+5) | 1 |
| S3 | Quitar `AND kind = 'TERMINAL'` del `UPDATE` del trigger | migración | `emparejar un terminal nuevo › releva al terminal anterior y NO al técnico` | 1 |
| S4 | `body.fiscalRecord && !gateFiscal.descartarRegistro` → `body.fiscalRecord` (los dos sitios) | `tickets/routes.ts` | `una venta en modo prueba › el espejo lo descarta` y `la cadena del cliente sigue íntegra` | 1 |
| S5 | Quitar el `emite: false` del head y los dos 409 de anulación | `fiscal/routes.ts` | `el head no le da serie ni cabeza al modo prueba` y `las dos rutas de anulación le contestan 409` | 1 |
| S6 | Quitar `AND d.kind = 'TERMINAL'` de la precondición | migración | `la precondición › no cuenta dispositivos técnicos: con 1 TERMINAL + 1 TEST pasa` (1 test, limpio) | 1 |
| S7 | Backfill con `AND` en vez de `OR` | migración | `el backfill › marca TEST con CUALQUIERA de las dos` | 1 |
| S8 | Quitar las guardas de modo prueba de `fiscal.ts` | `tpv-web` | `no genera el registro de una venta` y `aunque haya un terminal real configurado` | 1 |
| S9 | `if (sesion?.isTest)` → `if (false)` | `fiscal/mode.ts` | tres casos del gate | 1 |

Los seis puntos que pedía el prompt están cubiertos: 1→S1, 2→S2, 3→S3, 4→S4+S8, 5→S4+S5, 6→S6.

**Nota honesta sobre las cascadas.** El e2e comparte estado entre `describe`s (un tenant, una caja,
una cadena), así que un sabotaje que rompe el estado temprano tumba también tests posteriores. En la
tabla va **el test que nombra el invariante roto**; los demás caen detrás. S6 es el caso limpio: un
único test rojo.

### 3.1 Suites

| Suite | Resultado |
|---|---|
| `pnpm test` (252 ficheros) | **2.723 pasan, 3 saltados, 0 fallan** |
| `pnpm test:e2e` (20 ficheros, Postgres real) | **298 pasan** |
| `infra/test/dockerfile-manifiestos.test.ts` | dentro del proyecto `infra`: 44 pasan |

Ficheros nuevos:

- `apps/api/test/verifactu-modo-prueba.test.ts` — el head, el gate y los 409 (10 tests).
- `apps/api/test/verifactu-1b-migracion.test.ts` — el contrato del SQL, **incluido el orden**: la
  columna y el backfill van antes de la precondición, del índice y del trigger. Si fueran después,
  la precondición abortaría contando técnicos y el `ALTER TABLE` ni llegaría a correr (10 tests).
- `apps/tpv-web/test/verifactu-modo-prueba.test.ts` — el dispositivo, y que no contamina al terminal
  real del mismo navegador (7 tests).
- `apps/api/test-e2e/verifactu-modo-prueba.e2e.ts` — los seis puntos contra Postgres (17 tests).

La precondición y el backfill **se leen de la migración** y se ejecutan tal cual. Una copia a mano en
el test se queda vieja, y entonces el test pasaría verificando un SQL que ya no es el que corre en
producción.

Se tocó un test de verifactu-1: `verifactu-ingesta.test.ts` comparaba el objeto del gate con
`toEqual`, y el campo `descartarRegistro` lo rompía. Sin sesión de prueba delante, el gate se
comporta exactamente igual que antes.

---

## 4 · Ensayo general sobre una copia real de producción

Copia: `~/Backups/mipiacetpv/prod-2026-09-24.dump` (`pg_dump -Fc`, 646 KB). Restaurada en
`mipiacetpv_ensayo`, base **nueva**, nunca encima de la de desarrollo. **Son datos reales de
clientes: no se han copiado al repo, no se han commiteado, y aquí van sólo agregados.** La base se
borró al terminar.

### 4.1 Punto 1 · restaurar

```bash
docker exec -i mipiacetpv-postgres psql -U mipiacetpv -c "CREATE DATABASE mipiacetpv_ensayo;"
docker exec -i mipiacetpv-postgres pg_restore -U mipiacetpv -d mipiacetpv_ensayo \
  --no-owner --no-acl < ~/Backups/mipiacetpv/prod-2026-09-24.dump
```

Sin errores. Y lo primero que se mira:

```
 migration_name                        | ok
---------------------------------------+----
 20260923010000_fichaje_1_registro     | t     ← la última aplicada
 20260923000000_fichaje_1_modulo       | t
 20260913000000_catalogo_local         | t
```

`verifactu_1_registro`: **0 filas**. `devices.kind`, `devices.revoked_reason`, `fiscal_records`,
`registers.fiscal_series`: **no existen**. Confirmado: verifactu-1 no ha corrido en producción.

### 4.2 Punto 2 · la foto de antes

```
comercio                                      | tickets | suma_total | turnos_abiertos
----------------------------------------------+---------+------------+-----------------
 Cafetería Sirope                             |      44 |     224.08 |               0
 Fouzia Attaoui Batah                         |       1 |      37.50 |               0
 Frutos Secos Cachitos                        |       3 |       4.70 |               0
 Librería Thalia                              |      20 |     562.20 |               0
 María Soledad Morán Segovia - Peluquería Sole|     270 |    8333.95 |               0
 PRUEBAS MIPIACE                              |       0 |       0.00 |               0

 comercios | cajas | devices | devices_activos | tickets | suma_total
-----------+-------+---------+-----------------+---------+------------
         6 |     6 |      30 |              13 |     338 |    9162.43
```

Dispositivos activos por caja, **agrupando por `r.id`** (columna `tecnicos` = los del modo prueba):

```
 comercio                 | caja_id                              | activos | tecnicos
--------------------------+--------------------------------------+---------+----------
 Cafetería Sirope         | 446fd941-32c8-44d2-8992-e406fa8adf3e |       6 |        1
 Fouzia Attaoui Batah     | 753b746f-9c7e-434c-94cd-b569d77f4ad3 |       1 |        1
 Frutos Secos Cachitos    | bab6c358-2a02-4c66-85b7-a422b20a0767 |       3 |        0
 Librería Thalia          | 50067b7e-cc39-4f6b-92e7-729ae05d9ff5 |       1 |        1
 Peluquería Sole          | 27080a8b-ad0f-4fe9-97df-51fe17d5c75c |       1 |        0
 PRUEBAS MIPIACE          | 170f2624-515f-4799-9583-a1e91569b021 |       1 |        0
```

Y `holded_enabled = true` en los seis. Ninguno emite sus facturas todavía, así que este despliegue no
enciende la cadena de nadie.

> **Dos comercios no tienen ningún terminal activo**: Fouzia y Thalía sólo tienen vivo el
> dispositivo del modo prueba. Es el estado que ya traía la copia, no lo provoca nada de este
> bloque — pero conviene saberlo antes de mirar las cuentas de después y pensar que se ha perdido
> algo.

### 4.3 Punto 3 · la migración aborta

```
Applying migration `20260924000000_verifactu_1_registro`
Error: P3018 · Database error code: 23514

ERROR: VERIFACTU_PRECONDICION: hay 2 caja(s) con más de un TERMINAL activo:
  · Cafetería Sirope · Tienda principal / Caja 1 (446fd941-32c8-44d2-8992-e406fa8adf3e): 5 terminales activos
  · Frutos Secos Cachitos · Tienda principal / Caja 1 (bab6c358-2a02-4c66-85b7-a422b20a0767): 3 terminales activos

Decide cuál se queda y revoca el resto desde el admin ANTES de volver a lanzar la migración.
Esta migración no revoca nada por su cuenta.
```

Exactamente Sirope y Cachitos, como se esperaba. Dos cosas que este punto enseñó:

1. **El dispositivo técnico ya no cuenta.** Sirope tiene 6 activos y la precondición dice 5; Fouzia y
   Thalía, con sólo su técnico, no aparecen. Antes de este bloque, Sirope habría abortado igual pero
   contando 6, y Fouzia y Thalía habrían pasado a tener su técnico como «el terminal».
2. **La migración es transaccional y no deja nada a medias.** Después del aborto: `devices.kind` no
   existe, el tipo `DeviceKind` no existe, `fiscal_records` no existe. Todo se deshizo.

Pero sí deja rastro en `_prisma_migrations` (`finished_at NULL`), y eso **bloquea el siguiente
deploy**. Hay que marcarla como revertida antes de reintentar:

```bash
pnpm --filter @mipiacetpv/db exec prisma migrate resolve \
  --rolled-back 20260924000000_verifactu_1_registro
```

Esto no estaba escrito en ningún sitio y es el paso que, sin el ensayo, se descubre con el despliegue
parado.

### 4.4 Punto 4 · la limpieza, y otra vez

En cada caja se queda **el que se vio por última vez, y sólo si es una tablet**. Los `Macintosh` son
portátiles del equipo que quedaron emparejados durante la implantación: no son terminales de cobro.

| Caja | Se queda | Se revoca |
|---|---|---|
| Sirope `446fd941` | `94ffd0dd` Android AP11-1006, visto **02-09** | `11250e41` (Android, 31-08), `96574fee` (Mac, 20-08), `5e0fd499` (Mac, 10-07), `96019c0d` (Android, 09-07) |
| Cachitos `bab6c358` | `f0845535` Android K, visto **26-06** | `70e0e35e` (Mac, 24-06), `338b65d3` (Android, 24-06) |

El técnico de Sirope (`13d434a2`) **no se toca**.

Los `id` van explícitos, uno a uno. Un `WHERE last_seen_at < …` revocaría por una regla, y una regla
que nadie ha mirado fila a fila es la forma de apagarle el terminal a un cliente.

Al correr **antes** de la migración, estas filas se quedan con `revoked_reason = NULL`: la columna
todavía no existe. Es coherente con lo que la propia migración dice de todo lo revocado hasta hoy —
no sabemos por qué se hizo y no se inventa.

Resultado: `UPDATE 6`. Sirope queda con 2 activos (1 terminal + el técnico) y Cachitos con 1.
Segundo `migrate deploy`: **`All migrations have been successfully applied.`**

### 4.5 Punto 5 · después de migrar

| Comprobación | Resultado |
|---|---|
| La foto del punto 2 | **Idéntica** salvo las dos filas de dispositivos activos que yo mismo revoqué (6→2 y 3→1, y el total 13→7). Tickets **338**, suma **9.162,43 €**, turnos abiertos **0**, comercios **6**, cajas **6**, `devices` **30**: iguales al carácter. **La migración no tocó ni una fila de negocio** |
| Toda caja con serie e instalación | 6 cajas, **0** sin serie, **0** sin instalación |
| Dos series iguales en un comercio | **0 filas**. Cada comercio tiene una caja y le tocó `C1` |
| `fiscal_records` | **0 filas** |
| `holded_enabled` | **6 con Holded, 0 sin Holded.** Nadie cambió |
| Backfill de `kind` | `TERMINAL` 24 (4 activos) · `TEST` 6 (3 activos) |
| El técnico de Sirope | `13d434a2` · `kind = TEST` · **activo** · sin `revoked_reason` |
| TERMINAL activos por caja | **1 en todas**. Ninguna con más de uno |

Y el dato honesto sobre el `OR` del backfill: de los 6 técnicos, **6 llevan las dos marcas**, 0 sólo
el user-agent, 0 sólo el nombre. Sobre los datos de hoy el `OR` no rescató nada.

### 4.6 Punto 6 · la API contra la copia

API levantada en `127.0.0.1:3111` contra `mipiacetpv_ensayo`. Dos cinturones para que **nada** salga
hacia Holded:

- **Ningún worker arrancado** (`ps` → 0 procesos `workers/index`). El job se encola y se queda ahí.
- **`HOLDED_KEY_ENCRYPTION_SECRET` distinto del de producción**: aunque algo intentara subir, no
  puede descifrar ninguna API key.
- Redis en el índice **9**, para no tocar las colas de desarrollo.

Comercio: **Cafetería Sirope**, que factura **con Holded**.

```
### 6.1 · el head fiscal de un comercio CON Holded
{"emite":false}

### 6.2 · abrir turno            → 201 · shift 2e7f55ff
### 6.3 · cobrar 12,10 €         → 201 · ticket 000021 · PENDING_SYNC · fiscalRecord null
### 6.4 · el mismo cobro MANDANDO un registro (APK equivocada) → 409 FISCAL_MODE_OFF
### 6.5 · emparejar un terminal nuevo → 201 · deviceId bf85c4b0
```

Comprobado en la base después:

```
 internal_number | status       | total | sin_documento_holded | registros_fiscales
-----------------+--------------+-------+----------------------+--------------------
 000021          | PENDING_SYNC | 12.10 | t                    |                  0

 total_registros_fiscales: 0        ← en TODA la copia

 device   | kind     | nombre                   | activo | revoked_reason | relevado_por
----------+----------+--------------------------+--------+----------------+--------------
 13d434a2 | TEST     | mipiacetpv · modo prueba | t      |                | —
 94ffd0dd | TERMINAL | Mozilla/5.0 (Linux; And… | f      | PAIRED_NEW     | bf85c4b0
 bf85c4b0 | TERMINAL | Tablet del ensayo        | t      |                | —
```

**El cobro entra igual que antes y no genera registro fiscal. El emparejamiento releva al terminal
anterior con su traza, y no al técnico.** Sobre datos reales, que es el punto.

En Redis quedaron las claves `bull:ticket-upload:*` con el job encolado y sin consumir: se ve que el
camino de Holded es el de siempre y que no salió nada.

### 4.7 Punto 7 · la vuelta atrás

Imagen anterior: **5c249cd** (90 commits por detrás de master; es el último antes de la serie que
lleva a verifactu-1). Worktree aparte, `pnpm install`, `prisma generate` con **su** schema — el
cliente Prisma de esa versión no conoce `kind`, ni `revoked_reason`, ni `fiscal_records`. Levantada
en `:3112` contra la copia **ya migrada**.

```
### 7.1 · abrir turno   → 409 (ya había uno abierto del punto 6; se reusa)
### 7.2 · cobrar 12,10 € → 201 · ticket 000022 · PENDING_SYNC
### 7.3 · emparejar      → 201 · deviceId 1c480fac
```

**La versión anterior cobra y empareja contra la base migrada.** La migración es aditiva y el código
viejo simplemente no selecciona las columnas nuevas. El emparejamiento incluso mejora: el trigger
revoca al anterior por él, cosa que la ruta vieja no hacía.

> ### 🔴 Pero hay una trampa, y hay que escribirla en rojo
>
> El `provisionTestCashier` **de la versión anterior** no sabe poner `kind`. Contra la base ya
> migrada:
>
> - Si el comercio **ya tiene** su dispositivo técnico (los seis de hoy lo tienen, backfilleado a
>   `TEST`), lo reactiva y no pasa nada. Comprobado con Sirope y con Cachitos.
> - Si el comercio **no lo tiene** —un alta nueva hecha ya en vuelta atrás—, lo **crea con
>   `kind = TERMINAL`** y el trigger **revoca el terminal real del cliente**. Comprobado con un
>   tenant sintético creado para esto:
>
>   ```
>    device   | kind     | name                     | activo | revoked_reason
>   ----------+----------+--------------------------+--------+----------------
>    eeee0000 | TERMINAL | Tablet del cliente       | f      | PAIRED_NEW     ← el del cliente
>    3f9aec1e | TERMINAL | mipiacetpv · modo prueba | t      |
>   ```
>
> **En vuelta atrás, no se usa el modo prueba del super-admin.** Para los seis comercios de hoy es
> seguro (todos tienen ya su fila `TEST`); para un alta nueva, no. Volver hacia adelante lo arregla
> solo.

Como la vuelta atrás **sí** funciona para cobrar y emparejar, el `pg_dump` inmediatamente antes no
es obligatorio. Va en el guion igual, porque la limpieza de dispositivos del paso 4 no se deshace
sola y cuesta treinta segundos.

---

## 5 · Guion de despliegue

Sale del ensayo, paso a paso. **Se para en cuanto algo no coincida con lo que dice la columna «qué
se mira».**

### Paso 0 · antes de tocar nada

```bash
ssh <vps>
docker exec -t mipiacetpv-postgres pg_dump -U mipiacetpv -Fc mipiacetpv \
  > ~/backups/pre-verifactu-1-$(date +%Y%m%d-%H%M).dump
ls -lh ~/backups/pre-verifactu-1-*.dump
```

**Qué se mira:** que el fichero existe y pesa lo esperado (≈650 KB hoy). **Si no:** no se sigue.

Restaurarlo, si hiciera falta:

```bash
docker exec -i mipiacetpv-postgres psql -U mipiacetpv -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='mipiacetpv' AND pid<>pg_backend_pid();"
docker exec -i mipiacetpv-postgres psql -U mipiacetpv -c "DROP DATABASE mipiacetpv;"
docker exec -i mipiacetpv-postgres psql -U mipiacetpv -c "CREATE DATABASE mipiacetpv;"
docker exec -i mipiacetpv-postgres pg_restore -U mipiacetpv -d mipiacetpv --no-owner --no-acl \
  < ~/backups/pre-verifactu-1-<sello>.dump
```

### Paso 1 · ver qué cajas van a abortar

La consulta del §7.2 de `verifactu-1-done.md`, **en su versión de antes de migrar** (todavía no hay
columna `kind`, así que mira los dos marcadores):

```sql
SELECT t.name AS comercio, s.name AS tienda, r.name AS caja, r.id AS caja_id,
       count(*) AS terminales_activos
  FROM devices   d
  JOIN registers r ON r.id = d.register_id
  JOIN stores    s ON s.id = r.store_id
  JOIN tenants   t ON t.id = s.tenant_id
 WHERE d.revoked_at IS NULL
   AND coalesce(d.user_agent, '') <> 'internal/mipiacetpv-test'
   AND coalesce(d.name, '')       <> 'mipiacetpv · modo prueba'
 GROUP BY r.id, t.name, s.name, r.name
HAVING count(*) > 1
 ORDER BY t.name, s.name, r.name;
```

**Qué se mira:** que salen **Sirope (5)** y **Cachitos (3)** y nadie más. **Si sale algún comercio
más**, alguien ha emparejado algo desde el 24-09: se para y se decide con Matías cuál se queda.

### Paso 2 · la limpieza de dispositivos

Preferiblemente **desde el admin** (`POST /admin/devices/:id/revoke`), que es donde queda traza de
quién lo hizo. Si se hace por SQL, es este, con los `id` explícitos:

```sql
BEGIN;
UPDATE devices SET revoked_at = now()
 WHERE revoked_at IS NULL
   AND id IN (
     -- Cafetería Sirope · se queda 94ffd0dd (el AP11-1006 de laboratorio)
     '11250e41-d67d-4eb2-8f5b-f1cb5cfb0b1d'::uuid,
     '96574fee-e162-439c-8c1c-7d9ebacde7a5'::uuid,
     '5e0fd499-b992-448a-9673-26337323ccb3'::uuid,
     '96019c0d-25ec-41cb-b05b-5420d8e78e88'::uuid,
     -- Frutos Secos Cachitos · se queda f0845535 (Android K, visto 26-06)
     '70e0e35e-c9b8-41bb-9f27-5939f833c071'::uuid,
     '338b65d3-b615-4154-ab02-dd36828802a6'::uuid
   );
COMMIT;
```

**Qué se mira:** `UPDATE 6`, y que la consulta del paso 1 ya no devuelve nada. **Si devuelve otro
número**, se para: los `last_seen_at` han cambiado desde el ensayo y hay que volver a decidir.

**Sirope no pierde nada y no hay que avisarlo.** Sirope es nuestro tenant de pruebas, y el terminal
que se queda —`94ffd0dd`, el AP11-1006— es **nuestro terminal de laboratorio** emparejado a él. Su
AP nunca llegó a funcionar: Sirope no cobra con ningún terminal. Revocar los otros cuatro no le quita
nada, y el día que se empareje el suyo de verdad, sustituirá al AP11 por el camino normal.

Esto matiza el criterio del §4.4 («se queda el que se vio por última vez, y sólo si es una tablet»):
en Sirope da el resultado correcto por casualidad, porque el que más recientemente se vio es
justamente el de laboratorio.

> **Cachitos sí.** Se queda sin las dos tablets que revocamos (`70e0e35e`, `338b65d3`). Hay que
> **avisarlos antes**: si alguien usaba una de esas, volverá a la pantalla de emparejar y necesita
> un código.

### Paso 3 · el despliegue

```bash
cd /srv/mipiacetpv && ./infra/deploy.sh
```

**Qué se mira:** `All migrations have been successfully applied.` y los healthchecks en verde.

**Si aborta con `VERIFACTU_PRECONDICION`:** es una caja que se coló entre el paso 1 y el 3. El
mensaje dice el comercio, la caja y el `register_id`. Hay que:

```bash
pnpm --filter @mipiacetpv/db exec prisma migrate resolve \
  --rolled-back 20260924000000_verifactu_1_registro
```

…volver al paso 2 con esa caja, y repetir. **Sin el `resolve`, el siguiente `deploy` no arranca.**
La base no se queda a medias: la migración es transaccional y el aborto lo deshace todo.

### Paso 4 · después de migrar

```sql
-- 1. ninguna caja con más de un TERMINAL
SELECT r.id, count(*) FROM devices d JOIN registers r ON r.id=d.register_id
 WHERE d.revoked_at IS NULL AND d.kind='TERMINAL' GROUP BY r.id HAVING count(*)>1;
-- 2. toda caja con serie e instalación
SELECT count(*) FILTER (WHERE fiscal_series IS NULL) AS sin_serie,
       count(*) FILTER (WHERE fiscal_installation_id IS NULL) AS sin_instalacion
  FROM registers WHERE deleted_at IS NULL;
-- 3. nadie ha cambiado de emisor
SELECT count(*) FILTER (WHERE NOT holded_enabled) AS comercios_que_emiten FROM tenants;
-- 4. los técnicos, marcados
SELECT kind, count(*) FROM devices GROUP BY kind;
-- 5. y las cuentas de siempre
SELECT count(*) AS tickets, sum(total)::numeric(14,2) AS suma FROM tickets;
```

**Qué se mira:** (1) **0 filas** · (2) **0 y 0** · (3) **0** — nadie emite todavía · (4) `TEST` = un
técnico por comercio · (5) **338 / 9.162,43 €** más lo que se haya cobrado entre medias. **Si (1)
devuelve algo o (3) no es 0, se para y se vuelve atrás.**

### Paso 5 · el humo

1. `GET /admin/fiscal/chains` desde el panel de Sirope. **Qué se mira:** responde, con las cadenas a
   cero.
2. El modo prueba de un comercio desde el super-admin. **Qué se mira:** el terminal real de esa caja
   **sigue activo** después de activarlo. Es el fallo que abre este bloque.

**Aquí no va un cobro real.** Cobrar de verdad en Sirope desde el AP11 dejaría un documento en el
Holded del cliente, y eso rompe el protocolo. El cobro de un comercio con Holded ya está probado
contra datos reales en el ensayo (§4.6, punto 6.3), donde no podía salir nada hacia fuera: sin
worker y con la clave de cifrado de Holded cambiada.

### Y la vuelta atrás

`IMAGE_TAG=<anterior> ./infra/deploy.sh` (sin volver a migrar: las migraciones no se desaplican).
Cobra y empareja. **No se usa el modo prueba mientras se esté en la versión anterior** — ver §4.7.

---

## 6 · Lo que este bloque NO hace

- **No toca los contadores de «dispositivos activos» del panel del cliente** (`stores/routes.ts`) ni
  la lista de `GET /admin/devices`. Siguen contando el técnico. No es el invariante de este bloque
  —ése es «un TERMINAL activo por caja», y vive en la base— y cambiarlo mueve lo que ve el cliente
  sin que nadie lo haya pedido. Queda anotado: hoy, Fouzia y Thalía ven «1 dispositivo» cuando lo
  que tienen es el nuestro.
- **No cambia el gate de borrar una caja** (`REGISTER_HAS_DEVICES`), que sigue contando el técnico.
  Fallar hacia «no se puede borrar» es la dirección correcta.
- **No añade unicidad sobre los `TEST`.** Ver §2.1.
- **No arregla que dos comercios no tengan terminal activo.** Es estado previo y es una llamada de
  teléfono, no un commit.

---

## 7 · Commits

```
f8fd74f chore(db): prisma format
4b2dcbf fix(verifactu-1b): el dispositivo del modo prueba no es un terminal de caja
334e4b5 fix(verifactu-1b): una venta en modo prueba no entra en la cadena
2a88333 test(verifactu-1b): los dos tipos de dispositivo, contra Postgres de verdad
aa5abd9 fix(verifactu-1b): la precondición dice a qué comercio llamar
```

Más el commit de este documento.
