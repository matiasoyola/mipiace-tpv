# Bloque enlaces-publicos · hecho

Rama `enlaces-publicos`, worktree
`~/Developer/Claude/Projects/mipiacetpv-enlaces-publicos`, desde `origin/master` = `cf0bd91`
(+ `9cfcb2e`, el prompt del bloque). Decisión **S1** de
`docs/clinica/solapes-clinica-agenda.md` (07-10, OK de Matías).

**Una sola puerta para todo lo que se abre sin cuenta.** El enlace del test de la valoración
—lo único que hoy existía— pasa a vivir sobre ella sin cambiar una coma de lo que se ve desde
fuera, y los cuatro que vienen (leer un consentimiento antes de firmarlo, «mi cita», la encuesta
post-visita, el formulario del equipo) sólo tendrán que declarar su `purpose`.

```
                           ANTES                              AHORA
   ┌───────────────────────────────┐        ┌───────────────────────────────────────┐
   │ GET/POST /valoracion/:token   │        │ GET/POST /valoracion/:token           │
   │   · formato del token         │        │   · qué preguntar                     │
   │   · hash SHA-256              │        │   · qué guardar                       │
   │   · caducidad por canal       │        └──────────────────┬────────────────────┘
   │   · un uso (link_used_at)     │                           │
   │   · rate-limit por IP         │        ┌──────────────────▼────────────────────┐
   │   · la 404 común              │        │ enlaces/puerta.ts · LA PUERTA         │
   │   · el módulo apagado         │        │   cabeceras · formato · huella        │
   │   · qué sale y qué no         │        │   purpose · anulado · caducado        │
   └───────────────────────────────┘        │   gastado · objetivo · estado         │
            todo en una ruta                │   dos límites · LA MISMA 404          │
                                            └──────────────────┬────────────────────┘
                                            ┌──────────────────▼────────────────────┐
                                            │ enlaces/reglas.ts · EL REGISTRO       │
                                            │   VALORACION: SOLO_ESCRIBIR, 1 uso,  │
                                            │   30 d / 4 h, PENDIENTE_PACIENTE,     │
                                            │   rastro clínico, límite por IP       │
                                            │   (+ los cuatro que vienen)           │
                                            └───────────────────────────────────────┘
```

La fila, leída del banco con navegador después de que Carmen contestara su test de verdad
(`mipiacetpv_enlaces_banco_e2e`):

```
purpose            | VALORACION
target_type        | CLINICAL_ASSESSMENT
huella             | 758fdbe893f6…        (64 caracteres · el token NO está)
expires_at         | 2026-11-06 22:02:41+00   (30 días · canal EMAIL)
max_uses           | 1
used_count         | 1                    (se gastó al CONTESTAR, no al abrir)
revoked_at         | ␀
created_by_user_id | ␀                    (la pidió la cita, no una persona)
```

---

## 1 · Qué cambia y qué NO cambia

**Visto desde fuera, nada.** Mismas dos rutas, mismos textos, misma 404, mismo correo, mismo
enlace de 43 caracteres. La prueba es que las cuatro guardias de clinica-2 siguen verdes **sin
tocar un solo assert**:

| Guardia | Casos | Estado |
| --- | --- | --- |
| `clinica-valoracion-rutas.test.ts` | 48 | verde, **cero asserts tocados** (sí el Prisma falso, §9) |
| `clinica-valoracion-migracion.test.ts` | 35 | verde, **sin tocar** |
| `clinica-valoracion.e2e.ts` | 44 | verde, **sin tocar** |
| `apps/e2e-ui/specs/11-clinica-valoracion.spec.ts` | 4 | verde, **sin tocar** (banco con navegador, base limpia) |

Lo que cambia por dentro:

- La seguridad **ya no está en `valoracion-publica.ts`**. El formato, la huella, la caducidad, los
  usos, la revocación, el estado admitido, los dos límites, las tres cabeceras y la 404 los decide
  la puerta. En la ruta queda la pantalla: qué se pregunta y qué se guarda.
- `clinica/enlace.ts` pasa de 193 líneas a 75: es la cara de la valoración sobre la puerta (la URL
  del email, y dos envoltorios de un renglón). **Cada decisión de clinica-2 que seguía valiendo
  viajó con su comentario al sitio donde manda ahora** — no se reescribió, se generalizó.
- Tres cabeceras **nuevas** en las dos rutas públicas (`no-store`, `noindex`, `no-referrer`). Es lo
  único que un cliente puede notar, y es aditivo.
