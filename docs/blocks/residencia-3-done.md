# Bloque residencia-3 · done

Rama `residencia-3`, worktree `~/Developer/Claude/Projects/mipiacetpv-residencia-3`, desde
`origin/master` = `e275b37` (el prompt del bloque y D-64). Siete commits, 79 ficheros,
+13.770 / −103.

**Hoy el cuidado se hace de memoria y se apunta al final del turno en una hoja que vive en la sala de
terapia.** Con este bloque se apunta en la puerta y en el momento, a pulsaciones, firmado con persona,
rol y hora, cifrado en reposo e inmutable. Y sin red no se pierde nada.

Eso es el bloque entero. Lo demás es cómo.

---

## 1 · `CareRecord` · la evidencia

Una fila = una cosa registrada de un residente: un «hecho», un valor ordinal, el «como siempre» de una
dimensión, un «a demanda» que sólo se cuenta, o una nota de «algo no va bien».

### El id lo genera LA TABLET, y es dos cosas a la vez

`care_records.id` no tiene `DEFAULT`. Lo pone quien escribe, y en la puerta quien escribe es la tablet:

1. es la **idempotencia** del envío por lotes (decisión 5): el mismo uuid dos veces es la misma fila, y
   una tablet que reintenta un lote con el wifi a medias no duplica un cuidado;
2. es el **`filaId` del AAD** del valor cifrado (decisión 6): el sitio es
   `tenant|care_records|value|<id>`, así que el valor de una fila no se puede mover a otra.

Las dos necesitan el id **antes** de insertar, que es justo lo que la tablet ya sabe. Un `DEFAULT` aquí
sería un valor que nadie usa y que taparía un olvido.

### Inmutable, con UNA transición legítima

`care_records_inmutable` es la regla de `clinical_entries` (clinica-1) con la escapatoria que aquélla no
necesitaba:

- **`DELETE`** — nunca. Y sin la escapatoria del «padre borrado» que llevan los triggers de S1 y F1: las
  diez FKs son `RESTRICT`, así que la cascada que esa escapatoria cubría no puede ocurrir. Mismo
  razonamiento que `clinical_access_log_append_only`.
- **`UPDATE`** — sólo para **anular**: `voided_at` y `voided_by_user_id` de NULL a puestos, y ni una
  columna más. Des-anular tampoco.

**Corregir no es un `UPDATE`**: es una fila nueva que apunta a la corregida. Por eso la función del
trigger no sabe nada de correcciones.

Las **veintidós columnas se comparan una por una y por su nombre**. Un
`row(NEW.*) IS DISTINCT FROM row(OLD.*)` habría sido más corto y habría dejado pasar en silencio
cualquier columna añadida después; con esto, el día que la tabla gane una, el test del contrato del SQL
se pone rojo y recuerda por qué.

### Qué va cifrado y qué va en claro (decisión 6, D-63)

residencia-1b §13 dejó dicho que «`CareRecord` nacerá cifrado en su bloque, con su `sitio*` en
`cripto-campos.ts` y su CHECK de formato en la migración. El sitio donde ponerlo ya está hecho». Aquí
está:

| Qué | Dónde | `sitio*` |
| --- | --- | --- |
| el VALOR (`{"tipo":"ORDINAL","opcion":"APAGADO","comoSiempre":false}`) | `value_cifrado` | `sitioValorDeRegistro` |
| el TEXTO de «algo no va bien» | `note_cifrado` | `sitioNotaDeRegistro` |
| la nota de VOZ | fichero del volumen, cabecera `MPC1` | `sitioDelFichero(…, "VOZ", …)` |

**Dos columnas lógicas y no una**, por la razón exacta por la que el motivo de apertura y el de cierre de
una línea del plan son dos (residencia-1b §1): con el mismo nombre lógico, el texto de la nota se podría
copiar a la columna del valor y **descifraría**. Tiene su caso en el e2e.

Quince columnas cifradas en la casa eran; **son diecisiete**, y los dos inventarios que las cuentan desde
lados distintos (`clinica-7.e2e.ts` sobre el esquema real, `residencia-1b-cifrado.test.ts` sobre el SQL de
las migraciones) se pusieron rojos haciendo su trabajo.

**Y lo que se queda EN CLARO, declarado**: `control_type_id`, `control_code`, el residente, los dos
instantes, el turno, el día, la firma y el estado de anulación. Sostienen «qué falta por hacer», el relevo
y los indicadores — igual que `care_plan_items.control_code` (residencia-1b §2). Y la consecuencia es la
misma y conviene no esconderla: **un `SELECT` sigue diciendo QUÉ se le registra a un residente y cuándo**,
no cuánto ni cómo está.

### La cadena de correcciones es UNA LÍNEA, y lo dice el motor

Dos índices, y hacen falta los dos:

```sql
CREATE UNIQUE INDEX "care_records_una_correccion_key"
    ON "care_records"("corrects_record_id");

CREATE UNIQUE INDEX "care_records_una_por_ocurrencia_key"
    ON "care_records"(
        "client_id", "control_code", "care_day",
        COALESCE("center_shift_id", '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE("occurrence_at", '-infinity'::timestamptz))
    WHERE "corrects_record_id" IS NULL;
```

El primero impide que dos filas corrijan a la misma (dos cabezas para una ocurrencia). El segundo impide
dos **cabezas de cadena** para la misma ocurrencia, y es **parcial** sobre «no es una corrección»: con el
índice total, corregir sería imposible; sin él, «cuál es el valor de ahora» lo decidiría el orden de la
base. Misma forma y misma lección que `bed_assignments_one_live_per_bed_key` y
`care_plan_items_one_live_key`.

**Los dos `COALESCE` no son adorno.** `center_shift_id` y `occurrence_at` son NULL legítimamente —un hueco
en el cuadrante, y la observación diaria, que no cuelga de ninguna ocurrencia— y en Postgres los NULL son
distintos entre sí. Sin los centinelas, dos «como siempre» del mismo turno serían dos claves distintas y
las dos entrarían: el índice existiría y no diría nada.

Es la **cuarta vez** que esta lección se paga en este repo (`ticket_allergies_mesa_key` en kds-1,
`care_zone_assignments_one_live_centro_key` en residencia-1, `control_types_una_vigente_*` en
residencia-2). Aquí está pagada de entrada, con su sabotaje con nombre en el e2e.

### `occurrence_at` · cuántas veces puede repetirse esto

La columna que sostiene el índice, y lo que decide **no se cree del cuerpo**: lo decide el catálogo.

| Qué es | `occurrence_at` | Consecuencia |
| --- | --- | --- |
| lo que «toca» (`queToca`) | el instante de la ocurrencia | tres cambios posturales de un turno son TRES |
| la observación diaria (capa `OBS`) | **NULL** | UNA por residente y turno (decisión 4) |
| lo `ON_DEMAND` | el instante del propio registro | dos deposiciones de un turno son DOS |

De la segunda fila sale, sin un solo `if`, que **repetir el «como siempre» en el mismo turno corrija en
vez de duplicar**.

### El turno puede ser NULL, y es legítimo

`center_shift_id` nullable con FK `Restrict`. residencia-1 (decisión 8 de su done) dejó escrito que «un
turno se puede borrar porque nada apunta todavía a un turno; lo que se le adscribe es el `CareRecord` de
residencia-3, que pondrá su propia FK `Restrict`». Ésta.

Y `NULL` es un registro **sin turno**, que se guarda y se pinta como aviso: residencia-1 §11.5 escrito en
una ruta. Rechazarlo sería perder un cuidado que se hizo por un hueco en el cuadrante.

### `care_day` · el día del CENTRO, que no es el del reloj

