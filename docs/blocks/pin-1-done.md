# Bloque pin-1 · mi PIN lo elijo yo — DONE

Origen: `docs/code-prompts/bloque-pin-1-mi-pin.md`, escrito el 27-10-2026. Rama `pin-1-mi-pin`,
worktree `mipiacetpv-pin-1`. Base `134d16f` (el merge de `personal-1` en master). **Con UNA
migración** — ver §6. **Sin despliegue.** Con `origin/master` mergeado al final (`503354a`, el
merge de `clinica-10`), para que la CI del PR vea la combinación de verdad.

**Lo que este bloque compra.** Cada persona que entra con PIN —propietaria, encargado, cajero,
sanitario— **entra con un PIN que ha elegido ella y que recuerda**, y quien lo olvida lo recupera
sin llamar a Mi Piace. El 27-10, en la pasada de clinica-9, se perdió el PIN de la propietaria dos
veces en la misma mañana: las dos hubo que ir a super-admin → «Configurar como OWNER» →
«Regenerar PIN», que daba cuatro cifras al azar y las enseñaba una vez. Ese camino se acaba.

---

## 1 · Lo que hay ahora

| Pieza | Dónde |
|---|---|
| **La marca «este PIN no es suyo todavía»** — `users.pin_provisional_at` + su CHECK | `migrations/20261027020000_pin_1_mi_pin/` · `schema.prisma` |
| **El registro de cambios de PIN** — `pin_changes`, sin el PIN | la misma migración · `model PinChange` |
| Las reglas del PIN (formato, triviales, PIN de soporte), puras | `apps/api/src/auth/pin.ts` |
| El token de «elige tu PIN antes de entrar» | `apps/api/src/auth/pin-eleccion.ts` |
| Escribir el PIN **y** registrarlo, en una transacción | `apps/api/src/auth/pin-registro.ts` |
| `POST /auth/me/pin` · cambiar el mío, con el actual | `apps/api/src/auth/routes.ts` |
| `POST /auth/me/pin/elegir` · la propietaria, sin el actual | la misma |
| `POST /auth/me/regenerate-owner-pin` · sólo soporte, deja PROVISIONAL | la misma |
| `POST /shift/cashier-pin` · donde el personal elige el suyo | `apps/api/src/shift/cashier-auth.ts` |
| El login del TPV, que ya no emite sesión con un PIN prestado | la misma |
| Las cuatro puertas que filtran el PIN prestado | `shift/cashier-auth.ts` · `shift/routes.ts` · `tables/routes.ts` · `admin/manager-authorize.ts` |
| «Mi PIN del TPV» / «Elige tu PIN» en Mi cuenta | `apps/admin/src/App.tsx` (`MiPinSection`) |
| «PIN provisional del propietario», sólo en sesión de soporte | la misma (`PinDeSoporteSection`) |
| La hoja del PIN del TPV, en sus dos modos | `apps/tpv-web/src/components/CambiarPinSheet.tsx` |
| «Cambiar mi PIN» en el cajón del TPV | `apps/tpv-web/src/pages/SalePage.tsx` |
| «Cambiar mi PIN» en la cabecera de la agenda, para el sanitario | `apps/tpv-web/src/pages/AgendaPage.tsx` (`onCambiarMiPin`) · `App.tsx` (`AgendaDelSanitario`) |
| El cuarto estado del panel de soporte: `PIN_PROVISIONAL` | `apps/api/src/superadmin/tenant-cashiers.ts` · `CashiersPanel.tsx` |
| Banco visual del panel (nuevo) | `apps/admin/visual/` |

**Tests nuevos: 9 ficheros, 153 casos.**

| Fichero | Casos |
|---|---|
| `apps/api/test/pin-1-reglas.test.ts` | 35 |
| `apps/api/test/pin-1-provisional.test.ts` | 24 |
| `apps/api/test/pin-1-cambiar-mi-pin.test.ts` | 23 |
| `apps/api/test/pin-1-elegir-y-soporte.test.ts` | 13 |
| `apps/api/test/pin-1-migracion.test.ts` | 13 |
| `apps/api/test/pin-1-correos.test.ts` | 8 |
| `apps/tpv-web/test/pin-1-cambiar-pin.test.tsx` | 15 |
| `apps/admin/test/pin-1-mi-cuenta.test.tsx` | 13 |
| `apps/tpv-web/test/pin-1-agenda-mi-pin.test.tsx` | 9 |