- Dos límites de peticiones donde había uno.
- `revocarEnlace` existe: recepción podrá anular cualquier enlace de cualquier `purpose` desde un
  sitio. La pantalla la trae «mi cita» (fuera de alcance).

---

## 2 · La tabla, y lo que garantiza el motor

`public_links` (migración `20261008000000_enlaces_publicos`, **aditiva**). La fila guarda ESTADO; lo
que el enlace PUEDE HACER lo declara el `purpose` en código.

| Garantía | Quién la sostiene |
| --- | --- |
| **La columna no admite un token en claro** | `CHECK token_hash ~ '^[0-9a-f]{64}$'` |
| Dos enlaces no comparten huella | único sobre `token_hash` |
| Un token sin caducidad no cabe | `expires_at NOT NULL` |
| Los usos no pasan del tope | `CHECK used_count BETWEEN 0 AND max_uses` |
| Los usos no bajan | trigger `public_links_guard` |
| Un anulado no se des-anula | trigger |
| **La caducidad no se alarga** | trigger (`expires_at` va en la identidad) |
| Un enlace no se borra | trigger |
| Ni se le cambia para qué sirve, a qué apunta, su huella o su tope | trigger |
| **Un solo enlace vivo por (`purpose`, objetivo)** | único PARCIAL `public_links_uno_vivo_key` |
| El negocio y quien lo creó no se borran por debajo | FKs `RESTRICT` (ninguna CASCADE) |

### Por qué `purpose` y `target_type` son TEXT y no enums

Porque un `purpose` nuevo tiene que poder nacer en el bloque que lo necesita, **sin migración**. Con
un enum, cada uno de los cuatro que vienen obligaría a un `ALTER TYPE … ADD VALUE` — y clinica-1 y
clinica-2 ya pagaron dos veces la lección de que ese ALTER no puede ir en la misma transacción que
el código que lo usa («unsafe use of new value of enum type»).

Y no se pierde nada, porque **el valor de la columna no es la autorización**. Para preguntarle a la
puerta por un `purpose` hay que traerle sus REGLAS, y las reglas sólo se escriben en `reglas.ts`.
Una fila con `purpose = 'LO_QUE_SEA'` puede estar en la base y no tiene ninguna ruta que la
pregunte: no abre nada. Un CHECK con la lista de valores habría devuelto el problema del enum
(migración por `purpose`) sin devolver la garantía.

Hubo una versión con una comprobación explícita (`purposeConocido()`) dentro de la puerta. Se quitó
al escribir el test: era **redundante y además impedía probar el mecanismo** con `purpose` de
prueba, que es justo lo que este bloque tenía que dejar probado para los cuatro que vienen.

### `target_id` sin FK, a propósito

Los objetivos son de tablas distintas (una valoración, una cita, un consentimiento). Una FK por tipo
exigiría una columna nula por tipo —diez columnas— o una tabla de enlaces por objetivo, que es
exactamente lo que este bloque viene a quitar. Lo que se pierde lo cubre la puerta: carga el
objetivo **con el `tenant_id` del enlace**, y si no está contesta la MISMA 404. Un enlace huérfano
no abre nada, y hay test.

### Un solo enlace vivo: la invariante que no estaba en el prompt

La decisión S1.5 dice «reenviar rota el token: fila nueva, la anterior revocada». Escrito así es una
costumbre. El único parcial lo convierte en invariante: **si `rotarEnlace` se olvidara de revocar, el
`crearEnlace` de la línea siguiente falla con 23505** en vez de dejar dos enlaces vivos del mismo
test, con el primero abriendo todavía.

Es parcial en los dos sentidos: un enlace anulado sale del índice y uno **gastado** también
(`used_count >= max_uses`), así que ninguno bloquea al siguiente. Un **caducado sí sigue dentro**, y
es deliberado: el camino que da un enlace nuevo tiene que anular el viejo explícitamente, y así la
anulación es la única forma de retirar uno.

---

## 3 · La puerta: el orden de las comprobaciones

```
 0. LAS TRES CABECERAS          ← antes de cualquier rama: las lleva el 200, la 404, el 429 y el 500
 1. candado del límite general  → 429
 2. formato ANTES de la base    → 404  (+ cuenta en los dos cubos)
 3. huella contra el único      → 404  (+ cuenta en los dos cubos)
 4. ¿es de este purpose?        → 404  (+ cuenta en los dos cubos)
 5. anulado / caducado / gastado→ 404  (+ cuenta SÓLO en el general)
 6. objetivo (con el tenant
    DEL ENLACE) y su estado     → 404  (+ cuenta SÓLO en el general)
 ── reset del cubo general ──
 → { enlaceId, tenantId, usosRestantes, expiraEn, objetivo }
```

