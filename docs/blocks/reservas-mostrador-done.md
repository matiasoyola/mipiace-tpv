# Bloque B-reservas-mostrador · El mostrador de la agenda — DONE

**Rama** `reservas-mostrador` · **worktree** `mipiacetpv-reservas-mostrador` ·
**desde** master `5994fde` · **último commit con código** `8656776`.

**Suite entera** (`pnpm test` en la raíz): **208 ficheros · 2131 pasados ·
3 SALTADOS**. Los 3 saltados son los mismos de la base
(`apps/api/test/super-admin.test.ts:566`, `describe.skip` del flujo legacy de
B-SuperAdmin): preexistentes, nada que ver con este bloque.
**e2e contra Postgres real**: 10 ficheros · 120 pasados, cero saltados.

La base antes de tocar nada era 200 ficheros / 1924 pasados / 3 saltados, y
los e2e 9 ficheros / 105 casos. El bloque añade **8 ficheros de test y 201
casos** a la suite (194 en los ficheros nuevos y 7 repartidos en dos que ya
existían) y **1 fichero e2e con 15 casos**.

---

## 0 · De qué iba esto

La agenda no tenía bloqueantes técnicos. Tenía cuatro cosas que una
recepcionista ve en el primer minuto, y el 13-09 en el AP11 salieron todas a
la primera. El bloque no añade una capacidad: **quita fricción medida en
hierro**, en el orden del daño — primero lo que descuadra un arqueo, luego lo
que se hace delante de la clienta, luego lo que falta.

---

## 1 · Lo que cambia, frente por frente

### Frente 1 · El botón que no descuadra dos arqueos

**«Reservar» es el primario** (coral, primero en el DOM, que es el orden del
tabulador). **«Reservar y cobrar» pasa a secundario y sólo existe si la cita
es de hoy.**

Un cobro entra en el turno ABIERTO, que es el de hoy. Si alguien reserva para
el jueves y pulsa el primario por inercia, el dinero del jueves cae en el
arqueo de hoy — y deshacerlo no es anular (no existe) sino **devolver**, que
cae en el turno del día en que se haga y mueve efectivo. Un toque de más
descuadra dos arqueos, no uno.

- «De hoy» sale de **`draft.start`**, no del día que se está mirando.
  `start` es el instante que se va a escribir, y cambiar de día con el panel
  abierto NO lo mueve: derivarlo de `date` haría aparecer el botón sobre una
  cita que sigue siendo del jueves.
- **Sin salto de layout.** El pie es `shrink-0` al final de un `flex-col`, así
  que quitarle una fila subiría el borde y bajaría el primario de golpe. La
  fila del secundario se queda como ranura de altura fija; cuando la cita no
  es de hoy, la ocupa la razón: «Se cobra el día de la cita».
- **El camino por teclado:** no hay `<form>` ni `type="submit"` en el panel,
  así que no existía ni existe un Enter que cobre. El test lo fija para que no
  nazca uno al reordenar.

### Frente 2 · La cita se ve y se sabe de quién es

El fondo de la tarjeta se tiñe con el color de la profesional. Hasta aquí la
jerarquía estaba invertida: lo que más gritaba era el rayado de «no
reservable» —una banda que dice que ahí NO se puede hacer nada— y la cita, lo
único que importa, era blanca sobre blanco.

**El tinte no es «el color al 10 %»**: es el color llevado a una **luminancia
relativa objetivo (0,72)**, aclarando hacia el blanco si es oscuro o bajando
los canales si es clarísimo, por bisección sobre la fórmula de WCAG. Así un
morado `#4c1d95` y un amarillo `#fef9c3` acaban con el mismo peso visual, el
tono sobrevive, y el contraste con el texto es **el mismo número para todas**
— así que se garantiza de una vez en vez de color por color.

Los números están en §2.1. Lo demás:

- **El filete del ESTADO se queda** y se sigue distinguiendo, con un tono
  derivado (§2.2).
- **Una profesional sin color** tiene el suyo derivado del `userId` (FNV-1a
  sobre una paleta de 8), no uno al azar: al azar la agenda parpadearía en
  cada repintado.
- **El color es un refuerzo:** la tarjeta sigue diciendo hora, cliente y
  servicio, con la regla de dos líneas de B-5 F8 intacta.
- **Las citas locales y rechazadas de 6a NO se tiñen**: su ámbar y su rojo,
  con rayas discontinuas en la mitad derecha, son lo que las distingue de una
  cita de verdad.
- **El rayado baja de tono** (0,18 → 0,09, fondo `slate-100` → `slate-50`)
  pero sigue viéndose: lo fija `agenda-horario.test.tsx`.

### Frente 3 · El alta rápida es rápida

- **La fecha de nacimiento SALE del alta rápida** (el selector de cliente de
  la agenda y el de la venta). Filtro «¿y qué?»: al reservar no permite tomar
  ninguna decisión. `ClientForm` recibe `modo`, con `"ficha"` por defecto para
  que ninguna pantalla que ya lo usaba cambie por accidente.
- **En la ficha deja de ser un `<input type="date">`.** En el Chrome del AP11
  ese control abre el calendario EN EL MES ACTUAL, y una fecha de nacimiento
  está treinta o cuarenta años atrás. Pasa a máscara `dd/mm/aaaa` con
  `inputMode="numeric"`, validación junto al campo (fecha imposible, mes fuera
  de rango, año demasiado atrás, fecha futura) y
  `aria-invalid` / `aria-describedby`. **La API sigue recibiendo
  `YYYY-MM-DD`.**
- **Los apellidos pasan a OPCIONALES**, en el front y en la API. Sin
  migración: la columna sigue `NOT NULL` y guarda `""`.

### Frente 4 · Ningún botón mudo

- **«Buscar hueco»** dice la suya en texto visible debajo: «Elige al menos un
  servicio» o «Ese día ya ha pasado». **El día pasado manda** sobre el
  servicio que falta: es la causa que no tiene arreglo en ese panel.
  `searching` no genera frase — la etiqueta ya dice «Buscando…».
- **«Reservar»**: «Falta el servicio», «Falta la hora», o «Faltan el servicio
  y la hora», en una ranura de altura fija encima del botón.
