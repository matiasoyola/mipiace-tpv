# Bloque clinica-2 · done

Rama `clinica-2`, worktree `~/Developer/Claude/Projects/mipiacetpv-clinica-2`, desde
`9d39888` (la cabeza de `clinica-2` al empezar, que es `master` = `0357ce2` más el mockup y el
prompt), **y mergeada después con `origin/master` = `906b279`** (el merge de `ticket-con-iva`, PR
#8, más la auditoría del AP13). Once commits, 81 ficheros.

**Este bloque construye la primera pantalla clínica de verdad**, sobre el suelo que puso
`clinica-1`. Y la construye entera: el test que contesta el paciente, las dos puertas por las que
entra, la pantalla con la que la podóloga lo valida, y la función que `clinica-3` usará para no
dejar tratar a nadie sin ella.

La frase que resume lo que tiene que ser verdad al terminar: **nadie trata a un diabético
anticoagulado sin saberlo**, porque la historia no deja registrar un tratamiento sin la valoración
validada.

---

## 1 · El cuestionario, versionado y en código

`packages/clinica-valoracion` — paquete nuevo, compartido por la API y las pantallas.

La versión 1 es la del mockup validado: las diez preguntas, sus ayudas, los dos seguimientos
(insulina si diabetes; a qué es alérgico, con botones, si alergias) y qué alerta sale de cada «Sí».

**Por qué está versionado:** la valoración guarda CON QUÉ VERSIÓN se contestó. Si mañana cambia una
pregunta, lo contestado ayer sigue leyéndose bien. Sin eso, una valoración de hace dos años se
pintaría con las preguntas de hoy — que es decir que el paciente contestó algo que no se le
preguntó. En un registro legal eso no es un detalle de interfaz.

**Por qué es código y no una tabla:** editar el cuestionario desde una pantalla está fuera de
alcance por el prompt. Una tabla sin pantalla que la edite no es más flexible que una constante: es
la misma rigidez con una migración de por medio y sin revisión de código. El día que haya pantalla,
esta constante pasa a ser la fila `version = 1` y nada de lo que cuelga de ella cambia de forma.

### Por qué es un PAQUETE y no un fichero del API

Porque el MISMO cálculo lo necesitan los dos lados. La API decide si una valoración se puede
validar y qué alertas tiene; el test del paciente y la pantalla del sanitario pintan el botón
desactivado con su motivo y la franja de alertas. Con una copia por lado, el día que cambie una
regla la pantalla diría una cosa y el servidor otra — y la que gana es la del servidor, así que el
usuario vería un botón activo que falla.

Lo que vive ahí es PURO: ni Prisma, ni Fastify, ni React, ni reloj.

- `alertasDe` · respuestas vigentes (con las correcciones aplicadas) → alertas.
- `puedeValidarse` · decide **y redacta el motivo**, porque el mockup pide el botón desactivado con
  la razón al lado y dos funciones acabarían discrepando.
- `puedeRecibirPrimerTratamiento` · la puerta de `clinica-3`.
- `preguntasEnJuego` · el seguimiento de la insulina sale de juego solo si la podóloga corrige la
  diabetes a «No», sin que nadie borre nada.

### Un «Sí» no es siempre una alerta

Artrosis, operaciones previas y tabaco tienen `alerta: null`: están en la historia y **no** van en la
franja roja. Si todo fuera alerta, la franja dejaría de leerse, que es el único modo de fallo que
importa en una señal de seguridad. La distinción vive en el dato y no en un `if`, así que añadir
una pregunta no obliga a tocar `alertas.ts`.

### La única divergencia con el mockup, declarada

El mockup escribe las alertas en femenino («Diabética») porque su paciente de ejemplo es Carmen.
Aquí van en NEUTRO: «Diabetes», «Anticoagulación», «Inmunodepresión». Son etiquetas de la franja de
CUALQUIER paciente, y una etiqueta en femenino sobre la historia de un hombre es un error de dato,
no de estilo.

**Las preguntas no se tocan**: son la voz del producto, están validadas, y cambiarlas es volver a
validarlas.

---

## 2 · El reparto en tres sitios, que es el eje del bloque

| Dónde | Qué | Quién lo protege |
| ----- | --- | ---------------- |
| `clinical_entries` con `kind = INITIAL_ASSESSMENT` | **Lo que contestó el paciente** | El trigger `clinical_entries_inmutable`, **que ya existía desde clinica-1**. Aquí no se toca esa tabla: se usa. |
| `clinical_assessments` | **El estado**, que sí cambia | Trigger de guarda propio + seis CHECKs |
| `clinical_assessment_corrections` | **Lo que corrigió el sanitario** | Trigger append-only + trigger de «sólo sobre una respondida y no validada» |

Si todo viviera en una tabla habría que elegir: **o es inmutable** (y entonces el estado no puede
avanzar) **o es mutable** (y entonces las respuestas del paciente son editables). Separarlo da las
dos cosas sin inventar un segundo mecanismo de inmutabilidad por columnas.

### Las garantías, y quién las sostiene

1. Lo contestado no se borra ni se edita → trigger de `clinical_entries` (clinica-1).
2. Una corrección no se edita ni se borra → trigger append-only.
3. Una valoración VALIDADA no se edita → trigger de guarda.
4. Validar exige las TRES confirmaciones y firma → CHECK.
5. El estado sólo avanza → trigger de guarda.
6. Un paciente no tiene dos valoraciones abiertas → índice único PARCIAL. Y **sí** puede tener
   varias validadas: la valoración se repasa creando una nueva (decisión de producto 7).
7. Lo que la valoración llama «sus respuestas» es una entrada de ESTE paciente y de esa clase →
   trigger.

Ninguna es un `if` de la aplicación: la aplicación no es la única puerta a Postgres (ADR-015 §1).

---

## 3 · El actor «paciente por enlace» — la pregunta que el prompt manda contestar

El prompt lo señala: *«Hoy `ClinicalAccessLog.userId` es obligatorio y el paciente no es un `User`:
resuélvelo y dilo en el done.»* Lo mismo vale para `ClinicalEntry.authorUserId`.

**Las dos salidas posibles:**

**(a) Relajar los NOT NULL** y añadir una columna «qué clase de actor fue». **Se descarta.** Esos
NOT NULL con RESTRICT son la garantía de clinica-1 de que ninguna línea de historia es anónima
(«una línea sin autor no es historia clínica, es una nota anónima»). Convertirla en «ninguna línea
sin autor, SALVO ESTAS» es perder la invariante entera para ahorrar una fila — y obliga a que cada
consulta, cada join y cada pantalla que lea autoría lleve su caso especial para siempre.

**(b) Darle una fila al paciente.** Un actor de sistema por tenant, con `alias = "Paciente (por
enlace)"`. La autoría sigue siendo NOT NULL, el registro no necesita ningún caso especial, y la
ruta que se le enseña a un inspector contesta, sin tocar nada, «la escribió el paciente por el
enlace».

**Se elige (b).** El coste es una fila por tenant clínico y cuatro listas de personas que la
excluyen; el beneficio es que la invariante legal no se toca.

### Y no puede autenticarse NUNCA, por CHECK y en los dos sentidos

```sql
CONSTRAINT "users_system_actor_no_credentials"
    CHECK (NOT "is_system_actor"
           OR ("password_hash" IS NULL AND "pin_hash" IS NULL))
```

Sin password no hay login de panel y sin PIN no hay login de TPV (`/shift/cashier-login` rechaza al
usuario sin PIN antes de comparar nada). Está escrito en los dos sentidos a propósito: también
prohíbe **marcar como actor de sistema a un usuario que YA tiene credenciales**, que es el camino
por el que esto se rompería de verdad (un UPDATE sobre la fila de la propietaria). El e2e lo
comprueba por los cuatro lados.

### No es alguien a quien dar de alta

No sale en `GET /cashiers`, ni en `GET /staff`, ni entre los candidatos a PIN de encargado, ni
cuenta para la colisión de alias — todas filtran por `isSystemActor: false`, un valor que nace en
`false`, así que **ningún tenant de hoy cambia de comportamiento**.

Se crea perezosamente, dentro de la transacción de la respuesta del paciente: si la respuesta se
cae, el actor tampoco queda. No se siembra en la migración porque hoy no hay ningún tenant con la
clínica encendida, y sembrar usuarios en una migración es sembrar filas que nadie ha pedido en
quince bases.

---

## 4 · El enlace del email

Sigue el patrón probado del PDF público del ticket (`tickets/public-pdf-route.ts`) y lo endurece
donde el dato lo pide.

| | Ticket (B-Print) | Valoración (aquí) | Por qué |
| - | ---------------- | ----------------- | ------- |
| Qué se guarda | el slug EN CLARO | **el SHA-256** | El slug de un ticket abre un PDF que su dueño ya tiene. Esto abre el formulario de salud de una persona: con el hash, una copia de la base —un backup, un volcado— no abre ni un enlace. |
| Tamaño | 64 bits | **256 bits** | No hay fuerza bruta que valga ni con el rate-limit apagado. |
| Caducidad | no caduca | **30 días** por email, **4 horas** en tablet | Una cita a tres semanas necesita el enlace vivo; uno de hace un año, no. |
| Usos | ilimitados | **uno** | Al contestar se sella y el trigger impide reabrirlo con un UPDATE. |

### Un solo mecanismo para las dos puertas

El token de la tablet es **el mismo** que el del email, con otra caducidad. Es la mitad del «un solo
test, dos puertas» del prompt: con un mecanismo por canal habría dos rutas públicas, dos formas de
caducar y dos sitios donde equivocarse.

Y de ahí sale gratis lo que hacía falta igual: **abrir la tablet invalida el enlace del email**,
porque rotar el token deja el hash anterior sin nada contra lo que buscar. Sin un camino aparte que
«cancele» el correo.

### La misma 404 para todo

«No existe», «caducado» y «ya usado» contestan lo mismo, carácter por carácter. Tres respuestas
distintas le dicen a un escáner que el token existía, y eso ya es información sobre una persona.
Consecuencia buscada: **la pantalla del paciente no puede decirle «su enlace ha caducado»**. Dice
«este enlace ya no sirve» y le pide que llame a la clínica — que es, además, lo que tiene que
hacer.

**Con el módulo apagado, tampoco existe.** La ruta pública no tiene sesión de la que sacar el
tenant, así que no puede llevar `ensureClinicaEnabled`: comprueba la capability ella misma después
de resolver el token, y contesta la misma 404.

### Rate-limit por IP, tras el proxy

30 intentos por hora, candado de una hora, con la misma mecánica que la descarga de la APK. Cuentan
los intentos que **no** encuentran token: si sólo contaran los reales, probar el espacio saldría
gratis. Y el enlace bueno limpia el contador, porque si no un paciente que recarga treinta veces se
bloquearía a sí mismo. `trustProxy: 1` ya estaba en `server.ts`, así que `request.ip` es el último
salto del `X-Forwarded-For` de Caddy.

### El email, sin un solo dato de salud

Lleva: nombre de la clínica, nombre de pila, día y hora de la cita, y el enlace. **Y nada más.** Ni
una pregunta, ni «diabetes», ni «alergia», ni el nombre del servicio (que en una clínica puede ser
«quiropodia diabético»). Un asunto que dijera «test de enfermedades crónicas» convierte la vista
previa en la pantalla de bloqueo del móvil —que ve quien esté al lado— en un dato de salud.

El guardián se construye **desde el cuestionario**, no desde una lista a mano: el día que se añada
una pregunta, ya la cubre. Compara palabras con palabras y no subcadenas (con `includes`, «lleva»
de «¿Lleva marcapasos?» casaba dentro de «le llevará unos tres minutos»).

---

## 5 · Dónde se engancha el alta de la cita, y la diferencia con clinica-1

En `agenda/store.ts::insertHold`, el punto único donde nace una cita — la misma lección que
`mover-con-otra` ya cobró en clinica-1. Enganchado en la ruta, un camino nuevo que cree citas (el
alta offline por outbox, una reserva online, un import) no mandaría el test y nadie lo notaría hasta
encontrarse a un paciente sin valoración en la silla.

**Pero con una diferencia importante: esto NO va dentro de la transacción de la cita.**

- El acceso clínico de clinica-1 sí: media operación deja a un sanitario con una cita cuya historia
  no puede abrir, y las dos cosas son escrituras locales.
- Mandar un email es I/O a un servidor que no es nuestro. Dentro de la transacción, un SMTP lento
  tendría abierta la transacción que compite por el `EXCLUDE` del anti-solape, y **un SMTP caído
  haría que no se pudiera dar una cita**. Eso no es aceptable: la cita es el acto de negocio y el
  email es el recado. Es la misma forma de la memoria de la casa («cobrar siempre se puede»).

Así que el store **averigua dentro** de la transacción (una lectura local, que ve el mismo estado
que la escritura) y **manda después del commit**. Si el envío falla, la cita está dada y la
valoración creada con su enlace: la podóloga reenvía o da la tablet.

### Y de ahí sale `source`, con el vocabulario de clinica-1

`engine.ts` no se toca, así que el store no tiene usuario al que atribuir el envío. La solución es
la misma que `clinical_access` ya usaba:

```sql
CONSTRAINT "clinical_assessments_source_pedida_por"
    CHECK (("source" = 'MANUAL'      AND "requested_by_user_id" IS NOT NULL)
        OR ("source" = 'APPOINTMENT' AND "requested_by_user_id" IS NULL))
```

`APPOINTMENT` no la pide nadie: la pide el hecho de que se le ha dado esa cita. Inventarse un autor
ahí sería escribir en una historia clínica que alguien pidió algo que no pidió.

---

## 6 · El registro de accesos: un solo punto, dos predicados

`conHistoria` gana un segundo permiso, `PERSONAL_DEL_CENTRO`, para los dos actos que **la
recepcionista sí puede hacer** (decisión de producto 6): mandar el test y abrir la tablet. Ninguno
enseña una respuesta; los dos escriben en la historia, así que los dos dejan línea con su nombre.

**El predicado cambia, la escritura de la línea no.** La alternativa era llamar a `apuntarAcceso`
desde la ruta de enviar, y eso habría roto lo único que hace el registro de fiar: que lo escribe un
solo sitio. Con cinco rutas se nota poco; con quince, el día que alguien añada la decimosexta sin
acordarse, la historia se escribe sin dejar rastro.

Y el `outcome` dice si **este** acto se permitió, no qué opinaba la función de acceso: una línea
DENIED sobre un envío que sí ocurrió sería una línea falsa.

### La única excepción, y por qué

La ruta pública (`POST /valoracion/:token`) llama a `apuntarAcceso` directamente. No puede usar
`conHistoria`: no hay sesión, y la función de acceso contestaría «no eres sanitario». La
alternativa era un tercer valor de `PermisoClinico` para «el paciente por su enlace», y eso habría
metido en la función de autorización **del personal** un caso que no es del personal. Mantiene el
orden de clinica-1: la línea ANTES del trabajo, y si no se puede escribir, las respuestas no se
guardan.

### Lo que NO deja línea, y es deliberado

El alta de la cita que crea la valoración. No hay persona a la que atribuirla y lo que se crea es
una valoración **vacía** con un token, sin un solo dato de salud dentro. Es la misma decisión que
clinica-1 tomó con `clinical_access` cuando nace de la agenda (§11.2 de su done). Lo que sí deja
línea, siempre, es el contenido: las respuestas del paciente, cada lectura de la pantalla y cada
corrección. Y queda escrito en la fila igualmente: `source = APPOINTMENT` y `appointment_id` dicen
exactamente de dónde salió.

Lo mismo con el aviso «Valoración pendiente» de la agenda: no lee ni una respuesta, y apuntar un
acceso por cada pintada de la agenda llenaría de ruido justo la lista de «quién ha abierto la
historia de este paciente».

---

## 7 · Las pantallas

### El test del paciente: UN componente, dos puertas

`apps/tpv-web/src/clinica/TestPaciente.tsx`. Lo pinta el enlace del email y lo pinta la tablet. Lo
único que cambia es la despedida, y eso entra como un `canal`.

Vive en la PWA del TPV y se desvía en `main.tsx` **antes de montar `App`**, que arranca con el
bootstrap del device: un móvil sin emparejar caería en la pantalla de pairing — que es exactamente
lo que le pasaba a la URL del PDF del ticket antes de su `handle` en Caddy (Bug-04). Aquí el desvío
es en el cliente y **no hace falta regla nueva en Caddy**: el `try_files {path} /index.html` de la
PWA ya devuelve el index para esa ruta.

Y en la tablet, el modo paciente **no es una pantalla dentro del TPV**: si lo fuera, el paciente
tendría detrás la sesión de la podóloga y «sin forma de salir» sería un adorno. Montando sólo el
test, lo único en pantalla es su test; para volver se teclea el PIN, que es el login de siempre.

Escrito para una persona de 78 años: una pregunta por pantalla, pregunta a 38 px (28 en móvil),
«Sí»/«No» a 96 px, «No lo sé» siempre disponible y a ancho completo, palabras de la calle, sin
contraseñas.

**Los 96 px van fuera de la escala táctil de la casa**, con token propio (`tap-valoracion`) y su
justificación escrita en `docs/design/tokens.md` §4, que es la regla: «si un control no entra en la
escala, primero se discute el token; luego se implementa». El resto del test respeta el mínimo de la
casa.

### La pantalla del sanitario

Las cinco piezas del mockup en su orden: pill de estado, franja de alertas, «Respuestas del test»
con la del paciente en coral y la corrección en oscuro, «Antes del primer tratamiento» con las tres
confirmaciones, y «Validar valoración» desactivado **con el motivo escrito al lado**.

Pinta el botón con `puedeValidarse`, la MISMA función pura que usa la API. El servidor manda —vuelve
a decidirlo al recibir la petición— y aquí se usa para pintar sin ir y volver.

**Las tres confirmaciones viven en memoria y viajan con la validación.** Media validación guardada
(dos casillas y nadie que firme) no significa nada, y tres toques de casilla no son tres escrituras
sobre una historia clínica. El CHECK garantiza que una fila VALIDADA las tiene las tres, que es lo
que de verdad importa.

### El aviso de la agenda

Una lista de ids de paciente y nada más: ni una alerta, ni una respuesta, ni el estado concreto.
«A este paciente le falta un trámite antes de su primer tratamiento» es información de AGENDA, no de
salud — y la recepcionista la necesita para preguntarle si le llegó el email.

**No entra en la caché offline**, a propósito: es información que cambia sin que la agenda se
entere, y un aviso viejo sobre una valoración ya validada manda a alguien a mandar un test que no
hace falta.

### A quién se le OFRECE lo clínico: la MARCA, no el rol

El front decide por `isClinician` (nuevo en el login del TPV) y no por el rol: en el piloto **la
podóloga es la dueña**, así que mirar el rol la dejaría fuera. No es una puerta —cada ruta clínica
pasa por la función de acceso y por el registro— sino lo que evita pintarle a la recepcionista un
botón que siempre le va a fallar **y que le dejaría una línea DENIED por cada toque de curiosidad**,
que es justo la clase de ruido que clinica-1 decidió no meter en el registro.

---

## 8 · La tabla de sabotajes

Cada sabotaje se aplicó de verdad sobre la línea de producción y se corrió la suite. Los mensajes
son los reales.

| Garantía | Qué línea se rompe | Qué se pone rojo | Mensaje real |
| -------- | ------------------ | ---------------- | ------------ |
| **Lo contestado no se toca** | Quitar el trigger `clinical_entries_inmutable` | `clinica-valoracion.e2e.ts` · «un UPDATE del cuerpo de la entrada falla» y «un DELETE de la entrada falla» | `El motor ACEPTÓ lo que no debía: UPDATE clinical_entries SET body = …` |
| **El enlace es de un solo uso** | Quitar las DOS comprobaciones de `estadoDelEnlace` (el sello y el estado) | `clinica-valoracion-rutas.test.ts` · 4 casos | `expected 200 to be 404` y, el que más dice, `expected [ {…}, {…} ] to have a length of 1 but got 2` — **dos entradas de historia para un paciente que contestó una vez** |
| **El email no lleva salud** | Poner «test de diabetes, alergias y anticoagulantes» en el asunto | `clinica-valoracion-rutas.test.ts` · «NI UNA PALABRA de ninguna pregunta…» | `expected [ 'diabetes', 'anticoagulantes', …(1) ] to deeply equal []` |
| **No se valida con «No lo sé»** | `if (sinResolver.length > 0)` → `if (false && …)` en `validar.ts` | 6 casos entre el paquete y las rutas | `expected { puede: true } to deeply equal { puede: false, …(2) }` y `expected 200 to be 409` |
| **La recepcionista no lee** | `{ action: "READ" }` → `{ action: "READ", permiso: "PERSONAL_DEL_CENTRO" }` en la ruta de la pantalla | `clinica-valoracion-rutas.test.ts` · 3 casos (la recepcionista, la dueña no sanitaria, la sanitaria sin acceso) | `expected 200 to be 403` |
| **El paciente deja línea** | `await apuntarAcceso(…)` → `if (false) await …` en la ruta pública | `clinica-valoracion-rutas.test.ts` · 3 casos | `expected [] to have a length of 1 but got +0` y `expected 201 to be 500` |
| **Una abierta por paciente** | (comprobado sin sabotaje: el índice lo impone) | `clinica-valoracion.e2e.ts` · «dos abiertas a la vez» | `Code: 23505 … Key (client_id)=(…) already exists` |
| **Una VALIDADA no se edita** | Quitar el bloque `OLD.status = 'VALIDADA'` de la guarda | e2e · «una VALIDADA queda CONGELADA» | `HISTORIA_VIOLADA: la valoración … ya está validada y no se edita.` |

### Lo que los sabotajes enseñaron, y no sabía antes

**El «un solo uso» lo sostienen DOS líneas independientes, y la suite no puede distinguirlas.**
Quitar el sello (`linkUsedAt`) deja los tests en verde, porque el estado (`status !==
PENDIENTE_PACIENTE`) ya cierra el enlace. Y quitar el estado también los deja en verde, porque el
sello ya lo cierra. Sólo quitando **las dos** se pone rojo.

No es un test flojo: es defensa en profundidad, y conviene saber cuál es cuál. El **sello** es lo
que el motor protege (el trigger impide revivirlo con un UPDATE) y lo que convierte «se usó» en un
hecho registrado; el **estado** es lo que cubre el caso de una valoración que llegara a RESPONDIDA
por un camino que no sellara. Hay una tercera capa que tampoco se ve: el `updateMany` con
`status: "PENDIENTE_PACIENTE"` en el WHERE, que cierra la carrera de dos envíos simultáneos.

Es el mismo descubrimiento que clinica-1 hizo con el `ON CONFLICT`: **lo que garantiza el
comportamiento no siempre es la línea que uno escribió pensando que lo garantizaba.**

---

## 9 · Decisiones tomadas sin preguntar

1. **El email NO pasa por una cola de BullMQ.** El prompt dice «por la cola de email que ya existe
   (`email/sender.ts`)» y nombra el fichero: `email/sender.ts` **es el envío**, no una cola. La
   única cola de email de la casa (`queues/ticket-email.ts` + `ticket_email_jobs` + su worker) es un
   pipeline de PDFs de ticket con clave `ticketId`; meter una valoración ahí exigiría inventarse un
   ticket que no existe. Todo lo demás que manda correo transaccional (reset de contraseña, alta de
   super-admin, bienvenida, alertas de dispositivo) llama a `getEmailSender().send()` directamente.
   Esto hace lo mismo, y **un fallo de SMTP nunca tumba ni la cita ni la valoración**.
2. **Las tres confirmaciones se mandan con la validación**, no una a una (ver §7).
3. **`validable` se calcula dando las tres confirmaciones por marcadas.** Calcularlo con las de la
   fila sería inútil: antes de validar son `false` las tres, así que el motivo sería siempre «marca
   las tres confirmaciones» y taparía el «queda 1 respuesta por resolver», que es el que hay que
   leer primero. La pantalla hace el AND con sus casillas usando la misma función pura.
4. **La tablet caduca a las 4 horas y el email a los 30 días.** Dos números porque son dos
   situaciones: el paciente contesta la tablet ahí mismo, y cuatro horas cubren una mañana de
   consulta con margen.
5. **El detalle de las alergias se filtra contra las opciones del cuestionario.** Un texto libre
   acabaría en la franja de alertas de la podóloga, y lo que esa franja enseña tiene que venir del
   cuestionario y no del teclado de un desconocido.
6. **Una respuesta a una pregunta que no se hizo no entra en la historia.** Lo que llegue de más se
   tira en silencio: el paciente no tiene nada que arreglar.
7. **La valoración no se puede atar a una cita después de creada** (ni mover). El enganche la crea
   con su `appointment_id` dentro; dejar abierto el NULL→valor permitiría colgar una valoración de
   la cita de otra persona con un solo UPDATE. La única excepción es el `ON DELETE SET NULL`.
8. **`clinicalRecordsEnabled` viaja al TPV** con sus hermanos (`crmEnabled`, `agendaEnabled`…) para
   decidir si se enseña la pestaña «Valoración». Es UI y no una puerta, y **falla hacia apagado**:
   una pestaña «Valoración» en la ficha de un cliente de bar le cuenta que este sistema guarda datos
   de salud de otros.
9. **El capítulo del banco corre sobre su propio tenant.** Encenderle la clínica a la peluquería
   habría cambiado lo que ven los diez capítulos anteriores, que son los del vídeo de la agenda.

---

## 10 · Dudas abiertas

1. **La valoración validada NO CADUCA**, y es una decisión de producto que no está tomada. La ley no
   pone plazo; inventar un número en `puedeRecibirPrimerTratamiento` sería esconder una decisión de
   producto en una función. Hay un test que lo fija explícitamente («una validación de hace cinco
   años sigue valiendo») para que el día que se fije un plazo se vea dónde cambia.
2. **El cuestionario no se puede editar desde ninguna pantalla** (fuera de alcance, declarado). Lo
   ajusta Mi Piace con la podóloga tocando `CUESTIONARIO_V1` y sacando una versión 2.
3. **No hay recordatorio si el paciente no contesta.** Fuera de alcance por el prompt. Hoy la
   podóloga lo ve en el aviso de la agenda y reenvía a mano.
4. **La pantalla del sanitario en la ficha del cliente va dentro de un panel lateral de 448 px** y
   queda apretada. El camino principal del sanitario es el overlay de la agenda, que es ancho; el de
   la ficha es el secundario (y el que usa la recepcionista para mandar el test). Se ve en las
   capturas 06-10. Si molesta, la ficha necesita su propia pantalla ancha — y eso es un bloque de
   diseño, no un parche.
5. **El `source = APPOINTMENT` no deja línea en el registro** (§6). Está razonado y es coherente con
   clinica-1, pero es la clase de decisión que un abogado de protección de datos puede querer
   revisar.
6. **El `body` sigue en claro en la base** (duda 4 de clinica-1, sin cambios).
7. **Un paciente sin email sólo puede contestar en la tablet.** Es correcto y conviene que la
   podóloga lo sepa: la pantalla se lo dice («Este paciente no tiene email. Ábrele la tablet…»).

---

## 11 · Lo que encontraron el banco y la revisión, y no la suite

Cuatro cosas. Tres las encontró el banco con navegador —ninguna la podía ver un test de la suite, que
es el mismo argumento que clinica-1 dejó escrito en su §10b— y la cuarta la encontró Dirección
revisando el despliegue antes del merge.

### 1 · Al paciente se le decía «ya está» antes de guardar

La pantalla pintaba «Gracias, Carmen. Ya está.» en cuanto se contestaba la última pregunta y mandaba
las respuestas en segundo plano. El capítulo leyó la base justo después y la valoración seguía
PENDIENTE.

Como fallo de test era una carrera. **Como producto era peor:** a una persona de 78 años se le
estaba diciendo que había terminado —e invitándola a cerrar la página, que es lo que esa pantalla
dice— sobre algo que todavía no se había guardado. Si cierra ahí, pierde el test y cree que lo hizo.

Ahora hay un paso «Estamos guardando sus respuestas… No cierre esta página» y el «ya está» espera a
que el servidor confirme.

### 2 · La ficha del cliente reventaba con una cita dentro — **y es un fallo de master**

`HistoryTab` leía `e.total` en todas las líneas del historial. Desde B-reservas-4,
`GET /clients/:id/history` devuelve un array **unificado** de compras Y citas
(`[...purchaseEntries, ...appointmentEntries]`), y una cita no tiene `total`. Una paciente con cita
y sin compras tiraba la ficha entera a la pantalla del ErrorBoundary:

```
TypeError: Cannot read properties of undefined (reading 'toLocaleString')
    at HistoryTab (ClientsPage.tsx:779)
```

**No es de este bloque y afecta a cualquier tenant con la agenda encendida.** Se arregla aquí porque
el camino que este bloque abre pasa justo por ahí: la podóloga que abre la ficha de su paciente
recién citada se encuentra una pantalla blanca. El tipo pasa a ser una unión y las citas se pintan
como citas.

### 3 · `PUBLIC_TPV_URL` no llegaba a producción — **lo cazó Dirección, no yo**

La variable entró en `env.ts` con su default de desarrollo y **no se añadió a
`infra/docker-compose.prod.yml`**, que pasa las variables una a una. La que no está en esa lista no
llega al contenedor.

Y como la del schema tiene `.default()`, **el arranque no falla**: cae a
`http://localhost:5174` y se queda tan tranquilo. El efecto no se ve en el despliegue; se ve tres
días después, cuando una paciente llama diciendo que el enlace del correo no abre.

Arreglado en los dos servicios (api y worker) y en `.env.production.example`. Y con el guardián que
lo adelanta a la suite: `infra/test/env-publicas-en-produccion.test.ts` exige que toda `PUBLIC_*`
del schema esté en los DOS bloques `environment` y en el ejemplo con una URL `https://` de verdad.

Es la misma forma que `dockerfile-manifiestos.test.ts` —una lista a mano, un olvido silencioso, un
test que lo caza— y la misma clase de fallo que ese test ya cubre para los paquetes. Que hicieran
falta los dos dice algo: **esta casa tiene dos listas que hay que mantener a mano al añadir una
pieza nueva, y las dos fallan en silencio.** Ahora las dos tienen guardián.

Comprobado quitando la línea del worker: rojo con «`PUBLIC_TPV_URL: ${PUBLIC_TPV_URL}` aparece 1
vez/veces en docker-compose.prod.yml».

### 4 · El aviso de la agenda se quedaba pegado tras validar

El aviso sale de la respuesta de `/agenda`, pedida antes de entrar a la valoración. Ahora se recarga
el día al cerrar.

**Y de paso, dos arreglos de accesibilidad que salieron de pelear con el banco:** el botón de volver
del overlay se llama «Volver a la agenda» (había dos «Volver» en la misma pantalla, que un lector de
pantalla tampoco puede distinguir), y las filas de respuestas llevan `data-pregunta` en vez de
obligar a filtrar `div` por su texto.

---

## 12 · Lo que NO cubre este bloque

Declarado en el prompt y respetado: editar el cuestionario desde una pantalla; el mapa del pie, la
sesión y la entrada de tratamiento (`clinica-3`); fotos; consentimientos firmados; informe PDF;
WhatsApp/SMS; recordatorios del test; la app para iPad (Capacitor iOS); el IVA exento en Verifactu;
y mover la ficha técnica dentro de la historia (duda 3 de clinica-1).

**`engine.ts` no se toca.** Una línea de diferencia: cero.

---

## 13 · Cómo se cierra

### Migración · HAY MIGRACIÓN, y son dos

- `20261006000000_clinica_2_tipos` — el valor `INITIAL_ASSESSMENT` del enum, `users.is_system_actor`
  con su CHECK, y `service_scheduling.primera_valoracion`.
- `20261006010000_clinica_2_valoracion` — los cuatro tipos nuevos, las dos tablas, sus índices y sus
  cuatro triggers.

**Por qué son dos:** la misma razón que en clinica-1. Postgres prohíbe USAR un valor de enum en la
misma transacción en que se añade, y el trigger `clinical_assessments_entry_kind` nombra
`'INITIAL_ASSESSMENT'`. Juntas, la migración aborta con «unsafe use of new value of enum type». Un
test lo fija.

**Las dos son ADITIVAS**: ni un DROP, ni un TRUNCATE, ni un DELETE, ni un UPDATE masivo. Las dos
columnas nuevas nacen con `DEFAULT false` y desde PG 11 eso no reescribe la tabla. Un test lo fija.

El **`down`** está escrito en la cabecera de cada una, incluido lo que no se puede deshacer: un
valor de enum no se quita en Postgres, y con valoraciones dentro el `down` ES el borrado de historia
clínica que la migración existe para impedir.

**Aplicadas en una COPIA** de la base de desarrollo con filas reales (`mipiacetpv_clinica2_copia`,
creada con `CREATE DATABASE … TEMPLATE mipiacetpv`), no en producción. De paso volvió a salir la
precondición pendiente de `verifactu_1_registro` que clinica-1 ya documentó (dos TERMINAL activos en
la misma caja): **no es de este bloque** y se resolvió en la copia, como el propio mensaje de la
migración indica.

Y sobre la copia se comprobaron a mano **veinte garantías del motor** antes de escribir una línea de
API.

### Despliegue

1. `prisma migrate deploy` (lo hace el arranque de la imagen).
2. **Ningún tenant cambia de comportamiento**: las dos columnas nuevas nacen en `false` y las dos
   tablas nacen vacías.
3. Para que una clínica lo use: marcar su servicio de primera visita con «Es la primera valoración»
   en Catálogo de agenda (sólo aparece con la historia clínica encendida).
4. **Variable de entorno nueva**: `PUBLIC_TPV_URL` (la PWA del TPV; de ahí sale el enlace del
   test que recibe el paciente). Ya está en `infra/docker-compose.prod.yml` —en los DOS servicios,
   api y worker— y en `infra/.env.production.example` con su valor
   (`https://mipiacetpv.com`). **Hay que ponerla en el `.env` del VPS**: tiene default
   `http://localhost:5174` y, al tenerlo, su ausencia NO rompe el arranque (ver §11.4).
5. `EMAIL_OUTBOX_FILE` es sólo para el banco de pruebas. Producción no la pone.
6. **Sin cambios en `infra/Caddyfile`**: el `try_files {path} /index.html` de la PWA ya sirve
   `/valoracion/<token>`, y la llamada a la API va por `/api/*`, que ya se proxea.
7. **Sí hay `COPY` nuevo en `infra/Dockerfile`**: nace el paquete `clinica-valoracion`. Lo cantó
   `infra/test/dockerfile-manifiestos.test.ts` en la primera pasada de la suite, que es para lo que
   existe — las dos veces anteriores (escpos-builder, verifactu) se vieron en el smoke del CI
   después del merge.

### El merge con `origin/master`

`master` avanzó con `ticket-con-iva` (PR #8) y la auditoría del AP13 mientras este bloque estaba en
vuelo. **El merge entró sin un solo conflicto**, y no por suerte: los dos frentes no comparten ni un
fichero (`comm -12` entre las dos listas de cambios sale vacío). `ticket-con-iva` toca el ticket, el
carrito y el checkout; esto toca lo clínico, la agenda y el catálogo de servicios.

Las tres suites se volvieron a pasar enteras DESPUÉS del merge, no sólo antes.

### Verde (después del merge con `origin/master`)

- `pnpm test` · **288 ficheros, 3276 tests, 3 skipped.** Verde.
- `pnpm test:e2e` · **26 ficheros, 437 tests.** Verde, sobre `mipiacetpv_clinica2_e2e`.
- `pnpm e2e:agenda` · **34 passed**, sobre `mipiacetpv_clinica2_banco_e2e` y Redis propio (6395),
  incluidos los diez capítulos de la peluquería **sin tocar una línea de sus specs**.
- `tsc` de API, tpv-web, admin y e2e-ui · limpio.

### Lo nuevo de este bloque

- `packages/clinica-valoracion/test/alertas.test.ts` (28) · el cuestionario, las alertas y la
  validación.
- `packages/clinica-valoracion/test/primer-tratamiento.test.ts` (9) · la puerta de `clinica-3`.
- `clinica-valoracion-rutas.test.ts` (48) · el enlace, el email, la recepcionista y el registro.
- `clinica-valoracion-migracion.test.ts` (35) · el contrato del SQL.
- `clinica-valoracion.e2e.ts` (44) · los triggers y los CHECKs, contra Postgres.
- `specs/11-clinica-valoracion.spec.ts` (4) · el viaje entero por las pantallas de verdad.
- `infra/test/env-publicas-en-produccion.test.ts` (7) · toda `PUBLIC_*` del schema llega al
  contenedor y al ejemplo de producción (ver §11.3).

### Capturas

`docs/qa/2026-10-06-clinica-2/`, con su `README.md`: el test a 320, 390 y 1024; la pantalla final
con y sin «No lo sé»; y la del sanitario por validar, con corrección y validada, con el botón
desactivado y su motivo.

---

## 14 · Commits

```
63d1539 feat(clinica-2): el cuestionario versionado y sus funciones puras
ac7fc60 feat(clinica-2): las tablas de la valoración, y el actor «paciente por enlace»
4fe387d feat(clinica-2): la valoración en la API, el enlace y el envío del test
a35432b test(clinica-2): el enlace, el email sin salud, la recepcionista y los sabotajes
9eb33c3 feat(clinica-2): el test del paciente, la pantalla del sanitario y el aviso de la agenda
e68733d test(clinica-2): el banco con navegador, y tres fallos que encontró
491a5b0 docs(clinica-2): el bucle visual contra el mockup
afb9f73 docs(clinica-2): el done del bloque
b1ce975 docs(clinica-2): la rama queda sin pushear (el push lo bloqueó el permiso)
148af60 fix(clinica-2): PUBLIC_TPV_URL no llegaba a producción
a727205 Merge remote-tracking branch 'origin/master' into clinica-2
<este>  docs(clinica-2): el merge, el arreglo de producción y la CI
```

## 15 · La rama

**Pusheada**, y el PR contra `master` es el
[**#9**](https://github.com/matiasoyola/mipiace-tpv/pull/9).

Mergeada con `origin/master` = `906b279` (`ticket-con-iva`, PR #8, más la auditoría del AP13) **sin
un solo conflicto**, y las tres suites pasadas enteras después del merge (§13).

**CI verde** sobre el merge `a727205`, los tres jobs:
[run 37500416737](https://github.com/matiasoyola/mipiace-tpv/actions/runs/37500416737) —
`ci: success`, `smoke: success`, `e2e: success` (`publish` se salta, como toca fuera de master).

**Ni merge ni despliegue: eso lo hace Dirección.** Y al desplegar, lo único que hay que acordarse de
poner en el `.env` del VPS es `PUBLIC_TPV_URL=https://mipiacetpv.com` (§13, punto 4).

---

## 16 · Una nota de proceso: dos sesiones en el mismo árbol

A mitad del cierre apareció otra sesión de Claude Code trabajando en **este mismo worktree**, con el
mismo HEAD y el árbol limpio, preguntando de quién era qué. Paró en cuanto se lo dije y no escribió
nada; el PR #9 y el push de `b1ce975` salieron de ella.

Lo que no se puede repetir, y por qué: con dos sesiones escribiendo en un árbol, el `push` de una
se lleva por delante lo de la otra — y aquí había una migración de por medio. **Un árbol, un
escritor.** Si hacen falta dos a la vez, `git worktree add` y cada una con su base, su Redis y su
`apps/api/.env`; este árbol tiene ya los suyos (`mipiacetpv_clinica2_e2e`,
`mipiacetpv_clinica2_banco_e2e`, Redis en 6395).