**La 0 va donde va por una razón concreta**: si las cabeceras se pusieran en cada rama, la rama
nueva que alguien escriba dentro de dos bloques no las llevaría. Puestas al principio, no hay
respuesta de la puerta que pueda salir sin ellas — y el 429, que es la que nadie se acuerda de
vestir, tiene su propio test.

Las tres, y lo que cierra cada una:

- `Cache-Control: no-store` — ni el navegador ni un proxy guardan la respuesta. Sin esto, el
  formulario de un paciente queda en la caché de la tablet de la sala para el siguiente que la coja.
- `X-Robots-Tag: noindex` — si una de estas URLs acaba en un correo reenviado que un buscador
  rastrea, no se indexa. Es la diferencia entre «se filtró a una persona» y «está en Google».
- `Referrer-Policy: no-referrer` — **el token está EN la ruta**. Sin esta cabecera, cualquier recurso
  externo que la página cargara recibiría la credencial entera en una cabecera de su propio log.

Lo único que sale sin ellas es el 400 del esquema de Fastify (un token que no mide 43), que se
contesta antes de llegar a la puerta y no lleva ningún dato.

### La misma 404, y por qué el texto vive en el `purpose`

Ocho motivos (`FORMATO`, `NO_EXISTE`, `OTRO_PURPOSE`, `ANULADO`, `CADUCADO`, `GASTADO`,
`SIN_OBJETIVO`, `ESTADO_NO_ADMITE`) y una sola respuesta, carácter por carácter. El motivo se queda
en el log de la aplicación —es lo que permite ayudar a quien llama diciendo «me da error»— y nunca
en la respuesta.

El texto está en `reglas.ts` y no en la ruta porque con un mensaje por ruta, el día que alguien
ajuste el de una sola se puede volver a distinguir. (Ni el token ni la huella van al log: el motivo
y el `purpose`.)

---

## 4 · Los dos límites, y por qué dos

| | clave | tope | ventana | cuenta |
| --- | --- | --- | --- | --- |
| **general** (el de clinica-2) | IP, **o la huella del token** si el `purpose` lo dice | 30 | 1 h (candado 1 h) | todos los fallos |
| **tokens inexistentes** (nuevo) | **siempre la IP** | 10 | 1 min | sólo formato / no existe / otro purpose |

El general es de ventana larga: acota el total, pero deja pasar una ráfaga de 29 intentos en dos
segundos antes de enterarse. El nuevo es la ráfaga: **la undécima petición del minuto contra un
token que no es de nadie se corta**.

**Un enlace caducado, gastado o anulado NO cuenta en el segundo.** Un paciente mayor que recarga
quince veces la pantalla de «este enlace ya no sirve» no es un escáner, y bloquearle sería castigar
al único que de verdad quería contestar; su token existió, y para el total ya está el general. Hay
test de las quince recargas.

**El del equipo va por token y el de inexistentes no.** Los `purpose` del equipo (capacidades, B9)
limitan por token porque todas las profesionales contestan desde el wifi del centro y por IP serían
un solo atacante. El de tokens inexistentes **no es configurable**: un token que no existe no tiene
identidad contra la que contar, y por token le daría a un escáner un cubo nuevo por intento, que es
ningún límite. Los dos casos tienen test con un `purpose` de prueba (`PRUEBA_EQUIPO`).

La clave del cubo por token es **la huella**, no el token: lo que se mete en Redis no abre nada.

---

## 5 · Los tres perfiles, y el `purpose` que hay dado de alta

`SOLO_ESCRIBIR` (contesta y nunca recibe datos de vuelta), `SOLO_LEER` (ve un documento y no
escribe) y `ACTUAR_SOBRE_CITA` (ve día, hora, servicio y profesional de ESA cita y actúa sobre ella;
nada de la ficha y nada de salud). El perfil se aplica en la puerta y no en cada pantalla, que es el
punto entero del bloque.

**Hoy sólo está dado de alta `VALORACION`**, y hay un test que lo afirma
(`expect(Object.keys(PURPOSES)).toEqual(["VALORACION"])`), para que dar de alta uno nuevo sea un acto
deliberado y visible y no algo que aparezca de rebote.

