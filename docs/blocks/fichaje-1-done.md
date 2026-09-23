# F1 · fichar desde el móvil y cumplir la ley — DONE

Origen: el prompt de Matías del 23-09-2026. Rama `fichaje-1`, worktree `mipiacetpv-fichaje-1`.
Base: `5aa0a20` (master con **A5** `08caf79` y **catálogo local** `41882ba` dentro, comprobado
con `git merge-base --is-ancestor` antes de la primera línea). **Sin push, sin deploy.**
**Con DOS migraciones** — ver §7.

Frente 0: `docs/blocks/fichaje-1-plan.md`. Decisión estructural:
`docs/design/adr-018-el-registro-de-jornada-es-inalterable.md`.

**Lo que este bloque compra.** Un colegio de Talavera que lleva meses sin registro de jornada
cumple el **art. 34.9 del Estatuto de los Trabajadores** desde el primer día: cada profesor
ficha entrada y salida desde su móvil, puede corregirse con motivo sin que el original
desaparezca, y la secretaría le enseña el registro a la Inspección en PDF o en CSV. Sin caja,
sin Holded y sin app nueva.

---

## 1 · Lo que hay ahora

| Pieza | Dónde |
|---|---|
| **La capability** — `fichaje_enabled BOOLEAN NOT NULL DEFAULT false` | `schema.prisma` · `migrations/20260923000000_fichaje_1_modulo/` |
| **La puerta** — 403 `FICHAJE_DISABLED`, patrón ADR-016 con la dirección del fallo invertida | `apps/api/src/lib/fichaje-gate.ts` |
| El cuarto módulo en el alta, el PATCH y la salud | `superadmin/tenants.ts` (`MODULE_FIELDS`) · `superadmin/onboarding-health.ts` |
| **El registro de jornada** — 5 tablas, 4 triggers, 3 funciones | `migrations/20260923010000_fichaje_1_registro/` |
| La vía de corrección del lado de la aplicación | `apps/api/src/fichaje/corrections.ts` |
| El tiempo (UTC ↔ Europe/Madrid, reutilizando `agenda/time.ts`) | `apps/api/src/fichaje/time.ts` |
| «Enviado sin conexión», derivado | `apps/api/src/fichaje/offline.ts` |
| Cómo se lee un registro (una forma para las cuatro superficies) | `apps/api/src/fichaje/view.ts` |
| **La API del empleado**, versionada | `apps/api/src/fichaje/routes.ts` (`/fichaje/v1/*`) |
| La identidad del móvil (3ª puerta de auth del sistema) | `apps/api/src/fichaje/auth.ts` · `fichaje/context.ts` |
| **La API del panel** | `apps/api/src/fichaje/admin-routes.ts` (`/admin/fichaje/*`) |
| **El export a la Inspección** — PDF (pdf-lib) y CSV | `apps/api/src/fichaje/export.ts` |
| **La pantalla de fichar** | `apps/admin/src/fichar/` + `main.tsx` (la bifurcación) |
| El service worker de ámbito `/fichar` y el manifest | `apps/admin/public/fichar-sw.js` · `fichar-manifest.webmanifest` |
| La cola local con `holdUntil` (el deshacer de 4 s) | `apps/admin/src/fichar/lib/outbox.ts` |
| **Las tres pantallas del panel** | `apps/admin/src/pages/fichaje/` |
| `<FichajeGate>` y la sección del sidebar | `apps/admin/src/FichajeGate.tsx` · `AdminShell.tsx` |
| El aterrizaje de una empresa con fichaje y sin caja | `apps/admin/src/App.tsx` (`landingSinCaja`) |
| El token nuevo `tap-fichar` (208 px) | `docs/design/tokens.md` §4 · `apps/admin/tailwind.config.js` |

**Tests nuevos: 9 ficheros, 117 casos** (suite) **+ 5 ficheros, 92 casos** (e2e).

| Fichero | Casos |
|---|---|
| `apps/api/test/f1-fichaje-gate.test.ts` | 10 |
| `apps/api/test/f1-modulo.test.ts` | 11 |
| `apps/api/test/f1-superadmin-fichaje.test.ts` | 8 |
| `apps/api/test/f1-puertas-del-modulo.test.ts` | 18 |
| `apps/api/test/f2-registro-migracion.test.ts` | 18 |
| `apps/api/test/f3-fichaje-tiempo.test.ts` | 21 |
| `apps/admin/test/f5-fichar-outbox.test.ts` | 9 |
| `apps/admin/test/f5-fichar-lectura.test.ts` | 11 |
| `apps/admin/test/f6-panel-fichaje.test.ts` | 11 |
| `apps/api/test-e2e/f2-registro-inalterable.e2e.ts` | 24 |
| `apps/api/test-e2e/f3-fichar.e2e.ts` | 24 |
| `apps/api/test-e2e/f4-panel.e2e.ts` | 16 |
| `apps/api/test-e2e/f7-export.e2e.ts` | 11 |
| `apps/api/test-e2e/f8-colegio.e2e.ts` | 17 |