`VARCHAR(10)`, «YYYY-MM-DD». **No es la fecha de `recorded_at`**: es la del día del TURNO. El turno de
noche del lunes va de las 22:00 del lunes a las 08:00 del martes, así que lo registrado a las 02:00 del
martes pertenece a la noche **del lunes**. Con la fecha del reloj, la ronda de la madrugada saldría
partida en dos días y cada mitad contaría como un turno a medias.

Lo calcula `diaDelTurno`, que vive en el paquete puro con su tabla de verdad (los dos cambios de hora
incluidos) y está **copiada en la tablet**, por lo mismo que `turnoDe` lo está desde residencia-1: sin red
el servidor no puede contestarlo.

**`VARCHAR` y no `CHAR`**, y es una decisión: `bpchar` rellena con espacios y compara ignorándolos, así que
`'2026-10-15'` y `'2026-10-15 '` serían el mismo valor para un `=` y distintos para un `~`. En una columna
que agrupa el histórico, eso es un día partido en dos.

---

## 2 · El PIN de la puerta · por qué hay DOS columnas

El mockup validado (D-64) pide **sólo el PIN**: ni email, ni elegir nombre de una lista. Es lo correcto
para el sitio —la auxiliar tiene las manos ocupadas y el presupuesto es de dos segundos (D-05)— y es lo
que obliga a resolver un problema que no es obvio: **con cuatro cifras hay que ENCONTRAR a la persona**.

Buscarla probando argon2id contra los veinte de la plantilla son **cinco segundos y 1,3 GB de memoria por
intento**. No se puede. Así que `care_pins` tiene dos columnas:

- **`pin_lookup`** — la huella de búsqueda: HMAC-SHA256 de `puerta-pin|<tenant>|<pin>` con una subclave
  derivada de la **DEK del centro**. Una consulta indexada la resuelve, y su índice único por centro es
  lo que impide que dos personas compartan PIN — sin eso, «sólo el PIN» no identificaría a nadie.
- **`pin_hash`** — argon2id, la credencial de verdad, verificada **sólo contra la fila que la huella
  encontró**. Una huella escrita a mano en la base no abre nada.

### Por qué la clave de la huella NO puede estar en la base

Una huella determinista de cuatro cifras salada con un valor de la propia base son **diez mil pruebas
instantáneas** sobre un volcado: el PIN de toda la plantilla, en un segundo. Con la subclave derivada de
la DEK —que vive envuelta por la `CLINICAL_KEK` del entorno— un volcado sin la KEK no la puede calcular ni
invertir.

Dos consecuencias buscadas: **destruir la DEK de un centro (art. 28.3.g) apaga el PIN de sus puertas**, que
es lo correcto porque la relación terminó; y **rotar la KEK no los toca**, porque la DEK no cambia al
re-envolverse.

### Y es OTRO PIN que el del TPV

`User.pinHash` abre el cajón y cobra; éste **firma registros de salud**. Tres razones y la tercera es la que
manda:

1. dos cosas distintas no comparten secreto;
2. una auxiliar de Jardín de Gredos no es `CASHIER` ni entra al TPV, y el login de cajero exige
   `role IN (OWNER, MANAGER, CASHIER, CLINICIAN)`. Colgar la puerta de aquél habría dejado fuera a media
   plantilla o habría obligado a tocar `UserRole`, que es justo lo que D-50 saca de en medio;
3. en un centro sin caja —el cliente cero— éste es el **único** PIN, así que no hay dos que recordar.

### El rate-limit es POR PUERTA, y corto a propósito

No hay email que teclear, así que lo único que identifica el intento es la tablet. Y los números **no** son
los del login de cajero (5 intentos → 15 min de candado):

- **10 intentos** en 5 minutos, porque una auxiliar con guantes y prisa teclea mal más de dos veces;
- **2 minutos de candado**, no 15. Un candado largo en esta pantalla **bloquea el registro de cuidados de
  una habitación**, y eso es peor que el riesgo que evita: diez mil combinaciones a diez intentos cada
  cinco minutos son casi cuatro días de alguien de pie en un pasillo. El candado está para que no se pueda
  barrer el espacio, no para castigar a quien se equivoca.

Lo que no se hace es dejarlo sin límite, y lo que tampoco se hace es bloquear la habitación entera: las
otras puertas, el admin y el panel siguen funcionando, y el mensaje dice que se puede usar otra puerta.

---

## 3 · La sesión de la puerta · qué prueba y qué NO

La sesión (JWT con `type: "puerta"`, TTL el del centro) prueba **que alguien con un PIN bueno de este
centro está en esta puerta**. Eso es lo que autoriza a leer lo que hay detrás del PIN y a mandar un lote.

**No es la firma de los registros.** La firma —persona + capacidad (D-31)— viaja en CADA registro del lote
y se comprueba una por una. Son dos cosas distintas a propósito, y la razón es la red:

- un lote puede salir de la tablet **horas después**, con la auxiliar que lo tecleó ya en su casa. Si
  tuviera que ir firmado con SU sesión, un turno de noche sin wifi perdería los cambios posturales al
  caducar el token;
- con la firma en el cuerpo, **los registros salen con la sesión de la siguiente persona que entre en esa
  puerta**. La del turno de mañana teclea su PIN y, sin saberlo, sube los de la noche. Cada uno con su
  autor, su capacidad y su `recordedAt` original.

Dicho en una línea: **el token dice quién está delante; el cuerpo dice quién hizo cada cosa.**

Lo que el servidor SÍ comprueba de cada firma, y es bastante:

1. la asignación de rol existe, es de esa persona, de este centro, de un rol que REGISTRA y **estaba
   vigente en el `recordedAt`** — no «ahora». Un cambio postural hecho el martes por alguien a quien se le
   revocó el rol el miércoles entra, y tiene que entrar: lo hizo;
2. esa persona **alcanza** a ese residente (D-51), por LA función de acceso de la casa, con su línea
   `WRITE` en el registro de accesos;
3. el residente está en **la habitación de esta tablet**.

Y lo que el servidor **no puede** comprobar —que quien firma un registro hecho sin red tecleara de verdad
su PIN— no lo puede comprobar ningún diseño offline-first. Es la misma confianza que el TPV deposita en su
sesión de cajero local (v1.10 §1-2), y queda dicho aquí y en la cabecera de `puerta-sesion.ts`.

---

## 4 · Los dos instantes y sus límites (decisión 5)

`recorded_at` es el de la tablet: **cuándo ocurrió el cuidado**. `received_at` es cuándo llegó al servidor.
Con la red caída los dos se separan horas, y las dos preguntas —«¿cuándo se le giró?» y «¿cuándo lo
supimos?»— tienen respuesta.

El servidor acepta el de la tablet **dentro de límites**:

- **Futuro: cinco minutos.** El reloj de una tablet de pared se va unos segundos. Más allá no es desvío: es
  un reloj mal puesto, y un registro del futuro cae en un turno que todavía no ha pasado — la DUE del
  relevo leería un cambio postural que nadie ha hecho.
- **Pasado: siete días.** El número sale de dos cosas: (1) una tablet que lleva una semana sin red es una
  tablet que alguien tiene que ir a mirar, no un caso que el servidor deba tragarse en silencio; (2) el
  parte de relevo de residencia-5 se confirma con PIN al acabar el turno, y un registro de hace un mes que
  entra hoy **cambia un parte que alguien ya firmó** — eso es peor que perderlo.

Los dos son **`REGISTRO_EN_EL_FUTURO`** y **`REGISTRO_DEMASIADO_VIEJO`**, y el lote contesta **409**: la
cola del TPV lo trata como rechazo permanente, no lo reintenta en bucle y lo deja visible. No se arregla
reintentando y alguien tiene que verlo.