```ts
REGLAS_VALORACION = {
  purpose: "VALORACION",
  targetType: "CLINICAL_ASSESSMENT",   // ← la VALORACIÓN, no la cita
  perfil: "SOLO_ESCRIBIR",
  vidaMs: canal => canal === "TABLET" ? 4 h : 30 días,
  maxUsos: 1,                          // se gasta al CONTESTAR, no al abrir
  limitePor: "IP",
  registraAccesoClinico: true, pacienteDe: v => v.clientId, accionClinica: "WRITE",
  admiteEnlace: v => v.tenant.clinicalRecordsEnabled && v.status === "PENDIENTE_PACIENTE",
}
```

Dos cosas que se mudaron a `admiteEnlace` y merecen decirse:

1. **El módulo apagado es un estado que no admite enlace.** Con la clínica apagada ninguna valoración
   abre, y con la misma 404 — un tenant al que se le apagó no destapa que la tuvo. Antes era un `if`
   suelto en la ruta; ahora es exactamente lo que es.
2. **«Pendiente de contestar» y no «la cita está confirmada»**, que es la precisión que clínica hizo
   en el S1: el enlace apunta a la valoración, la cita sólo la origina.

### El rastro clínico lo declara el `purpose`, no la ruta

Decisión S1.6. `registrarAccesoDelEnlace` escribe la línea de `ClinicalAccessLog` con el actor
«paciente por enlace» de clinica-2, **antes del trabajo y fuera de su transacción**, igual que
`conHistoria`: si la línea no se puede escribir, la petición falla. Trazabilidad por encima de
disponibilidad, que es la decisión contraria a la de la venta («cobrar siempre se puede») y a
propósito — nadie pierde nada si la respuesta no se guarda; lo que no se puede perder es la prueba
de que ocurrió.

Que lo declare el `purpose` y no la ruta es lo que cierra «cada ruta se acuerda», que es la forma de
fallo que clinica-1 cerró con `conHistoria` y que una puerta común volvería a abrir. Y un `purpose`
que diga dejar rastro clínico **sin decir de quién** levanta error en vez de no escribir nada en
silencio: tiene su test.

**Lo que NO deja línea, y es deliberado: el GET.** Un enlace `SOLO_ESCRIBIR` no entrega nada de la
historia —la respuesta son el nombre de la clínica, el nombre de pila y el cuestionario, que es dato
del módulo en código—, así que no hay acceso a la historia que apuntar. Lo que se apunta es el acto
que gasta el enlace, que es el que escribe. Es el mismo criterio de clinica-2 (§6 de su done: «lo
que deja línea, siempre, es el contenido»), y por eso el conteo de líneas del banco no cambia.

---

## 6 · El espejo de las tres columnas obsoletas · EXPAND AHORA, CONTRACT DESPUÉS

`clinical_assessments.link_token_hash` / `link_expires_at` / `link_used_at` **ya no las lee nadie**:
se quitaron del `SELECT_VALORACION`, el estado del enlace que pinta la pantalla del sanitario sale
de `public_links` (`enlaceDeLaValoracion`), y lo único que resuelve un token es la puerta.

**Se siguen escribiendo**, como espejo, y la razón es una sola: la guardia de regresión de clinica-2
las mira — `clinica-valoracion.e2e.ts` contra los CHECK y los triggers de `clinical_assessments`, y
`11-clinica-valoracion.spec.ts` contra la fila real (`expect(v.linkTokenHash).toMatch(/^[0-9a-f]{64}$/)`,
`expect(v.linkUsedAt).not.toBeNull()`). **El bloque que generaliza el mecanismo no es el que cambia
la guardia que lo vigilaba**, y borrar las columnas en la misma migración que las sustituye deja la
vuelta atrás sin red.

No es una segunda fuente de verdad: nada lo lee, así que no puede discrepar de nada. Comprobado en el
banco tras el viaje entero por la interfaz — `link_token_hash = token_hash` y `link_used_at`
sellado a la vez que `used_count = 1`.

**Se quitan, con sus columnas, en el bloque que mueva esa guardia a `public_links`.** Están marcadas
`/// OBSOLETO (enlaces-publicos)` en el esquema, y el espejo vive en una función con nombre
(`espejoDelEnlaceObsoleto`) para que borrarlo sea borrar una función y no buscar asignaciones.

---

## 7 · La migración de clinica-2 · la consulta de producción

El backfill mueve los enlaces de `clinical_assessments` a `public_links`: la misma huella (así los
enlaces que estén en algún buzón **siguen abriendo después de la migración**), la misma caducidad,
`max_uses = 1`, `used_count = 1` si estaba sellado, apuntando a la **valoración** y con el autor que
tuviera —NULL cuando la pidió la cita—. Es idempotente (`ON CONFLICT (token_hash) DO NOTHING`).