**Suite: 234 ficheros, 2514 verdes, 3 saltados** (`pnpm test` desde la raíz, tras
`pnpm db:generate`). Base de master: **225 / 2397 / 3**, derivada por resta de los 9 ficheros y
117 casos nuevos — no medida corriendo la suite en el árbol de master, que es de otra sesión
(«un árbol, un escritor»). **Los 3 saltados son los de siempre:** `super-admin.test.ts:566`, un
`describe.skip` del flujo legacy de B-SuperAdmin, anterior a este bloque. **Ni uno nuevo**, que
es el número que hay que mirar.

**e2e: 17 ficheros, 247 verdes** contra `mipiacetpv_fichaje_e2e` (12 ficheros y 155 casos de
antes + 5 y 92 de F1). Base borrada al terminar (§8).

**master no se ha movido** durante el bloque: `git log HEAD..master` vacío al cerrar.

### 1.1 La forma final del dato

```
Tenant.fichajeEnabled          Boolean NOT NULL DEFAULT false

employees                      (tenant, nombre, email?, teléfono?, userId?, active)
  UNIQUE (tenant_id, user_id)
employee_devices               (tenant, empleado, sha256(token), pairedAt, revokedAt)
  UNIQUE (employee_id) WHERE revoked_at IS NULL      ← un móvil activo
employee_pairing_tokens        (tenant, empleado, sha256(token), expiresAt, consumedAt)
time_entries                   (tenant, empleado,
                                started_at / ended_at            ← la hora que cuenta
                                *_device_at / *_server_at        ← la procedencia, INMUTABLE
                                start_source / end_source,
                                start_external_id / end_external_id)
  UNIQUE (employee_id) WHERE ended_at IS NULL        ← un tramo abierto
  CHECK ended_at > started_at
  CHECK (ended_at IS NULL) = (end_source IS NULL) = (ended_server_at IS NULL)
time_entry_corrections         append-only (campo, antes, después, motivo+texto,
                                autor+tipo, txid, fecha)
  CHECK field IN ('started_at','ended_at')
  CHECK reason_code <> 'OTRO' OR reason_text <> ''
  CHECK (EMPLOYEE ⇒ employee_id) AND (PANEL ⇒ user_id)

+ record_time_entry_correction(...)   SECURITY DEFINER, la ÚNICA vía
+ mipiacetpv_time_correction_exists(entry, campo)   mira txid_current()
+ 4 triggers: correcciones append-only, guard de horas, no-borrar fichaje,
              no-borrar empleado con fichajes
```

Dos migraciones, las dos **aditivas**. Se despliegan juntas (§7).

---

## 2 · Decisiones tomadas sin preguntar

Van una a una, con su porqué. Las siete primeras estaban en el prompt como «decisiones
tomadas» y se han implementado tal cual; las que siguen son mías y aparecieron al escribir el
código.

### 2.1 Las del prompt, confirmadas

| Decisión | Cómo ha quedado |
|---|---|
| Empleado con `User` opcional y sin enlace a `StaffProfile` | `employees.user_id` nullable, `@@unique([tenantId, userId])`. Al leer `StaffProfile` se confirmó: es la agenda (quién atiende qué servicio con qué recurso), y fichar no es atender. |
| Móvil personal, enlace de un solo uso, un móvil activo, sin PIN | Índice parcial único + claim atómico. Revisado el PIN y **sin objeción**: añadiría fricción a lo único que el empleado hace, y la palanca real —móvil perdido— ya existe y es mejor. |
| El emparejamiento del móvil es propio; los terminales siguen colgando de una caja | Tablas y rutas nuevas. `devices/routes.ts` y `devices/auth.ts` **no se han tocado ni una línea**. |
| Corrección del propio empleado sin aprobación, con motivo de un toque e historial append-only | ADR-018 §4. Lo que impide que sea un agujero no es un jefe que aprueba: es que el valor anterior no se puede borrar. |
| La salida olvidada se pregunta, nunca se cierra sola | ADR-018 §5. Es el sabotaje nº 7 de §3. |
| La pantalla de fichar vive dentro de `apps/admin`, sin tocar Caddy | §2.4. Ni una línea de `infra/`. |
| `fichajeEnabled` sólo desde el super-admin | Entra en `MODULE_FIELDS`; `POST /admin/tenant/settings` no lo acepta. |

### 2.2 `requireOwnerOrManager`, no `requireOwner`, en el panel