Y **cinco bancos de la casa ampliados, no bajados**: `contrato-lectura-completa-pin` (su
invariante sale más fuerte: ahora NINGÚN camino genera un PIN), `h1-activacion-sin-caja`,
`onboarding-v2`, `super-admin-tenant-cashiers` (la lista de claves que pueden hablar de PIN crece
con `pinProvisional`; lo que no baja es lo prohibido) y `clinica-8-cajeros` / `cashiers-alias`
(sus PIN de atrezzo dejan de ser triviales).

**Suite: 496 ficheros, 7 396 verdes, 10 saltados** (`pnpm test` desde la raíz, tras
`pnpm db:generate`, con master mergeado). Base en este árbol antes de la primera línea:
**482 / 7 171 / 10**. Ni un saltado nuevo. `tsc --noEmit` limpio en los tres paquetes, uno a uno.

---

## 2 · Los siete puntos, uno a uno

### 1 · Cambiar mi PIN, cualquier rol que entra con PIN

`POST /auth/me/pin` con `{ currentPin, newPin }`, y **el mismo endpoint desde los dos sitios**: el
panel (access token de OWNER o MANAGER) y el TPV (sesión de cajero). Por eso el `preHandler` es
`requireOwnerOrCashier`. Dos endpoints paralelos habrían sido dos sitios donde escribir el filtro
de triviales, el contador de intentos y el registro del punto 7.

La repetición del PIN **no viaja**: existe para cazar una errata que no se ve, y eso lo ve la
pantalla mejor que el servidor. Lo que viaja son dos PIN.

La ruta **no tiene `:userId`**, y es deliberado: escribe siempre sobre el usuario de la sesión. Es
la forma de que «un cajero no puede cambiar el PIN de otro» no dependa de una comprobación que
alguien pueda quitar. El PIN de otra persona se cambia por `PATCH /cashiers/:id/pin`, que pide
OWNER o MANAGER y deja el PIN **provisional**.

Dónde está el botón:

* **panel** → Mi cuenta → «Mi PIN del TPV», con los tres campos a la vista (sin abrir nada: la
  decisión del bloque es «mínimos clics»);
* **TPV** → el cajón → «Cambiar mi PIN», justo encima de «Bloquear»;
* **TPV del sanitario** → la cabecera de la agenda, junto al ⋯ de las ausencias. Su TPV es sólo
  la agenda, así que es donde tiene que estar. El botón lo pinta `AgendaPage` con el prop
  `onCambiarMiPin`, y **sólo lo pasa su rama**: esa barra no tiene píxeles de sobra a 390 (la
  lección de B-reservas-5 F8), y la cajera ya lo tiene en el cajón.

### 2 · Olvidé mi PIN, la propietaria

`POST /auth/me/pin/elegir` con `{ newPin }` y **sin el actual**. No es un atajo: para llegar ahí
hay que tener sesión del panel, y a esa sesión se llega con email, contraseña y el 2FA si lo tiene.
Pedirle además el PIN que acaba de olvidar es pedirle lo que no tiene.

En pantalla es «He olvidado mi PIN», que quita el campo del actual. **«Regenerar PIN» desapareció
de Mi cuenta** — es lo que el bloque viene a quitar.

Dos negativas, y las dos en la ruta y no en el botón:

* **un MANAGER no llega** (`requireOwner`). Decisión tomada sin preguntar: el punto 2 dice «la
  propietaria» y el punto 3 mete al encargado en el camino del personal — su PIN se lo repone
  quien le dio de alta y él elige el suyo al entrar. Es también lo conservador: la propietaria es
  la titular de la cuenta; un encargado es personal.
* **una sesión de soporte tampoco.** `requireOwner` acepta el JWT de «Configurar como OWNER» como
  si fuera el OWNER desde v1.3-SuperAdmin-Hub. Sin el `isImpersonation === true`, Mi Piace podría
  dejarle a la propietaria un PIN **definitivo** elegido por Mi Piace, que es justo lo que el
  punto 5 prohíbe.

Y elegirlo **limpia el candado** de los cinco intentos: tendría el PIN nuevo en la mano y la caja
cerrada quince minutos, que es exactamente el momento en que lo necesita.

### 3 · Olvidé mi PIN, el personal

El gesto de la dueña no cambia: Cajeros → «PIN provisional». Lo que cambia es **qué queda puesto**.

Un PIN con `pin_provisional_at` sirve para una cosa y nada más: entrar al TPV UNA vez y elegir el
propio. En concreto:

1. **el login no emite sesión.** Contesta `200 { mustChoosePin: true, pendingPinChangeToken, user }`
   — sin `sessionToken` y sin `shiftState`. La negativa está en la emisión y no en una pantalla
   que se pueda saltar con la consola del navegador abierta;