**La consulta que dice cuántas filas mueve, para correr en producción ANTES de desplegar:**

```sql
-- 1 · ¿hay alguna clínica encendida?
SELECT count(*) FILTER (WHERE clinical_records_enabled) AS clinicas_encendidas,
       count(*)                                          AS tenants
  FROM tenants;

-- 2 · ¿cuántos enlaces de valoración hay que mover, y en qué estado?
SELECT count(*)                                              AS filas_a_migrar,
       count(*) FILTER (WHERE link_used_at IS NOT NULL)      AS ya_gastados,
       count(*) FILTER (WHERE link_expires_at <= now())      AS ya_caducados,
       min(created_at)                                       AS la_mas_vieja
  FROM clinical_assessments
 WHERE link_token_hash IS NOT NULL;

-- 3 · la red: ninguna puede tener dos enlaces vivos (rompería el único parcial)
SELECT client_id, count(*)
  FROM clinical_assessments
 WHERE link_token_hash IS NOT NULL
 GROUP BY client_id HAVING count(*) > 1;
```

**La corre Matías** (producción es suya). Lo esperado es `clinicas_encendidas = 0` y
`filas_a_migrar = 0` o unas pocas de prueba: clinica-2 está desplegada desde el 07-10 y ninguno de
los quince tenants tiene el módulo encendido. **La migración se aplica igual y con cualquiera de los
dos resultados**: con cero filas no hace nada, y con filas de prueba las mueve con su estado. La 3
no puede devolver nada —clinica-2 rotaba el token SOBRE la misma fila y el índice único parcial
`clinical_assessments_one_open_key` sólo deja una valoración abierta por paciente—, y está en la
lista por si acaso.

El backfill se prueba **contra Postgres de verdad y leyendo el SQL REAL del fichero de migración**,
no una copia a mano: `enlaces-publicos.e2e.ts` extrae el `INSERT … SELECT` de `migration.sql` y lo
corre con filas delante. Que fuera una copia era un fallo de verdad y lo cazó un sabotaje (§8, 9a).

---

## 8 · La tabla de sabotajes

Cada sabotaje se aplicó de verdad sobre la línea de producción y se corrió la suite. Los mensajes son
los reales.

| Garantía | Qué línea se rompe | Qué se pone rojo | Mensaje real |
| --- | --- | --- | --- |
| **El token no se guarda** | `tokenHash: huellaDeToken(token)` → `tokenHash: token` en `crearEnlace` | `enlaces-puerta.test.ts` · 13 casos (la puerta entera deja de poder crear un enlace) | `new row violates check constraint "public_links_token_hash_es_sha256"` |
| **La misma 404 para todo** | Una rama aparte para `CADUCADO` con «Su enlace ha caducado» | `enlaces-puerta.test.ts` · «la misma 404 para los siete motivos» **y** `clinica-valoracion-rutas.test.ts` · «la 404 es INDISTINGUIBLE» | `expected '{"error":"VALORACION_NOT_FOUND"…' to deeply equal '…'` |
| **Las tres cabeceras** | Quitar `X-Robots-Tag` de `CABECERAS_DE_ENLACE` | `enlaces-puerta.test.ts` · 4 casos (la constante, el 200, la 404 y el 429) | `expected undefined to be 'noindex'` |
| **Ni un uso más del tope** | `usedCount: { lt: maxUsos }` → `{ lt: maxUsos + 1 }` en `consumirEnlace` | `enlaces-puerta.test.ts` · «se gasta lo que el purpose declara» | `new row violates check constraint "public_links_usos_dentro_del_tope"` |
| **No se des-anula** (motor) | Quitar el bloque `revoked_at` de `public_links_guard` | `enlaces-publicos.e2e.ts` · 2 casos, **y** `enlaces-migracion.test.ts` · 3 | `El motor ACEPTÓ lo que no debía: UPDATE public_links SET revoked_at = NULL …` |
| **`SOLO_ESCRIBIR` no devuelve nada de la valoración** | Añadir `estado: v.status` al GET público | `clinica-valoracion-rutas.test.ts` · «devuelve las TRES cosas y nada más» | `expected [ 'canal', 'clinica', …(3) ] to deeply equal [ 'canal', 'clinica', …(2) ]` |
| **El tope de tokens inexistentes** | `MAX_INEXISTENTES` efectivo → 1000 | `enlaces-puerta.test.ts` · 5 casos | `expected 404 to be 429` |
| **El enlace clínico deja rastro** | `registraAccesoClinico: true` → `false` en `REGLAS_VALORACION` | `clinica-valoracion-rutas.test.ts` · 3 casos **y** `enlaces-puerta.test.ts` · 1 | `expected [] to have a length of 1 but got +0` y `expected 201 to be 500` |
| **Anular la cita NO toca el enlace** (9a) | El backfill apunta a `a."appointment_id"` y `'APPOINTMENT'` | `enlaces-migracion.test.ts` · 2 casos **y** `enlaces-publicos.e2e.ts` · 5 | `expected '…' to match /'CLINICAL_ASSESSMENT'/` |