**Por qué:** en un colegio, quien da de alta a un profesor y le corrige un olvido es la
secretaría, no la dirección. Es el mismo reparto que ya vale para cajeros y dispositivos
(B6 §1), y el MANAGER es precisamente el rol que B-OnboardingV2 creó para la operativa diaria.

**Coste asumido:** un MANAGER puede corregir el registro de cualquiera. Queda trazado con su
nombre, que es la garantía que este bloque da.

### 2.3 El fichaje de SALIDA no exige corrección

La decisión está argumentada entera en **ADR-018 §3.2** y es la frontera del bloque: el
`INSERT` del tramo tampoco deja traza y nadie lo echa en falta, porque **la fila ES el
registro**; cerrar el tramo ocho horas después es el mismo acto. El dato se sella cuando queda
**completo** (misma frontera que ADR-015), y desde ahí sólo se corrige.

Para que un `UPDATE` a pelo desde psql no se cuele por esa puerta, el trigger exige que el
mismo `UPDATE` traiga la procedencia (`ended_server_at` y `end_source`). Está probado: el e2e
«cerrar SIN decir de dónde sale la hora se rechaza».

### 2.4 La pantalla de fichar: `/fichar` en el SPA, service worker de ámbito `/fichar`

El prompt pedía que viviera en `apps/admin` y que no se tocara Caddy. Las tres piezas:

1. **`/fichar` llega por el `try_files` que ya sirve `/admin/*`.** Ni una línea de Caddyfile.
2. **`main.tsx` bifurca con dos imports dinámicos.** `App.tsx` importa de forma estática las
   ~30 pantallas del panel; servirle eso al móvil de un profesor para enseñarle un botón sería
   absurdo. Medido en el build: **26 kB (8 gzip)** la rama de fichar contra **405 kB** la del
   panel.
3. **El service worker vive en `/fichar-sw.js`** —fichero real, servido por `try_files`— y se
   registra con ámbito `/fichar`. Un ámbito **más estrecho** que el directorio del script
   siempre está permitido, así que no hace falta la cabecera `Service-Worker-Allowed` (que sí
   obligaría a tocar Caddy). **No puede controlar `/admin/*` ni `/superadmin/*` ni con un bug**,
   que es el fallo de `v1.2-Lite` Lote 3.B y de A4 repetido sobre el super-admin.

El manifest y las metas de iOS se **inyectan en runtime** desde la rama de fichar: un
`<link rel="manifest">` estático en `index.html` dejaría el panel del propietario instalable
como «Fichar».

**Lo que esto choca con el admin, y cómo se evita:** el login (`/fichar` no pasa por
`RootRouter` ni por `readTokens()`; la identidad es el token del móvil, y sin él la pantalla
dice qué hacer en vez de mandar a `/login`), la CSP (`default-src 'self'` ya cubre
`manifest-src`, y `worker-src` cae en `script-src 'self'`: nada que añadir) y el service worker
(punto 3).

### 2.5 El «deshacer 4 s» no borra nada en el servidor

No podía ser un `DELETE` —los registros de jornada no se borran, es media razón de ser del
bloque—, así que el toque se persiste en IndexedDB **ya**, con `holdUntil = ahora + 4 s`, y el
flush **salta** los items cuyo plazo no ha vencido.

Con eso se cumplen las dos cosas a la vez: si el empleado mata la app dentro de esos cuatro
segundos el fichaje **sobrevive** y se envía al arrancar, y si pulsa «Deshacer» **nunca existió**
en el servidor. Es el sabotaje nº 12.

### 2.6 Una corrección no puede apuntar al futuro

400 `CORRECTION_IN_FUTURE`, con el mismo margen de cinco minutos que el toque. Con el selector
del móvil es un resbalón de un dedo dejar dicho que se salió a las 20:00 siendo las 11:00, y
eso son nueve horas que nadie ha trabajado **en un documento que se le enseña a la Inspección**.

### 2.7 Un alta manual desde el panel se lee como alta, no como «08:00 → 08:00»

El prompt pide que añadir un fichaje pase por la **misma función** y el **mismo motivo** que una
corrección. Eso deja una fila de traza con el mismo valor a los dos lados, porque la fila existe
antes de que se escriba la traza. Se expone como `kind: "ALTA" | "CAMBIO"`, **derivado**
(`oldValue === newValue`), para que el historial y el PDF no pinten un cambio donde no lo hay.

### 2.8 El export se baja por `fetch` + blob, no por `window.open`

`window.open` no lleva cabeceras, así que habría que meter el access token en la URL — y una
URL con un token dentro acaba en el historial del navegador, en los logs de Caddy y en el
portapapeles de quien la copie. El registro de jornada de una empresa entera no vale eso.

### 2.9 Tres tests existentes de H1 han tenido que cambiar

