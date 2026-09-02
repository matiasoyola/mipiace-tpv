# Bloque Reservas-10 · Importación y adaptador desde Koibox

> El bloque que permite que un centro **que hoy vive en Koibox** se mude aquí sin perder su agenda ni
> su histórico. Hoy no existe nada: en `apps/` el único `grep -i koibox` que casa es **un comentario**
> (`apps/api/src/agenda/engine.ts:62`, *«idéntica firma que expondrá KoiboxAdapter»*); lo demás son
> cabeceras de migración, que se llaman así por el nombre interno del bloque. La única referencia de
> diseño viva es el §7 de `docs/design/agenda-belleza-spec.md`, que es un boceto de mapeo **con las
> rutas equivocadas** — y este bloque lo corrige.
>
> **Es el último de la serie a propósito:** sólo hace falta el día que entre un centro que viene de
> Koibox, y es el único que depende de una API de terceros **sin entorno de pruebas**.
>
> Rama propia en worktree. Sin push.

## Contexto (leer antes)

- **`docs/reservas/01-cruce-con-b-reservas-4.md`** — §H6 (el hueco) y **D-10** (la fe de erratas que
  este bloque tiene que aplicar).
- **`docs/reservas/00-koibox-ingenieria-inversa-y-modelo.md`, Partes 1, 9 y 10** — dos meses de
  ingeniería inversa contra una cuenta real. **Leer con las marcas delante:**
  - **[M]** medido y **[D]** documentado por ellos → se puede construir encima.
  - **[H]** hipótesis **sin verificar** → **no se convierte en código**. En particular **el §1.8
    entero (su esquema de BD inferido) es [H]**: sirve para entender por qué su producto tiene los
    defectos que tiene, **no para construir sobre ello**.
  - Su **Parte 6** («lo que sigue sin saberse») y su **§10.3** (K1-K5) son la lista de lo que hay que
    verificar **antes** de codificar cada pieza que dependa de ello.
- **Su Parte 9** — `rt-booking`, la única implementación viva del contrato de reservas, probada
  contra Koibox de verdad. **El adaptador de aquí se parece a ese**, y sus mecanismos se heredan.
- `docs/design/agenda-belleza-spec.md` §7 — el mapeo **a corregir**.
- `docs/design/adr-r8-motor-reservas-agnostico.md` §4 — la interfaz `BookingEngine` de casa, que es la
  que el adaptador tiene que satisfacer.

## Alcance

### 1. Fe de erratas de nuestro propio §7 (primero, y es media hora)

`docs/design/agenda-belleza-spec.md` §7 documenta rutas que **no existen**. Se corrige con lo medido:

| Lo que dice nuestro §7 | Lo real |
|---|---|
| `GET /horas-disponibles` | `GET /api/agenda/horas-disponibles/` |
| `POST /citas` | `POST /api/agenda/` |
| `PATCH /citas/:id` para cancelar | **Cambiar a estado 3** («Anulada por centro») **reenviando `hora_fin`** aunque no cambie |
| (implícito) que hay `DELETE` | **`DELETE` devuelve 405.** No se borran citas, y tienen razón: la cita es historial y contabilidad |
| `GET /servicios` | Correcto, pero la doc **en inglés** (`/api/services`, `/api/blocks`) son etiquetas traducidas que **[H]** casi seguro no existen. No usarlas |

### 2. Importación de un centro · el sentido único que sí se puede hacer hoy

Un comando/endpoint de importación, **idempotente y repetible**, que trae desde una cuenta Koibox:

- **Clientes** → `Client`. **Matcher exacto sobre email/teléfono**, nunca por subcadena: su filtro es
  `icontains` y un matcher ingenuo colgaría **todas** las reservas de la primera clienta parecida.
  Es un fallo medido, no hipotético.
- **Servicios** → propuesta de `ServiceScheduling` sobre el catálogo de Holded. ⚠️ **La duración que
  trae Koibox lleva la recogida dentro** (convención medida: 41 de 45 variantes a +10 min sobre la
  carta). El importador **propone** `durationMin` + `bufferAfterMin` separados y **pide confirmación**;
  no parte el número solo.