- **«fin» desaparece** cuando no hay servicios (§2.6).
- **Nada de esto va en un `title` ni en un tooltip**: `docs/ux-principles.md`
  §6 los prohíbe. El test recorre todos los botones del panel y comprueba que
  ninguno lleva `title`.

### Frente 5 · El nombre de la clienta siempre

- **Las dos cachés locales se releen en cada carga del día** —después de
  pintar, sin bloquearlo— y el cliente que se elige o se crea en el selector
  entra en el mapa ahí mismo.
- **El mismo patrón estaba en el catálogo** de esta misma pantalla, con el
  mismo fallo latente (un servicio nuevo se pinta «Servicio»). Se arregla
  igual, porque es el mismo bug con otro nombre.
- **El refresco MEZCLA, no reemplaza** (§2.7).
- **«Cliente» deja de usarse como marcador** (§2.8).

### Frente 6 · El buscador encuentra a los clientes de Holded

El selector **sigue siendo local y sin esperas**: los del CRM salen del caché
como hasta ahora. Los de Holded llegan después, por red, con `debounce` de
250 ms, desde 2 caracteres, en una sección «De Holded» aparte y debajo —
nunca mezclados, porque tocar uno de ellos **crea una ficha** y tocar un
cliente no.

- **Un contacto ya enlazado no sale dos veces**: sale como cliente.
- **El servidor decide**, con un endpoint idempotente (§2.3 y §2.4).
- **El nombre se parte** con un criterio fijo y documentado (§2.5).
- **Sin red** la sección no aparece y un aviso pequeño lo dice. **Sin
  contactos** no hay sección vacía.
- **El teléfono va enmascarado**, heredando la invariante de v1.4.
- **Los proveedores no salen**, ni para el cajero ni para el propietario
  (§2.9).
- **NO se escribe nada en Holded** (ADR-R2), y hay un test que lo mira en la
  fuente.

### Frente extra · Se llega a un día de dentro de tres semanas

**No sale de las capturas: sale de cruzar la suite con la rutina de Sole**,
que reserva con semanas de antelación. Está en §5.

---

## 2 · Decisiones tomadas sin preguntar, una a una

### 2.1 · El contraste del tinte, con números — y por qué `slate-500` se va

El objetivo 0,72 lo fija el texto **más débil** de la tarjeta, que es la
segunda línea:

| Color | L | Sobre blanco | Tinte mínimo para 4,5:1 | Sobre el tinte (0,72) |
|---|---|---|---|---|
| `slate-500` #64748b | 0,1706 | **4,76:1 ✔** | **0,943** (o sea, blanco) | 3,49:1 ✘ |
| `slate-600` #475569 | 0,0886 | 7,58:1 ✔ | 0,574 | **5,56:1 ✔** |
| `mipiace-ink` #1F2937 | 0,0215 | 14,68:1 ✔ | 0,272 | **10,76:1 ✔** |

O sea: **`slate-500` no era un fallo hasta ahora** —pasa AA sobre blanco— pero
**con él el color de la profesional es incompatible con AA**, porque haría
falta un fondo de luminancia 0,943, que es un tinte que no se ve. Por eso la
segunda línea baja a `slate-600`; el tinte no cabía de otra forma.

> **Corrección al plan.** El plan del frente 0 decía que `slate-500` «no llega
> a 4,5:1 ni sobre blanco puro (máximo 4,48:1)». Eso estaba **mal**: da
> 4,76:1 y pasa. La conclusión (cambiarlo) no cambia; la razón sí, y es la de
> arriba. Los números del plan para `slate-600` (4,63:1) y para `ink`
> (9,02:1) también estaban bajos: los buenos son 5,56:1 y 10,76:1.

### 2.2 · El filete del estado se pinta con un tono derivado, y eso cierra un defecto de master

Al medir el filete encima del tinte salió algo que **NO es de este bloque** y
que el tinte sólo destapa: `STATUS_COLOR` tal cual **tampoco llega a 3:1
contra la tarjeta BLANCA de hoy**.

| | Contra blanco (master) | Contra el tinte | Con el tono derivado |
|---|---|---|---|
| `IN_SERVICE` #10b981 | 2,36:1 ✘ | 1,57:1 ✘ | **3,34:1 ✔** |
| `PENDING` #f59e0b | 1,94:1 ✘ | 1,29:1 ✘ | **3,34:1 ✔** |
| chip del detalle (texto BLANCO encima) | 2,15:1 ✘ | — | **4,56:1 ✔** |

El estado se pinta con el mismo color **bajado hasta una luminancia máxima de
0,18**, que saca los dos números a la vez: 3:1 de componente no textual (WCAG
1.4.11) contra el tinte, y 4,5:1 de texto (1.4.3) para el blanco del chip.
**`STATUS_COLOR` no se toca**: sigue siendo el mapeo de estados del mockup, y
de él sale el tono. Los cinco estados pintables siguen siendo cinco colores
distintos (`CANCELLED` no entra: las canceladas no se pintan).

### 2.3 · Un cerrojo consultivo, y NO un índice único

Descartado el índice único parcial sobre `(tenantId, holdedContactId)`, y no
sólo por el «cero migraciones» del bloque:

**ese enlace lo rellena el camino de cobro desde ADR-010, de forma perezosa y
sin que nada impidiera duplicados.** Un tenant que HOY tenga dos clientes
apuntando al mismo contacto —que es legal— convertiría el
`CREATE UNIQUE INDEX` en un despliegue que se cae. Cambiar un problema de UX
por un problema de arranque, justo en el bloque que enciende la agenda en
Sole, es mal negocio.

En su lugar:

```sql
SELECT pg_advisory_xact_lock(hashtext($tenant), hashtext($contacto))
```

- Va **lo primero** de la transacción: cualquier cosa que se lea antes se lee
  sin protección. El test del contrato comprueba el ORDEN, no sólo que el SQL
  esté (`tx:abre → cerrojo → busca → crea → tx:cierra`).
- Postgres lo suelta solo al cerrar la transacción: no hay forma de olvidarse
  de liberarlo.
- **Forma de dos `int4` y no un `bigint`**: dos contactos sólo se estorban si
  colisionan los DOS hashes, y aun colisionando el resultado sigue siendo
  correcto — sólo se serializan de más un instante. El e2e comprueba que dos
  contactos DISTINTOS a la vez sí dan dos clientes.
