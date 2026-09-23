# ADR-018 · El registro de jornada es inalterable

_2026-09-23. Decide cómo se hace inalterable el registro de jornada del personal, quién puede
corregirlo y qué pasa cuando alguien olvida fichar la salida. Precede al bloque F1
(«fichar desde el móvil y cumplir la ley»)._

---

## 0. Tesis en una frase

El registro de jornada lo hace inalterable el **motor de base de datos** —no la disciplina de
la aplicación—, toda corrección legítima deja traza con **motivo y autor**, y una salida
olvidada **se pregunta**: nunca se cierra sola.

## 1. Contexto

Mi Piace abre un producto nuevo, el **control horario del personal**. Vive dentro de
mipiacetpv y a la vez se vende solo, a empresas sin caja. El cliente 0 es un **colegio de
Talavera** que tenía Holded únicamente para fichar, se le venció y desde entonces **no tiene
registro de jornada**.

Lo que la ley exige hoy, y no es negociable:

> **Art. 34.9 del Estatuto de los Trabajadores.** La empresa garantizará el registro diario de
> jornada, que deberá incluir el **horario concreto de inicio y finalización** de la jornada de
> cada persona trabajadora. Los registros se **conservarán durante cuatro años** y permanecerán
> a disposición de las personas trabajadoras, de sus representantes legales y de la
> **Inspección de Trabajo y Seguridad Social**.

Y lo que el **borrador del RD de registro digital** —sin aprobar a fecha de hoy— añade:
que el registro sea **inalterable**, que **registre cada cambio** y que se pueda **consultar en
remoto**.

Las dos primeras se pueden diseñar hoy sin atarse a nada. La tercera no: no existe formato de
API, así que el bloque se queda en exportar (PDF y CSV) y en dejar la superficie del empleado
versionada (`/fichaje/v1`) para cuando lo haya.

**Y hay un precedente en casa.** La auditoría del 2026-09-05 sobre los datos de venta
(`docs/auditorias/2026-09-05-inalterabilidad-datos-venta.md`) encontró que la premisa «nuestro
TPV por definición no permite modificar los datos» era **cierta para el cajero y falsa fuera de
la aplicación**: no había ni un trigger, ni un `REVOKE`, ni una regla en ninguna migración, y un
script de backfill había tocado doce tickets sin dejar rastro. S1 lo cerró llevando la garantía
al motor (ADR-015).

Este ADR aplica exactamente esa lección a un dato que, además, **tiene valor probatorio ante un
inspector**.

## 2. Lo que NO se decide aquí (frontera dura)

Ni la jornada teórica ni el cuadre contra ella (horas extra y déficit), ni festivos, ni
ausencias y vacaciones, ni pausas, ni ubicación, ni notificaciones push, ni la app nativa de la
fase 2, ni la consulta remota de la Inspección por API, ni la facturación del módulo. Y **nada
del camino de cobro**: los triggers de S1, la agenda y la caja se quedan exactamente como
están.

## 3. Decisión: el registro lo sella el motor, y las horas sólo se mueven por una vía

**Alternativas descartadas:**

| Alternativa | Por qué no |
|---|---|
| **Sobrescribir la hora, como Holded** | Un registro que se puede editar sin traza no es un registro de jornada. El art. 34.9 lo quiere **a disposición de la Inspección**, y el borrador del RD exige inalterabilidad y traza de cada cambio. Es, punto por punto, el agujero nº 1 que la auditoría del 05-09 encontró para la venta. |
| **Disciplina de la aplicación** (sólo rutas que se porten bien) | Ya se probó con la venta y era falso: la aplicación no es la única puerta a Postgres. Un `UPDATE time_entries SET started_at = ...` desde el VPS pasaría sin dejar rastro. |
| **Una tabla de auditoría que escribe la aplicación** | La traza y el cambio viajarían en dos escrituras distintas. Si una revienta —o si alguien se salta la primera— queda un cambio sin traza, que es el estado que este ADR existe para impedir. |

**Decisión**, copiando pieza por pieza el patrón de S1 (ADR-015 §4):

1. **`time_entry_corrections`**, append-only por trigger: valor anterior, valor nuevo, motivo
   (enum cerrado con CHECK), autor (empleado o usuario del panel), `txid` y fecha.
2. **`record_time_entry_correction(...)`**, `SECURITY DEFINER`: lee el valor anterior **del
   propio motor**, escribe la traza y **hace el UPDATE**. La traza y el cambio son la misma
   transacción **por construcción** — si una revienta, se van las dos.