2. **no cuenta como acceso**: `lastLoginAt` no se toca. «Último acceso» en Cajeros tiene que
   seguir queriendo decir «entró»;
3. **no autoriza un descuento** (`manager-authorize`), **ni anula una mesa** (`tables/routes.ts`),
   **ni firma un cierre con incidencia** (`shift/routes.ts`). Las tres con el mismo 401/403
   genérico de siempre: no se revela por qué;
4. **no viaja en el roster offline.** Si viajara, bastaría con quitar la wifi para saltarse la
   pantalla que obliga a elegirlo.

La bifurcación del login va **después** de comprobar el PIN: al revés, contestar «tienes que
elegir uno» le diría a cualquiera que ese email existe y que acaban de reponerle el PIN.

Y el token que emite el login (`purpose: "pin-eleccion"`, 10 min, con el `deviceId` dentro) **no
es un pase**: `POST /shift/cashier-pin` relee de la base que el PIN SIGA siendo provisional. En
cuanto su dueña elige el suyo, el token que sobró no vale para nada — para cambiarlo después está
`/auth/me/pin`, que pide el actual.

Tras elegirlo, la pantalla **reintenta el login sola** con el PIN nuevo: ya lo ha tecleado dos
veces, no se le pide una tercera.

### 4 · Primer acceso

**Nadie genera un PIN para nadie.** Se fueron las tres fuentes:

| Dónde | Qué hacía | Ahora |
|---|---|---|
| `POST /auth/login` | OWNER sin PIN → cuatro cifras + pantalla «apúntalo, sólo se muestra una vez» | nada |
| `POST /super-admin/tenants/:id/activate` | generaba el PIN, lo devolvía y lo mandaba por correo | nada; `ownerPin: null` siempre |
| `invite-email.ts` / `welcome-email.ts` | «· PIN: 4817» y «Puedes cambiar tu PIN en cualquier momento desde el panel» | sin PIN; el de invitación dice DÓNDE elegirlo |

La frase de los correos era **mentira**: no existía la pantalla. Ahora existe y el correo la
nombra con su rótulo real («Mi cuenta» → «Elegir PIN»), con el formato que la API acepta de
verdad (4 a 8 cifras) y diciendo que se puede cambiar cuando quiera. Hay un test por cada una de
las tres cosas.

Se fue también el **parámetro** `ownerPin` de las dos plantillas, no sólo su uso: mientras no haya
por dónde meter un PIN, no puede volver por descuido. El banco lo comprueba leyendo el fuente.

Para el personal, el «primer acceso» es el punto 3: el PIN del alta nace provisional.

`cashierPinIssued` se queda en la respuesta de `activate` y en la auditoría, con otro significado:
ya no es «le hemos dado un PIN» sino «esta cuenta tiene caja, o sea, tiene un PIN que elegir». Es
lo que el implantador necesita saber con el cliente delante y lo que decide si el correo habla de
PIN (H1: en una residencia no hay TPV al que entrar).

### 5 · Super-admin

`POST /auth/me/regenerate-owner-pin` se queda, con dos cambios:

* **deja el PIN PROVISIONAL**, no definitivo. La respuesta lo dice (`provisional: true`) para que
  quien lo lea por teléfono sepa que la dueña va a tener que elegir el suyo;
* **sólo desde una sesión de soporte** (`isImpersonation === true`). La propietaria de verdad
  tiene «Elegir PIN», que le deja el que ella teclea; dejarle también este botón sería mantener
  vivo justo lo que el bloque quita. El 403 le dice por dónde sí.

Y el PIN al azar que genera **nunca es trivial**, ni cuando la suerte saca 1234: sería absurdo que
el sistema generara un PIN que él mismo rechaza al cambiarlo.

El panel de soporte gana un cuarto estado, `PIN_PROVISIONAL`, y no es cosmético: tiene PIN puesto
y `canOpenTpv: false`. Decir `ACTIVE` era contestar «sí» a la pregunta equivocada justo en la
pantalla que Mi Piace mira cuando alguien llama diciendo que no puede entrar.

### 6 · El bloqueo por intentos

Sigue igual (5 fallos → 15 min) y **protege también el «PIN actual»** del punto 1. Lo hace en el
**mismo cubo** que el login del TPV (`cashier-login-attempts:<tenant>:<email>`), que es la
decisión que importa: con dos cubos, adivinar el PIN desde «cambiar el mío» saldría gratis
mientras el login se queda bloqueado. Es la misma credencial; es el mismo contador.

