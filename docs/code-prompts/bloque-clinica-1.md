# Bloque clinica-1 · los cimientos de la historia clínica

Rama `clinica-1`, worktree `~/Developer/Claude/Projects/mipiacetpv-clinica-1`, desde `master` = `ef8f2ef` (o el que haya al lanzarlo).
Frente C del tablero (entra el 05-10-2026 en el hueco de `holded-v2`, aparcado por escrito hasta que
exista el token `pat_` de PRUEBAS). Escrito por Dirección el 05-10-2026.

Lee antes: `claude/historia-clinica-decisiones.md` (copia en este repo:
`docs/clinica/00-decisiones.md`). Es el diseño funcional entero, validado por Matías pieza a pieza.
Este bloque **no** construye ninguna pantalla clínica: construye el suelo sobre el que van todas.

## Por qué existe

Una clínica de podología quiere llevar en mipiacetpv pacientes, agenda, cobro, bonos **y la historia
clínica**, hoy en papel y archivos sueltos. Fisioterapia y podología son profesiones sanitarias: lo que
escriban es historia clínica legal (Ley 41/2002 y art. 9 RGPD). Eso obliga a cuatro cosas que hoy el
TPV no hace: la historia **no se borra**, **sólo la ve quien debe**, **queda escrito quién la abre** y
**cada línea tiene autor y fecha**. Si los cimientos no lo garantizan, cada pantalla posterior tendría
que acordarse de hacerlo, y alguna se olvidaría.

¿Y qué?: la podóloga puede contratar a una recepcionista sin que lea las historias, meter a un
podólogo que sólo pasa consulta sin darle la caja, y enseñarle a un inspector o a un paciente quién ha
abierto su historia. Mi Piace puede decir, con pruebas, que el sistema cumple.

## Lo que hay hoy (verificado el 05-10 sobre `63149b3`)

- `UserRole` = `OWNER | MANAGER | CASHIER` (`schema.prisma:19`). El `User` es el profesional de la
  agenda (ADR-R1, `StaffProfile` 1:1).
- `crm/routes.ts`: todas las rutas con `requireOwnerOrCashier`. `GET /clients/:id` devuelve
  `technicalNotes` a cualquier rol: hoy una cajera leería todo.
- `ClientConsent` y `ClientTechnicalNote` cuelgan de `Client` con `onDelete: Cascade`, y todo cuelga
  de `Tenant` en cascada.
- La agenda guarda quién atiende cada cita en `AppointmentAssignment.staffUserId`.
- La agenda se enciende por tenant con `Tenant.agendaEnabled` (ADR-R6): mismo patrón para esto.

## Decisiones de producto ya tomadas (Matías, 05-10) — no se re-debaten

1. **Tres roles visibles** para el personal de una clínica: **cajero**, **cajero-sanitario** y
   **sanitario**. El sanitario a secas ve **su agenda y las historias**, y **no toca la caja**.
2. **La dueña y el encargado** también se marcan como sanitarios o no. Una dueña no sanitaria (un
   gerente) administra el negocio y **no** ve historias.
3. Por dentro, **rol de negocio y marca sanitaria se guardan separados** (para que mañana quepa otro
   rol sin rehacer permisos). En pantalla se ven los tres nombres de arriba.
4. Cada sanitario tiene **alcance**: `todos` los pacientes o una `selección`.
5. **La selección se llena sola desde la agenda**: al asignarle una cita, ese paciente entra en su
   selección. La dueña o el encargado pueden **añadir a mano** y **revocar**.
6. Un paciente puede estar en la selección de **varios** sanitarios.
7. Al cambiar de especialista, el anterior **sigue viéndola mientras no se le revoque**. Si tras una
   revocación se le asigna una cita nueva con ese paciente, **recupera el acceso** (vuelve a
   atenderlo); la revocación queda en el histórico.
8. **Todo acceso a una historia queda registrado**, tenga alcance `todos` o `selección`.
9. **La agenda sólo enseña datos de contacto.** Nada de salud fuera de la historia.

## Alcance

### 1 · El interruptor de la clínica

`Tenant.clinicalRecordsEnabled` (booleano, `false` por defecto), mismo patrón que `agendaEnabled`.
Apagado, **nada** de este bloque se ve ni responde (las rutas clínicas dan 404, no 403: un tenant de
bar no tiene por qué saber que existen). Lo enciende el super-admin; dilo en el done si debería poder
encenderlo la dueña, pero **no** lo pongas en sus Ajustes en este bloque.

### 2 · Rol de negocio + marca sanitaria

- `User.isClinician` (booleano) y `User.clinicianLicense` (nº de colegiado, texto, opcional pero
  **exigido** al marcar a alguien como sanitario en un tenant con la clínica encendida).