3. **`time_entries_registro_guard`**, `BEFORE UPDATE`: una hora sólo cambia si existe una
   corrección **de esta misma transacción** para esa columna de esa fila
   (`mipiacetpv_time_correction_exists`, que mira `txid_current()`).
4. **`time_entries_delete_guard`** y **`employees_delete_guard`**: un fichaje no se borra, y un
   empleado con fichajes tampoco (la baja **desactiva**). Si el empleado se pudiera borrar, el
   `ON DELETE CASCADE` se llevaría los cuatro años de registro por la puerta de atrás, que es
   justo lo que los otros dos triggers impiden por la de delante.

### 3.1 Dos invariantes que garantiza la base, no el código

- **Un tramo abierto por empleado** (`time_entries_one_open_key`, índice parcial único).
- **Un móvil activo por empleado** (`employee_devices_one_active_key`, ídem).

Las dos se caen solas si se dejan a un `if` que mira antes de insertar: dos toques a la vez
desde la cola offline y hay horas contadas dos veces, o un enlace reenviado y dos móviles
vivos. Con el índice, si el código olvida revocar el anterior el `INSERT` revienta en vez de
dejar el sistema en un estado que nadie detecta.

### 3.2 Por qué el fichaje de SALIDA no exige corrección

Es la frontera y conviene que quede escrita, porque es la pregunta que se hará quien lea el
trigger.

El `INSERT` del tramo —el fichaje de entrada— no escribe ninguna fila de traza, y nadie lo echa
en falta: **la fila ES el registro**. Cerrar el tramo ocho horas después es el mismo acto,
la segunda mitad del mismo hecho. Exigir traza para la segunda mitad y no para la primera sería
una asimetría sin dueño.

La frontera es la de ADR-015: **el dato se sella cuando queda completo**, y a partir de ahí sólo
se corrige. `ended_at` de `NULL` a valor entra sin ceremonia —pero exigiendo la procedencia,
`ended_server_at` y `end_source`, para que un `UPDATE` a pelo desde psql no pase—; de valor a
otro valor exige corrección; y de valor a `NULL` está **prohibido siempre**, porque reabrir un
tramo cerrado es borrar el registro con otro nombre.

## 4. Decisión: el propio trabajador corrige lo suyo, sin circuito de aprobación

**Alternativas descartadas:**

| Alternativa | Por qué no |
|---|---|
| **Circuito de aprobación** (el empleado propone, la empresa aprueba) | Mete a un tercero en el camino de algo que el trabajador **tiene derecho** a hacer, y crea un estado «pendiente» en el que el registro no dice la verdad ni antes ni después: ni la hora vieja ni la nueva. Además, en un colegio de doce personas, la cola de aprobaciones la lleva la misma persona que ya tiene bastante. |
| **Sólo corrige la empresa** | Convierte cada olvido en un recado. El olvido de fichar la salida es el caso **más frecuente** del producto, no un caso raro. |

**Decisión:** el empleado corrige sus fichajes desde su móvil, **sin aprobación**, con motivo
obligatorio de un toque. Lo que impide que eso sea un agujero **no es un jefe que aprueba**: es
que el valor anterior no se puede borrar (§3).

**Límite:** el empleado corrige hasta **30 días atrás**; más allá, sólo la empresa. No es
desconfianza, es que a los dos meses ya nadie se acuerda, y una corrección que no se recuerda no
es una corrección. La empresa no tiene ventana: es quien puede cruzar un fichaje viejo con lo
que pasó ese día, y es a quien le piden el registro.

**Consecuencia asumida:** un trabajador puede inflar sus horas y el sistema lo dejará. Lo que el
sistema garantiza es otra cosa —que quede escrito quién lo hizo, cuándo, desde qué valor y por
qué—, y eso es exactamente lo que convierte una discusión en un documento.

## 5. Decisión: la salida olvidada se pregunta, nunca se cierra sola

**Alternativa descartada:** cerrarla automáticamente a una hora razonable (la jornada teórica,
la mediana del empleado, el cierre del centro).

**Por qué no:** inventarse una hora y firmarla como registro de jornada es **falsear un
documento con valor legal**. Da igual lo buena que sea la estimación: el registro dejaría de
decir lo que pasó para decir lo que el sistema supone.

**Decisión:** con un tramo abierto de un día anterior, lo **primero** que el empleado ve al
abrir su pantalla no es el botón: es la pregunta. Con una hora **propuesta** —la mediana de sus
salidas de los últimos 30 días— se contesta de un toque, y sin historial no se propone nada.
Se guarda como corrección con motivo `OLVIDO`, y el original sigue ahí.