---

## 5 · Lo que la pantalla hace con un toque

| Gesto | Filas | Por qué |
| --- | --- | --- |
| **«Como siempre»** | **N** (= dimensiones `OBS` activas con `isAsUsual`) | D-15: es un registro CON VALOR, no la ausencia de registro. Sin estas filas no hay denominador y no se distingue «hoy está normal» de «hoy nadie lo miró» |
| **«No como siempre»** con una cambiada | **1 + (N−1)** | «Lo demás se guarda como siempre» es una promesa de la pantalla 4 y se cumple en la base. Si sólo se guardara la cambiada, el día que doña Carmen está inquieta su ánimo constaría y su piel no |
| **«Hecho»** / las cuatro opciones de una comida | 1, con su ocurrencia | tres rondas son tres filas |
| **«+ Higiene», «+ Deposición»** | 1, sin ocurrencia del plan | `ON_DEMAND`: sólo se cuenta |
| **«Algo no va bien»** | 1, con texto y voz **opcionales** | D-13: a secas es un registro completo |

Quién decide qué dimensiones entran en el «como siempre»: las de capa `OBS` **que declaran una opción
`isAsUsual`**, y activas en el centro. Las tres condiciones hacen falta, y la segunda es la que deja fuera
a `ALGO_NO_VA_BIEN` — que es `OBS` y no tiene opciones. «Como siempre» no puede significar «no me ha
parecido que pase nada», porque entonces el día que SÍ pasa algo no se distinguiría de los otros 84.

Todo eso vive en `puerta-gestos.ts`, que es **puro**: sin React, sin red y sin reloj. Así la obligación que
residencia-2 §11.5 dejó escrita es una tabla de verdad y no una maqueta de pantalla.

---

## 6 · El catálogo gana UN control: `ALGO_NO_VA_BIEN`

La rama de controles §4 lo pide junto a las siete dimensiones: «más un botón transversal "algo no va
bien", con nota de voz o texto corto alternativo (ambos opcionales)». residencia-2 dejó el dominio
`TEXT_SHORT` en el enum y ningún control que lo usara; éste lo usa, y entra **como un INSERT en el fichero
de datos y no como un despliegue**, que es la decisión entera del catálogo (D-11).

Los 36 de serie son **37**: 22 `EXEC`, **8** `OBS` y 7 `MEASURE`.

Tres cosas lo hacen distinto de las siete dimensiones, y las tres están razonadas en el fichero de datos:
es `ON_DEMAND` (nadie lo incumple), **no tiene opciones** (la regla 1 de la capa: el registro no exige
diagnosticar) y por eso **no entra en el toque de «como siempre»**.

Va en la capa 2 y no en la 4 porque la capa 4 son EVENTOS con gravedad, protocolo y escalado, y eso es
residencia-4. Esto es una observación que alguien hace y que el relevo lee.

---

## 7 · Sin red, de verdad

Está en tres sitios y los tres reutilizan lo que ya existe (el prompt lo pide con esas palabras: «aquí no
se inventa otro mecanismo»).

1. **El arranque** (`GET /residencia/puerta/arranque`) se guarda en IndexedDB
   (`mipiacetpv-puerta`, **fuera** de `IDB_NAMES_TO_CLEAR`, como el outbox y el paquete de auth). Trae sólo
   **lo de SU habitación**: residentes, plan vigente, ajustes, turnos, momentos, catálogo y el roster.
2. **El PIN** se resuelve contra el roster cacheado recalculando la huella con `crypto.subtle`. Con red
   manda el servidor, que es el autoritativo; el camino local es sólo para cuando no contesta.
3. **«Lo que toca»** lo calcula `queToca` del paquete puro, en la tablet, con el plan de la caché. Es para
   esto que ese paquete no toca la base de datos (residencia-2 §5).

Y lo registrado **va a la cola ANTES del POST**, igual que una venta desde v1.5: la pantalla 6 no depende
de que haya red, depende de que esté escrito en la tablet.

### La cola es la del TPV, con una línea nueva

`lib/outbox.ts` gana un `kind` (`care-record`) y un campo (`auth: "cashier" | "puerta"`). **Ausente =
cajero**, así que los items ya persistidos salen igual y no hace falta subir la versión de la BD — mismo
criterio que `method` en B-5 y `durationMin` en B-6a. El único sitio que mira `auth` es `sendItem`.

Un gesto = **un item** = un POST con N registros dentro. El toque de «como siempre» son siete filas y una
sola petición, que es lo que hace que quepa en los dos segundos con una wifi mala.

### El 401 es TRANSITORIO, y es la pieza

Sin sesión de puerta, `apiConPuerta` da 401 `PUERTA_SIN_SESION`, y `isPermanentRejection` deja el 401
fuera. El lote **espera** a que alguien teclee su PIN en esa tablet y sale entonces, con su `recordedAt`
original. Si fuera permanente, se quedaría `rejected` y nadie lo volvería a intentar.

### El token sobrevive a «Terminar»

Hay dos cosas y conviene no confundirlas: la **sesión de pantalla** (lo que se pinta; se cierra sola al
minuto y al pulsar «Terminar») y el **token** (lo que la cola necesita). Si «Terminar» borrara el token,
pulsarlo con tres registros en la cola los dejaría esperando a que alguien volviera a entrar — y la cola
puede tener que salir a las tres de la mañana, sin nadie delante.

### La caché se vacía al revocar el dispositivo

`olvidarLaPuerta()` lo llama el arranque cuando `/devices/me` confirma que el aparato está revocado, y
también el desemparejado a mano. Dentro hay el plan de cuidados de dos personas y el roster del centro.

---

## 8 · La foto del residente y su consentimiento (D-64)

El JPEG vive en el **volumen clínico**, cifrado con cabecera `MPC1` y con la huella del claro, igual que
una foto clínica (clinica-4 decisión 11, clinica-7 decisión 8). `ClaseDeFichero` gana dos valores:
`RESIDENTE` y `VOZ`, y entran en **ese** almacén y no en uno propio porque el cifrado, la huella, el nombre
que no dice nada de nadie y la comprobación al leer se escriben una vez.

**El consentimiento es un `ClientConsentKind.IMAGE`** y no una columna, y es la decisión que más se nota:
lo que hay que guardar es exactamente lo que `client_consents` ya guarda —quién lo dio (residente o
familiar, con nombre y parentesco), cuándo, quién lo anotó— y sobre todo **que se puede revocar** con su
fila, su motivo y su fecha. Una familia que llama para decir «quiten la foto de mi madre» no se resuelve
con un booleano que se pone a `false` y no deja rastro.

Sin consentimiento vigente, la puerta contesta **404** y la tablet pinta las iniciales. 404 y no 403: un
403 diría «esta persona tiene foto y no te la damos», y en una tablet de pasillo eso ya es decir algo de
ella.

Y hay **dos mitades**: el arranque dice `tieneFoto: false` para no pedir una foto que se sabe perdida, y
la ruta contesta 404 igual. La segunda es la que de verdad protege — una retirada a mitad de turno tiene
que notarse sin esperar a que la tablet vuelva a arrancar.

**Se reemplaza, no se versiona**: la cara de alguien es identidad (como `clients.firstName`), no historia.
Nadie tiene que poder reconstruir qué foto tenía doña Carmen en marzo; lo que sí hay que poder reconstruir
es qué le tocaba y qué se le hizo.

---

## 9 · El aviso a la enfermera NO SE PINTA (decisión 9)

El mockup lo tiene; este bloque no lo enciende. El aviso inmediato real (D-19) llega con la gravedad y las
incidencias en residencia-4, y **un botón que parece avisar y no avisa es peor que no tenerlo**: se pulsa,
se deja de buscar a la enfermera y nadie va.