- Va por **`$executeRawUnsafe`** y no por `$queryRawUnsafe`:
  `pg_advisory_xact_lock` devuelve `void` y Prisma no sabe deserializar esa
  columna («Failed to deserialize column of type 'void'»). Salía **500 en los
  cinco casos del e2e** hasta dar con eso — y es la razón de que este frente
  tuviera que ejercerse contra Postgres de verdad para existir.

### 2.4 · El endpoint recibe el id de la FILA `Contact`, no el `holdedContactId`

`POST /clients/from-contact/:contactId` con el uuid de la fila. Valida la
pertenencia al tenant de un golpe (`findFirst({ id, tenantId })`), y un
`holdedContactId` en la ruta habría hecho falta filtrar dos veces. 404 si no
es del tenant, y el cerrojo ni se pide.

Devuelve **201 con `created: true`** si lo crea y **200 con `created: false`**
si ya estaba: nadie ve un error por haber llegado segundo.

### 2.5 · La primera palabra es el nombre, el resto los apellidos

`Contact.name` es un solo campo y `Client` tiene dos. El criterio es **tonto y
documentado a propósito**: cualquier heurística más lista («Ana Belén» es un
nombre compuesto, «de la Fuente» es una partícula) acierta unas veces y se
equivoca otras, y **la recepcionista no puede saber cuál le tocó** — se
encontraría fichas partidas de dos maneras distintas sin explicación. Con una
regla fija, lo que sale mal **sale mal siempre igual** y se corrige a mano en
la ficha en dos segundos.

- «Carmen Ruiz Delgado» → («Carmen», «Ruiz Delgado»)
- «Sole» → («Sole», «») — **por eso el frente 3 va antes que el 6**: sin
  apellidos opcionales, la base rechazaría este alta.
- Sólo espacios → («(sin nombre)», «»). No se inventa nada.
- Se corta a 120 caracteres por lado, que es el largo del esquema.
- Teléfono y email se copian si los hay. **Nada se escribe en Holded.**

### 2.6 · «Reservar» NO nombra el cliente, y no es un olvido

El frente 4 pedía que el botón dijera qué falta «(cliente, servicio, hora)».
**Dice servicio y hora, nunca cliente.** Desde B4 una cita SIN cliente es
legal a propósito —la reserva por teléfono de quien todavía no tiene ficha, el
fixture `ap-6` del banco visual— y `canReserve` nunca lo ha exigido. Decir
«falta el cliente» mandaría a la cajera a buscar un dato que no hace falta.

### 2.7 · El refresco de clientes MEZCLA, no reemplaza

Reemplazar tenía un fallo que el test destapó: al reservar, `doCreate` recarga
el día, la recarga releía el caché, y **la clienta que se acababa de elegir
volvía a «Sin nombre» — delante de ella**. Ahora el caché manda donde tiene el
dato (una ficha editada trae el nombre nuevo) y lo que el mapa ya sabía
sobrevive donde el caché aún no llega.

### 2.8 · «Cliente» se lee como un nombre

Una tarjeta que pone «16:00 · Cliente» parece la cita de alguien que se llama
así, no un dato que falta, y eso es exactamente lo que engañó el 13-09. El
marcador pasa a **«Sin nombre»**, en cursiva y peso normal.

**No lleva color propio**, y eso lo cambió el bucle visual: lo pinté en
`text-slate-400` y sobre el tinte da **1,95:1**. Un dato que falta hay que
poder leerlo. Lo que lo distingue de un nombre de verdad es la cursiva, que no
cuesta contraste.

**«Sin cliente» (id nulo) NO cambia**: no es un dato que falte, es una cita
sin ficha asociada a propósito, y ya se entendía.

El puente a caja manda **`null`**, no el marcador: la caja pondría «Sin
nombre» como si fuera el nombre de la clienta en el contexto del borrador.

### 2.9 · El filtro de proveedores vive en DOS sitios, a propósito

`GET /contacts/search` ya lo tenía, y **se aplica a todos los roles, el
propietario incluido**, salvo `?includeAll=1` (que además exige OWNER y da 403
a cualquier otro). El TPV nunca manda ese flag, y hay test de que no lo manda.

El endpoint de enlace **lo aplica también**, con 409 `CONTACT_NOT_CLIENT`. Si
viviera sólo en la búsqueda, quien llamara al endpoint a mano podría enlazar
un proveedor y meterlo en la agenda como clienta.

Un contacto con `type = null` (anterior al backfill de b29) **sí entra**: es
lo mismo que `UNKNOWN` — todavía no se sabe qué es, y el cajero lo ve.

### 2.10 · El A–Z del servidor NO se toca, y no es una omisión

Con apellidos opcionales, un `""` ordena ANTES que cualquier letra. Pero el
`orderBy` de `GET /clients` **es el orden del CURSOR de paginación, no lo que
se ve**: `refreshClients()` se baja el tenant entero (200 por página) y la
lista se pinta con `sortClientsAz`. Lo único que ese `orderBy` tiene que
garantizar es ser un orden total y estable entre páginas, y lo es. Cambiarlo
rompería la paginación sin arreglar nada visible. Queda documentado en el
propio `orderBy`.

El A–Z **que se ve** sí se arregla: la clave pasa a ser «el apellido, o el
nombre si no hay apellido». Sole cae en la S, entre Ruiz y Soto, que es donde
la recepcionista va a mirar.

### 2.11 · El `type="date"` nativo SÍ vale para ir a un día, y es el contrario del frente 3

Una fecha de **cita** cae a semanas del día de hoy, que es justo donde el
calendario del sistema abre. Una fecha de **nacimiento** cae cuarenta años
atrás, que es justo donde no abre. El mismo control es bueno en un sitio y
malo en el otro, y las dos decisiones salen del mismo razonamiento.

### 2.12 · La vuelta a «Hoy» va en la tira, no en la cabecera

Probé a ponerla en las dos y a 390 px salió el fallo que B-5 F8 arregló:
«Nueva cita» cortado por el borde derecho. Esa barra no tiene píxeles de
sobra. El primer chip de la tira dice «Hoy» en vez de «jue 17» y está siempre
a la vista: un toque, cero píxeles de cabecera.

### 2.13 · El cambio del selector llega TAMBIÉN a la venta