- Un rol nuevo para el **sanitario sin caja**. Propuesta: `UserRole.CLINICIAN`, que implica
  `isClinician = true`. Añadir un valor al enum obliga a revisar cada `switch`/comparación de rol del
  repo: **hazlo a propósito** y lista en el done cada sitio y qué decidiste (por defecto: un
  `CLINICIAN` **no** puede nada de lo que hoy puede un `CASHIER` salvo entrar al TPV y ver su agenda).
  Si encuentras una forma mejor de que quepa sin tocar el enum, explícalo antes de tirar por ella.
- `User.clinicalScope` = `ALL | SELECTION` (por defecto `SELECTION`: lo seguro es lo restrictivo).
- **Una sola función** decide «¿puede este usuario ver la historia de este paciente?»
  (`apps/api/src/clinica/acceso.ts` o similar), pura y testeada: tenant encendido + `isClinician` +
  (`ALL` o acceso vigente). Ninguna ruta repite la regla por su cuenta.

### 3 · El acceso por paciente

Tabla `ClinicalAccess`: `clinicianUserId`, `clientId`, `source` (`APPOINTMENT | MANUAL`),
`grantedAt`, `grantedByUserId` (nulo si viene de la agenda), `revokedAt`, `revokedByUserId`.
- **No se borra nunca**: revocar rellena `revokedAt`; volver a dar acceso crea **otra fila**. Así el
  histórico dice siempre quién pudo ver qué y cuándo.
- **Desde la agenda**: cuando una asignación de cita lleva `staffUserId` de un sanitario y el tenant
  tiene la clínica encendida, se crea el acceso si no hay uno vigente, **en la misma transacción** que
  la cita. Busca el punto único donde nacen las asignaciones (alta, mover, reasignar) y engánchalo ahí,
  no en cada ruta. Mover una cita que conserva su profesional no crea filas nuevas.
- **A mano**: `POST/DELETE` para dar y revocar, sólo OWNER/MANAGER.
- **Ojo, hay otra rama viva que toca este mismo punto: `mover-con-otra`** (worktree
  `mipiacetpv-mover-con-otra`, prompt `docs/code-prompts/bloque-mover-con-otra.md`): hace que mover
  una cita pueda **cambiarla de profesional**. Para la clínica eso significa que el sanitario nuevo
  tiene que recibir el acceso al paciente en esa misma transacción. Por eso el enganche va en el
  **punto único** donde se persisten las asignaciones, no en la ruta de alta: así lo hereda cualquier
  camino que reasigne. Antes de empezar, `git fetch` y mira si `mover-con-otra` ya está en
  `origin/master`. Si lo está, rebasa y cubre su camino con un test («mover con otra sanitaria le da
  el acceso»). Si no, deja ese test escrito como pendiente con su motivo y dilo en el done, para que
  quien mergee segundo lo active.

### 4 · El registro de accesos

Tabla `ClinicalAccessLog`, **sólo inserciones** (ni `UPDATE` ni `DELETE` desde la aplicación):
`userId`, `clientId`, `action` (`READ | WRITE | EXPORT`), `at`, `deviceId` si lo hay, y el resultado
(`ALLOWED | DENIED`: los intentos denegados también se apuntan).
- Lo escribe **un único punto** por el que pasan todas las rutas clínicas (un `preHandler` o
  envoltorio), no cada handler a mano.
- Ruta para la dueña/encargado: «quién ha abierto la historia de este paciente», paginada.

### 5 · La primera pieza de historia: la anotación clínica

Para que los cimientos se prueben con algo real, y porque todo lo que viene (valoración, sesión,
fotos) se apoya en ello: `ClinicalEntry` — `clientId`, `authorUserId`, `appointmentId` (opcional),
`kind` (de momento `NOTE`), `body` (JSON), `createdAt` — y `ClinicalAddendum` — `entryId`,
`authorUserId`, `body`, `createdAt`.
- **Inmutable**: una entrada no se edita ni se borra; se le añaden anotaciones con autor y fecha.
- Rutas: listar la historia de un paciente, crear entrada, añadir anotación. Todas por la función del
  punto 2 y por el registro del punto 4.

### 6 · Lo clínico no se borra

- `ClinicalEntry`, `ClinicalAddendum`, `ClinicalAccess` y `ClinicalAccessLog` cuelgan de `Client` y
  `Tenant` con **`onDelete: Restrict`**, no `Cascade`.
- **Busca todos los caminos que borran un cliente o un tenant** (super-admin, activación del tenant que
  borra lo TEST, scripts) y haz que **se nieguen con un mensaje claro** si hay historia. Lista los
  caminos en el done.