En su sitio, en las dos pantallas donde el mockup lo pone, va la frase «Si no puede esperar, avisa a la
enfermera en persona».

**El hueco queda preparado**: `PuertaAlgoNoVaBien` tiene `onAvisarEnfermera` en sus props y sin cablear, y
un test fija que con la función el botón sale. Encenderlo en residencia-4 es pasar una función, no rehacer
la pantalla.

---

## 10 · La devolución del art. 28.3.g, cerrada

residencia-1b §12.4 dejó la deuda anotada: «el día que un centro de residencia pida sus datos, el ZIP no
llevará la ficha del residente ni su plan». Ya la lleva. Por residente:

- `residencia.json` — ficha (con DNI y NSS **descifrados**), histórico de habitaciones, plan completo y
  **todo el registro de cuidados**, con la firma de cada fila y el estado de correcciones y anulaciones;
- `foto.jpg` — su foto, descifrada;
- `notas-de-voz/` — los audios de «algo no va bien», descifrados.

**El registro entero y no un resumen**, porque lo que se devuelve es la evidencia y la evidencia de una
residencia es precisamente que nada se borró: que la corrección está al lado de lo corregido, con quién y
cuándo.

Lo que **no** va: el **PIN de la puerta**. Es una credencial del personal, no un dato del centro ni de
ningún residente, y devolver hashes de PIN en un ZIP que viaja por correo es regalar la llave de las
puertas del edificio que se acaba de entregar. Lo que sí va es quién firmó cada registro, que es el dato.

Los clientes que no son residentes —los pacientes de la consulta de un centro mixto— no ganan ningún
fichero.

---

## 11 · Tres cosas que no salieron de pensarlas

### 1 · El e2e encontró que un reenvío tardío se rechazaba por la firma

El test «y un reenvío TARDÍO —fuera del margen— tampoco lo pierde ni lo rechaza» salió rojo con
`FIRMA_NO_VALIDA: quien firma no tenía ese rol cuando se hizo el cuidado`.

Lo que pasaba: la comprobación de la firma mira la asignación **en el instante del registro**, que es lo
correcto. Pero corría **antes** que la idempotencia, así que un lote de hace semanas que **ya estaba
guardado** se rechazaba — y la tablet lo habría borrado de su cola creyendo que no llegó, y además lo
habría pintado en rojo en la pantalla 6.

Ahora la idempotencia se comprueba **antes que cualquier otra cosa y en la ruta**, no sólo dentro de
`escribirRegistro`: lo de abajo también valida (la firma y la zona) y también tiene que quedar fuera. Lo
que ya está, está; qué pasaba el día que se escribió lo decidió el servidor entonces.

### 2 · «Residente de otra habitación» contestaba «fuera de tu zona»

Registrar a alguien de la 201 desde la tablet de la 112 daba `RESIDENTE_FUERA_DE_TU_ZONA`, porque la zona
se comprobaba antes que la habitación. Las dos negativas son correctas, pero la primera **manda a la
auxiliar a pedirle una planta a dirección** cuando lo que pasa es que se ha equivocado de tablet.

La habitación pasa a comprobarse antes: es el aislamiento de ESTA tablet y es más específico.

### 3 · El bucle visual encontró tres cosas que ningún test vio

Porque un test que compara códigos pasa igual:

- **«lo que toca» pintaba el CÓDIGO del control.** La auxiliar leía `CAMBIO_POSTURAL` en vez de «Cambio
  postural»: el `nombreDe` de la ruta caía a `control.code` porque `ControlParaRegistrar` no llevaba el
  nombre. Ahora lo lleva, y el comentario del campo dice por qué.
- **La hoja del admin pintaba el código de la opción**: «SIN_DOLOR · como siempre» en el documento que se
  enseña en una auditoría. El registro guarda el código a propósito —para que cambiarle el texto no
  reescriba el histórico— así que la ruta devuelve además la etiqueta. Y el sufijo «· como siempre» no se
  repite cuando la etiqueta ya lo dice: cuatro de las siete dimensiones llaman «Como siempre» a su valor
  de normalidad y las otras tres no, y sin eso la hoja decía «Como siempre · como siempre».
- **Las opciones de la dimensión abierta se envolvían** en vez de ir en fila como pide el mockup. El
  vocabulario de la rama §4 es largo **a propósito** —«Apagado / triste / no quiere levantarse» es UNA
  opción porque partirla sería pedirle a la auxiliar que distinga si está apagada o triste— así que lo que
  se mueve es la rejilla: la tarjeta abierta ocupa la fila entera.

Y uno más, pequeño, que salió del `afterAll` del e2e al no poder limpiar lo que había creado: borrar un
dispositivo intenta un `UPDATE` sobre `clinical_access_log` (`device_id` es `SetNull`), y esa tabla es
**sólo inserciones**. Otra garantía funcionando — revocar un aparato no borra la línea de quién abrió una
historia desde él.

---

## 12 · Medido (D-05 y D-16)

Del bucle visual, a 1280×800 en el producto de verdad (`docs/qa/2026-10-15-residencia-3/MEDIDO.txt`):

| Caso | Toques | Máquina |
| --- | --- | --- |
| **normal**: PIN + «como siempre» + dos «hecho» | **11** | 2,8 s |
| de ellos: PIN + «como siempre» | 5 | 2,0 s |
| **con algo**: «no como siempre» con un cambio + nota escrita | **6** | 1,7 s |

### Qué está medido y qué no

Los **toques** son exactos: son los `click` que hace falta dar. Los **segundos son de máquina** —del primer
toque a que la pantalla diga «Apuntado»— y eso es lo que el software cuesta. Lo que **no** está medido es
el tiempo de la persona: cuánto tarda un dedo en ir de un botón al siguiente se mide con una auxiliar
delante, no con un navegador.

### Contra D-05 y D-16

**D-05 pide ≤15 s por registro con el desplazamiento incluido.** El desplazamiento es el 80 % de eso y no
depende de este bloque — depende de que la tablet esté en la puerta, que es D-52. Lo que este bloque
controla son los toques, y con un segundo por toque (holgado para un dedo con guantes sobre botones de
56-120 px) el caso normal sale en **~11 s de persona + 2,8 s de máquina**, dentro del presupuesto con la
máquina pagada.

**Y los dos primeros toques de esos once son el PIN**, que se paga una vez por habitación y no por
registro: la auxiliar entra, marca a los dos residentes y sale. El «como siempre» de un residente, con la
sesión ya abierta, es **un toque** y escribe siete filas.

**D-16 pide que el coste sea proporcional a la anomalía, no al tamaño del catálogo.** Se cumple y se mide:
el día normal son **1 toque por residente** (siete filas) y el día con algo son **6**, no catorce ni
veintiuno. Siete tarjetas cerradas y sólo se abre la que se toca.

### Lo que falta medir, dicho

Un turno completo con una auxiliar real y 25 residentes, para contrastar los ≤30 min por jornada de D-05.
Eso es la observación de turno que D-64 sustituyó por la validación de Matías para el mockup; sigue
pendiente y es lo primero que hay que hacer en el piloto.

---

## 13 · La tabla de sabotajes

Las filas del e2e, con el mensaje real de Postgres a través de Prisma.