### Lo que los sabotajes enseñaron, y no sabía antes

**1 · Un test que recorre la constante que debería vigilar no es un test, es un espejo.**
La primera versión de los casos de cabeceras hacía `for (const [k,v] of Object.entries(CABECERAS_DE_ENLACE))`.
Quitar `X-Robots-Tag` los dejó **en verde**: recorrían dos cabeceras en vez de tres y las dos
cuadraban. Sólo se puso roja la igualdad literal de la constante. Se reescribieron con la lista a
mano (`LAS_TRES`), y entonces el mismo sabotaje pone rojo el 200, la 404 y el 429 además de la
constante. Mismo error, misma forma, en el e2e del backfill: tenía una **copia** del `INSERT …
SELECT` en vez de leerlo del fichero, y el sabotaje 9a lo dejó verde. Ahora lo lee del
`migration.sql`.

**2 · «Un uso más del tope» no lo frena la aplicación: lo frena el CHECK.** El sabotaje de
`consumirEnlace` no se puso rojo por un assert de comportamiento sino por la constraint. Y la
guardia de clinica-2 **ni se enteró**: su «NO SE REUTILIZA» sigue verde porque el estado
(`status !== PENDIENTE_PACIENTE`) cierra el enlace por su cuenta. Es exactamente el mismo
descubrimiento que clinica-2 apuntó en §8 de su done —el «un solo uso» lo sostienen dos líneas
independientes— y ahora se ve que son **tres**: el estado admitido del `purpose`, el contador, y el
CHECK que lo respalda desde el motor.

**3 · La comprobación de más impedía probar el mecanismo.** `purposeConocido()` dentro de la puerta
parecía la pieza que hacía seguro el TEXT de la columna. Al escribir el test con `purpose` de prueba
se vio que (a) es redundante —para preguntar hace falta traer las reglas, y las reglas sólo están en
el registro— y (b) hacía imposible ejercitar la puerta con los `purpose` que vienen. Lo que de
verdad sostiene la garantía no era la línea que yo había escrito pensando que la sostenía. (Tercera
vez que esta casa aprende lo mismo: clinica-1 con el `ON CONFLICT`, clinica-2 con el sello del
enlace.)

**4 · Para el sabotaje 9 no hay más que sabotear, y eso ES el hallazgo.** «Que anular la cita revoque
el enlace de la valoración» no se puede provocar desde el código: **no existe ningún camino que ate
el ciclo de vida de una cita a `public_links`**. Lo único sabotable es a dónde apunta el enlace (9a),
y la guarda positiva es el caso del e2e que borra la cita de verdad y comprueba que el enlace queda
sin anular y sin gastar — el `ON DELETE SET NULL` se lleva el `appointment_id` de la valoración y no
toca la tabla de enlaces, porque son tablas distintas y no hay FK entre ellas.

---

## 9 · Lo que hubo que tocar fuera de lo previsto, y por qué

El prompt pide que las cuatro guardias de clinica-2 sigan verdes **sin cambios**, y si alguna hay que
tocar, que el done explique por qué. Son dos ficheros y **ningún assert**:

1. **`apps/api/test/clinica-valoracion-rutas.test.ts`** · el Prisma EN MEMORIA, porque el de verdad
   cambió. El enlace del test ya no vive en `clinical_assessments` sino en `public_links`, así que el
   fake tiene ahora esa tabla —con las dos cosas que Postgres impone sobre ella: la huella es un
   SHA-256 y hay un solo enlace vivo por objetivo, igual que el fake ya imponía el índice parcial y
   el CHECK de `clinical_assessments`— y `conEnlace()` deja la fila del enlace al lado de la de la
   valoración, como hace el código de verdad. Además, `findFirst` adjunta `client` y `tenant` cuando
   se piden: antes sólo lo hacía `findUnique`, y el `cargarObjetivo` del `purpose` usa `findFirst`.
   **Las siete garantías y los 48 casos están como clinica-2 los dejó.**