**Es la única excepción a «los tests existentes siguen verdes sin tocarlos»**, y se hace a
propósito. `h1-salud-modulos.test.ts:206` y `h1-alta-sin-holded.test.ts:260,285` hacen `toEqual`
estricto sobre el mapa `modules`, y añadirle `fichaje` los rompe.

La alternativa era que la clave apareciera **sólo cuando el módulo está encendido**. Eso dejaría
la API peor para siempre y empeoraría con cada módulo nuevo. Las tres líneas ahora afirman
`fichaje: false`, que **es** la prueba de no-regresión, escrita donde se ve.

### 2.10 Un token nuevo fuera de la escala táctil: `tap-fichar`, 208 px

Añadido a `docs/design/tokens.md` §4 **con su justificación, antes de implementarlo**, como
manda la regla de ese documento. El botón de fichar no es «un control de uso diario», es **el
acto**: se pulsa entrando por una puerta con el bolso en la otra mano, sin mirar, una vez por
jornada. Está en el orden de la tarjeta de producto del TPV (22-26 mm, que las pruebas físicas
del 27-08 dieron por sobradas) y no en el de una tecla. A 320 px deja 56 px de margen a cada
lado.

Es el **único** control del sistema fuera de la escala de tres peldaños, y el token está ahí
para que siga siéndolo.

---

## 3 · Tabla de sabotaje

Cada fila se ha **ejecutado**: parche aplicado, suite corrida, resultado copiado, parche
revertido. Los once mínimos del prompt están, más dos.

| # | Qué rompo | Qué se pone rojo |
|---|---|---|
| 1 | Quitar el trigger append-only de `time_entry_corrections` | `f2-registro-inalterable.e2e` ×2 («una corrección no se edita», «no se borra») **y** `f2-registro-migracion` «la tabla de correcciones es append-only, por trigger» |
| 2 | Quitar el índice parcial de «un tramo abierto por empleado» | `f2-registro-inalterable.e2e` «no deja abrir un segundo tramo del mismo empleado (lo garantiza la BASE)» |
| 3 | Corregir sin motivo (guarda de la función SQL + CHECK de `OTRO` + pre-comprobación del servidor) | `f2-registro-inalterable.e2e` ×2 **y** `f3-fichar.e2e` «"Otro" sin texto no se escribe» |
| 4 | Que un enlace ya usado vuelva a emparejar | `f3-fichar.e2e` «el enlace empareja el móvil y deja de valer» **y** `f8-colegio.e2e` ×6 (el recorrido del colegio se cae entero desde el paso 6) |
| 5 | Que emparejar un móvil nuevo no revoque el anterior | `f3-fichar.e2e` «emparejar un móvil nuevo REVOCA el anterior» |
| 6 | Que el token de un empleado lea los fichajes de otro | `f3-fichar.e2e` ×2 («no ve el fichaje de otro», «no ve nada de otro tenant») |
| 7 | Cerrar la salida olvidada sola con el toque de hoy | `f3-fichar.e2e` «la salida olvidada NO se cierra con el toque normal» |
| 8 | Guardar la hora de llegada en vez de la del toque | `f3-fichar.e2e` ×2 («un tramo completo», «un toque que llega tres horas tarde guarda LA HORA DEL TOQUE») **y** `f8-colegio.e2e` ×5 |
| 9 | Olvidar `ensureFichajeEnabled` en `/admin/fichaje/today` | `f4-panel.e2e` «sin el módulo, ninguna de estas rutas existe», `f8-colegio.e2e` «no ve NADA del control horario» **y** `f1-puertas-del-modulo` «GET /admin/fichaje/today lleva el gate» |
| 10a | `ensureCajaEnabled` en el **fichaje del empleado** | `f1-puertas-del-modulo` «la API del empleado no la menciona siquiera». **Los e2e NO se ponen rojos, y hay que saber por qué** — ver abajo. |
| 10b | `ensureCajaEnabled` en el **panel** del módulo | `f4-panel.e2e` + `f8-colegio.e2e`: **23 casos**. Un colegio con `caja_enabled = false` recibiendo 403 en cada pantalla del único módulo que ha comprado. |
| 11 | Que la migración deje `fichaje_enabled DEFAULT true` | `f8-colegio.e2e` «una fila que no la nombra, tampoco lo tiene» **y** `f1-modulo` ×2 («DEFAULT false», «NO backfillea a true por ninguna vía») |
| 12 | Que el flush ignore `holdUntil` (adiós al deshacer) | `f5-fichar-outbox` ×2 («el item no sale mientras el plazo no vence», «un item con el plazo vivo no se considera enviable») |
| 13 | Calcular el total restando horas de pared en vez de instantes | `f3-fichaje-tiempo` ×4, incluidas las dos noches del cambio de hora |

### 3.1 El nº 10a merece su párrafo