- **La matriz servicio × profesional** (`servicio.users`) → `StaffSkill`. **Es el inventario, y es lo
  más valioso que trae la importación.** ⚠️ En la cuenta medida estaba vacía en 44 de 45 servicios: el
  importador **dice cuántas casillas ha traído y cuántas faltan**, y esa cifra alimenta la tarjeta nº 1
  del panel de salud (B-reservas-9).
- **Horarios de empleada** → `bookable_window` (**no** `StaffShift`): lo que Koibox llama horario **es
  una ventana de disponibilidad, no un turno contratado** (§1.5, medido). Importarlo como turno
  metería en el sistema el mismo dato falso que allí sostiene un 34 % de ocupación irreal.
- **Festivos y bloqueos** → `center_holidays` y `BookingBlock`.
- **Citas** (histórico y futuras) → `Appointment` + items + assignments, con `externalId` = el id de
  Koibox. **Aquí es donde el GiST va a rechazar filas**: una agenda ajena tendrá solapes que aquí son
  imposibles. Ver §4.
- **Bonos: no se pueden importar por API.** No existen en su API (verificado por barrido de
  documentación **y** por sondeo de 13 rutas, todas 404, con tres controles que hacen que ese 404
  signifique algo). Se importan **por hoja**, o no se importan. El importador lo dice en la cara.

**Informe de importación obligatorio**: qué entró, qué se rechazó y **por qué**, fila a fila,
descargable. Una importación que no se puede auditar no se puede repetir.

### 3. `KoiboxAdapter` de sólo lectura (fase de convivencia)

Una implementación de `BookingEngine` contra su API, **con `book()` en `dry_run` por defecto**. Hereda
tal cual los mecanismos ya probados en `rt-booking` (su §9.3), que no son opcionales:

| Mecanismo | Por qué |
|---|---|
| **Candado de escritura** por constante de entorno, sin casilla en la interfaz | **No tienen sandbox: se opera sobre la agenda real de un negocio vivo.** El candado se abre a mano y a propósito |
| **Escritura anticipada + clave de idempotencia UNIQUE** | Un timeout deja una fila recuperable, no una cita duplicada |
| **Caché + tope por minuto + copia tibia** | Su límite es **de frecuencia y sin cifras publicadas**, y se reservan el derecho a cortar el acceso |
| **Reconfirmación en modo fresco antes de escribir** | El hueco pudo irse mientras la clienta rellenaba el formulario |
| **Matcher exacto encima de su `icontains`** | Ver §2 |
| **Catálogo de errores propio** | Cada código es un estado que el front ya sabe pintar. Se hereda |
| **Un parámetro suyo desconocido se ignora en silencio** | Nunca se asume que un filtro ha filtrado: se verifica el resultado |

**Y una trampa que cuesta una ficha de clienta:** en su API, `notas` **no es un campo de la cita**: es
un alias de las **notas de la ficha del cliente** (probado: vaciar el `notas` del cliente vació el de
la cita). La nota de la cita va en `observaciones`. **Guardarraíl en el smoke que se cae si `notas`
aparece en cualquier payload nuestro.** Ya nos pasó una vez.

### 4. Espejo local y convivencia

Mientras convivan los dos sistemas hay que decidir **quién manda en cada cita**, y sin webhooks
entrantes la convivencia **se desincroniza sola**. Por eso el espejo local no es opcional:

- Tabla de mapeo `externalId ↔ appointment.id` (la columna ya existe, `schema.prisma:1904`).
- **Reconciliación** repetible: qué cita cambió allí, qué cambió aquí, qué está en conflicto. Se
  **muestra**, no se resuelve sola.
- **Los solapes que el GiST rechace se listan como conflicto de importación**, con la fila exacta y
  las dos citas implicadas, para que una persona decida. **No se relaja la restricción para que
  entren.** El anti-solape no se negocia por una importación.

### 5. Antes de codificar: las sondas de lectura

Su §10.3 y §1.8.5 dejan cinco incógnitas abiertas (K1-K5) y cuatro sondas **de sólo lectura** que las
cierran casi todas — empezando por `OPTIONS` sobre cada colección, que puede devolver el esquema de
campos casi entero. **Ninguna se ha lanzado todavía.**

