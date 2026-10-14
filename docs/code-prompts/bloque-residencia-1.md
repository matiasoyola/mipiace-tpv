# Bloque residencia-1 · los cimientos de la residencia

Rama `residencia-1`, worktree `~/Developer/Claude/Projects/mipiacetpv-residencia-1`, desde `master` =
`7f74ef1` (o el que haya al lanzarlo). Vertical nueva: **residencias de mayores**, cliente cero
Jardín de Gredos. Escrito el 14-10-2026 desde el proyecto de Jardín de Gredos, con el diseño de la
Fase 0 cerrado. **Antes de abrir la rama, pasarlo por Dirección · mipiacetpv** (frente nuevo,
peldaño 4).

Lee antes: `docs/residencia/00-decisiones.md` (todas las decisiones, D-01 a D-60) y
`docs/residencia/01-modelo-datos.md` (el mapa de entidades). Lee también `docs/clinica/00-decisiones.md`
y `docs/blocks/clinica-1-done.md`: **este bloque se apoya en los cimientos clínicos y no los rehace.**
Este bloque **no** construye la pantalla de la puerta: construye el suelo sobre el que va.

## Por qué existe

Una residencia de 49 plazas registra hoy sus cuidados en papel, de memoria y al final del turno, en una
hoja que vive en la sala de terapia. AENOR lo tiene abierto como observación repetida y la Consejería
de Bienestar Social de la JCCM exige un sistema informático. La idea es una **tablet en la puerta de
cada habitación** donde el personal registra a pulsaciones, y el registro de calidad ISO 9001 sale solo
del trabajo diario. Para que eso funcione, el sistema tiene que saber primero **quién vive en qué
habitación, quién trabaja con qué rol y en qué zona, en qué turno estamos y qué tablet es qué puerta**.

¿Y qué?: la dirección da de alta a sus residentes, su plantilla y su edificio una sola vez; desde ahí,
cada registro posterior sale firmado con persona, capacidad, habitación y turno sin que nadie lo
escriba, y un residente con historia no se puede borrar por error.

## Lo que hay hoy (verificado el 14-10 sobre `7f74ef1`)

- `Client` es el paciente de la clínica, con historia (`ClinicalEntry`), accesos (`ClinicalAccess`),
  registro de accesos (`ClinicalAccessLog`), valoraciones, consentimientos, fotos y entregas de informe,
  todo con `Restrict`.
- `UserRole` = `OWNER | MANAGER | CASHIER | CLINICIAN`; `User.isClinician` y `User.clinicalScope`
  (`ALL | SELECTION`). La función única de acceso clínico vive en `apps/api/src/clinica/acceso.ts`
  (y el enganche de la agenda en `acceso-por-cita.ts`).
- Interruptores por tenant: `agendaEnabled`, `cajaEnabled`, `fichajeEnabled`, `holdedEnabled`,
  `clinicalRecordsEnabled` (éste lo mueve sólo el super-admin).
- `StaffProfile` amplía `User` 1:1: es el patrón para `ResidentProfile` sobre `Client`.
- `DeviceKind` = `TERMINAL | TEST | KITCHEN`. `Device.registerId` es **NOT NULL**. La tablet de cocina
  (kds-1) cuelga de una caja y no factura ni releva al terminal.

## Decisiones de producto ya tomadas — no se re-debaten

1. **Un interruptor nuevo `Tenant.residenciaEnabled`**, mismo patrón que `clinicalRecordsEnabled`, lo
   mueve **sólo el super-admin**. Apagado, nada de este bloque se ve ni responde (404, no 403).
   Encenderlo exige la clínica encendida (los residentes tienen historia).
2. **El residente es un `Client` con `ResidentProfile` 1:1.** No se duplica nada de la clínica.
3. **Rol de negocio y rol de cuidado son cosas distintas.** `UserRole` **no se toca**. Los roles de
   cuidado son un **catálogo de datos** con **categoría** (`OPERATIVO | SUPERVISOR | DIRECTIVO`) y la
   asignación persona-rol es **muchos a muchos con vigencia**. Una persona puede ser TO y Calidad a la vez.
4. **Las asignaciones no se borran**: revocar rellena `revokedAt`; volver a dar crea otra fila.
5. **Alcance por zona, no por cita**: cada persona tiene una o varias plantas vigentes, o todo el centro.
   DUE, médico, calidad y dirección ven todo el centro.
6. **Ocupación con vigencia**: una cama tiene como mucho un residente vigente y un residente ocupa como
   mucho una cama vigente. Cambiar de habitación cierra una ocupación y abre otra.
7. **Turnos del centro configurables**, con unos por defecto (mañana 08-15, tarde 15-22, noche 22-08).
8. **La puerta es un dispositivo `ROOM`** emparejado a una habitación: la misma APK, en «modo puerta»
   (en este bloque sólo se empareja y se identifica; la pantalla de la puerta es residencia-3).
9. **Holded es opcional** y no aparece en nada de este bloque.

## Alcance

### 1 · El interruptor

`Tenant.residenciaEnabled` (booleano, `false`). CHECK o validación: no puede estar encendido con
`clinicalRecordsEnabled` apagado. Endpoint del super-admin y casilla en su panel, junto a la de la clínica.

### 2 · El residente

`ResidentProfile` (ver `01-modelo-datos.md`): fecha de ingreso, alta (fecha y motivo), nivel de
dependencia (`VALIDO | SEMIASISTIDO | DEPENDIENTE`), grado (I/II/III, opcional), tipo de plaza
(`PRIVADA | CONCERTADA | TEMPORAL`; pagadores y vigencia de la plaza son Fase 3) y familiar responsable.
- **No se borra**: `Restrict` contra `Client` y `Tenant`. Un residente se **da de alta**, no se elimina.
  Repasa los caminos de borrado que cerró clinica-1 y comprueba que el perfil también los bloquea.