Cuando se ejecutó por primera vez, **ningún test se puso rojo**. La razón: `caja-gate.ts`
resuelve el tenant desde `request.auth`, `request.cashier` y `request.device`, y el empleado
viaja en `request.employee`, que no mira. El sabotaje era **inerte**.

Inerte hoy y una bomba el día que alguien añada `employee` a `resolveTenantId` de la caja: en
ese momento, y sin que nada avise, el colegio dejaría de poder fichar.

Se cerró con `f1-puertas-del-modulo.test.ts`, que **lee el código fuente** —mismo instrumento
que H1 usó para contar sus 92 puertas— y afirma que ninguna de las dos superficies del módulo
menciona `ensureCajaEnabled` ni `caja-gate`. Ahora se pone rojo ya.

---

## 4 · El bucle visual

29 capturas a **320, 390 y 1280×800** en `docs/blocks/fichaje-1-shots/`, más el PDF de
septiembre entero (`export.pdf` y sus dos páginas rasterizadas).

| Pantalla | Capturas |
|---|---|
| Fichar, fuera | `fichar-fuera-{320,390}` |
| Fichar, dentro con el contador | `fichar-dentro-{320,390}` |
| El banner de deshacer | `fichar-deshacer-{320,390}` |
| La salida olvidada (con propuesta y con selector) | `salida-olvidada-{320,390}`, `salida-olvidada-selector-{320,390}` |
| Corregir con motivo | `corregir-motivo-{320,390}` |
| El historial de una corrección | `corregir-historial-{320,390}` |
| «Pendiente de enviar» sin red | `sin-red-{320,390}` |
| El enlace caducado / ya usado | `enlace-caducado-{320,390}` |
| Panel · Hoy | `panel-hoy-{390,1280}` |
| Panel · Empleados, y el enlace | `panel-empleados-{390,1280}`, `panel-enlace-1280` |
| Panel · Registro, corregir y añadir | `panel-registro-{390,1280}`, `panel-corregir-1280`, `panel-anadir-1280` |
| El PDF exportado | `export.pdf`, `export-pdf-p{1,2}-1280` |

**Catorce cosas las encontró el bucle visual, no un test.** Van con su porqué porque casi todas
son decisiones, no erratas:

1. La hoja de corregir no cabía a 390×760 y el botón de guardar se quedaba fuera **sin forma de
   llegar a él**. `max-h` + scroll, y el botón pegado al borde inferior de la hoja.
2. La rueda de horas abría en `00` con la hora elegida fuera de vista: el selector parecía
   vacío. Se centra la fila activa al abrir…
3. …y el centrado necesitaba `relative` en el contenedor: sin él, `offsetTop` se medía contra
   la hoja entera y la columna quedaba a mitad de la lista.
4. Al tocar «Entrar» se leía **«0h 00m»** bajo el botón — que es EXACTAMENTE lo que este bloque
   le critica a Holded. El contador no aparece hasta el primer minuto.
5. Un día con el tramo abierto mostraba «0h 00m» de total. Ahora dice **«En curso»**.
6. Doce filas idénticas de «lun 21 · 08:00 → 17:30»: los dos días que importan pasan a tener
   nombre, **Hoy** y **Ayer**.
7. «Martes, 22 de septiembre no fichaste la salida» obliga a hacer la cuenta de qué día fue.
   El caso normal es ayer, y **«ayer» se entiende sin pensar**.
8. «Tienes 4 segundos» era texto fijo que mentía a los tres. Fuera.
9. El registro del panel pintaba **dos filas por día** —cabecera de grupo + tramo— y repetía el
   total en las dos. El 90% de los días tienen un solo tramo: ahora es una fila.
10. Cada empleado ocupaba 180 px porque los tres botones caían a una segunda línea; una
    plantilla de diez no cabía en pantalla.
11. Y al arreglarlo, «Móvil desde el 17 sept» se partió en **tres líneas encima del botón**: la
    columna se encogía por debajo de su texto.
12. El sidebar repetía «Horario ·» en las tres entradas.
13. A 390 el badge «Corregido» empujaba el total fuera de la fila y se leía «10h 10».
14. En el PDF: el autor y la fecha de cada corrección **se salían por la derecha y la frase se
    cortaba a media palabra** (en el documento que se le enseña a la Inspección, «quién y
    cuándo» es lo que no puede cortarse); el segundo tramo de un día partido salía sin fecha y
    flotaba; y cada corte de página dejaba media hoja en blanco.

Y **una la encontró el e2e**: `→` (U+2192) no existe en WinAnsi, la codificación de las fuentes
estándar de PDF, así que `pdf-lib` reventaba con un 500 al generar el export. Dos columnas,
«Antes» y «Después». El CSV sí la aguantaba, que es por lo que no saltó antes.

---

## 5 · Qué NO cubre la suite

Y qué pasa con cada cliente real. **Ninguno de los cuatro huecos toca al colegio en el día 1**;
el que más cerca queda se explica en §5.6.