⚠️ **Se lanzan desde el Mac de Matías**: `api.koibox.cloud` no es alcanzable ni desde el contenedor ni
desde el shell del ordenador. **Este bloque no se abre hasta tener sus resultados**, porque la mitad
de lo que hay que mapear hoy es `[H]`.

## Restricciones

- **Nada marcado `[H]` se convierte en código.** Si una pieza del mapeo depende de una hipótesis sin
  verificar, se lanza la sonda o se deja fuera con su nota. **El §1.8 completo es [H].**
- **Sólo lectura por defecto.** `book()` en `dry_run`; la escritura contra la agenda real de un
  negocio vivo se abre a mano, nunca por configuración de la interfaz.
- **El núcleo no se toca.** Koibox es **un adaptador más detrás de `BookingEngine`** (ADR-F6 del
  documento de entrada, que aquí ya está construido así). Cero `if (koibox)` en el motor, en las rutas
  o en el front.
- **El anti-solape no se relaja** para que entren datos ajenos (ADR-R4).
- **NO se toca el camino de cobro a Holded** (ADR-010).
- **La importación es idempotente y repetible**: correrla dos veces no duplica nada.
- **Cero datos personales en logs.** Se importan fichas de clientas reales de un negocio ajeno: RGPD
  aplica desde la primera línea.
- Multi-tenant por fila; una importación es **siempre** contra un tenant concreto y explícito.
- **No commit en el worktree principal.** `git worktree list` antes de la primera línea. No push.

## Entregables

- `docs/design/agenda-belleza-spec.md` §7 **corregido** (fe de erratas de §1).
- `apps/api/src/integrations/koibox/` — cliente con candado, caché, tope por minuto y catálogo de
  errores; `KoiboxAdapter` implementando `BookingEngine` en modo lectura.
- Importador con informe auditable y modo simulación (`--dry-run` que no escribe nada).
- Espejo + reconciliación + listado de conflictos.
- **Tests**: el importador es idempotente · el matcher exacto **no** cuelga una reserva de una clienta
  parecida · una cita importada que solapa **se lista como conflicto y no entra** · el candado impide
  cualquier escritura sin la constante · el smoke **se cae si `notas` aparece en un payload** · el
  adaptador satisface la interfaz `BookingEngine` sin tocar el motor.
- **Criterio de "funciona"**: contra una cuenta de pruebas, `--dry-run` produce el informe completo
  (clientes, servicios, matriz, ventanas, festivos, citas) **sin escribir una sola fila**; al
  ejecutarlo de verdad, la agenda del centro se ve aquí con sus profesionales y sus citas; correrlo
  otra vez **no duplica nada**; y las citas que solapan aparecen en la lista de conflictos, no en la
  agenda.
- **Tabla sabotaje → test rojo** en el cierre.
- `docs/blocks/B-reservas-10-done.md` con la plantilla de la metodología.

## Fuera de alcance (explícito)

- **Sincronización bidireccional continua.** Este bloque importa y, como mucho, lee. Escribir en su
  agenda desde aquí de forma sostenida es otro bloque y otra conversación.
- **Importación de bonos por API** — no existen en su API. Por hoja, o no.
- **Los cinco huecos de negocio y de datos** (F1, F2, D1, D3, D6 de su Parte 10): son una reunión con
  el centro, no código.
- **Migrar el histórico de ventas y la contabilidad**: la agenda no cobra (ADR-010; la frontera es
  sana y aquí es literal).
- **Las reglas de yield, la ventana reservable, el saldo y el panel** — B-reservas-6/7/8/9. Este
  bloque **rellena** sus tablas; no implementa su lógica.
- **Un adaptador genérico "multi-CRM"**: se escribe **uno**, contra el CRM que tenemos delante. La
  abstracción llega con el segundo, no con el primero.

---

*Lanzar como los bloques previos: implementar respetando alcance/restricciones/fuera-de-alcance,
escribir el `-done.md`, no commit/push. Commit selectivo después (stage → revisar → commit), NUNCA
`git add -A`.*