- La ficha del residente en la API pasa por la **misma función de acceso** que la historia.

### 3 · El edificio

`Floor`, `Room`, `Bed`, `BedAssignment` (ver el mapa). Índices parciales para la regla 6.
Rutas de alta y edición para OWNER/MANAGER. Dar de alta un residente sin cama está permitido
(ingreso pendiente), pero el admin lo pinta como aviso.

### 4 · Roles de cuidado y zonas

`CareRole` con semilla de serie (auxiliar, DUE, médico, TO, fisio, limpieza, cocina, calidad,
dirección, administración) y su categoría; un centro puede **desactivar** roles de serie y **añadir**
los suyos, nunca cambiar la categoría de uno de serie. `CareRoleAssignment` y `CareZoneAssignment`
con vigencia.
- Quien tiene un rol de cuidado vigente que registra (todos salvo administración) queda
  `isClinician = true` y con número de colegiado **sólo si su rol lo exige** (DUE, médico, fisio, TO).
  Explica en el done cómo encaja con el CHECK de clinica-1 y con el requisito de colegiado.

### 5 · La función de acceso, ampliada

Amplía la función única de clinica-1, **no escribas otra**: en un tenant con `residenciaEnabled`,
«¿puede este usuario ver a este residente?» = rol de cuidado vigente **y** (rol de alcance total **o**
el residente tiene una cama vigente en una planta de su zona vigente). En el resto de tenants la
función responde **exactamente igual que hoy**. Tabla de casos en los tests.

### 6 · Turnos del centro

`CenterShift` con los tres de serie al encender el interruptor. Función pura «¿en qué turno cae este
instante?» (los turnos cruzan medianoche: la noche de 22 a 08). Testeada con cambios de hora.

### 7 · El dispositivo de puerta

`DeviceKind.ROOM` + `Device.roomId`. `registerId` es hoy NOT NULL: decide entre hacerlo nullable para
los tipos que no son de caja (con CHECK por `kind`) o colgar la puerta de una caja técnica como la
cocina. **Preferencia: nullable con CHECK**, porque un tenant de residencia tiene la caja apagada.
Si el cambio es más invasivo de lo que parece (triggers `devices_revoke_previous`, índice
`devices_one_active_per_register_key`, Verifactu), explícalo antes de seguir.
- Emparejar una tablet a una habitación desde el admin, con el mismo código de 6 dígitos.
- Un `ROOM` **no abre turno, no cobra, no emite registro fiscal y no releva a nadie**: compruébalo en la
  API y en los triggers, no sólo en botones.
- La APK arranca en «modo puerta» y de momento enseña el número de habitación y quién la ocupa
  (nombre, sin un dato de salud). Nada más.

### 8 · Las pantallas del admin

Sólo con `residenciaEnabled`:
- **Residentes**: lista (habitación, cama, nivel de dependencia, tipo de plaza), alta, ficha, dar de
  alta, cambiar de habitación.
- **Edificio**: plantas → habitaciones → camas, con quién ocupa cada una y qué tablet tiene la puerta.
- **Personal**: a la pantalla de personal existente, añadir roles de cuidado (varios, con vigencia) y zona.
- **Turnos**: los del centro.
- Poco texto, todo a un toque. Sigue `metodologia-front-mipiace` y `sistema-visual-mipiace`; bucle de
  Playwright con capturas.

## Respeta

- **Ningún tenant actual nota nada.** Con `residenciaEnabled = false` todo responde igual que hoy;
  la clínica de podología, los bares y las tiendas no cambian. Suite, `e2e` y `pnpm e2e:agenda` verdes
  sin tocar sus specs.
- `UserRole` no gana valores en este bloque.
- Datos de salud y DNI/NSS: **nunca** en logs, Sentry ni mensajes de error.
- Verifactu, caja y cobro no cambian.

## Fuera de alcance (declarado)

- La pantalla de la puerta (PIN, residente, tareas, «hecho»): residencia-3, con mockup y observación de
  turno antes.
- Catálogo de controles y plan de cuidados: residencia-2.
- Eventos, incidencias, relevo, panel de dirección: residencia-4 y 5.
- Pagadores, copago y facturación de plazas: Fase 3. Medicación, escalas, `Lesión`: Fase 2.
- Que la dirección encienda la residencia desde Ajustes.

## Cómo se cierra

- Migración con su `down` pensado, aplicada en una copia.
- Tests: función de acceso (tenant apagado, sin rol, rol revocado, rol de alcance total, auxiliar con
  zona y residente dentro/fuera, residente sin cama, cambio de habitación, residente dado de alta);
  ocupación (dos residentes en una cama, un residente en dos camas → rechazado); turno de un instante
  (incluida la noche y el cambio de hora); `ROOM` no abre turno ni cobra ni factura ni releva.
- **Tabla de sabotajes**: por cada garantía —el residente no se borra, sólo lo ve quien debe, la
  asignación no se borra, una cama un residente, la puerta no factura— qué línea rompes, qué test se
  pone rojo y con qué mensaje.
- CI verde (`ci`, `smoke`, `e2e`). `COPY` en `infra/Dockerfile` si nace paquete.
- Capturas de las cuatro pantallas (320 px, 390 px, escritorio, un error) en `docs/qa/`.
- `docs/blocks/residencia-1-done.md` con la estructura de la metodología: qué se hizo punto a punto,
  la decisión del `registerId`, cómo encajan roles de cuidado e `isClinician`, decisiones tomadas sin
  preguntar, dudas abiertas, cómo se despliega (hay migración). Dice si la rama está pusheada y si hay PR.
- Commits pequeños en español, push de la rama y **PR contra `master`**. Ni merges ni despliegues.
