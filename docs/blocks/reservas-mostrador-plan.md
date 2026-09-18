# B-reservas-mostrador · El mostrador de la agenda — PLAN (frente 0)

Rama `reservas-mostrador`, worktree `mipiacetpv-reservas-mostrador`, desde
master `5994fde`.

**Base verde antes de tocar nada:** `pnpm test` en la raíz → **200 ficheros,
1924 pasados, 3 saltados** (los 3 saltados son
`apps/api/test/super-admin.test.ts:566`, `describe.skip` del flujo legacy de
B-SuperAdmin; preexistentes, nada que ver con este bloque).

---

## 0 · Por qué este bloque, y qué NO es

La agenda no tiene bloqueantes técnicos. Lo que tiene son cuatro cosas que una
recepcionista ve en el primer minuto y que el 13-09 en el AP11 salieron a la
primera. El bloque no añade una capacidad: **quita fricción medida en hierro**.

El criterio que ordena los frentes es el DAÑO:

1. El botón que descuadra dos arqueos (dinero).
2. La cita que no se ve y el nombre que no aparece (operativa delante de la
   clienta).
3. El alta que tarda de más y el botón que no dice nada (fricción).
4. El buscador que no encuentra a media clientela (funcionalidad que falta).

---

## 1 · Lo verificado, línea a línea

Todo lo que el prompt daba por verificado **lo está**. Tres precisiones de
número de línea, ninguna de fondo:

| Lo que dice el prompt | Comprobado |
|---|---|
| «fin» repite la hora de inicio · `AgendaPage.tsx:1624` | ✔ exacto. `endHHMM` sólo mira `draft.start`; con `totalDuration = 0` devuelve la misma hora. Fotografiado en `docs/qa/2026-09-13-ap11/20-lunes-cita.png`: «Servicios · fin 12:30» con la hora puesta a las 12:30 y el servicio SIN marcar |
| La tarjeta pone «Cliente» · `AgendaPage.tsx:398-401`, `:452-456` | ✔ con matiz: **:398 es el catálogo** (`loadCatalogFromCache`) y **:399-401 los clientes**. Los DOS cuelgan del mismo `useEffect(..., [])` y ninguno se refresca. `clientName()` en :452-456 ✔ |
| El buscador sólo mira el CRM local · `GET /clients` | ✔. `useClientPicker` → `refreshClients()` → `/clients`. Los contactos de Holded viven en `contacts` y salen por `GET /contacts/search` |
| El filtro de tipo del cajero · `contacts/routes.ts:113` | ✔ el `app.get` empieza en :112-113; el filtro `CLIENT + UNKNOWN` está en **:146-155**. Y es más fuerte de lo que dice el prompt: **también el OWNER** ve sólo `CLIENT + UNKNOWN` salvo que mande `?includeAll=1` — y ese flag da 403 a cualquier rol que no sea OWNER |
| `POST /clients` acepta `holdedContactId` · `crm/routes.ts:183` | ✔ exacto |
| El índice `(tenantId, holdedContactId)` NO es único | ✔ `schema.prisma:1985` → `@@index`, no `@@unique` |
| «Reservar y cobrar» es el primario · `:1850-1863` | ✔ exacto |
| «Buscar hueco» se desactiva sin decir por qué · `:1797` | ✔ exacto |
| El filete de la tarjeta es el ESTADO · `StaffProfile.color` en `schema.prisma:1957` | ✔ exacto. El color de la profesional sólo se usa en el `borderTop` de la cabecera de columna (`:1359`) |
| `ClientForm` · fecha `type="date"` en `:90`, apellidos obligatorios en `:88` | Fecha en **:90** ✔. Los apellidos obligatorios están en **:86** (`required`) y **:131** (`disabled`); **:88 es el Teléfono** |

### 1.1 Dos hechos que el prompt no trae y mandan sobre él