Acertar el PIN actual lo limpia. Y el sexto intento recibe 429 aunque el PIN sea el bueno: el
candado es del contador, no del intento.

### 7 · Auditoría

Tabla `pin_changes`: `tenant_id`, `target_user_id`, `actor_user_id`, `kind`
(`PROPIO` | `PROVISIONAL`), `source` (`PANEL` | `TPV` | `PERSONAL` | `SOPORTE`), `created_at`.
**Sin el PIN**, y la forma de que eso sea verdad para siempre es que no haya columna donde
ponerlo — hay un test que enumera las columnas.

Se escribe **en la misma transacción que el `pin_hash`**: o las dos, o ninguna. El riesgo asumido
—si `pin_changes` no se puede escribir, nadie cambia su PIN— es el mismo que ya tiene `users`, que
es la otra mitad de la transacción. La alternativa («registra después, y si falla loguéalo») es
exactamente el agujero del 27-10: dos regeneraciones del PIN de la propietaria en una mañana y
nada escrito más que un `request.log.info` que nadie leyó.

No hay pantalla que lo pinte, y es deliberado: lo que el bloque necesita es que el dato EXISTA
desde el primer cambio. Una pantalla sobre una tabla vacía no sirve de nada.

---

## 3 · Decisiones tomadas sin preguntar

| # | Decisión | Por qué |
|---|---|---|
| 1 | **Elegir PIN sin el actual es sólo del OWNER.** Un MANAGER va por el camino del personal (PIN provisional de quien le dio de alta). | El punto 2 dice «la propietaria» y el 3 mete al encargado entre «el personal». Y es lo conservador: la propietaria es la titular. |
| 2 | **El filtro de triviales va en las CUATRO rutas donde un humano teclea un PIN que se guarda**, no sólo en «cambiar el mío». | El PIN del alta funciona hasta que la cajera lo cambie, y entre el alta y el primer turno pasan días. «1234» entraría al TPV todo ese tiempo. |
| 3 | **El login NO filtra triviales.** Un PIN trivial ya guardado sigue entrando. | Nadie se queda fuera al desplegar; el día que lo cambie se le pedirá otro. |
| 4 | **El PIN del alta de personal nace PROVISIONAL.** | Es el «primer acceso» del punto 4 para el personal, y lo que convierte «te pongo 5050, cámbialo luego» en algo que se cumple. |
| 5 | **`pin_changes` es una tabla, no una línea de log.** | La pregunta que hay que poder contestar es «¿quién le cambió el PIN a Marta el martes?», y esa se contesta mirando. El propio código de la casa lo dice: «lo que salva la activación es Copiar enlace, no un log que nadie lee». |
| 6 | **Todas las rutas de PIN llevan el gate de la caja**, con `cajaIsDisabled` en el handler y no `ensureCajaEnabled` en el `preHandler`. | `ensureCajaEnabled` rechaza a un `CLINICIAN` por diseño (clinica-1), y un sanitario tiene que poder cambiar su PIN. Lo que se gatea aquí es la capability del tenant, no el rol. |
| 7 | **`POST /shift/cashier-pin` devuelve `{ ok: true }` y la pantalla reintenta el login**, en vez de emitir la sesión ella misma. | Emitir una sesión de cajero es montar turno, ensayo, TTL y `shiftState`, y eso ya está escrito una vez. El viaje de más cuesta 200 ms y lo paga cada persona una vez en la vida. |
| 8 | **`ownerPin` se queda en la respuesta de `activate`, siempre a `null`**, en vez de quitar el campo. | Una consola de super-admin abierta en otra pestaña a mitad de despliegue sigue leyéndolo, y `null` es la rama que ya sabía pintar. |
| 9 | **El cuarto estado `PIN_PROVISIONAL` en el panel de soporte**, aunque el bloque no lo pedía. | Es la pantalla donde se mira «¿por qué no entra?», y `ACTIVE` con `canOpenTpv: true` para alguien que no entra manda a soporte a buscar el problema en la red. |

---

## 4 · Por qué cambiar el PIN **no** cierra las demás sesiones

El bloque lo pedía «o se justifica en el `-done`». Aquí está la justificación, con las cuentas.

**Las sesiones que abre un PIN son las de cajero.** Son JWT firmados con `JWT_ACCESS_SECRET`, sin
`tokenVersion` dentro, y se validan **sin tocar la base** (`verifyCashierSession` es una
verificación de firma y nada más). Revocarlas exigiría:

* una columna `cashier_session_version` en `users`, **y**
* una lectura por PK en **cada petición** del TPV que hoy no hace ninguna — son todas las de la
  venta, y el aislamiento por tenant ya no depende de ella, **y**
* decidir qué pasa en **modo offline**, donde el terminal valida el PIN contra el roster cacheado
  y no hay servidor al que preguntar.

Eso es un bloque, no una línea, y toca el camino por el que pasa cada cobro.

**Bumpar `tokenVersion` tampoco vale**, y no por caro sino por incorrecto: `tokenVersion` revoca
los *refresh* del PANEL, y el panel no se abre con el PIN. Cambiar el PIN cerrándole la sesión del
panel a la propietaria sería una consecuencia que nadie espera.

**Qué queda cubierto de verdad, sin nada de lo anterior:**

* el PIN viejo **deja de funcionar en el acto** para abrir una sesión nueva, autorizar un
  descuento, anular una mesa o cerrar un turno;
* la sesión que ya esté abierta en otro terminal muere por inactividad
  (`cashierAutoLogoutMinutes`, 10 min por defecto) o por TTL (12 h);
* y el caso que de verdad importaba —«alguien conoce mi PIN»— es el del punto 3, donde el PIN
  prestado **no llega a abrir sesión**.

Si algún día hace falta el cierre inmediato, el sitio es `cashier-session.ts` y el precio está
medido arriba.

---

## 5 · La tabla de sabotajes

Cada uno aplicado sobre el árbol limpio, el fichero **entero** en rojo (no `-t`), y restaurado con
`git checkout -- .` después. Los 31.

| # | Sabotaje | Fichero que se pone rojo | Casos en rojo |
|---|---|---|---|
| S1 | El PIN actual no se comprueba (`if (false)`) | `pin-1-cambiar-mi-pin` | 6 / 23 |
| S2 | Quitar `motivoPinTrivial` de `/auth/me/pin` | `pin-1-cambiar-mi-pin` | 5 / 23 |
| S3 | Cubo de rate-limit propio en vez del del login | `pin-1-cambiar-mi-pin` | 2 / 23 |
| S4 | El fallo del PIN actual no llama a `registerFailure` | `pin-1-cambiar-mi-pin` | 3 / 23 |
| S5 | El registro sale de la transacción (`Promise.all`) | `pin-1-cambiar-mi-pin` | 1 / 23 |
| S6 | El login emite sesión con un PIN provisional | `pin-1-provisional` | 7 / 24 |
| S7 | El PIN provisional viaja en el roster offline | `pin-1-provisional` | 1 / 24 |
| S8 | Un PIN provisional autoriza un descuento | `pin-1-provisional` | 1 / 24 |
| S9 | El reset de personal deja el PIN definitivo | `pin-1-provisional` | 1 / 24 |
| S10 | `/shift/cashier-pin` no relee si sigue provisional | `pin-1-provisional` | 1 / 24 |
| S11 | Soporte puede elegir un PIN definitivo | `pin-1-elegir-y-soporte` | 2 / 13 |
| S12 | La propietaria vuelve a tener el PIN al azar | `pin-1-elegir-y-soporte` | 1 / 13 |
| S13 | «Regenerar» deja el PIN como PROPIO | `pin-1-elegir-y-soporte` | 2 / 13 |
| S14 | Vuelve un PIN al correo de invitación | `pin-1-correos` | 2 / 8 |
| S15 | El correo promete sin decir dónde | `pin-1-correos` | 2 / 8 |
| S16 | `NOT NULL DEFAULT now()` en la columna nueva | `pin-1-migracion` | 1 / 13 |
| S17 | El CHECK escrito con `<>` en vez de `IS NOT NULL` | `pin-1-migracion` | 1 / 13 |
| S18 | Cae la regla de «cifras seguidas» | `pin-1-reglas` | 4 / 35 |
| S19 | El PIN de soporte sin filtrar | `pin-1-reglas` | 3 / 35 |
| S20 | La hoja del TPV pide el actual también al elegir | `pin-1-cambiar-pin` (tpv) | 6 / 15 |
| S21 | «Guardar» se enciende con los dos PIN distintos | `pin-1-cambiar-pin` (tpv) | 1 / 15 |
| S22 | Vuelve «Regenerar PIN» a Mi cuenta de la dueña | `pin-1-mi-cuenta` (admin) | 10 / 13 |
| S23 | «He olvidado mi PIN» va a la ruta que pide el actual | `pin-1-mi-cuenta` (admin) | 2 / 13 |
| S24 | El login vuelve a auto-generar el PIN del OWNER | `contrato-lectura-completa-pin` | 3 / 10 |
| S25 | Revocar deja la marca de provisional sin PIN | `pin-1-provisional` | 1 / 24 |
| S26 | El alta de personal deja el PIN definitivo | `pin-1-provisional` | 1 / 24 |
| S27 | La activación vuelve a generar y mandar un PIN | `h1-activacion-sin-caja` | 2 / 12 |
| S28 | `canOpenTpv: true` con un PIN prestado | `super-admin-tenant-cashiers` | 1 / 15 |
| S29 | El PIN prestado anula una mesa (`tables/routes.ts`) | `pin-1-provisional` | 1 / 24 |
| S30 | El PIN prestado cierra un turno (`shift/routes.ts`) | `pin-1-provisional` | 1 / 24 |
| S31 | Una **sexta** ruta que verifica un `pin_hash` sin decidir | `pin-1-provisional` | 1 / 24 |