`useClientPicker` lo comparten la agenda y `SalePage`, así que la sección «De
Holded» y el alta rápida sin fecha de nacimiento aparecen en los dos. Es lo
que pedía el frente 3 («el selector de cliente de la agenda **y de la
venta**») y es coherente: el problema de las dos listas es el mismo en las dos
pantallas.

Ojo con no confundirlo con el **`ContactSheet` de la venta**
(`SalePage.contact.tsx`), que sigue igual: ése asigna el contacto de Holded
**al ticket, para la factura** (ADR-010). Son dos cosas distintas y las dos
siguen existiendo.

### 2.14 · El techo del filete de cabecera es 0,29 y no 0,30

De la fórmula sale 0,30 clavado. Con ese techo, el color acaba en canales de
8 bits y redondear dejaba algún tono del repertorio en **2,99997:1** — un test
rojo por un pelo que no vale para nada. Con 0,29 el peor caso es 3,04:1.

---

## 3 · Sabotaje → test rojo

Verificados **de una pasada contra el código final**, y comprobando antes de
cada uno que el test estaba VERDE con el código intacto.

| # | Qué línea de producción rompo | Fichero | Test que se pone rojo | Rojos | Mensaje |
|---|---|---|---|---|---|
| 1 | «Reservar y cobrar» visible en una cita de otro día (`esDeHoy = true`) | `AgendaPage.tsx` | `agenda-mostrador` | 2 | `expected <button …></button> to be null` |
| 2 | «Reservar y cobrar» otra vez como primario (clases intercambiadas) | `AgendaPage.tsx` | `agenda-mostrador` | 2 | `expected 'w-full h-12 rounded-xl border border-…' to contain 'bg-mipiace-coral'` |
| 3 | Quitar la deduplicación del endpoint de contacto (el `SELECT` previo) | `crm/from-contact.ts` | `crm-from-contact` | 3 | `expected 201 to be 200` · `expected ['tx:abre','cerrojo',…(2)] to deeply equal […(3)]` |
| 4 | Quitar el filtro de tipo del contacto | `crm/routes.ts` | `crm-from-contact` | 3 | `expected 201 to be 409` |
| 5 | Volver a exigir apellidos en la API | `crm/routes.ts` | `crm-route` | 3 | `expected 400 to be 201` |
| 6 | Volver a cargar el mapa de clientes sólo al montar | `AgendaPage.tsx` | `agenda-mostrador` | 17 | `expected '12:00 · Sin nombreServicio' to contain 'Carmen Ruiz'` |
| 7 | Calcular «fin» con cero servicios | `AgendaPage.tsx` | `agenda-mostrador` | 2 | `expected '…' not to contain 'fin'` |
| 8 | Tarjeta sin el tinte de la profesional | `AgendaPage.tsx` | `agenda-mostrador` | 6 | `expected '' to be '#e1d9ed'` · `expected 1 to be greater than or equal to 3` |
| 9 | **Quitar EL CERROJO** | `crm/from-contact.ts` | `crm-contacto.e2e` (Postgres real) | 2 | `expected 2 to be 1` |
| 10 | Proponer `COLOR_PRESETS[0]` a toda profesional sin perfil | `admin/StaffPage.tsx` | `staff-color-propuesto` | 3 | `expected 1 to be 3` (un color donde tenía que haber tres) · `expected '#e8663c' to be '#3c8ce8'` |
| 11 | Que el 40P01 deje de reconocerse (`isRaceAbort` → `false`) | `agenda/store.ts` | `agenda-carrera.e2e` (Postgres real) | 5 | `expected [201, 500] to deeply equal [201, 409]` con el `sqlState: "40P01"` en el cuerpo |

La 11 no es de este bloque: es el test que traía master y que puso el CI de
la rama en rojo (§12.1). Se comprueba aquí porque al traerse el arreglo hay
que demostrar que **sigue cazando lo que decía cazar** — que no se ha comprado
el verde a cambio de dejar de mirar. Las dos pasadas:

- **sin carrera** (`C409_SIN_CARRERA=1`, la palanca que trae el propio
  arreglo, que serializa las dos altas): el caso 1 sale **SALTADO**, con el
  motivo por consola. Es la condición del CI reproducida a mano;
- **con el 40P01 sin traducir**: **5 rojos**, y el primero salta en la ronda
  14 con el 500 en el mensaje — o sea, la garantía dura se comprueba ronda a
  ronda y ANTES de cualquier salto.

**Dos sabotajes salieron VERDES al primer intento, y los dos destaparon un
test malo:**

- **El 8** pasaba porque el test leía un atributo `data-tinte` **que se ponía
  él mismo**, no el fondo que el navegador iba a pintar. Ahora lee
  `style.backgroundColor`.
- **El 9** sólo tumbaba uno de los dos casos: una carrera de dos puede salir
  bien por suerte. Se añadieron **una prueba DIRECTA de que el cerrojo
  serializa** (dos transacciones que marcan entrada y salida: el orden es
  `entra-sale-entra-sale`, nunca `entra-entra`) y **diez rondas** de la
  carrera de dos, que convierten «tuvo suerte» en «no puede». Con eso, el
  sabotaje sale rojo en **tres pasadas seguidas**.

---

## 4 · Lo que la suite NO cubre

Cruzado con la rutina real de Sole (tres profesionales, nombres de pila,
reservas a semanas vista, agenda y caja en la misma tablet). **Lo que su
rutina pisaba está arreglado en esta rama** (§5); esto es lo que queda fuera.

1. **El hierro.** Nada de esto se ha visto en un AP11 ni en un AP12. El
   `type="date"` de ir a un día abre el calendario **del sistema Android**, y
   el del AP11 es un Chrome viejo: cómo se ve y si se puede tocar con el dedo
   **sólo se sabe en la pasada de hierro** (§7). El campo con máscara de la
   fecha de nacimiento tiene el problema inverso y está cubierto por tests,
   pero el teclado numérico que abre `inputMode="numeric"` tampoco se ha
   visto.
2. **La red de verdad con Holded.** El `debounce` y el «sin conexión» se
   prueban con la red interceptada. Una red **lenta** (no caída) no se cubre:
   la sección aparecería tarde, y no hay indicador de «buscando» en la sección
   de Holded — a propósito, porque un spinner que aparece y desaparece en cada
   letra es peor que nada, pero no está medido en 3G real.