### 5.1 El service worker de `/fichar` no lo prueba nada automático

Lo que está probado es el **ámbito** (una constante en `pwa.ts` y el fichero en `public/`) y
que la cola local funciona sin red (`f5-fichar-outbox`, con `fake-indexeddb`). Lo que **no**:
que el SW registre, cachee el shell y sirva la pantalla con el avión activado. Eso necesita un
navegador real sobre un build servido por HTTPS, y ni jsdom ni el bucle visual en `vite dev` lo
dan.

**Mitigación de diseño:** el fichaje **no depende del SW**. Vive en IndexedDB desde el instante
del toque y se reenvía solo; sin SW se pierde el arranque sin red, no el fichaje. El registro
va en un `catch` que no rompe nada.

- **Colegio:** es el único al que le importa, y es el caso del sótano. **Hay que probarlo a
  mano en el móvil del primer profesor** — está en los pasos de §9.
- **Sole, Thalía, Cachitos, La Maestranza:** no les llega. El SW no existe fuera de `/fichar`.

### 5.2 Web Share y el portapapeles

`navigator.share` y `navigator.clipboard.writeText` se llaman desde `EnlaceModal` y no hay test:
jsdom no los implementa y Playwright headless tampoco los ejerce de verdad. Los dos van en
`try/catch` y el enlace **está a la vista en la hoja** para seleccionarlo a mano, así que el
peor caso es un copiado manual.

- **Colegio:** peor caso asumible. Se ve en `panel-enlace-1280`.
- **Los demás:** no les llega.

### 5.3 El PDF se lee como texto, no como maqueta

`f7-export.e2e` extrae el texto con `pdf-parse` y comprueba **qué pone** y **en qué orden** (las
correcciones al final, el hueco de firma, el pie). Lo que no comprueba es que **no se solapen
columnas**: eso lo vio el bucle visual y lo arregló, pero un nombre de empleado muy largo
—«María del Carmen Fernández-Escalona»— podría volver a pisar la columna de al lado y **ningún
test lo detectaría**.

- **Colegio:** apellidos compuestos son perfectamente posibles en un claustro. **Es el hueco más
  cercano a morder**, y por eso está en §9 como comprobación del día 1 con los nombres reales.
- **Los demás:** no les llega.

### 5.4 La concurrencia real de los índices parciales

Los dos índices parciales únicos están probados **secuencialmente** (insertar, que falle). Lo
que no hay es un test que lance dos `INSERT` **a la vez** desde dos conexiones. La garantía es
de Postgres, no nuestra, y por eso se eligió un índice en vez de un `if`; pero la afirmación
«dos toques simultáneos no crean dos tramos» descansa en el motor y no en una prueba.

- **Todos:** el riesgo es el mismo y es muy bajo. Un índice único en Postgres es exactamente la
  herramienta para esto.

### 5.5 La zona horaria es fija

`Europe/Madrid`, constante compartida con la agenda. No hay test de otra zona porque no hay otra
zona. Un cliente en Canarias daría **una hora de diferencia en todo el registro**.

- **Colegio (Talavera), Sole, Thalía, Cachitos, La Maestranza:** todos peninsulares. No muerde.
- **A vigilar:** la primera venta fuera de la península obliga a `Tenant.timeZone`. Es una
  columna y un parámetro; hoy sería inventar un problema.

### 5.6 Lo que se arregla en esta rama porque sí encaja con un cliente

**Sole tiene caja y agenda, y algún día podría fichar.** Ese cruce sí está cubierto y se ha
comprobado a propósito:

- Un tenant con **caja y fichaje a la vez** apaga la caja sin quedarse sin módulos
  (`f1-superadmin-fichaje` «apagarle la CAJA a quien ya ficha deja de ser un 400»).
- El sidebar de un tenant con **agenda y fichaje** enseña las dos secciones, y «Personal»
  (agenda) y «Empleados» (fichaje) son entradas distintas con iconos distintos. Se renombraron
  en el bucle visual justo para que no se confundan.
- `landingSinCaja` pone la **agenda por delante** del fichaje: un tenant con agenda que hoy
  entra en `/admin/agenda-catalog` **sigue entrando ahí**. Nadie se mueve de sitio.

---

## 6 · Criterio de hecho, punto por punto