**S29, S30 y S31 son el inventario.** Anular una mesa y cerrar un turno con `managerPin` viven
detrás de media pantalla de venta: montarlas en un banco serían doscientas líneas de falsos para
comprobar un `where`. Así que se miden como `h1-caja-gate.test.ts` mide la puerta de la caja —
contando el filtro en el fuente, con la lista enumerada— y con un **barrido que caza la sexta**:
recorre `apps/api/src` entero buscando quien haga `verifyPassword(...pinHash...)` y exige que esté
en la lista de puertas o en la de exenciones, con su razón escrita. El día que alguien escriba una
ruta nueva que verifique un PIN, el banco se pone rojo hasta que decida qué hace con los
prestados.

Es el patrón de «un comentario que promete sin cumplir»: la cabecera del fichero dice cinco
puertas, así que hay cinco contadas.

---

## 6 · La migración

`20261027020000_pin_1_mi_pin`. **Aditiva**: ni un `DROP`, ni un `UPDATE`, ni un `DELETE`, ni un
`DISABLE TRIGGER`. Un test lo guarda (anclado a principio de sentencia: las tres FK llevan
`ON UPDATE CASCADE`, que no toca ninguna fila).

```sql
ALTER TABLE "users" ADD COLUMN "pin_provisional_at" TIMESTAMPTZ;

ALTER TABLE "users"
  ADD CONSTRAINT "users_pin_provisional_exige_pin"
  CHECK ("pin_provisional_at" IS NULL OR "pin_hash" IS NOT NULL);
```

**Nullable y sin DEFAULT**, y es la decisión cara del bloque: `NULL` significa «PIN propio», así
que **las filas de hoy se quedan como están**. Los quince terminales en producción, el PIN de la
propietaria de Sirope y los de la clínica de Sole entran igual el minuto siguiente al despliegue.

La dirección contraria —marcar como provisionales los PIN de hoy— habría obligado a 21 personas de
una residencia y a la barra entera de un bar a elegir PIN nuevo el día del despliegue, delante de
la cola. El bloque existe para que cada uno pueda elegir el suyo, no para forzarlo.

**El CHECK está escrito con `IS NULL` / `IS NOT NULL` a propósito**: un CHECK que evalúa a NULL
**pasa**, así que una comparación con `=` sobre una columna nullable no cierra nada. Las dos ramas
dan siempre TRUE o FALSE.

Y el CHECK tiene consecuencia en el código, puesta: revocar un cajero y purgar el cajero técnico
ponen `pin_hash = NULL`, así que los dos limpian `pin_provisional_at` en la misma escritura. Sin
eso, revocar a alguien con PIN provisional —que es TODO el personal recién dado de alta—
reventaría contra la base. Es S25.

`pin_changes`: dos enums, tres FK (`tenant` CASCADE, `target` CASCADE porque es el historial de
una CREDENCIAL como `care_pins`, `actor` SET NULL porque dar de baja a la encargada que puso un
PIN provisional no puede borrar que se puso) y dos índices.

**Contra Postgres de verdad ya corrió**: los dos jobs `e2e` de la CI aplican las migraciones
sobre una base real antes de los tests, y pasan. O sea que la columna, el CHECK y `pin_changes` se
CREAN bien. Lo que eso todavía no demuestra es que el CHECK **rechace** la fila sin sentido, que
es lo que queda para la pasada en hierro (§9).

---

## 7 · El bucle visual

11 capturas en `docs/blocks/pin-1-shots/`: cinco del TPV (1280×800 y el N1 a 360×648) y seis del
panel (1280×900). Sin errores de consola en ninguna.