3. **Un tenant con muchos contactos.** `GET /contacts/search` limita a 25 y el
   selector los pinta todos. Con un tenant de miles de contactos y una query
   de dos letras salen 25 filas en una hoja que ya hace scroll. No se ha
   medido si eso es cómodo.
4. **La línea roja de «ahora» sigue tachando** el texto de una cita que la
   cruza. Es la deuda que 6a §5 dejó apuntada y 7a §5 volvió a medir (la
   solución buena es el `nowtag` del mockup). **Medida otra vez aquí y no
   arreglada**: sigue fuera de alcance.
5. **Dos citas que se solapan** en la misma columna siguen sin layout de
   solape (el `EXCLUDE` lo hace imposible salvo con citas locales, y para eso
   está la mitad derecha de 6a). No lo toca este bloque.
6. **La paleta del admin no está medida contra el tinte.** ~~El color de la
   profesional no se puede poner desde el admin.~~ **Eso era falso y lo corrigió
   la revisión de cierre: sí se puede** — `apps/admin/src/pages/StaffPage.tsx`
   tiene un selector con seis presets (`COLOR_PRESETS`) y además un
   `input type="color"` para cualquier otro. Lo escribí sin mirar la pantalla,
   fiándome de un `grep` que sólo buscaba en `apps/admin-web/` (un directorio
   que no existe: el paquete se llama `apps/admin`). **De ahí salió el filo de
   §5**, que sí estaba y ahora está arreglado.

   Lo que de verdad NO cubre la suite: **ninguno de los seis presets se ha
   medido contra el tinte del frente 2**, ni el color libre del
   `input type="color"`. No hace falta que se midan —`tinteClaro` normaliza
   CUALQUIER color a luminancia 0,72 y `staff-color.test.ts` lo comprueba con
   ocho colores, incluidos un casi negro y un casi blanco— pero nadie ha mirado
   si los seis presets, ya teñidos, se distinguen **entre sí**. Dos presets con
   tonos parecidos darían dos tintes parecidos, y eso el contraste no lo dice.
7. **`agenda-mostrador.test.tsx` no comprueba píxeles.** Que el pie no salte
   se fija contando filas y mirando las clases de alto fijo, no midiendo. Lo
   que mide de verdad es el bucle visual.
8. **La `ContactSheet` de la venta no se ha tocado** y sigue con su propia
   búsqueda de contactos. Que las dos convivan sin confundir al cajero no está
   probado con nadie delante.

---

## 5 · Lo que la rutina de Sole pisaba, y está arreglado

**Se llega a un día de dentro de tres semanas.** Sole reserva con semanas de
antelación. Hasta este bloque sólo había cuatro formas de cambiar de día: la
tira de **siete** chips, dos flechas y el botón de volver a hoy. Y las flechas
son `hidden sm:flex`. O sea:

- en la tablet, un jueves de dentro de tres semanas costaba **veintiún
  toques** en la flecha;
- por debajo de 640 px, donde las flechas no existen, el día 8 en adelante era
  **sencillamente inalcanzable**.

La cabecera gana un salto de fecha con `min` en hoy (§2.11), y la vuelta a hoy
pasa al primer chip de la tira (§2.12).

**Las tres profesionales salían del mismo color.** El formulario de perfil del
admin proponía `COLOR_PRESETS[0]` a **toda** profesional sin perfil. El día en
que Sole da de alta a SOLE, ANA e ISA, nadie toca el selector —que es lo
normal: el campo ya venía relleno— y **las tres quedan en el mismo coral**. En
la agenda, el tinte del frente 2 las pinta idénticas: el color deja de
distinguir de quién es cada cita, que es para lo único que está. O sea, el
frente 2 entero se quedaba sin efecto en el caso más probable de todos — el
primer día.

Ahora se propone **el primer color de la paleta que no esté usando ya otra
profesional ACTIVA del tenant**; si están todos usados, se vuelve a empezar por
el principio. Detalles:

- **Sólo cambia el valor inicial del formulario.** El color que una profesional
  ya tiene guardado no se toca nunca: esto no repinta a nadie, sólo evita que
  la siguiente alta nazca repetida. Hay test de que dos profesionales que hoy
  comparten color siguen viendo el suyo al abrir su editor.
- **Una profesional de baja no ocupa color**: sin citas en la rejilla, el suyo
  no le estorba a nadie.
- **Se coge el hueco, no el siguiente al último.** Si la segunda se dio de baja
  y su color quedó libre, se reusa.
- **Se calcula una sola vez, al abrir el editor** (`useState` con función).
  Recalcularlo en cada render movería el color bajo el dedo de quien lo está
  eligiendo.
- La regla vive en `apps/admin/src/pages/StaffPage.colors.ts`, aparte y pura,
  para poder probarla sin montar la pantalla — mismo patrón que
  `SalePage.contact.privacy.ts`.

**Un alta sin apellidos SIN RED.** Los dos casos de su rutina a la vez: apunta
a sus clientas por el nombre de pila y el centro se queda sin cobertura. El
cuerpo que se encola es el que va a reintentar el outbox y `last_name` es
`NOT NULL`: si se colara un `undefined`, el alta moriría en el reintento,
cuando ya nadie está mirando. Cubierto en `clients-cache.test.ts`.

---

## 6 · Bucle visual

Playwright a **390, 1280 y a la resolución del AP11/AP12 en horizontal**,
contra el banco visual (`apps/tpv-web/visual/`). `playwright-core` vive en el
scratchpad y **no entra en el repositorio**. **45 capturas** en
`docs/blocks/reservas-mostrador-shots/`.

**De dónde sale la resolución del AP11.** Medida sobre las capturas del 13-09:
son de 1920×1200 de fichero, y el panel de alta (`md:w-96` = 384 px CSS) ocupa
575 px. 575/384 = 1,5. Luego **el AP11 en horizontal es 1280×800 CSS a
`deviceScaleFactor` 1,5**. Las capturas `-ap11` se toman con ese factor, así
que salen a 1920×1200 y se pueden poner al lado de las del 13-09.