| Garantía | Qué se rompe | Qué se pone rojo | Mensaje real |
| --- | --- | --- | --- |
| **Un registro no se borra** | `DELETE FROM care_records` por SQL | `residencia-3.e2e.ts` · «SABOTAJE · BORRAR UNA FILA por SQL falla» | `RESIDENCIA_VIOLADA: un registro de cuidado no se borra (care_records.…). Se anula, con autor y hora, y se queda en el histórico.` |
| **…ni se edita** | `UPDATE … SET value_cifrado` | e2e · «SABOTAJE · EDITAR SU VALOR falla» | `RESIDENCIA_VIOLADA: un registro de cuidado no se edita (…). Para corregirlo se escribe OTRA fila que apunta a ésta…` |
| **…ni cambia de residente** | `UPDATE … SET client_id` | e2e · «SABOTAJE · cambiarle el RESIDENTE falla» | `…no se edita…` |
| **El claro NO CABE** | `INSERT … value_cifrado = 'como siempre'` | e2e · «…y en un INSERT, lo corta el CHECK de formato» | `new row … violates check constraint "care_records_value_cifrado_formato"` |
| **La anulación no se deshace** | `UPDATE … SET voided_at = NULL` | e2e · «SABOTAJE · DES-ANULAR falla» | `RESIDENCIA_VIOLADA: el registro … ya está anulado y la anulación no se deshace ni se mueve.` |
| **Y un UPDATE que no anula tampoco pasa** | `UPDATE … SET voided_by_user_id` solo | e2e · «SABOTAJE · un UPDATE que no anula nada falla» | `…violates check constraint "care_records_anulacion_completa"` |
| **Una fila por ocurrencia** | Repetir el INSERT con la misma clave | e2e · «SABOTAJE · DOS FILAS PARA LA MISMA OCURRENCIA» | `Key (client_id, control_code, care_day, COALESCE(center_shift_id, '000…'::uuid), COALESCE(occurrence_at, '-infinity'::timestamptz))=(…, ANIMO, 2026-10-15, …, -infinity) already exists.` |
| **…y una CORRECCIÓN sí entra** | — | e2e · «…y una CORRECCIÓN sí entra: la cadena puede crecer» | (dos filas) |
| **Una corrección por fila corregida** | Dos INSERT con el mismo `corrects_record_id` | e2e · «SABOTAJE · DOS CORRECCIONES de la misma fila» | `Key (corrects_record_id)=(…) already exists.` |
| **Una fila no se corrige a sí misma** | `UPDATE … SET corrects_record_id = id` | e2e · «SABOTAJE · UNA FILA QUE SE CORRIGE A SÍ MISMA falla» | `…"care_records_no_se_corrige_a_si_misma"` / `…no se edita…` |
| **Reenviar el mismo lote no duplica** | — (es la idempotencia) | e2e · «EL MISMO LOTE DOS VECES NO DUPLICA NADA» | `expected [ 'ya-estaba', 'ya-estaba' ]` |
| **La hora de la tablet en mañana** | — (es el límite) | e2e · «UN RELOJ PUESTO EN MAÑANA: el lote entero se rechaza con 409» | `REGISTRO_EN_EL_FUTURO` |
| **…y hace tres semanas** | — | e2e · «y uno de hace un mes, también» | `REGISTRO_DEMASIADO_VIEJO` |
| **La foto sin consentimiento no se sirve** | Subirla sin anotar el consentimiento | e2e · «SIN CONSENTIMIENTO, la puerta NO la sirve: 404 y las iniciales» | `{"error":"SIN_FOTO"}` |
| **…y retirarlo la vuelve a esconder** | — | e2e · «y RETIRARLO la vuelve a esconder, dejando rastro» | `expected 404`, y DOS filas de consentimiento |
| **El JPEG del volumen está cifrado** | — | e2e · «y el JPEG del volumen está CIFRADO» | `expected 'MPC1'` |
| **Una puerta no ve otra habitación** | Mandar un registro del residente de la 201 desde la 112 | e2e · «la 112 no registra nada del residente de la 201» | `RESIDENTE_DE_OTRA_HABITACION` |
| **Fuera de zona no se ven datos** | La auxiliar de la 1.ª planta entra en la 201 | e2e · «FUERA DE SU ZONA no se ven datos, y la frase lo dice» | `HABITACION_FUERA_DE_TU_ZONA` · «Esta habitación no es de tu zona…» |
| **Una sesión no vale en otra puerta** | Llevar el token de la 112 a la 201 | e2e · «una sesión de la 112 NO sirve en la 201» | `PUERTA_SESION_DE_OTRA_HABITACION` |
| **UN TERMINAL contra la puerta** | — | e2e · «UN TERMINAL NO ENTRA EN LAS RUTAS DE LA PUERTA» | `NOT_A_ROOM_DEVICE` |
| **Dos personas con el mismo PIN** | `UPDATE care_pins SET pin_lookup = <el de otra>` | e2e · «SABOTAJE · DOS PERSONAS CON EL MISMO PIN» | `Key (tenant_id, pin_lookup)=(…) already exists.` |
| **El valor no se mueve de fila** | Copiar el ciphertext de una fila a otra | e2e · «UN VALOR MOVIDO A OTRA FILA NO SE DESCIFRA» | `valor clínico que no se descifra en care_records.value (…): la clave o el sitio no son los suyos` |
| **…ni de columna** | Poner la nota en el sitio del valor | e2e · «y una NOTA copiada a la columna del VALOR tampoco» | el mismo |
| **El canario no aparece en NINGUNA tabla** | Escribir la nota en claro | e2e · «SE ESCRIBEN CIFRADOS, y el claro no está en ninguna parte» | `expected [] ` (cero apariciones en todas las tablas del esquema) |
| **Un residente con registros no se borra** | `DELETE FROM clients`, con las otras cuatro FKs apartadas | e2e · «SABOTAJE · UN RESIDENTE CON REGISTROS NO SE BORRA · LA FK SOLA» | `update or delete on table "clients" violates foreign key constraint "care_records_client_id_fkey"` |
| **…ni el turno al que se adscribe** | `DELETE FROM center_shifts` | e2e · «SABOTAJE · UN TURNO CON REGISTROS TAMPOCO» | `…"care_records_center_shift_id_fkey"` |
| **…ni la versión del control** | `DELETE FROM control_types` | e2e · «SABOTAJE · NI LA VERSIÓN DEL CONTROL» | `…"care_records_control_type_id_fkey"` |
| **…ni la asignación de rol con la que se firmó** | `DELETE FROM care_role_assignments` | e2e · «SABOTAJE · NI LA ASIGNACIÓN DE ROL» | `…"care_records_care_role_assignment_id_fkey"` |
| **Media nota de voz no entra** | `UPDATE … SET voice_file_name` solo | e2e · «SABOTAJE · MEDIA NOTA DE VOZ no entra» | `…"care_records_voz_completa"` / `…no se edita…` |
| **Media foto tampoco** | `UPDATE resident_profiles SET photo_file_name` solo | e2e · «SABOTAJE · MEDIA FOTO en la ficha no entra» | `…"resident_profiles_foto_completa"` |
| **Un día con otra forma** | `care_day = '15/10/2026'` | e2e · «SABOTAJE · UN DÍA DEL CENTRO CON OTRA FORMA» | `…"care_records_dia_formato"` |
| **Un consentimiento de imagen «clínico»** | `kind = 'IMAGE', clinical = true` | e2e · «SABOTAJE · UN CONSENTIMIENTO DE IMAGEN «CLÍNICO» no entra» | `…"client_consents_imagen_no_es_clinica"` |
| **Sólo quien lo firmó lo deshace** | — | e2e · «SÓLO QUIEN LO FIRMÓ: la DUE no deshace lo de la auxiliar» | `SOLO_QUIEN_LO_FIRMO` · «…Si está mal, corrígelo: queda tu nombre en la corrección.» |
| **Y sólo en la ventana** | Envejecer la fila diez minutos | e2e · «y SÓLO EN LA VENTANA: pasada, se corrige» | `FUERA_DE_LA_VENTANA` |
| **Con el contrato revocado no se escribe** | Revocar el contrato de encargado | e2e · «CON EL CONTRATO NO VIGENTE, la puerta no escribe: 423» | `423` al escribir, **200 al leer** (clinica-7 decisión 4) |
| **La cola no sale por la auth del cajero** | Ignorar `auth` en `sendItem` | `puerta-sin-red.test.ts` · «los items de la puerta NO salen por la auth del cajero» | `expected "spy" to be called 1 times` |
| **El 401 no es permanente** | Meter el 401 en `isPermanentRejection` | `puerta-sin-red.test.ts` · «SIN SESIÓN DE PUERTA el 401 es transitorio» | `expected { pending: 0, rejected: 1 } to deeply equal { pending: 1, rejected: 0 }` |
| **El trigger nombra TODAS las columnas** | Quitar una del `IS DISTINCT FROM` | `residencia-3-migracion.test.ts` · «el trigger NOMBRA TODAS menos las dos de la anulación» | `expected [ 'occurrence_at' ] to deeply equal []` |