Mientras nadie conteste, el tramo **sigue abierto** y la empresa lo ve marcado «sin salida» en
su pantalla de Hoy.

**Consecuencia asumida:** habrá tramos abiertos durante días, y el total del mes de esa persona
estará incompleto hasta que conteste. Es correcto: un registro incompleto que lo dice es
defendible; uno completo con horas inventadas, no.

## 6. Decisión: quien ficha es una entidad propia, y su móvil es su identidad

`User` sirve al panel y a la caja; `StaffProfile` es la agenda (quién atiende qué servicio con
qué recurso). Un **profesor** no es ninguna de las dos cosas: no entra al panel, no cobra y no
atiende citas.

**Decisión:** `Employee`, con `userId` **opcional** y **sin enlace a `StaffProfile`**. Quien
además entra al panel o atiende citas, lo hace a través del mismo `User`, por separado.

Y su móvil personal **no cuelga de una caja**. El emparejamiento de terminales del TPV pide el
código desde `/admin/registers/:registerId/pairing-codes` y todas sus rutas pasan por
`ensureCajaEnabled`; el colegio no tiene caja. Se copia el **patrón** —token de un solo uso,
hash, revocación— con tablas y rutas propias.

**Sin PIN**, a propósito: el móvil es personal y ya es la identidad. Un PIN añadiría fricción a
lo único que el empleado hace, y la palanca de seguridad real —un móvil perdido— ya existe y es
mejor: generar otro enlace revoca el anterior.

**Y el token del enlace es de alta entropía, no un código de seis dígitos** como el de los
terminales. Aquél se teclea en una tablet y vive una hora; éste viaja en una URL por WhatsApp y
vive una semana: seis dígitos serían enumerables.

## 7. Decisión: la hora que cuenta es la del toque

Colegio con sótano, obra sin señal. El fichaje se persiste en el móvil **antes** de salir a la
red (copia del outbox del TPV, v1.5-consistencia-C) y se envía al volver la conexión.

El servidor guarda **las dos**: la del toque (`*_device_at`) y la de llegada (`*_server_at`).
La que cuenta es la del toque, por vieja que sea. Si difieren más de diez minutos, el registro
queda marcado «enviado sin conexión» — **derivado de las dos columnas, no guardado como flag**,
por lo mismo que en S1 el sello se calcula y no se confía: un flag puede desincronizarse de lo
que lo justifica.

Lo único que se acota es el **futuro**: un reloj adelantado no puede crear un tramo que todavía
no ha pasado.

## 8. Consecuencias

**Se gana:**

- Un registro de jornada que un inspector puede leer y un trabajador puede firmar, con la
  garantía en el motor y no en la buena conducta del código.
- El colegio de Talavera deja de estar sin registro de jornada, y lo hace sin caja, sin Holded
  y sin app nueva.
- La misma frontera de S1 aplicada a un segundo dominio: cuando llegue el tercero, el patrón ya
  está escrito dos veces.

**Se paga:**

- Cualquier código futuro que intente un `UPDATE` sobre `started_at` o `ended_at` **fallará en
  producción, no en revisión**. Los tests tienen que cubrir esa frontera (la misma consecuencia
  que ADR-015 §6).
- La vía de corrección es una puerta: si se usa a la ligera, la garantía vale lo que valga la
  disciplina de quien la abre. Por eso el motivo es obligatorio **en la base** y el historial es
  visible desde las dos pantallas.
- Tramos abiertos durante días mientras alguien no conteste (§5), y totales de mes incompletos
  mientras tanto.
- Una migración con cinco tablas, cuatro triggers y una función `SECURITY DEFINER` que nadie
  debería tocar sin leer esto antes.

**Queda fuera y hará falta:** la jornada teórica y el cuadre contra ella. Sin eso, «quién no ha
fichado hoy» significa «no ha aparecido», no «falta al trabajo», y el producto no puede decir si
alguien hizo horas de más. Es F2, no un fallo de éste.

## 9. Referencias

- `docs/design/adr-015-sello-de-la-venta.md` — el patrón que se copia entero.
- `docs/design/adr-016-la-caja-es-un-modulo.md` §7 — el flag del módulo que este bloque trae, y
  que allí quedó nombrado como lo único que faltaba para el colegio.
- `docs/auditorias/2026-09-05-inalterabilidad-datos-venta.md` — la auditoría que enseñó que la
  disciplina de la aplicación no basta.
- `docs/blocks/fichaje-1-plan.md` — el inventario medido y la forma final del dato.
- `docs/blocks/fichaje-1-done.md` — decisiones del bloque, tabla de sabotaje y qué no cubre la
  suite.