El banco gana los parámetros del bloque: `?colores=matriz` (un morado oscuro,
un amarillo clarísimo y una profesional **sin color**), `?sin-apellidos=1`,
`?holded=resultados|vacio|sin-red` y la pantalla `clientes`.

| Captura | Qué enseña |
|---|---|
| `f2-agenda-colores` | Las tres profesionales con los tres casos del tinte y citas de las tres. El rayado de «no reservable» ya NO pesa más que las tarjetas |
| `f2-agenda-local-y-rechazada` | La cita local y la rechazada de 6a, a rayas y en la mitad derecha, **sin teñir** — se siguen distinguiendo de una cita normal |
| `f1-panel-hoy` · `f1-panel-otro-dia` | El panel con y sin «Reservar y cobrar». El pie mide lo mismo: donde iba el botón, va «Se cobra el día de la cita» |
| `f4-panel-con-servicio` | «Servicios · 30 min · fin 13:30» con el servicio puesto, y los dos botones encendidos |
| `f4-buscar-hueco-mudo` | «Buscar hueco» apagado **con su motivo debajo**, y «Faltan el servicio y la hora» encima de «Reservar» |
| `f6-selector-crm` | Sólo clientes. **Carmen Ruiz sale UNA vez**, aunque tenga contacto de Holded: es la deduplicación |
| `f6-selector-holded` | La sección «DE HOLDED» con dos contactos y **el teléfono enmascarado** |
| `f6-selector-sin-red` | Sin sección y con el aviso: «Sin conexión: no se buscan contactos de Holded» |
| `f6-selector-vacio` | Sin resultados: «Sin coincidencias» y **ninguna sección vacía** |
| `f3-clientes-az` | El A–Z con Sole (sin apellidos) **entre Carmen Ruiz y Ana Belén Soto**, no la primera |
| `f3-ficha-nacimiento` · `-error` | La fecha con máscara `dd/mm/aaaa`, y «Febrero no tiene 31 días» junto al campo con el botón apagado |
| `f3-alta-rapida` | El alta del selector **sin la fecha de nacimiento** |
| `f7-ir-a-dia` | El salto a un día de dentro de tres semanas, y el chip «Hoy» de la tira |

### Lo que el bucle cambió, y que ningún test habría cogido (`f1774f6`)

1. **El marcador «Sin nombre» era ILEGIBLE.** Lo pinté en `text-slate-400`
   para que se leyera como un dato que falta: sobre el tinte da **1,95:1**, y
   sobre el rojo de una cita rechazada, 2,48:1. Un dato que falta hay que
   **poder leerlo**.
2. **El filete de la cabecera DESAPARECÍA con un color claro.** Ana tiene un
   amarillo casi blanco: **1,26:1** contra el blanco de la cabecera, o sea que
   su columna se quedaba sin marca de color mientras sus citas sí la tenían.
3. **«El 02 no tiene 31 días» es una frase de programador.** Hay que traducir
   el 02 antes de entenderla, y eso es justo lo que no se hace con una clienta
   delante.

Y en la segunda vuelta (`bee7321`): **a 390 px el salto de fecha cortaba
«Nueva cita»** por el borde derecho — el mismo fallo que B-5 F8 arregló,
reintroducido. Se resolvió quitando de la cabecera el botón «Hoy» que había
añadido, porque el chip de la tira ya hacía ese trabajo.

**Medido y NO arreglado:** la línea roja de «ahora» sigue tachando el texto de
la cita que cruza (§4.4). A 320 px la agenda sigue haciendo scroll horizontal
(comportamiento de B4).

---

## 7 · Lo que Matías tiene que mirar en el AP11

En este orden, que es el del daño:

1. **El botón, con una cita del jueves.** Abrir la agenda, ir a un día que no
   sea hoy, tocar una franja, elegir servicio: **tiene que haber un solo
   botón**, «Reservar», y debajo «Se cobra el día de la cita». Volver a hoy:
   aparece «Reservar y cobrar», y **sigue sin ser el coral**. Comprobar que al
   cambiar de día con el panel abierto el primario **no se mueve de sitio**.
2. **El salto de fecha.** Es lo único del bloque que abre un control **del
   sistema Android**, y el AP11 lleva un Chrome de 2020. Tocar el campo de
   fecha de la cabecera: ¿abre el calendario?, ¿se puede elegir un día de
   dentro de tres semanas con el dedo?, ¿el campo cabe en la barra sin comerse
   «Nueva cita»? **Si el calendario nativo no sirve en ese Chrome, esto hay
   que rehacerlo** y es lo más probable que falle.
3. **El tinte, con el sol de la tarde.** Las capturas son de un monitor. En la
   pantalla del AP11 y con la luz del local: ¿se distinguen las tres columnas
   por el color?, ¿se lee la segunda línea (el servicio) sobre el tinte?, ¿el
   rayado de «no reservable» **sigue viéndose** ahora que pesa la mitad?
4. **La fecha de nacimiento con el teclado.** En la ficha de un cliente,
   teclear `07031961`: ¿sale el **teclado numérico** o el alfabético?, ¿la
   máscara pone las barras según se escribe?, ¿el aviso de «Febrero no tiene
   31 días» se lee sin que el teclado lo tape? (El `scrollFocusIntoView` de la
   casa debería subirlo, pero eso no se ha visto aquí.)
5. **El buscador con el tenant de PRUEBAS.** Buscar «dem» —o el nombre que
   fallara el 13-09— y comprobar que ahora sale bajo «De Holded». **Elegirlo,
   y comprobar que la ficha se crea con el nombre bien partido.** Luego
   buscarlo otra vez: tiene que salir **arriba, como cliente, y no abajo**.
6. **El mismo contacto desde dos sitios.** Si hay un segundo terminal: elegir
   el mismo contacto de Holded en los dos a la vez y comprobar en Clientes que
   **hay una sola ficha**. Es lo que el e2e demuestra contra Postgres, pero no
   contra dos APK reales.
7. **Un alta sin apellidos, y sin red.** Poner el terminal en avión, dar de
   alta a una clienta sólo con el nombre, reconectar y comprobar que **la
   ficha llega** y que en la lista sale ordenada por su nombre, no la primera.
8. **El nombre en la tarjeta.** Crear una clienta desde el selector con la
   agenda abierta y comprobar que la cita nueva sale **con su nombre**, no con
   «Sin nombre». Y que ninguna cita vieja pone ya «Cliente».