---

## 14 · Decisiones tomadas sin preguntar

1. **El PIN de la puerta es OTRO que el del TPV**, con su propia tabla y su huella de búsqueda derivada de
   la DEK (§2). Es la pieza que el mockup obliga a inventar y la que más razones necesita; están todas en
   la cabecera de `care_pins` en el esquema y en la de `huellaDePinDePuerta`.
2. **La sesión de la puerta prueba presencia, no firma** (§3). La alternativa —firmar el lote con la
   sesión de quien lo tecleó— pierde los registros de un turno de noche sin wifi.
3. **La idempotencia se comprueba antes que cualquier otra validación** (§11.1). Lo encontró el e2e.
4. **El consentimiento de imagen es un `ClientConsentKind` y no una columna** (§8), lo que obligó a partir
   la migración en dos (Postgres no deja usar un valor de enum en la transacción en la que se añade).
5. **El valor y la nota son dos columnas lógicas distintas** aunque vivan en la misma fila. Con una, el
   texto de la nota descifraría en el sitio del valor.
6. **`ALGO_NO_VA_BIEN` entra en el catálogo de serie** como `OBS` + `ON_DEMAND` + `TEXT_SHORT` y sin
   opciones (§6), que es lo que lo deja fuera del toque de «como siempre».
7. **Un lote con un registro malo guarda los buenos**, y si no entró ninguno contesta 409 para que la cola
   lo deje visible. El peor caso de un lote es «seis apuntados y uno dicho».
8. **«No hecho» no se apunta.** Es la ausencia de registro; quien lo deriva es residencia-4. Con las dos
   fuentes, el indicador de cumplimiento tendría que decidir cuál manda.
9. **El rate-limit del PIN bloquea la tablet, no a la persona, y dura dos minutos** (§2). Un candado largo
   bloquea el registro de cuidados de una habitación.
10. **La ventana de «deshacer» es de diez minutos.** Es «me he equivocado de botón», no «quiero que esto no
    conste».
11. **La foto se sube desde un fichero y no desde la cámara**: esa pantalla la usa la dirección en su
    despacho, y pedir «hacer una foto» obligaría a ir a la habitación con el portátil.
12. **El PIN no entra en la devolución del art. 28.3.g** (§10).
13. **Se añadieron dos tokens táctiles fuera de la escala** (`tap-puerta` 72 px y `tap-puerta-tecla`
    120 px), con su justificación en `tailwind.config.js` como pide la regla de `docs/design/tokens.md` §4.
14. **El sembrador de Jardín de Gredos vive en el repo** (`src/scripts/sembrar-gredos.ts`) y no en el
    scratchpad: es el escenario del cliente cero y el día que alguien quiera volver a ver las seis
    pantallas tiene que poder hacerlo sin reconstruirlo de memoria.

---

## 15 · Dudas abiertas

1. **No se ha observado un turno real.** D-64 sustituyó la observación con auxiliares por la validación del
   mockup por Matías, que se ha criado en la residencia. Lo medido (§12) son toques y milisegundos de
   máquina; **los ≤30 min por jornada de D-05 siguen sin contrastar** y es lo primero del piloto.
2. **Una tablet robada permite aprender los PIN de la plantilla.** El roster cacheado lleva la huella y la
   subclave; diez mil combinaciones son instantáneas. Es la misma exposición que el roster de
   `offlineAuth` del TPV acepta y documenta (v1.10 §1-2, argon2id de un PIN de cuatro cifras en un
   dispositivo emparejado), y la respuesta es la misma: la caché se vacía al revocar el dispositivo, y el
   PIN no abre nada más que la puerta de una habitación. **Lo que lo cerraría de verdad es que el PIN
   dejara de ser de cuatro cifras**, y eso es una decisión de producto que el mockup no toma.
3. **Sin red, «lo que toca» sale todo como por hacer.** La tablet no sabe qué se registró desde otra
   pantalla ni lo que no llegó a subir. Es lo prudente —el servidor es idempotente por ocurrencia, así que
   volver a marcar algo entra como corrección y no como un cuidado de más— pero significa que una auxiliar
   sin red ve la lista entera. Guardar en la tablet lo que ella misma acaba de registrar es una mejora
   clara y no entra aquí.
4. **`configurarAvisoDeIlegible` sigue sin llamarlo nadie.** Deuda de clinica-7 que residencia-1b §12.1
   dejó anotada: un valor que no se descifra sale como hueco en pantalla y **no deja rastro en el log**.
   Ahora hay dos columnas más que pueden salir así. Sigue sin arreglarse aquí por lo mismo —cablear un
   logger a esa función es una decisión sobre qué se registra, con «nada de salud en logs» de por medio—
   pero cada bloque que pasa la hace más cara.
5. **Las fotos de residente huérfanas no las barre nadie.** Cambiar la foto deja la anterior en el volumen.
   Es deliberado (borrar binarios dentro de la transacción que escribe la fila es la forma de quedarse sin
   la foto si algo falla después) y hace falta un script de barrido el día que un centro cambie muchas.
6. **La nota de voz no se transcribe.** Es ia-1 (ADR-02). Mientras tanto, la escucha la DUE desde la ficha
   y cada escucha deja su línea en el registro de accesos. Y **D-46 decía que no habría voz en la v1**: el
   prompt de este bloque la mete con el audio cifrado y la transcripción fuera, que es lo que D-46 quería
   evitar (un audio que nadie escucha) resuelto por el otro lado.
7. **Un centro sin clave clínica no puede tener PIN de puerta.** No puede pasar en la práctica
   —`tenants_residencia_exige_clinica` y `clinica/arranque.ts`— y la ruta lo dice con una frase en vez de
   con un «PIN incorrecto» que mandaría a la auxiliar a probar.
8. **El `care_day` lo decide la tablet.** Con el reloj mal puesto dentro del margen de cinco minutos, un
   registro de las 07:58 podría caer en la noche en vez de en la mañana. El margen es pequeño a propósito;
   cerrarlo del todo exigiría que el servidor recalculara el turno, y entonces un registro hecho sin red no
   podría adscribirse — que es justo lo que este bloque viene a permitir.

---

## 16 · Lo que NO cubre este bloque

Declarado en el prompt y respetado:

- **constantes (`MEASURE`), umbrales y eventos derivados**: residencia-4. Si el plan de un residente tiene
  una línea `MEASURE`, **la puerta no la pinta** y la API la rechaza con `CONTROL_FUERA_DE_ALCANCE` y un
  mensaje que dice de qué bloque es. El catálogo de serie tiene siete, así que pasa de verdad;