- La ficha técnica actual (`ClientTechnicalNote`): en un tenant con la clínica encendida, **deja de
  salir** en `GET /clients/:id` para quien no sea sanitario con acceso. En el resto de tenants (Sole)
  **no cambia nada**.

### 7 · El TPV del sanitario sin caja

- Un `CLINICIAN` **entra en el TPV** igual que entra hoy un cajero (mira cómo: PIN, sesión de cajero,
  `verifyCashierSession`) y ve **sólo la agenda, con sus citas por defecto**. Ni venta, ni turno, ni
  cajón, ni informes. Si la pantalla de venta es hoy la puerta obligatoria a la agenda (la agenda es un
  overlay de `SalePage`), dilo y propón el mínimo para que no lo sea; **no** rediseñes el TPV.
- Ningún cobro puede nacer de un `CLINICIAN`: compruébalo en la API, no sólo escondiendo botones.

### 8 · La pantalla de personal

En el admin, donde hoy se da de alta y edita el personal (`StaffPage` / `CashiersPage`; mira cuál
manda), **sólo en tenants con la clínica encendida**:
- Elegir **cajero / cajero-sanitario / sanitario** (y para dueña y encargado, la casilla «es
  sanitario»). Nº de colegiado al marcar sanitario.
- **Alcance**: «Todos los pacientes» / «Sólo los suyos».
- En la ficha de un sanitario con «sólo los suyos»: su lista de pacientes (de dónde vino cada uno:
  agenda o a mano), **añadir** y **revocar**.
- Poco texto, todo a un toque (regla de Matías: «mucho clic, poco escribir» y «que todo fluya»).
  Sigue `metodologia-front-mipiace` y `sistema-visual-mipiace`; bucle de Playwright con capturas.

## Respeta

- **Sole y el resto de tenants no notan nada.** Con `clinicalRecordsEnabled = false` el
  comportamiento es idéntico al de hoy. El banco de la agenda (`pnpm e2e:agenda`) y la suite tienen
  que seguir verdes sin tocar sus specs.
- El motor de reservas (`engine.ts`) **no se toca**. El enganche del punto 3 va donde se persisten
  las asignaciones, no en el cálculo de huecos.
- Verifactu, caja y cobro no cambian (salvo la negativa del punto 7).
- Datos de salud: **nunca** en logs de aplicación, Sentry ni mensajes de error. Los `body` clínicos no
  se escriben en ningún log.

## Fuera de alcance (declarado)

- La valoración inicial y el test del paciente, el mapa del pie, la sesión, las fotos, los
  consentimientos firmados y el informe PDF: **bloques siguientes**, con su mockup antes.
- El IVA exento en Verifactu (`registro.ts` declara siempre `S1`): **bloque propio**, espera a la
  asesoría.
- La app para iPad (Capacitor iOS): bloque propio.
- Cifrado a nivel de campo, contrato de encargado, evaluación de impacto: no son código de este bloque.
- Que la dueña encienda la clínica desde Ajustes.

## Cómo se cierra

- Migración con su `down` pensado, y aplicada en una copia (no en producción).
- Tests de la función de acceso (tabla de casos: tenant apagado, no sanitario, `ALL`, `SELECTION` con
  y sin acceso, revocado, revocado y vuelto a asignar por cita, dueña no sanitaria, `CLINICIAN`).
- Tests de ruta: cajera no ve la ficha técnica en tenant clínico y sí en tenant normal; un
  `CLINICIAN` no puede abrir turno ni cobrar; cada lectura deja su línea en el registro, y la
  denegada también; borrar un tenant/cliente con historia se niega.
- **Tabla de sabotajes** (`feedback_criterio_funciona_sabotaje`): por cada garantía —no se borra,
  sólo la ve quien debe, todo acceso se apunta, inmutable, el acceso nace de la cita, el sanitario no
  cobra— qué línea de producción rompes, qué test se pone rojo y con qué mensaje real.
- CI verde (`ci`, `smoke`, `e2e`) y `pnpm e2e:agenda` verde. Recuerda el `COPY` en
  `infra/Dockerfile` si nace un paquete o manifest, y el mock literal de `catalog.js`.
- Capturas de la pantalla de personal (320 px, 390 px, escritorio, un error) en `docs/qa/`.
- `docs/blocks/clinica-1-done.md` con la estructura de la metodología: qué se hizo punto a punto,
  **los sitios del enum de roles y qué se decidió en cada uno**, los caminos de borrado y cómo se
  cerraron, decisiones tomadas sin preguntar, dudas abiertas, cómo se despliega (hay migración: dilo).
  Dice si la rama está pusheada y si hay PR.
- Commits pequeños en español, push de la rama y **PR contra `master`**. Ni merges ni despliegues:
  eso lo hace Dirección.