**(a) El cliente NO es obligatorio para reservar, y no debe serlo.**
`canReserve` (`:1706`) exige servicio + hora, no cliente. Es deliberado desde
B4: la reserva por teléfono de alguien que aún no tiene ficha es un caso real —
el banco visual tiene su fixture (`ap-6`, «sin cliente»). El frente 4 pide que
«Reservar» diga qué falta «(cliente, servicio, hora)». **Va a decir servicio y
hora, nunca cliente**, porque nombrar el cliente sería mentir sobre lo que hace
falta. Se anota como desviación consciente.

**(b) El A–Z que ve la recepcionista lo ordena el FRONT, no el servidor.**
`refreshClients()` (`lib/clients.ts:196`) pagina el tenant ENTERO a caché local
y la lista se pinta desde `searchClientsLocal` → `sortClientsAz`. El
`orderBy: [lastName, firstName, id]` del servidor (`crm/routes.ts:148`) es el
**orden del cursor de paginación**, no lo que se ve. Consecuencia para el
frente 3: el apellido vacío se arregla en `sortClientsAz` (front) y el orden del
servidor se deja como está, porque cambiarlo rompería la paginación por cursor
sin arreglar nada visible. Se justifica en el done.

**(c) Precedente de privacidad que hay que respetar en el frente 6.**
`SalePage.contact.tsx` (v1.4-Buscador-Contactos) tiene una invariante: **el
listado de resultados de `/contacts/search` nunca enseña el teléfono completo**
(`maskPhone`). La sección «De Holded» del selector consume ese mismo endpoint y
hereda la invariante.

---

## 2 · Orden de los frentes, y por qué ese orden

| # | Frente | Depende de | Por qué aquí |
|---|---|---|---|
| 0 | Plan | — | Commit antes de tocar código |
| 1 | El botón que no descuadra dos arqueos | — | Es el único que toca dinero |
| 2 | La cita se ve y se sabe de quién es | — | Es el que cambia la pantalla entera; mejor antes de meter más cosas en ella |
| 3 | El alta rápida es rápida | — | Toca `ClientForm`, que el frente 6 va a reutilizar |
| 4 | Ningún botón mudo | 1 (comparte el pie del panel) | El pie del panel lo reescribe el 1; el 4 lo termina |
| 5 | El nombre de la clienta siempre | 2 (la tarjeta ya está tocada) | El mapa de clientes alimenta la tarjeta del 2 |
| 6 | El buscador encuentra a los de Holded | 3 (apellidos opcionales) y 5 (el mapa se refresca al elegir) | El contacto partido deja apellidos vacíos: sin el 3, la API los rechazaría. Y sin el 5, el cliente recién enlazado saldría como «Cliente» |

---

## 3 · Frente por frente: qué fichero, qué test

### Frente 1 · El botón que no descuadra dos arqueos

**Qué cambia.** «Reservar» pasa a primario (coral, primero en el DOM).
«Reservar y cobrar» pasa a secundario y **sólo existe si la cita es de hoy**.

**De dónde sale «es de hoy».** NO de `date` (el día que se está mirando) sino de
**`draft.start`**: es el instante que se va a guardar. Cambiar el día con el
panel abierto no mueve `draft.start`, así que derivarlo de `date` haría
aparecer el botón para una cita que sigue siendo del jueves. Con `draft.start`
la respuesta es siempre la verdad de lo que se va a crear.

**El salto de layout.** El pie es `shrink-0` al final de un `flex-col`: quitar
el segundo botón sube el borde del pie y baja el primario. Se resuelve con un
**pie de altura fija**: el hueco del secundario, cuando la cita no es de hoy,
lo ocupa una línea que explica por qué —«Se cobra el día de la cita»—. Ni hueco
muerto ni salto.

**El camino por teclado.** No hay ningún `onKeyDown` de Enter en la agenda ni
ningún `<form>` (ni `type="submit"`): no existe hoy un atajo que cobre. Lo que
sí cambia es el **orden del DOM**, que es el orden del tabulador: «Reservar»
primero. El test lo fija para que no se invierta por descuido.