9. **Dar de alta tres profesionales y comprobar que salen con tres colores
   distintos.** En el panel de Personal, abrir SOLE, ANA e ISA y guardar cada
   una **sin tocar el selector de color**. Las tres tienen que quedar en tres
   colores de la paleta, no en el mismo. Y luego, en la agenda: que las tres
   columnas se distingan por el tinte.

---

## 8 · Al desplegar

- **Cero migraciones.** `prisma migrate deploy` no tiene nada nuevo que
  aplicar. El bloque no toca el esquema.
- **El servidor va primero.** El front nuevo llama a
  `POST /clients/from-contact/:contactId`, que no existe en master: un APK
  nuevo contra un servidor viejo deja la sección «De Holded» dando error al
  elegir (sale el aviso «No se ha podido traer ese contacto», no se rompe
  nada). Al revés —servidor nuevo, APK viejo— no pasa nada: nadie llama al
  endpoint.
- **Nada que configurar.** No hay flag, ni ajuste, ni dato que sembrar.
- **Cuando entre `catalogo-local`** (tenant con `holdedEnabled=false`): la
  sección «De Holded» **no debe aparecer**. Hoy ya no aparece por el camino
  natural —un tenant sin contactos sincronizados devuelve cero resultados y la
  sección sólo existe si hay alguno—, así que el comportamiento es el correcto
  desde el primer día **sin tocar nada**. Cuando esa rama traiga el flag al
  payload del catálogo, lo suyo es gatear además la **petición**: hoy se hace
  un `GET /contacts/search` por búsqueda que en ese tenant siempre va a volver
  vacío. Es desperdicio, no un fallo.

---

## 9 · Ficheros

**Nuevos**

| Fichero | Qué |
|---|---|
| `apps/tpv-web/src/lib/staffColor.ts` | Luminancia, contraste, el tinte por bisección, el tono de estado, el de cabecera y el color estable por `userId` |
| `apps/tpv-web/src/lib/birthdate-mask.ts` | Máscara `dd/mm/aaaa` y parseo a `YYYY-MM-DD`, con el «hoy» por parámetro |
| `apps/tpv-web/src/lib/contacts.ts` | Búsqueda de contactos de Holded y enlace, con el caché al día |
| `apps/api/src/crm/from-contact.ts` | El cerrojo, el `SELECT`-o-`INSERT` y `partirNombre` |
| `apps/admin/src/pages/StaffPage.colors.ts` | La paleta y el color que se propone a una profesional nueva |
| `apps/tpv-web/test/staff-color.test.ts` | 48 casos de contraste |
| `apps/tpv-web/test/birthdate-mask.test.ts` | 19 casos del parser |
| `apps/tpv-web/test/agenda-mostrador.test.tsx` | 45 casos de los frentes 1, 2, 4, 5 y el salto de fecha |
| `apps/tpv-web/test/clients-az.test.ts` | 9 casos del A–Z con apellidos vacíos |
| `apps/tpv-web/test/client-form-quick.test.tsx` | 14 casos de los dos modos del formulario |
| `apps/tpv-web/test/client-picker-holded.test.tsx` | 19 casos de la sección de Holded |
| `apps/api/test/crm-from-contact.test.ts` | 21 casos del contrato del endpoint |
| `apps/api/test-e2e/crm-contacto.e2e.ts` | 15 casos contra Postgres real |
| `apps/admin/test/staff-color-propuesto.test.tsx` | 19 casos: la regla del color libre y las tres altas seguidas |

**Tocados**

| Fichero | Qué |
|---|---|
| `apps/tpv-web/src/pages/AgendaPage.tsx` | Frentes 1, 2, 4, 5 y el salto de fecha |
| `apps/tpv-web/src/pages/ClientForm.tsx` | `modo`, la fecha con máscara, apellidos opcionales |
| `apps/tpv-web/src/hooks/useClientPicker.tsx` | La sección «De Holded» y el alta en modo rápido |
| `apps/tpv-web/src/lib/clients.ts` | `clientSortKey`, `sortClientsAz`, `lastName` opcional |
| `apps/api/src/crm/routes.ts` | `lastName` fuera de `required`, la ruta nueva, el porqué del `orderBy` |
| `apps/api/test/crm-route.test.ts` | El bloque de apellidos opcionales; un test viejo actualizado |
| `apps/tpv-web/test/clients-cache.test.ts` | El alta sin apellidos y sin red |
| `apps/tpv-web/visual/main.tsx` | Los parámetros del bloque y la pantalla `clientes` |
| `apps/admin/src/pages/StaffPage.tsx` | El color propuesto sale de los que ya están pillados; la paleta se va al módulo puro |

---

## 10 · Componentes de 21st

**Ninguno.** Se evaluó para los dos sitios que el prompt sugería:

- **El campo con máscara** — lo que hacía falta no era un componente sino el
  **parser** (`birthdate-mask.ts`, 19 casos): qué es una fecha imposible, qué
  es futura, y que el desbordamiento de fin de mes no se cuele. Un componente
  de catálogo habría traído su propio input, sus propias clases y su propia
  idea de validación, y luego habría que normalizarlo a los tokens de la casa.
  El `Field` que ya existe en `ClientForm` sólo necesitaba tres props más.
- **El aviso de botón desactivado** — el catálogo resuelve esto con tooltips,
  que `docs/ux-principles.md` §6 prohíbe explícitamente («Touch no tiene
  hover»). Lo que se ha hecho es un `<p>` de una línea en una ranura de altura
  fija: traer un componente para eso habría sido traer el anti-patrón con él.

---

## 11 · Commits

| Hash | Qué |
|---|---|
| `46c0b2b` | El plan del frente 0 |
| `eeb0bea` | F1 · «Reservar» primario, cobrar sólo si la cita es de hoy |
| `b3ca26c` | F2 · el tinte de la profesional en la tarjeta |
| `700d7c0` | F3 · la fecha fuera del alta rápida, con máscara en la ficha, apellidos opcionales |
| `391f38f` | F4 · ningún botón mudo, y sin duración no hay «fin» |
| `dcece2f` | F5 · el nombre de la clienta siempre |
| `35eb2c2` | F6 · el buscador encuentra a los contactos de Holded |
| `f1774f6` | Lo que cogió el bucle visual |
| `bee7321` | Se llega a un día de dentro de tres semanas |
| `3cd910f` | El alta sin apellidos y sin red |
| `6bf3c4f` | El done del bloque |
| `8656776` | Revisión de cierre · el color propuesto a una profesional nueva |
| `86fb85d` | La corrección del §4.6 |
| *(merge)* | Master a la rama: el testigo del deadlock de `1cdf7e3`, que es lo que puso el CI en rojo (§12) |