Para sacarlas hizo falta **un banco visual del panel** (`apps/admin/visual/`), que no existía: es
el gemelo del del TPV, con la red interceptada y sin base de datos detrás. Queda para los bloques
que vengan.

**Lo que encontró el bucle, y los tests no:**

| # | Qué | Medida | Arreglo |
|---|---|---|---|
| 1 | A **1280×800**, el modo «cambiar» dejaba «Guardar mi PIN» cortado por abajo y «Cancelar» bajo el pliegue. | tarjeta 880 px de 800 | Dos columnas de `md` arriba (campos / teclado): la tarjeta baja a **526**. |
| 2 | En el **N1 (360×648)** no cabía nada: 818 px de tarjeta. | «Guardar» a 790 | El texto largo sólo de `sm` arriba, el ojo sube a la cabecera, teclas y campos más bajos, y el pie `sticky`. Elegir PIN entra **entera: 650**. |
| 3 | Centrar la tarjeta con `items-center` la desbordaba **por arriba** en compacto: el título quedaba fuera de alcance. | título a −40 | `items-start md:items-center`. |
| 4 | «He olvidado mi PIN», al lado del botón, partía en dos líneas. | — | `whitespace-nowrap shrink-0`. |
| 5 | «Regenerar PIN» partía dentro del propio botón. | — | `whitespace-nowrap`. |

El modo «cambiar» en el N1 se queda en 726 px (tiene un campo más): el pie `sticky` deja
«Guardar» siempre a la vista y la última fila del teclado pide ~40 px de desplazamiento. Se
consideró bajar las teclas por debajo de los 44 px de objetivo táctil de la casa y se descartó:
el estándar de toque manda sobre el pliegue.

---

## 8 · Al desplegar

**Migración.** `pnpm --filter @mipiacetpv/db run migrate:deploy`. Una sola, aditiva, sin bloqueo
de tabla apreciable (`ADD COLUMN` nullable sin default no reescribe `users`).

**Qué pasa con los PIN que ya existen: nada.** `pin_provisional_at` nace `NULL` en todas las
filas, y `NULL` es «PIN propio». Nadie tiene que elegir nada, nadie se queda fuera, y el primer
turno después del despliegue entra con los PIN de siempre. Es el punto que hay que leer antes de
desplegar y el que el banco `pin-1-migracion` guarda.

**Las tablets ya emparejadas.** Siguen emparejadas: el bloque no toca `devices` ni el device
token. Lo que cambia es que su PWA tiene que ser la nueva — ver abajo.

**APK nueva: sí, y hace falta.** El TPV gana la pantalla de elegir PIN
(`CambiarPinSheet`), y un terminal con la PWA vieja que teclee un PIN provisional recibirá
`{ mustChoosePin: true }` sin `sessionToken` y **se quedará parado** (el código viejo guardaría
una sesión con `sessionToken: undefined`).

Mientras no estén todos los terminales actualizados, el riesgo se acota solo: **sólo hay PIN
provisionales si alguien los crea**, y los crea la propietaria desde Cajeros o Mi Piace desde
soporte. Orden recomendado:

1. desplegar API + panel;
2. publicar y repartir la APK / recargar las PWA;
3. **y sólo entonces** empezar a usar «PIN provisional» en Cajeros.

Los PIN que ya existen no se vuelven provisionales solos, así que el paso 3 es el único que
introduce el caso nuevo.

**Lo que Mi Piace tiene que saber el día 1:**

* «Regenerar PIN» ya no está en Mi cuenta del cliente. Está en «Configurar como OWNER», y lo que
  deja es un PIN **provisional**;
* al activar una cuenta nueva **no sale ningún PIN que leer por teléfono**. El correo le dice a la
  propietaria dónde elegirlo, y la ficha de la cuenta lo recuerda;
* si alguien no puede entrar, el panel de cajeros de super-admin ahora distingue «PIN
  provisional» de «Puede entrar».

**Nada que revertir a mano.** Si hiciera falta volver atrás, el código viejo convive con la
columna (la ignora) y lo único que quedaría raro es que los PIN provisionales entrarían como
definitivos. El `-done` no recomienda revertir: recomienda terminar el paso 2.

---

## 9 · Lo que NO entra, y lo que queda abierto

Del prompt, fuera a propósito: login sin PIN, biometría, PIN por terminal, el PIN de puerta de
residencia (`care_pins`, otra tabla y otras reglas — ni se toca ni se rompe, hay una exención con
su razón escrita en el barrido del inventario) y cambiar el formato (4-8 cifras se queda).

**Lo que queda abierto, y por qué:**