| Fichero | Qué |
|---|---|
| `apps/tpv-web/src/pages/AgendaPage.tsx` | `BookingPanel`: pie reordenado, `esDeHoy` derivado de `draft.start`, altura fija |
| `apps/tpv-web/test/agenda-mostrador.test.tsx` **(nuevo)** | «Reservar» es el primario y va primero en el DOM · «Reservar y cobrar» NO existe con `draft.start` de mañana · SÍ existe con `draft.start` de hoy · el pie mide lo mismo en los dos casos · ningún `type="submit"` en el panel |

### Frente 2 · La cita se ve y se sabe de quién es

**Qué cambia.** El fondo de la tarjeta se tiñe con el color de la profesional.
El filete del ESTADO se queda. El rayado de «no reservable» baja de tono.

**Cómo se garantiza el contraste, con números.** El tinte no es «el color al
10 %»: es **el color mezclado con blanco hasta alcanzar una luminancia relativa
objetivo**, calculada por bisección sobre la fórmula de WCAG. Así un morado
oscuro y un amarillo casi blanco acaban en el mismo peso visual.

El umbral lo fija el texto MÁS DÉBIL de la tarjeta, que es la segunda línea:

- Hoy es `text-slate-500` (#64748b, L = 0,1845). **Ese color no llega a 4,5:1
  ni sobre blanco puro** (máximo 4,48:1): es una deuda de contraste que ya
  existe y que este frente cierra de paso.
- Pasa a `text-slate-600` (#475569, L = 0,1119). Para 4,5:1 hace falta
  `L_fondo ≥ 4,5 · 0,1619 − 0,05 = 0,679`.
- **Objetivo del tinte: L = 0,72.** Da 4,63:1 en la segunda línea y 9,02:1 en la
  primera (`mipiace-ink`, #1F2937).

**El filete encima del tinte.** Es un componente no textual: WCAG 1.4.11 pide
3:1. Contra L = 0,72 el peor de los `STATUS_COLOR` vivos es COMPLETED (#64748b,
L = 0,1845) → 3,29:1 ✔. `CANCELLED` (#cbd5e1, L = 0,652) no entra en la cuenta:
las citas canceladas no se pintan (`:468`).

**Sin color, color estable.** `colorDeProfesional(userId)` = paleta fija de 8
tonos indexada por un hash del `userId`. Mismo id, mismo color, en cada render y
en cada terminal.

**Lo que NO se toca.** Las citas locales y rechazadas de 6a (rayas
discontinuas, mitad derecha, ámbar/rojo) **no se tiñen**: si se tiñeran dejarían
de distinguirse de una cita normal, que es justo lo que 6a fue a resolver.

| Fichero | Qué |
|---|---|
| `apps/tpv-web/src/lib/staffColor.ts` **(nuevo)** | `luminanciaRelativa`, `contraste`, `tinteClaro(hex)`, `colorDeProfesional(userId)`. Puro, sin React |
| `apps/tpv-web/src/pages/AgendaPage.tsx` | `StaffColumn`: fondo de la tarjeta, segunda línea a `slate-600`, rayado más flojo |
| `apps/tpv-web/test/staff-color.test.ts` **(nuevo)** | El tinte de un color oscuro, uno clarísimo y uno medio alcanza L ≥ 0,70 · contraste ≥ 4,5 con ink y con slate-600 · contraste ≥ 3 de cada `STATUS_COLOR` pintable contra el tinte · mismo id → mismo color · id distinto → normalmente distinto |
| `apps/tpv-web/test/agenda-mostrador.test.tsx` | La tarjeta lleva el tinte de SU profesional · la local y la rechazada NO lo llevan · el filete de estado sigue ahí |

### Frente 3 · El alta rápida es rápida

Tres cosas, y la tercera toca la API.

**(a) La fecha de nacimiento sale del alta rápida.** `ClientForm` recibe
`modo: "rapido" | "ficha"` (por defecto `"ficha"`, para no cambiar la sección
Clientes por accidente). `useClientPicker` lo monta en `"rapido"`. Al reservar,
esa fecha no permite decidir nada.

**(b) En la ficha, la fecha deja de ser un `type="date"`.** Campo con máscara
`dd/mm/aaaa` e `inputMode="numeric"`, validación junto al campo (fecha
imposible, fecha futura). La API sigue recibiendo `YYYY-MM-DD`. El parseo va en
un helper puro para poder probarlo sin jsdom.

**(c) Los apellidos pasan a OPCIONALES, en el front y en la API.** Sin
migración: la columna sigue `NOT NULL` y un cliente sin apellidos guarda `""`.

Lo que hay que repasar para que `""` no deje espacios ni desordene:

| Sitio | Estado | Acción |
|---|---|---|
| `clientFullName` (`clients.ts:83`) | Ya hace `.trim()` | Fijar con test |
| `sortClientsAz` (`clients.ts:165`) | **Roto**: `""` ordena primero | Clave = `lastName \|\| firstName` |
| `initials` (`ClientsPage.tsx:171`) | `"S" + ""` → «S» | Fijar con test |
| `phoneWarning` (`crm/routes.ts:232`) | Ya hace `.trim()` | Fijar con test |
| A–Z del servidor (`crm/routes.ts:148`) | Es el orden del cursor, no lo que se ve (§1.1b) | **No se toca**, se documenta |
| Ticket / impresión | No usa `Client.lastName` (usa el nombre del contacto de Holded) | Nada |

| Fichero | Qué |
|---|---|
| `apps/tpv-web/src/lib/birthdate-mask.ts` **(nuevo)** | `aplicarMascara(texto)`, `parsearFecha(texto)` → `{ iso }` o `{ error }` |
| `apps/tpv-web/src/pages/ClientForm.tsx` | `modo`, campo de fecha con máscara, apellidos sin `required` |
| `apps/tpv-web/src/hooks/useClientPicker.tsx` | Monta `ClientForm` en `modo="rapido"` |
| `apps/tpv-web/src/lib/clients.ts` | `sortClientsAz`; `lastName` opcional en los tipos de entrada |
| `apps/api/src/crm/routes.ts` | `required: ["firstName"]`, `minLength: 0` en `lastName` (POST :170/:178 y PATCH :317) |
| `apps/tpv-web/test/birthdate-mask.test.ts` **(nuevo)** | 7/3/1961 → `1961-03-07` · 31/02/1990 → fecha imposible · mañana → fecha futura · máscara al teclear |
| `apps/tpv-web/test/clients-az.test.ts` **(nuevo)** | Sole (sin apellido) cae entre Soto y Suárez, no la primera · `clientFullName` sin espacio colgando · `initials` con una letra |
| `apps/tpv-web/test/client-form-quick.test.tsx` **(nuevo)** | `modo="rapido"` no pinta la fecha · `modo="ficha"` sí · «Crear cliente» se activa sin apellidos |
| `apps/api/test/crm-apellidos.test.ts` **(nuevo)** | POST sin `lastName` → 201 · POST con `""` → 201 · PATCH a `""` → 200 · `phoneWarning` sin espacio colgando |

### Frente 4 · Ningún botón mudo

Con texto visible junto al botón, **nunca con tooltip** — `docs/ux-principles.md`
§6 los prohíbe explícitamente («Touch no tiene hover»).

- **«Buscar hueco»**: «Elige al menos un servicio» / «Ese día ya ha pasado».
  `searching` no genera frase: la etiqueta ya dice «Buscando…».
- **«Reservar»**: «Falta el servicio», «Falta la hora», o las dos. **No nombra
  el cliente** (§1.1a).
- **«fin»** desaparece de la etiqueta de Servicios cuando `totalDuration === 0`.

| Fichero | Qué |
|---|---|
| `apps/tpv-web/src/pages/AgendaPage.tsx` | `motivoBuscarHueco()`, `motivoReservar()`, la etiqueta de Servicios |
| `apps/tpv-web/test/agenda-mostrador.test.tsx` | Sin servicios: el motivo se lee junto a «Buscar hueco» · día pasado: el otro motivo · sin hora: el motivo de «Reservar» · con cero servicios NO aparece «fin» · con servicios sí |

### Frente 5 · El nombre de la clienta siempre

Tres agujeros, uno de ellos en el catálogo:

1. `clientsById` se recarga en cada `loadDay` (no sólo al montar).
2. Al elegir o crear un cliente en el selector, entra en el mapa sin esperar.
3. **El mismo patrón en el catálogo** (`loadCatalogFromCache`, `:398`): un
   servicio creado con la agenda abierta se pinta «Servicio». Se arregla igual.

**El marcador.** `clientName(id)` con un id desconocido deja de devolver
«Cliente» —que se lee como un nombre— y devuelve **«Sin nombre»**, pintado
apagado (`slate-400`, cursiva) y con gancho `data-cliente-desconocido`. «Sin
cliente» (id nulo) no cambia: es otra cosa y ya se entendía.

| Fichero | Qué |
|---|---|
| `apps/tpv-web/src/pages/AgendaPage.tsx` | `refrescarCachesLocales()` llamada desde `loadDay`; `onClientPicked` mete el cliente en el mapa; marcador |
| `apps/tpv-web/test/agenda-mostrador.test.tsx` | Un cliente que llega al caché DESPUÉS de montar aparece con su nombre al recargar el día · elegirlo en el selector lo enseña sin recargar · un id desconocido se lee «Sin nombre» y lleva el gancho · un servicio nuevo en el caché deja de ser «Servicio» |

### Frente 6 · El buscador encuentra a los clientes de Holded

**Cómo se garantiza UN cliente por contacto SIN migración.**

Descartada la vía obvia —un índice único parcial sobre
`(tenantId, holdedContactId)`— por dos razones, y la segunda es la que decide:

1. Es una migración, y el bloque va a cero migraciones.
2. **Puede fallar al aplicarse en producción.** Ese enlace lo rellena desde
   ADR-010 el camino de cobro, de forma perezosa y sin nada que impidiera
   duplicados. Un tenant con dos clientes apuntando al mismo contacto —que hoy
   es legal— convierte el `CREATE UNIQUE INDEX` en un despliegue que se cae.
   Meter eso en el mismo bloque que enciende la agenda en Sole es cambiar un
   problema de UX por un problema de arranque.

**La vía elegida: cerrojo consultivo de transacción.** Dentro de un
`prisma.$transaction`:

```sql
SELECT pg_advisory_xact_lock(hashtext($tenantId), hashtext($holdedContactId))
```

…y después `SELECT` del cliente enlazado → si está, se devuelve; si no, se crea.
El cerrojo se suelta solo al cerrar la transacción. Dos toques seguidos o dos
terminales quedan serializados: el segundo encuentra lo que creó el primero.
Es la versión de dos `int4` a propósito: dos contactos sólo se estorban si
colisionan los DOS hashes, y aun colisionando el resultado sigue siendo
correcto (sólo se serializan de más).

**El endpoint.** `POST /clients/from-contact/:contactId`, con `:contactId` = el
**id de la fila `Contact`** (uuid, con tenant), no el `holdedContactId`: valida
la pertenencia al tenant de un golpe.

- 404 si el contacto no es del tenant.
- **409 `CONTACT_NOT_CLIENT`** si el `type` no es `CLIENT` ni `UNKNOWN`. El
  filtro de proveedores no puede vivir sólo en la búsqueda: si vive sólo ahí, se
  lo salta cualquiera que llame al endpoint a mano.
- 200 `{ client, created: false }` si ya estaba enlazado · 201 con
  `created: true` si se crea.
- **No escribe NADA en Holded** (ADR-R2): el módulo no importa
  `@mipiacetpv/holded-client`.

**Cómo se parte el nombre.** `Contact.name` es un solo campo:
`name.trim().split(/\s+/)` → **primera palabra = nombre, el resto = apellidos**
(que ahora pueden quedar vacíos — por eso el frente 3 va antes). «Carmen» →
(«Carmen», «»). «Ana Belén Soto Gil» → («Ana», «Belén Soto Gil»). Es un criterio
tonto y documentado a propósito: cualquier heurística más lista («Belén» es
nombre compuesto) acierta unas veces y se equivoca otras, y la recepcionista no
puede saber cuál le tocó. Teléfono y email se copian si los hay.

**El selector.** Sigue siendo local y sin esperas: el CRM sale del caché como
hoy. Los de Holded llegan después, con `debounce` de 250 ms, desde 2 caracteres,
en una sección «De Holded» debajo. Un contacto cuyo `holdedContactId` ya está en
un cliente del CRM **no sale dos veces**: sale como cliente. Sin conexión la
sección no aparece y un aviso pequeño lo dice. Sin contactos, no hay sección
vacía. Teléfono enmascarado (§1.1c).

**Proveedores.** El filtro del servidor ya aplica a todos los roles, incluido
OWNER, salvo `?includeAll=1` (que además exige OWNER). **El selector no manda
nunca ese flag**: el propietario no ve de repente a sus proveedores. Test en
vitest y en e2e.

| Fichero | Qué |
|---|---|
| `apps/api/src/crm/from-contact.ts` **(nuevo)** | El cerrojo, el `SELECT`-o-`INSERT` y el parte-nombre (`partirNombre`, exportado para poder probarlo solo) |
| `apps/api/src/crm/routes.ts` | Registra `POST /clients/from-contact/:contactId` |
| `apps/tpv-web/src/lib/contacts.ts` **(nuevo)** | `buscarContactosHolded(q)`, `clienteDesdeContacto(id)` |
| `apps/tpv-web/src/hooks/useClientPicker.tsx` | Sección «De Holded», debounce, dedup, aviso sin conexión |
| `apps/api/test/crm-from-contact.test.ts` **(nuevo)** | Crea y enlaza · segunda llamada devuelve el mismo · proveedor → 409 · otro tenant → 404 · `partirNombre` en 6 casos |
| `apps/tpv-web/test/client-picker-holded.test.tsx` **(nuevo)** | Sección aparte y debajo · con 1 carácter no se llama · dedup por `holdedContactId` · sin resultados no hay sección · sin conexión hay aviso y no hay sección · elegir uno llama a `from-contact` y devuelve el cliente |
| `apps/api/test-e2e/crm-contacto.e2e.ts` **(nuevo)** | Contra Postgres real |

---

## 4 · Los e2e contra Postgres de verdad

Base **propia**: `mipiacetpv_mostrador_e2e` (la suite hace `DROP SCHEMA` y hay
otras sesiones vivas). Contiene «e2e», así que pasa el guardia de
`assertDisposableDatabase`. **Se borra al terminar el bloque.**

```bash
docker compose up -d postgres
docker compose exec -T postgres psql -U mipiacetpv \
  -c "CREATE DATABASE mipiacetpv_mostrador_e2e;"
E2E_DATABASE_URL='postgresql://mipiacetpv:mipiacetpv_dev@127.0.0.1:5432/mipiacetpv_mostrador_e2e' \
  pnpm test:e2e
```

Los cuatro casos del criterio de hecho:

1. **Dos `POST /clients/from-contact` SIMULTÁNEOS dejan UN cliente enlazado.**
   Lanzados con `Promise.all`, sin `await` entre medias — es el caso que el
   cerrojo existe para cubrir. Se cuenta con `prisma.client.count`.
2. **Un contacto ya enlazado devuelve ESE cliente** (mismo `id`, 200,
   `created: false`), aunque el enlace lo hubiera puesto el camino de cobro.
3. **Alta sin apellidos por la API** → 201, y la fila guarda `""`.
4. **Un proveedor no aparece en la búsqueda** (`/contacts/search` no lo lista
   para el cajero NI para el owner sin flag) **y `from-contact` lo rechaza**
   con 409.

---

## 5 · Bucle visual

Playwright (`playwright-core` en el scratchpad, **no entra en el repo**) contra
el banco visual (`apps/tpv-web/visual/`), que ya tiene el vertical de Sole con
tres profesionales. Se le añaden parámetros nuevos:

- `?colores=matriz` → Sole con un morado oscuro, Ana con un amarillo clarísimo,
  Isa **sin color** (`null`), y una cita de cada una, más la local y la
  rechazada (`?encolada=`, que ya existe).
- `?panel=hoy` / `?panel=otro-dia` → el panel de alta abierto con `draft.start`
  de hoy y de mañana.
- `?picker=crm` / `?picker=holded` / `?picker=sin-red` / `?picker=vacio`.
- `?ficha=nacimiento` / `?ficha=nacimiento-error` en la sección Clientes.
- `?sin-apellidos=1` → una clienta sin apellidos en la lista A–Z.

**Tres anchos.** 390 px · 1280 px · y la resolución del AP11/AP12 en
horizontal. Medida sobre las capturas del 13-09 (`1920×1200` de fichero, y el
panel `md:w-96` = 384 px CSS ocupando 575 px): **el AP11 es 1280×800 CSS a
`deviceScaleFactor` 1,5**. Las capturas de ese tercer ancho se toman con ese
factor, así que salen a 1920×1200 y se pueden poner al lado de las del 13-09.
Tap targets ≥ 44 px (la casa pide 48 — `tailwind.config.js`, peldaño `touch`).

Capturas a `docs/blocks/reservas-mostrador-shots/`.

---

## 6 · Tabla de sabotaje (la que hay que rellenar al cerrar)

Antes de cada sabotaje se comprueba que el test está **verde con el código
intacto**. Mínimos exigidos:

| # | Qué línea de producción rompo | Test que se pone rojo |
|---|---|---|
| 1 | «Reservar y cobrar» visible en una cita de otro día | `agenda-mostrador` |
| 2 | «Reservar y cobrar» otra vez primario | `agenda-mostrador` |
| 3 | Quitar la deduplicación del endpoint de contacto (el `SELECT` previo) | `crm-from-contact` + e2e caso 1 y 2 |
| 4 | Quitar el filtro de tipo del contacto | `crm-from-contact` + e2e caso 4 |
| 5 | Volver a exigir apellidos en la API | `crm-apellidos` + e2e caso 3 |
| 6 | Volver a cargar el mapa de clientes sólo al montar | `agenda-mostrador` |
| 7 | Calcular «fin» con cero servicios | `agenda-mostrador` |
| 8 | Tarjeta sin el tinte de la profesional | `agenda-mostrador` + `staff-color` |

---

## 7 · Lo que NO se toca

Motor de huecos · el suelo de 6a · el horario de 7a · el panel de salud de B-9 ·
la carrera 409 · el camino de cobro de B-5 · los triggers de S1 · los `EXCLUDE`
· «Anular» (deuda de caja, no de agenda) · importación en bloque de contactos ·
la pantalla de `agenda.duration_pattern` · activar un perfil de agenda desde el
panel · el hierro (la pasada en el AP11 la hace Matías).

**Cero migraciones.** La única candidata —el índice único parcial del frente 6—
queda descartada en §3 con su razón, y el cerrojo consultivo ocupa su sitio.

---

## 8 · Commits

Uno por frente cerrado, en `reservas-mostrador`, **añadiendo por ruta** (hay
capturas de QA sin trackear: `git add -A` las metería). **Ni push ni deploy.**