- libro de incidencias, avisos y comunicación a familia: residencia-4;
- relevo con acuse y panel de dirección: residencia-5;
- medicación y escalas validadas (`SCALE`/`SCORE`, rechazadas con «Fase 2» en el mensaje): Fase 2;
- transcripción de la voz: ia-1.

`UserRole` no gana valores. Verifactu, caja y cobro no cambian de comportamiento para nadie. Y ni un dato
de salud en logs: ni el audio, ni su texto, ni el ciphertext.

**Tenants sin residencia no notan nada.** `care_records` y `care_pins` sólo tienen filas en un centro con
la residencia encendida; las seis columnas de foto están en `resident_profiles`, que sólo tiene filas allí
mismo; y el `IMAGE` del enum no lo escribe nadie hasta que una pantalla lo mande.

---

## 17 · Cómo se cierra

### Migración · HAY DOS

- `20261015020000_residencia_3_tipos` — `ALTER TYPE "ClientConsentKind" ADD VALUE 'IMAGE'`, y nada más.
- `20261015030000_residencia_3_registro` — `care_records`, `care_pins`, las seis columnas de foto, los ocho
  CHECK, los dos índices únicos y el trigger de inmutabilidad.

**Por qué son dos:** Postgres prohíbe USAR un valor de enum en la transacción en la que se añade, y Prisma
corre cada migración en una. `IMAGE` hace falta escrito dentro del CHECK
`client_consents_imagen_no_es_clinica`. Es la factura que clinica-1, -2, -3 y residencia-1 pagaron; aquí
está pagada de entrada y un test lo fija. Y conviene recordar la otra mitad, porque la regla se recuerda
mal: los tipos **nuevos** sí se pueden crear y usar en la misma migración (residencia-2 lo hizo con seis);
lo que no se puede es `ADD VALUE`.

**Las dos son ADITIVAS**: dos tablas nuevas vacías y seis columnas nullable sobre una tabla que sólo tiene
filas en un centro de residencia. Ni un `DROP TABLE`, ni un `DELETE`, ni un `TRUNCATE`, ni un `UPDATE …
SET` fuera de la función del trigger. Un test enumera los `ALTER TABLE` y comprueba que sólo nombran
cuatro tablas.

El **`down`** está escrito en la cabecera de las dos, incluido lo que no se puede deshacer: el valor del
enum no se quita en Postgres, así que `IMAGE` se queda en `ClientConsentKind` para siempre. Y el de la
segunda es completo **mientras no haya un solo registro de cuidado dentro**: después, el `down` es tirar la
evidencia que esa tabla existe para conservar cinco años.

**Aplicadas en una copia**, no en producción: `mipiacetpv_residencia3_copia`, creada con
`CREATE DATABASE … TEMPLATE mipiacetpv_residencia2_capturas` —una base con los datos sembrados de
residencia-1 y -2 dentro— y con residencia-1b aplicándose en la misma pasada. O sea el orden real del
despliegue.

### Despliegue

1. `prisma migrate deploy` (lo hace el arranque de la imagen).
2. **El arranque carga el catálogo de serie**: 37 filas globales, idempotentes. La nueva es
   `ALGO_NO_VA_BIEN`; el resto no cambia y el seed no las toca.
3. **Nada más.** Ningún tenant cambia de comportamiento: las dos tablas nacen vacías y las rutas están
   detrás del gate de la residencia.
4. Para que un centro pueda usar la puerta hacen falta tres cosas, y las tres se hacen desde el admin:
   - **un PIN de puerta** por persona (Personal → la tarjeta de cada uno). Sin él, su PIN no abre nada;
   - **la tablet emparejada** a la habitación (Edificio → código de 6 dígitos, que es de residencia-1);
   - y, si se quiere la foto, **subirla y anotar el consentimiento de imagen** en la ficha del residente.

**Sin `COPY` nuevo en `infra/Dockerfile`**: no nace ningún paquete. `packages/residencia-plan` ya tenía su
línea desde residencia-2, y que ahora lo use también `apps/tpv-web` no añade ninguna — la línea es del
`package.json` del paquete, no de quien lo consume.

**Ni una variable nueva en el entorno**, salvo una opcional: `CARE_VOICE_MAX_BYTES` (2 MB por defecto), el
tope de una nota de voz. La `CLINICAL_KEK` y el `CLINICAL_FILES_DIR` son los de clinica-7.

### Verde

| Suite | Resultado |
| --- | --- |
| Unitaria (`pnpm vitest run`, desde la raíz) | **5.293 pasan**, 3 saltados, 378 ficheros (antes del bloque: 5.139 / 371) |
| e2e de la API (`test:e2e`) | **783 pasan**, 38 ficheros (antes: 721 / 37) · **sin Redis y con los dos `.env` apartados**, que es como la ve la CI (§18) |
| `tsc --noEmit` · api | limpio |
| `tsc --noEmit` · los siete paquetes de la CI (más `residencia-plan`) | limpio |
| `tsc -b` · admin y tpv-web | limpio |

La suite unitaria se corrió **desde la raíz** (memoria de la casa: los ficheros de `tpv-web` necesitan su
entorno jsdom) y **también con los dos `.env` apartados**, que es como la ve la CI: 5.293 igual. La otra
memoria de la casa —«el `.env` de la raíz tapa la CI»— está respetada.

### Lo nuevo de este bloque

- `apps/api/test-e2e/residencia-3.e2e.ts` (62) · el camino completo y la tabla de sabotajes, contra
  Postgres de verdad y montando las rutas. Los dos últimos casos son del candado del PIN y llegaron
  arreglando la CI (§18).
- `apps/api/test/residencia-3-migracion.test.ts` (35) · el contrato del SQL, incluido el guardián de las
  veintidós columnas del trigger.
- `apps/api/test/residencia-registro.test.ts` (24) · el dominio puro: el valor, la ocurrencia, los
  márgenes y la cadena.
- `apps/tpv-web/test/puerta-pantallas.test.tsx` (39) · las seis pantallas por lo que dicen.
- `apps/tpv-web/test/puerta-gestos.test.ts` (27) · de un toque a unas filas, contando filas.
- `apps/tpv-web/test/puerta-sin-red.test.ts` (5) · cortar la red, registrar tres cosas, reabrir la app,
  recuperar la red y que lleguen **una vez** con su `recordedAt` original.
- `apps/admin/test/residencia-3-pantallas.test.tsx` (13) · los cuatro estados de la foto y el valor en
  palabras.
- `packages/residencia-plan/test/dia-del-turno.test.ts` (8) · la madrugada del turno de noche y los dos
  cambios de hora.
- Y `residencia-puerta.test.tsx` gana 1: la letra de la cama en una doble.

### Lo que NO se corrió, y por qué

**`pnpm e2e:agenda` (el banco de la agenda).** No entra en la CI, se lanza a mano y usa una base de nombre
FIJO (`mipiacetpv_agenda_banco_e2e`) que **vacía entera**, más tres puertos fijos. Hay cinco worktrees
abiertos en esta máquina; lanzarlo habría pisado a otra sesión (memoria de la casa).

Y no hay motivo para pensar que le afecte: el banco no tiene escenario de residencia (`seed/` son
`peluqueria-demo.ts` y `clinica-demo.ts`), y de los ficheros de producción de este diff los únicos que
toca algo que el banco recorra son `lib/outbox.ts` —donde el cambio es **puramente aditivo** (un `kind`
nuevo y un campo opcional que, ausente, se comporta igual que antes) y `App.tsx`, donde lo único que
cambia está **dentro** de la rama `state.kind === "room"`, que un terminal del banco no alcanza nunca.