2. **`apps/api/test/clinica-sesion-rutas.test.ts`** (clinica-3) · **cuatro líneas**, y es el mismo
   motivo. La pantalla de la sesión lee la valoración por `vistaDeLaValoracion`, y ésa pregunta ahora
   por el enlace en `public_links`; sin el delegate, el fake devolvía `undefined.findFirst` y la ruta
   daba 500. Se añade la tabla vacía con su filtro (no un `null` a pelo), para que el día que un caso
   de ahí necesite un enlace baste con empujar la fila. **Ni un assert tocado, los 54 casos verdes.**
   Es un fichero de `apps/api/test/`, no de `apps/api/src/clinica/`: **no toca nada de lo que
   `clinica-5` tiene abierto** (`packages/clinica-sesion`, `SesionPodologia.tsx`,
   `lineas-de-la-sesion.ts`, el catálogo).

Y un fichero de producción fuera de `clinica/` y `enlaces/`:

3. **`apps/api/src/lib/error-handler.ts`** · 25 líneas. Reconoce el prefijo `ENLACE_VIOLADO` del
   trigger y contesta 409 con una frase de persona, igual que `HISTORIA_VIOLADA` de clinica-1. Sin
   esto, el día que un camino nuevo intentara des-anular un enlace, el cliente recibiría «Error de
   base de datos (P2010)» con el mensaje de Postgres dentro. No se dispara desde ninguna pantalla de
   hoy: la puerta hace dos escrituras sobre una fila ya creada (`revoked_at` y `used_count + 1`) y las
   dos son legales.

---

## 10 · Decisiones tomadas sin preguntar

1. **El espejo de las tres columnas obsoletas** en vez de dejar de escribirlas (§6). La alternativa
   era tocar dos asserts de `11-clinica-valoracion.spec.ts`, y el prompt pide expresamente que ese
   fichero quede sin cambios.
2. **Un solo enlace vivo por (`purpose`, objetivo)**, por índice único parcial. No estaba pedido; es
   lo que convierte la decisión S1.5 en una invariante del motor.
3. **`expires_at` dentro de la identidad del trigger** (no se alarga NI se acorta). Sin ella, revivir
   un enlace caducado sería un UPDATE.
4. **Un enlace no se borra, se anula.** No estaba pedido. Borrarlo quitaría la prueba de que existió,
   que es justo lo que `revoked_at` viene a dejar escrito.
5. **El GET no gasta uso y no deja línea clínica** (§5). Es lo que clinica-2 ya hacía; se declara aquí
   con su razón para que los `purpose` que vienen no lo decidan cada uno por su cuenta.
6. **El cubo de tokens inexistentes no cuenta caducados, gastados ni anulados** (§4).
7. **El `purpose` entra en la clave del cubo general** (`enlace-intentos:<purpose>:<quien>`): un
   escáner que gasta el cubo de la valoración no deja a nadie fuera de «mi cita». Son puertas
   distintas.
8. **Los dos `purpose` de prueba viven en el fichero de test**, no en el registro de producción. Una
   fila que nadie puede crear es una promesa que el sistema no cumple; lo que el bloque deja listo es
   el mecanismo, y se prueba con reglas de prueba inyectadas.

---

## 11 · Lo que NO cubre este bloque

- Los `purpose` de «mi cita», consentimiento para leer, encuesta post-visita y formulario del equipo.
  Sólo la puerta preparada para ellos (perfiles, límite por token, estado admitido).
- La **pantalla de recepción** para ver y anular enlaces. `revocarEnlace` y `revocarEnlacesDe` existen
  y tienen test; la pantalla viene con «mi cita».
- **Borrar** las tres columnas viejas de `clinical_assessments` (§6).
- `Ticket.publicSlug`, que queda fuera por decisión S1.5 y **no se ha tocado**.
- La limpieza de enlaces caducados. El índice `public_links_expires_at_idx` está puesto para cuando
  haya un job; hoy no hay volumen que lo pida.

---

## 12 · Cómo se cierra

### Suite

| | |
| --- | --- |
| `pnpm test` (raíz) | **3635 verdes**, 3 saltados, 305 ficheros |
| `pnpm test:e2e` (Postgres real) | **521 verdes**, 30 ficheros (corrida a las 23:57) |
| `npx tsc --noEmit` en `apps/api` | limpio |
| Banco con navegador, capítulo 11 | **4 verdes**, fichero sin tocar, base limpia |
| Banco con navegador, suite entera | 34 verdes · **1 rojo que ya venía de master** (ver abajo) |