1. **La pasada en hierro.** El prompt la deja fuera de este bloque («la hacen Matías y Claude con
   la Lenovo»). Lo que hay que medir allí, en este orden:
   * el CHECK contra Postgres: `UPDATE users SET pin_provisional_at = now() WHERE pin_hash IS
     NULL` tiene que fallar;
   * revocar un cajero con PIN provisional (S25 contra la base de verdad);
   * el ciclo completo en el N1: alta con PIN provisional → login → elegir → entrar → vender.
2. **La pantalla de `pin_changes`.** La tabla se llena desde el primer cambio; no hay dónde
   mirarla más que en la base. Es deliberado (§2.7).

---

## 10 · Los commits

| Hash | Qué |
|---|---|
| `f8ffca5` | El bloque: migración, rutas, puertas, correos, panel y TPV |
| `f9f5164` | El estado `PIN_PROVISIONAL` en el panel de soporte, con sus tests |
| `3003f36` | El inventario de las cinco puertas + el barrido de la sexta |
| `f2e1275` | El bucle visual: dos columnas en mostrador, cabe en la mano, banco visual del panel, 11 capturas |
| `9cfb7bf` | Merge de `origin/master` (`503354a`, clinica-10) — suite verde después |
| `b42d19f` | Este documento |
| `893086c` | «Cambiar mi PIN» sube a la cabecera de la agenda (ver §11) |
| `e540d2b` | El sabotaje A5: el botón tiene que estar en la barra, no sólo en la pantalla |

**PR [#52](https://github.com/matiasoyola/mipiace-tpv/pull/52)**, con la CI en verde: `ci`, `e2e`
y `smoke` pasan en los dos runs (el del push y el del PR, que mergea el master de ahora).

---

## 11 · El botón del sanitario, a su sitio (28-10)

Cuando se escribió el bloque, `AgendaPage.tsx` era de la sesión `agenda-1` y no se podía tocar, así
que «Cambiar mi PIN» de la sanitaria se resolvió con un botón flotante colgado de
`LoggedInWrapper`. Con agenda-1 en master (PR #51), la rama se **rebasa sobre `origin/master`** y
el botón se va a donde le tocaba: **la cabecera de la agenda**, junto al ⋯ de las ausencias.

| Qué | Dónde |
|---|---|
| El prop | `AgendaPage.tsx` · `onCambiarMiPin?: () => void` |
| El botón | la barra de la cabecera, `h-11 w-11`, `aria-label` (en la agenda los tooltips están prohibidos, ux-principles §6) |
| Quién lo pasa | `App.tsx` · `AgendaDelSanitario`, **y sólo él** |

**La rama del `CLINICIAN` sale de un `if` dentro de `App` a su propio componente.** No es
cosmética: necesita estado propio (si la hoja del PIN está abierta) y un `useState` dentro de un
`if` sería un hook condicional. Se exporta por lo mismo que `TpvHome` — lo que hay que poder medir
es que esta rama **pasa** el prop, y eso no se ve desde `AgendaPage`.

**El prop es opcional y la cajera no lo recibe.** Esa barra es la que B-reservas-5 F8 tuvo que
rescatar a 390 px, y lo que se cortaba era la acción principal: un control más para todo el mundo
es volver a ese problema. La cajera tiene su «Cambiar mi PIN» en el cajón de la venta.

**Sabotajes nuevos (5), cada uno con el fichero entero en rojo:**

| # | Sabotaje | Casos en rojo |
|---|---|---|
| A1 | El botón se pinta siempre, sin mirar el prop | 1 / 9 |
| A2 | El botón no se pinta nunca | 7 / 9 |
| A3 | `AgendaDelSanitario` deja de pasar `onCambiarMiPin` | 2 / 9 |
| A4 | El botón usa `title` en vez de `aria-label` | 1 / 9 |
| A5 | El botón se pinta FUERA de la barra, suelto en la raíz | 1 / 9 |

**A5 salió verde a la primera, y por eso está escrito.** La comprobación de «está en la barra»
hacía `botón.parentElement.querySelector('[data-test="dar-cita"]')`, y la raíz de la pantalla
contiene la cabecera entera: un botón colgado de la raíz pasaba igual. Ahora se compara el padre
**inmediato** con el de «Dar cita» y el de «Volver». Es la misma trampa que
`scrollWidth miente con overflow-y-auto`: la comprobación parecía medir dónde está el botón y
medía otra cosa.

El `A3` es el que cierra «verde pero nadie la llama»: un prop que `AgendaPage` sabe pintar y que
nadie pasa es un botón que no existe.