Sobre el **capítulo 12 del banco**: seguía rojo antes de este bloque por dos colisiones de selector que
vienen de clinica-5 (clinica-7-done §15, residencia-1 y -2 lo dejaron dicho). Este bloque no lo arregla ni
lo empeora.

**El `smoke`.** Lo corre la CI arrancando la imagen real contra un Postgres **sin migrar**. Este bloque
añade al arranque **una fila al catálogo de serie** y nada más: `cargarCatalogoDeSerie` ya registra y sigue
si falla (residencia-2 §11.4), así que una base sin migrar da el mismo aviso que daba.

### Capturas

`docs/qa/2026-10-15-residencia-3/`, del bucle visual sobre el producto de verdad con Jardín de Gredos
sembrado:

- **las seis pantallas a 1280×800** (una tablet de 10" en la pared), más tres estados que son el bloque:
  `3b` con la franja verde y lo hecho en gris, `6c` con la banda ámbar de sin red y `1b` con la cola
  pendiente en reposo;
- **la ficha del admin** con la foto y el consentimiento, **lo registrado por turno** y **el PIN en
  Personal**, a escritorio y a 390;
- y `MEDIDO.txt` con los toques y los milisegundos de §12.

El bucle mide además **cada objetivo táctil sobre la página** (mínimo 56 px en la puerta, D-64) y si algo
se sale a lo ancho. **Hallazgos en la última pasada: ninguno.** Los tres de las pasadas anteriores están en
§11.3.

---

## 18 · La CI del e2e · el Redis que no hay

El job `e2e` de la PR #27 tardó **48 minutos** y acabó rojo (run `38776991509`); normalmente baja de dos.
No se colgó la CI: se colgó **este bloque**.

**Qué pasaba.** `residencia-3.e2e.ts` es el primer fichero de la suite que monta la ruta
`POST /residencia/puerta/pin`, y esa ruta pasa por el rate-limit (`auth/rate-limit.ts`), que vive en Redis.
El job `e2e` **sólo levanta Postgres** —por decisión escrita en el propio `ci.yml`: «preferible mantener la
suite autocontenida»— y el cliente de `context.ts` se construye con `maxRetriesPerRequest: null`, que lo
exige BullMQ para reconectar limpio. Con ese ajuste, un comando contra un Redis que no está **no falla:
espera reconexión para siempre**. Así que cada caso que teclea un PIN se quedaba parado en el primer
`inspect` hasta el timeout de 60 s de vitest: **51 de los 60 casos**, uno detrás de otro, 51 minutos de
runner. Los 9 que pasaban son los sabotajes que hablan sólo con Postgres.

**Por qué no lo vio nadie antes.** En el portátil hay un `mipiacetpv-redis` levantado (uno por worktree,
memoria de la casa), así que en local el rate-limit encontraba su Redis y el fichero pasaba en 16 s. El
verde de local mentía sobre el entorno de la CI, igual que lo hace el `.env` de la raíz.

**Qué se cambió.** En el e2e se sustituye **el transporte, no el limitador**: `vi.mock` de
`../src/context.js` que devuelve un `getRedis()` en memoria —un `Map` con TTL de verdad, el patrón de
`test/rate-limit-caracterizacion.test.ts`— y se deja pasar lo demás del módulo (el `getPrisma` sigue siendo
el Prisma real). `rate-limit.ts` y la ruta siguen siendo los de verdad: contador, candado, TTL y los
umbrales **por puerta** (10 intentos / 5 min → 2 min de candado). Y el `beforeEach` hace `flushall`, para
que los fallos de un caso no cuenten en el siguiente.

Lo que **no** se hizo es mockear `rate-limit.js` entero, que es lo que hace `holded-desconectar.e2e.ts`
para su throttle de catálogo. Aquí habría dejado el candado del PIN **sin una sola prueba en todo el
repo**: la ruta de la puerta no tiene test de unidad que la cubra. Así que el mock trae su contrapartida:
dos casos nuevos que lo vigilan a través de la ruta —a los diez fallos la tablet se canda, el PIN bueno
recibe 429, **la tablet de al lado sigue abriendo**, y un acierto limpia el contador—. El limitador en sí
(los cinco intentos del login, los TTL) lo sigue clavando `rate-limit-caracterizacion.test.ts`.

**Y una red para la próxima.** `timeout-minutes: 15` en el job `e2e`. La suite entera tarda dos minutos;
con eso, el siguiente cuelgue se paga en un cuarto de hora de runner y no en una hora, y el log dice
«timeout» en vez de hacer leer 1.429 líneas de `ECONNREFUSED`.

**Comprobado como lo ve la CI**, no sólo pasando: suite e2e completa con `REDIS_URL` apuntando a un puerto
muerto (`redis://127.0.0.1:6399`) → verde. Si algo volviera a necesitar Redis de verdad, se nota ahí antes
de empujar.

### Y detrás había un segundo, que el cuelgue tapaba

Con la suite corriendo de verdad, los tres casos de la foto del residente se cayeron:
`EACCES: permission denied, mkdir '/var/lib/mipiacetpv'` (500 en la ruta de subida, y de ahí un 404 y un
`path must be of type string, received null` en los dos siguientes). `CLINICAL_FILES_DIR` defaults en
`env.ts` a `/var/lib/mipiacetpv/clinical-files`, que es **la ruta del contenedor**: el runner no puede
crearla. Nunca se había notado porque ningún e2e anterior escribía un fichero clínico **a disco**, y en el
portátil el `.env` de la raíz trae su propia ruta —la memoria de la casa, otra vez: el `.env` de dev tapa
lo que la CI va a ver—.

Se fija en `test-e2e/e2e-env.ts`, la puerta que importan los 38 ficheros, al lado de la `CLINICAL_KEK` y
por el mismo motivo (en CI no hay `.env`). Y **sin `??=`**, al contrario que la KEK: la suite escribe en
`tmpdir()/mipiacetpv-e2e-clinical-files` en el portátil **y** en CI, que es justo lo que faltaba para que
esto se cazara antes de empujar. A `tmpdir()` y no al árbol, para no dejar fotos de prueba en el repo.

**Verde final, con los DOS `.env` apartados y sin Redis** —las dos memorias de la casa a la vez, que es
exactamente el entorno del runner—: **783 pasan, 38 ficheros, 128 s**.

### El `smoke`, aparte

En el run de `pull_request` de este arreglo el `smoke` se cayó con «/health no respondió en 60s», y en el
de `push` —**el mismo sha, los mismos contenedores**— pasó. El contenedor no había bindeado el 3001
todavía: su log acaba en `> tsx src/server.ts` y los dos avisos de base sin migrar. Es el margen de 60 s
del paso, no este bloque: el diff no toca ni una línea de producción. Queda anotado porque va a volver.

## 19 · Commits

```
f4a957c feat(residencia-3): el modelo del registro de cuidados, el PIN y la foto
d424d88 feat(residencia-3): la API de la puerta y el PIN que la abre
ba17c8b feat(residencia-3): las seis pantallas de la puerta y la cola sin red
8576cda feat(residencia-3): el admin que hace falta para usar la puerta
b5f53e0 test(residencia-3): la tabla del registro, los sabotajes y el sin red
3b0446c test(residencia-3): las seis pantallas, el admin y los inventarios al día
b5b4fcf fix(residencia-3): lo que encontró el bucle visual, y las capturas
5c1bd2d docs(residencia-3): el done del bloque
<este>  fix(residencia-3): el e2e no necesita Redis, y el candado del PIN tiene test
```

## 20 · La rama

Sobre `origin/master` = `e275b37`. **Ni merge ni despliegue: eso lo decide Matías.**