Lo que añade el bloque: `enlaces-puerta.test.ts` (31), `enlaces-migracion.test.ts` (32) y
`enlaces-publicos.e2e.ts` (36).

**Una intermitencia que no supe nombrar, y la digo igual.** De cinco pasadas completas de
`pnpm test`, **una dio 2 rojos** y las otras cuatro 3635 verdes. No capturé qué dos casos eran (el
filtro de la salida se comió los nombres antes de poder mirarlos) y no volvió a repetirse en tres
pasadas seguidas después. Queda apuntado como lo que es: **la suite tiene al menos un test
intermitente**, no sé cuál, y no es una excusa — si reaparece, lo primero es correr con
`--reporter=verbose` y guardar la salida entera. Los tres ficheros que añade este bloque (99 casos)
pasaron las cinco veces.

**Y un aviso de cronómetro, no de código.** La misma suite e2e, repetida a las **00:27**, da 6 rojos
en `f3-fichar.e2e.ts` y `f8-colegio.e2e.ts` (`expected 409 to be 200` al fichar la entrada). Son
tests que construyen sus horas con `Date.now() - 3 * 3_600_000` y parecidas: **pasada la
medianoche, «hace tres horas» cae en el día local anterior** y el fichaje se niega. Comprobado que no
es de este bloque — el mismo caso falla igual con la rama entera fuera (`git checkout 9cfcb2e`), con
el mismo mensaje, y el árbol de `src` no cambió entre las 23:57 y las 00:27. **La suite e2e de
`fichaje` hay que correrla fuera de la franja de medianoche**, o arreglarle el reloj; no es de este
bloque y no se ha tocado.

**El rojo que ya venía:** `apps/e2e-ui/specs/12-clinica-sesion.spec.ts` · «la podóloga marca el pie,
cierra la sesión y la cobra» falla con `expected "2 tratamientos · 35,00 € · iva 0 %" to contain
"30,00 €"`. **Comprobado que NO es de este bloque**: se sacó la rama entera (`git checkout 9cfcb2e`,
el punto de partida), se rehízo la base del banco desde cero y el capítulo 12 falla **exactamente
igual**, con el mismo mensaje. El capítulo es de clinica-3 y el seed de la clínica lo tocó por última
vez `342b6f7` (el arreglo de `iva-exento-sanitario`, el merge inmediatamente anterior a esta rama):
los importes del pie no cuadran con lo que el capítulo espera desde ese merge. Este bloque no toca
`packages/clinica-sesion`, ni `lineas-de-la-sesion.ts`, ni el catálogo, ni nada de `apps/e2e-ui`.
**Queda para quien lleve la sesión** (`clinica-5` lo tiene en la mano).

### Al desplegar

1. **HAY MIGRACIÓN, y es una:** `20261008000000_enlaces_publicos`. Crea `public_links`, sus cinco
   índices y su trigger, y **mueve los enlaces de clinica-2**. Aditiva: ni un DROP, ni un TRUNCATE,
   ni un DELETE, ni un UPDATE; lo único que escribe datos es el backfill.
2. Correr **antes** las tres consultas de §7 y dejar el resultado apuntado. Se despliega igual con
   cualquiera de los dos resultados.
3. **NO hay variables de entorno nuevas.** Ninguna.
4. No hay que reiniciar nada más allá del despliegue normal de la API. Las pantallas no cambian: el
   TPV no se toca en este bloque.
5. La vuelta atrás, si hiciera falta, es limpia y sin pérdida: lo que el backfill copia **sigue en
   `clinical_assessments`**, que es justamente la razón de no borrar las columnas viejas todavía. El
   `down` está escrito en la cabecera de la migración (tres sentencias).

### Nombre de la migración y el merge

`20261008000000_…`, con fecha posterior a la última de `master` (`20261007020000_iva_exento_sanitario`).
`clinica-5` está en Code a la vez y también añade migración: **quien mergee segundo rebasa**. Este
bloque no toca `packages/clinica-sesion`, `SesionPodologia.tsx`, `lineas-de-la-sesion.ts` ni el
catálogo, así que el único solape posible es el orden de las migraciones y la línea de
`clinicalAssessments` en el `schema.prisma` (modelo `Tenant` y modelo `User`, donde este bloque añade
una relación debajo).

### Push y PR

**Autorizados por el prompt.** Ni merge ni despliegue: eso es de Dirección.