**Último commit con código: `8656776`.**

**Ni push ni deploy**: eso lo hace Matías.

---

## 12 · El CI se puso rojo, y por qué en local no

### 12.1 · Qué falló (run 35224660333)

El job `e2e`. Y **no era nada de este bloque**: `crm-contacto.e2e.ts` pasó sus
15 casos. El que cayó fue el **caso 1 de `agenda-carrera.e2e.ts`**, que viene
de master:

```
AssertionError: 40 rondas sin un solo deadlock:
esta pasada NO ha ejercido el 40P01: expected 0 to be greater than 0
  ❯ test-e2e/agenda-carrera.e2e.ts:349:9
```

Ese caso repite la carrera de dos altas hasta que Postgres levante un
deadlock, y **se ponía rojo a propósito si no llegaba a haber ninguno** — la
idea era que un test que no ejerce lo que dice cubrir miente más que uno que
falta.

**La causa NO es la base, ni una variable de entorno, ni el orden de los
ficheros.** Es el reloj:

- un deadlock cuesta **como mínimo `deadlock_timeout`**, que es 1 s por
  defecto y el CI no lo cambia: Postgres no busca ciclos antes;
- en el CI las 40 rondas se despacharon en **1,4 s**. No caben ni un solo
  deadlock. Allí sencillamente **no hubo carrera**: con el socket local del
  runner, la primera alta termina antes de que la segunda empiece, y sale el
  23P01 de siempre;
- en este portátil, con Postgres en Docker y su VM de por medio, cada ronda
  tarda lo bastante como para que las dos se solapen — y el deadlock cae en
  las primeras rondas. Por eso aquí salía verde y allí rojo, **con el mismo
  Postgres 16-alpine y el mismo `deadlock_timeout` de 1 s** (comprobado en los
  dos sitios).

La diferencia entre local y CI no era de configuración: era de **latencia**.

### 12.2 · Por qué lo tenía mi rama y no master

Master ya había pasado por esto —su propio CI se puso rojo igual, run
34944219974— y lo arregló en `1cdf7e3` («el testigo del deadlock lo cuenta el
código, no `pg_stat_database`»). **Esta rama sale de `5994fde`, que es
anterior**, así que arrastraba la versión vieja del test.

Se arregla trayendo master a la rama (`git merge master`), que además es lo
que va a pasar al integrar. Cero conflictos: los tres ficheros que toca
`1cdf7e3` —`agenda/store.ts`, `agenda-carrera.e2e.ts` y
`agenda-carrera.test.ts`— no los toca este bloque.

Lo que trae el arreglo: el testigo pasa a ser un contador de `store.ts` que
sube en el instante en que se reconoce el SQLSTATE, y si una pasada no llega a
provocar deadlock **el caso 1 se SALTA** en vez de ponerse rojo (mentira: no
ha fallado nada) o verde (mentira también: no habría probado lo que dice). Las
garantías duras —ni un 500, una sola cita por hueco— se siguen comprobando en
cada ronda antes del salto.

### 12.3 · La lección para el siguiente bloque

**Correr los e2e en local NO es correr los e2e del CI.** Aquí se corrieron
contra una base propia (`mipiacetpv_mostrador_e2e`, con las credenciales de
desarrollo) y sin `CI=true`; el workflow usa `mipiacetpv_e2e`, la contraseña
`mipiacetpv` y un runner mucho más rápido. Ninguna de esas tres diferencias
causó ESTE fallo, pero la tercera lo destapó.

Antes de dar un bloque por cerrado, además de la pasada de siempre:

```bash
# Los e2e con la forma del CI: su nombre de base y su CI=true.
docker exec -i mipiacetpv-postgres psql -U mipiacetpv \
  -c "CREATE DATABASE mipiacetpv_ci_e2e;"
CI=true E2E_DATABASE_URL='postgresql://mipiacetpv:mipiacetpv_dev@127.0.0.1:5432/mipiacetpv_ci_e2e' \
  pnpm test:e2e
```

Y **mirar si master se ha movido** (`git log HEAD..master`): una rama larga
puede arrastrar un test que master ya arregló, que es exactamente lo que pasó
aquí.

---

## 13 · Cómo repetir lo de aquí

```bash
# La suite entera, desde la raíz
pnpm db:generate && pnpm test

# Los e2e, contra una base PROPIA (la suite hace DROP SCHEMA)
docker exec -i mipiacetpv-postgres psql -U mipiacetpv \
  -c "CREATE DATABASE mipiacetpv_mostrador_e2e;"
E2E_DATABASE_URL='postgresql://mipiacetpv:mipiacetpv_dev@127.0.0.1:5432/mipiacetpv_mostrador_e2e' \
  pnpm test:e2e
# Y al terminar, borrarla:
docker exec -i mipiacetpv-postgres psql -U mipiacetpv \
  -c "DROP DATABASE mipiacetpv_mostrador_e2e;"

# Los mismos e2e CON LA FORMA DEL CI (§12.3): su nombre de base y su CI=true.
docker exec -i mipiacetpv-postgres psql -U mipiacetpv \
  -c "CREATE DATABASE mipiacetpv_ci_e2e;"
CI=true E2E_DATABASE_URL='postgresql://mipiacetpv:mipiacetpv_dev@127.0.0.1:5432/mipiacetpv_ci_e2e' \
  pnpm test:e2e
docker exec -i mipiacetpv-postgres psql -U mipiacetpv \
  -c "DROP DATABASE mipiacetpv_ci_e2e;"

# El banco visual
pnpm --filter @mipiacetpv/tpv-web dev
# → http://localhost:5173/visual/index.html?screen=agenda&colores=matriz&at=11:20
# → …&holded=sin-red · …&screen=clientes&sin-apellidos=1
```