| Criterio | Cómo se comprueba |
|---|---|
| Una empresa sin caja ni Holded, con fichaje como único módulo, se da de alta y se activa. Su OWNER da de alta un empleado y le genera el enlace. El empleado lo abre, ficha entrada y salida, y el panel lo ve en Hoy y en Registro. Todo con `cajaEnabled = false` | `f8-colegio.e2e` §«el colegio de Talavera», pasos 1→9, contra Postgres real |
| Sin red, el fichaje entra igual, se envía al volver y guarda la hora del toque | `f5-fichar-outbox` (persistir antes de enviar, reintento tras fallo de red) + `f3-fichar.e2e` «un toque que llega tres horas tarde guarda LA HORA DEL TOQUE» + la captura `sin-red-{320,390}` |
| Con una salida olvidada, al día siguiente se le pregunta, contesta con un toque y queda como corrección OLVIDO. El registro original sigue ahí | `f8-colegio.e2e` pasos 10 y 11 (afirma explícitamente que `started_at` y `started_device_at` no se han movido) + `f3-fichar.e2e` ×4 |
| Un UPDATE o DELETE a mano en psql sobre un fichaje o una corrección falla | `f2-registro-inalterable.e2e`, 24 casos, **cada sabotaje por `$executeRawUnsafe`** — SQL directo, como lo escribiría alguien con acceso al VPS |
| El PDF y el CSV de un mes salen con las correcciones al final y las horas bien a ambos lados del cambio de hora | `f7-export.e2e` («las correcciones van al final…», «la noche del 24→25-10-2026 cuenta NUEVE horas, no ocho», «la zona sale con su nombre a cada lado») + `export.pdf` |
| Un tenant de hoy opera exactamente igual que en master y no ve nada del fichaje | `f8-colegio.e2e` §«un tenant de hoy», 4 casos + los 225 ficheros de master verdes con las tres líneas de §2.9 como única excepción |
| Tabla de sabotaje con los once mínimos | §3, trece roturas ejecutadas de verdad |

---

## 7 · Al desplegar

**Las dos migraciones viajan solas, sin ventana.**

- `20260923000000_fichaje_1_modulo` es un `ADD COLUMN ... NOT NULL DEFAULT false`. Desde PG 11
  eso **no reescribe la tabla**: guarda el default en el catálogo y lo sirve a las filas
  antiguas. Sin bloqueo largo y sin `UPDATE` masivo. `tenants` tiene decenas de filas.
- `20260923010000_fichaje_1_registro` sólo **crea objetos nuevos**: cinco tablas vacías, sus
  índices, tres funciones y cuatro triggers. No toca ni una fila ni una columna de lo que ya
  existe. Los triggers cuelgan de tablas que nacen en esa misma migración, así que no pueden
  interferir con nada en vuelo.

Comprobado ejecutándolas contra Postgres real (`prisma migrate deploy` sobre una base migrada
desde cero, 17 ficheros de e2e después). **Drift de Prisma sobre las tablas nuevas: cero**
(`migrate diff` limpio).

**El orden importa y lo garantiza el timestamp**: el módulo antes que el registro. Si sólo
corriera la primera, el sistema quedaría con la columna y sin tablas — y como nadie tendría el
módulo encendido, tampoco pasaría nada.

**Nada más que hacer.** Ni Caddy (no se ha tocado `infra/`), ni variables de entorno nuevas, ni
un contenedor nuevo. El `Dockerfile` ya copia `apps/admin/dist` entero, así que `/fichar`, el
service worker, el manifest y los iconos viajan con el build del admin.

> **Una corrección al prompt, para que conste.** El prompt dice que «deploy.sh no recarga
> Caddy». Hoy **sí**: el paso 6.b compara el sha256 del `Caddyfile` antes y después del `git
> pull` y hace `docker restart mipiacetpv-caddy` si cambió. No altera nada —no se ha tocado el
> Caddyfile igualmente— pero la razón para no tocarlo pasa a ser otra: reiniciar Caddy corta el
> SSL de todos los hosts.

> **Otra, sobre ADR-016 §3.1.** Dice que `additionalProperties: false` devuelve 400 si el
> propietario intenta mandar `cajaEnabled`. **No es cierto en este servidor**: Fastify arranca
> con el default de AJV `removeAdditional: true`, así que la propiedad se **descarta en
> silencio**. La garantía que importa se cumple igual (no llega al handler, la columna no se
> mueve) y `f1-modulo` la fija con esa forma; pero el código de estado no es el prometido. **No
> se ha cambiado la configuración global de AJV**: afectaría a las 92 rutas de H1 y a todo lo
> demás.

---

## 8 · La base del e2e

Se usó `mipiacetpv_fichaje_e2e`, **propia de esta sesión**, nunca la compartida: la suite hace
`DROP SCHEMA` y había otras sesiones vivas.

```
docker exec -i mipiacetpv-postgres psql -U mipiacetpv -d postgres \
  -c "DROP DATABASE IF EXISTS mipiacetpv_fichaje_e2e;"
```

Ejecutado al cerrar el bloque.

---

## 9 · Dar de alta al colegio y ponerle a fichar a su primer profesor

Los pasos exactos, en orden.

1. **Super-admin → Tenants → Nuevo.** Responder que **no** usa Holded. Módulos: **sólo control
   horario** (caja, CRM y agenda apagados). Razón social y NIF del colegio — son un check duro
   de la activación y van en la cabecera del PDF que se firma.
2. **Comprobar la salud** en el detalle del tenant: `Al menos un módulo encendido` debe decir
   «control horario», y los checks de caja y de Holded deben salir como **«No aplica»**. `ready`
   en verde sin un solo producto ni cajero.
3. **Activar**, con el email de la dirección o de la secretaría. El email de bienvenida **no
   habla de PIN ni de Holded** (eso ya lo arregló H1). El OWNER nace **sin PIN de cajero**.
4. El OWNER entra y **aterriza en Control horario → Hoy**, vacío.
5. **Empleados → Dar de alta.** Nombre del profesor; email y teléfono son opcionales y no se
   usan para nada todavía.
6. **Generar enlace** → **Copiar** (o **Compartir**, en móvil) y **pasárselo por donde hablen**.
   El servidor no manda nada. El enlace vale **una vez** y caduca a los **7 días**.
7. El profesor lo abre **en su móvil**. Queda emparejado y ve su botón.
8. **Que lo instale**: Compartir → «Añadir a pantalla de inicio» (iOS) o el aviso de instalar
   (Android). Sin instalar funciona igual, pero el icono es lo que hace que lo use.
9. **Las tres comprobaciones del día 1, a mano**, que son justo lo que la suite no cubre (§5):
   - **En el sótano o en modo avión**: abrir la app instalada, tocar «Entrar», comprobar que
     sale «Pendiente de enviar», volver a tener red y ver que el fichaje aparece en el panel
     **con la hora del toque**.
   - **Exportar el PDF del mes con los nombres reales del claustro** y mirar que ningún nombre
     largo pisa la columna de al lado.
   - **Dejar un tramo abierto a propósito** un día y comprobar al siguiente que la pregunta sale
     la primera, con la hora propuesta, y que se contesta de un toque.
10. Repetir 5–8 con el resto del claustro.

**Si un profesor pierde el móvil:** Empleados → **Generar enlace** otra vez. El anterior queda
revocado en la misma transacción. **Si alguien se va:** **Dar de baja** — desactiva y revoca el
móvil, y sus cuatro años de registro siguen intactos (los triggers no dejan otra cosa).

---

## 10 · Qué falta para F2

En orden de lo que el colegio va a pedir primero:

1. **Jornada teórica y cuadre contra ella.** Es lo que falta para que «quién no ha fichado hoy»
   deje de significar «no ha aparecido» y pase a significar algo, y para poder decir si alguien
   hizo horas de más o de menos. Sin esto el producto **registra** pero no **informa**.
2. **Festivos, ausencias y vacaciones.** Un colegio tiene Semana Santa y un claustro con días de
   asuntos propios; hoy esos días salen simplemente vacíos en el registro.
3. **Pausas.** El bloque las dejó fuera a propósito y el modelo no las acomoda: llegarán con su
   propia tabla, no con columnas nuevas en `time_entries`.
4. **La app nativa de la fase 2.** La API que consumirá ya existe y está versionada
   (`/fichaje/v1`). Lo que la app aporta sobre la PWA es notificación push fiable en iOS —que es
   la razón por la que el aviso de la salida olvidada sale hoy al abrir y no antes.
5. **La consulta remota de la Inspección por API.** Cuando el RD se apruebe y haya formato.
6. **La facturación del módulo.** `plan` sigue siendo texto libre, y con dos productos que se
   venden por separado deja de valer. Era el punto 6 de `h1-done.md` §9 y sigue abierto.
7. **Terminales sin caja**, si alguna vez hace falta un punto de fichaje compartido (un tótem en
   la entrada) en vez del móvil personal.

---

## 11 · Commits

| Hash | Frente |
|---|---|
| `1f25a2a` | Frente 0 · el plan |
| `e0d6327` | F1 · el módulo (columna, gate, super-admin, salud) |
| `c801c2e` | F2 · el registro inalterable (tablas, triggers, funciones) |
| `b97407f` | F3 · la API del empleado (`/fichaje/v1`) |
| `e900795` | F4 · la API del panel (`/admin/fichaje`) |
| `1442191` | F5 · la pantalla de fichar (PWA, cola local, deshacer) |
| `2248fe4` | F6+F7 · el panel y el export |
| `10c013b` | F8 · ADR-018 y el criterio de hecho contra Postgres |
| `135e4fe` | Las puertas del módulo contadas por fichero (sabotaje 10a) |
| `380cd6b` | El bucle visual · 29 capturas y el PDF |
| _(el siguiente)_ | este documento |

**Último commit de código: `135e4fe`.** Después van las capturas y este documento — su hash no
puede citarse aquí sin morderse la cola (`git log -1` lo da).
