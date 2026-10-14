# Bloque residencia-1 · done

Rama `residencia-1`, worktree `~/Developer/Claude/Projects/mipiacetpv-residencia-1`, desde
`master` = `3c15954` (el cierre de la Fase 0). Ocho commits, 52 ficheros, +12.300 / −50.

**Este bloque no construye la pantalla de la puerta.** Construye el suelo sobre el que va: quién vive
en qué habitación, quién trabaja con qué rol y en qué zona, en qué turno estamos y qué tablet es qué
puerta. La pantalla donde el personal registra a pulsaciones es residencia-3, y antes van un mockup y
la observación de un turno real.

---

## 1 · El interruptor de la residencia

`Tenant.residenciaEnabled`, booleano, `@default(false)`. Mismo patrón que `clinicalRecordsEnabled`
(clinica-1), `fichajeEnabled` (ADR-018) y `kitchenDisplayEnabled` (kds-1), y mismo gobierno: **lo
mueve sólo el super-admin**, por `PATCH /super-admin/tenants/:id`.

### Las rutas de residencia dan 404, no 403

`residencia/gate.ts::ensureResidenciaEnabled` reutiliza `respondeComoRutaInexistente` de la clínica
en vez de escribir una segunda copia de ese cuerpo — que es la forma de que las dos se separen. La
razón es la misma que allí y el dato es el mismo: un 403 «no tienes el módulo de residencia» le dice
a un bar que este sistema guarda quién vive en qué habitación y qué le pasa.

La lectura **falla hacia APAGADO**, como la de la clínica: la columna nace en `false`.

### No se puede encender sin la clínica, y lo dice el motor

El residente es un `Client` con historia (D-49): su ficha pasa por la misma función de acceso que la
historia clínica, y el registro de la puerta será historia clínica. Un tenant con
`residencia_enabled` y `clinical_records_enabled = false` sería un módulo cuyo dato central no se
puede ni leer.

Así que hay **dos** guardas y no una:

- el **CHECK** `tenants_residencia_exige_clinica` en la base, porque hay más de una puerta de
  escritura y la segunda es el `psql` de una implantación a las nueve de la noche;
- el **409** `RESIDENCIA_NEEDS_CLINICA` en la ruta, para que el super-admin lea una frase en vez de
  un 500 de constraint.

Y en el otro sentido: **apagarlo con residentes dentro, no** (409 `RESIDENCIA_HAS_RESIDENTS` con el
recuento). Mismo criterio exacto que `CLINICAL_RECORDS_HAS_HISTORY`: apagar es dejar de servir las
rutas, y los residentes se quedarían en la base con su historia, que hay que conservar cinco años y
poder enseñar.

### Encenderlo SIEMBRA el centro

En la misma transacción que el `update` y la línea de auditoría: los **diez roles de cuidado de
serie** y los **tres turnos** (`residencia/semilla.ts`). Sin esa semilla, un centro recién encendido
es un centro donde **la función de acceso dice «no» a todo el mundo** —exige rol de cuidado
vigente— y la dirección llamaría el primer día diciendo que el producto está roto.

Idempotente: `skipDuplicates` sobre `(tenantId, code)`. Apagar y volver a encender no duplica nada y
**no resucita lo que el centro desactivó**.

### Y una casilla en el panel del super-admin · con la de la clínica, que no existía

El prompt pide la casilla «junto a la de la clínica». La de la clínica no existía: clinica-1 §13 lo
dejó declarado («no hay pantalla de super-admin para el interruptor, se mueve por API»). Entran las
dos, en su propia caja («Datos de salud»), con un `confirm` que dice las consecuencias —encenderlas
hace a Mi Piace encargado de tratamiento— y no un «¿seguro?».

### El bug que esto destapó, y por qué nadie lo había visto

**`clinicalRecordsEnabled` no estaba declarado en el body schema del PATCH del super-admin.** El
handler lo trataba desde clinica-1, con sus dos guardas y su audit, y el done de ese bloque lo
documenta como la única forma de encender la historia clínica.

Lo que pasaba **no era un 400**. Fastify configura ajv con `removeAdditional: true` por defecto, así
que `additionalProperties: false` **borra** la propiedad en vez de quejarse: el PATCH contestaba
**200 `{noChanges: true}`** y no encendía nada. Un 400 se habría visto el primer día; un 200 que no
hace nada se lee como «ya estaba encendido».

No se vio en tres bloques porque ningún test la manda por HTTP —los de la clínica construyen el
tenant con la columna ya puesta— y porque no había pantalla que la mandase. La encontró este bloque
al necesitarla. Queda arreglada y con dos tests: que ahora se acepta, y que una propiedad
desconocida se tira en silencio (para que nadie vuelva a dar por hecho que este PATCH se queja).

---

## 2 · El residente

`ResidentProfile`, ampliación **1:1** de `Client` (D-49). La PK es el propio `clientId`: el perfil ES
el cliente visto como residente, igual que `StaffProfile` sobre `User` (ADR-R1). De ahí hereda gratis
la historia, los accesos, el registro de accesos, los consentimientos, las fotos y los informes — sin
duplicar una sola tabla de la clínica.

Columnas: fecha de ingreso, alta (fecha y motivo), nivel de dependencia, grado de la Ley 39/2006
(opcional), tipo de plaza, familiar responsable (nombre, teléfono, parentesco) y DNI/NSS.

**Nivel y grado son dos columnas y no una** a propósito: el nivel lo decide el centro para organizar
el trabajo y de él sale el plan de cuidados por defecto de residencia-2; el grado lo reconoce la
administración y puede no tenerse.

### Un residente no se borra

Las dos FKs son **`RESTRICT`**, y ésa es la diferencia con `staff_profiles` (que es `Cascade` a las
dos). Lo mismo `bed_assignments`, con RESTRICT a las tres: tenant, cama y residente.

Se repasaron los caminos de borrado que cerró clinica-1 §9, uno por uno:

| Camino | Qué pasa ahora |
| ------ | -------------- |
| `DELETE /clients/:id` | **Sigue sin existir.** El día que se escriba, `resident_profiles_client_id_fkey` lo impide. |
| Borrado de tenant | **Sigue sin existir.** `resident_profiles_tenant_id_fkey` lo impide. |
| `purgeTestData` | No toca clientes. Sin cambios. |
| `DELETE /cashiers/:id` | Soft-delete. Y ahora además `care_role_assignments_user_id_fkey` impediría el duro: la asignación es la capacidad con la que esa persona firmó. |
| `DELETE /staff/:userId` | Quita perfil de agenda, skills y turnos. **No toca roles de cuidado ni zonas**, igual que no tocaba lo clínico. |
| Quitar el perfil a mano (`DELETE FROM resident_profiles`) | Se puede, y **no abre el borrado del residente**: la ocupación lo sigue impidiendo. Tiene su caso en el e2e. |

Y la ruta de salida es **dar de alta**, no borrar: `dischargeDate` + `dischargeReason`, y en la misma
transacción se cierra su ocupación. Si no se cerrara, su cama seguiría ocupada por alguien que ya no
vive aquí y el índice parcial no dejaría meter al siguiente — que es la forma en que esto se habría
descubierto, con una familia esperando en la puerta.

### La ficha pasa por la MISMA función de acceso que la historia

`GET /residencia/residentes/:clientId` va envuelto en `conHistoria` y deja su línea en
`clinical_access_log`, con `action = READ`; el PATCH y los dos POST, con `WRITE`.

**La LISTA no.** Tres razones, en orden de peso:

1. Lo que devuelve no es historia: nombre, habitación, nivel de dependencia y tipo de plaza es el
   cuadrante del centro, lo mismo que hoy está impreso y colgado en el office. La historia es lo que
   hay DENTRO de la ficha.
2. Apuntar una línea por residente y por apertura llenaría el registro de lo que NO es un acceso a
   una historia, y eso lo hace **menos** útil — que es el daño real. Es, literal, la decisión 1 de
   clinica-1 sobre `GET /clients/:id`.
3. 49 residentes son 49 resoluciones de acceso y 49 inserciones por apertura.

Lo que la lista SÍ hace es **filtrar por la zona de quien mira**, resuelto una vez (no 49) y con la
misma regla que la función de acceso — porque si saliera de otro sitio, la lista enseñaría a alguien
que la ficha luego niega, que es la peor de las dos incoherencias posibles.

**DNI y NSS sólo en la ficha de uno.** La lista se enseña en una pantalla que mira cualquiera que
pase por el despacho. Tiene su test, y mira el payload crudo.

---

## 3 · El edificio

`Floor` → `Room` → `Bed` → `BedAssignment`.

- `rooms.number` es TEXTO y único **por centro**, no por planta: en Jardín de Gredos hay «112» y hay
  «112 bis», y el personal dice «la 112», no «la 112 de la primera».
- `beds` lleva `tenant_id` redundante por la regla de aislamiento por fila de la casa (misma decisión
  que `staff_skills`).
- Dar de alta un residente **sin cama está permitido** (ingreso pendiente) y el admin lo pinta como
  aviso ámbar, no como error: es lo normal el día antes de que llegue alguien, y lo que no puede es
  pasar desapercibido.

### La regla 6, en dos índices parciales

```sql
CREATE UNIQUE INDEX "bed_assignments_one_live_per_bed_key"
    ON "bed_assignments"("bed_id")    WHERE "to_at" IS NULL;
CREATE UNIQUE INDEX "bed_assignments_one_live_per_client_key"
    ON "bed_assignments"("client_id") WHERE "to_at" IS NULL;
```

De ahí salen las dos mitades sin un solo `if`: una cama tiene como mucho un residente vigente y un
residente ocupa como mucho una cama vigente. Y el **histórico cabe**: doña Carmen puede tener cinco
filas cerradas en cinco camas distintas, porque ninguna está en el índice. Con un índice total eso no
sería «menos correcto»: sería imposible — es la misma lección que `clinical_access_one_live_key` en
clinica-1, donde Postgres se negó a crear la versión no parcial.

**Cambiar de habitación cierra una ocupación y abre otra**, en la misma transacción y en ese orden.
Si el `UPDATE` no corriera, el `INSERT` revienta contra el índice en vez de dejar a la señora en dos
camas. La fila vieja **no se edita**: «¿dónde dormía doña Carmen en marzo?» es una pregunta que una
residencia tiene que poder contestar, a una familia, a la Consejería o a un juzgado.

---

## 4 · Roles de cuidado y zonas

### Catálogo de DATOS, por tenant

`UserRole` no gana ni un valor en este bloque, y ése es el 80 % del porqué de `CareRole`: hay ~60
rutas de caja que comparan `UserRole`, y añadirle un valor obliga a repasarlas una por una (clinica-1
§3 lo hizo, veinte sitios). Una residencia que invente «fisio de tarde» no puede costar eso.

**`tenantId` es NOT NULL** y la semilla es por centro, aunque el mapa de datos lo dejaba abierto
(`tenantId?`). Con un catálogo global harían falta dos tablas —el catálogo y una de excepciones por
centro— y toda consulta de roles pasaría a ser una unión con un `NOT EXISTS`. Lo que se pierde:
distribuir un rol de serie nuevo a los centros existentes deja de ser un INSERT y pasa a ser un
backfill. Se acepta: es una vez al año como mucho (D-57) y lo resuelve un script. Lo que no se puede
permitir es que «¿tiene rol de cuidado vigente?» —que corre en cada apertura de ficha, 49 veces por
turno— sea una unión.

### Los diez de serie, y los tres flags de los que cuelga el acceso

| Código | Categoría | Registra | Colegiado | Alcance total |
| ------ | --------- | -------- | --------- | ------------- |
| `AUXILIAR` | OPERATIVO | sí | — | — |
| `DUE` | SUPERVISOR | sí | **sí** | **sí** |
| `MEDICO` | SUPERVISOR | sí | **sí** | **sí** |
| `TO` | OPERATIVO | sí | **sí** | — |
| `FISIO` | OPERATIVO | sí | **sí** | — |
| `LIMPIEZA` | OPERATIVO | sí | — | — |
| `COCINA` | OPERATIVO | sí | — | — |
| `CALIDAD` | SUPERVISOR | sí | — | **sí** |
| `DIRECCION` | **DIRECTIVO** | sí | — | **sí** |
| `ADMINISTRACION` | OPERATIVO | **no** | — | — |

«Todos salvo administración» registran, que es lo que el prompt pide y lo que pasa de verdad: la
limpiadora y la cocinera apuntan («habitación hecha», «comió la mitad») y la administrativa no entra
en las habitaciones.

### Un rol de serie no cambia de categoría, y lo impide el motor

Trigger `care_roles_de_serie_son_fijos`. De uno de serie se puede cambiar el **nombre** (que un
centro llame «gerocultora» a la auxiliar es suyo), el **orden** y el **interruptor activo**. No la
categoría, ni el código, ni los tres flags, ni la propia marca de «de serie». Y no se borra: se
desactiva.

Por qué tan duro: de la categoría cuelga quién cierra una incidencia en residencia-4 (D-27: el cierre
es de categoría directiva, y los N3/N4 exigen además una persona distinta de quien registró). Si un
centro pudiera bajar «dirección» a OPERATIVO, el cierre dejaría de significar lo que la norma dice
que significa **y nadie lo notaría hasta la auditoría**.

### Las asignaciones no se borran

`CareRoleAssignment`, índice parcial `WHERE revoked_at IS NULL` — copia literal del criterio de
`ClinicalAccess`. Revocar rellena `revokedAt`; volver a dar crea otra fila. Y una persona puede
llevar **dos roles a la vez** (TO y Calidad, decisión de producto 3).

### La zona necesita DOS índices parciales, no uno

```sql
CREATE UNIQUE INDEX "care_zone_assignments_one_live_per_floor_key"
    ON "care_zone_assignments"("user_id", "floor_id") WHERE "to_at" IS NULL;
CREATE UNIQUE INDEX "care_zone_assignments_one_live_centro_key"
    ON "care_zone_assignments"("user_id")
    WHERE "to_at" IS NULL AND "floor_id" IS NULL;
```

El primero cubre «esta persona, esta planta». El segundo cubre «todo el centro», y hace falta porque
**en Postgres los NULL son distintos entre sí**: con sólo el primero, cinco filas de «todo el centro»
para la misma persona serían cinco claves distintas y las cinco entrarían. Mismo caso exacto que
`ticket_allergies_mesa_key` en kds-1. Los dos tienen su sabotaje en el e2e.

---

## 4b · Cómo encaja el rol de cuidado con `isClinician` (y con el CHECK de clinica-1)

Lo pide el prompt explícitamente, así que va aparte.

**Dar un rol de cuidado que REGISTRA enciende `User.isClinician`.** La razón es física: en una
residencia, la auxiliar que apunta que doña Carmen no ha comido está escribiendo en su historia
(D-51). Sin la marca, la función de acceso contesta «no es sanitario» antes de mirar el rol de
cuidado, y la plantilla entera se quedaría fuera.

**El número de colegiado se exige sólo si el rol lo exige** (DUE, médico, fisio y TO). La auxiliar y
la limpiadora registran y no tienen colegio profesional: pedírselo habría dejado a media plantilla
sin poder entrar en la puerta, que es justo para quien se construye. La regla cruza `care_roles` y
`users`, así que no cabe en un CHECK y vive en la API — igual que el requisito de colegiado de
clinica-1 cruzaba `users` y `tenants`.

**Lo que NO se toca es el rol de negocio.** `User.role` no cambia ni aquí ni en ningún sitio de este
bloque. Una auxiliar puede ser `CASHIER` (si el centro tiene cafetería) o `CLINICIAN`, y esta ruta no
opina.

**Y revocar un rol de cuidado NO apaga la marca.** Tres razones, y la tercera es la del CHECK:

1. **No haría falta.** La función de acceso exige rol de cuidado VIGENTE en un tenant de residencia,
   así que sin rol no ve a nadie: la marca encendida no le abre nada.
2. **Rompería el centro mixto.** Si la DUE es además la podóloga que pasa consulta los viernes,
   apagarle la marca al quitarle el rol de cuidado le quitaría sus pacientes de la clínica, que es
   otra vertical.
3. **Chocaría con `users_clinician_implies_flag`.** `role = CLINICIAN` implica `is_clinician` por
   CHECK de la base desde clinica-1: apagar la marca a un `CLINICIAN` sería un 500 de constraint en
   una ruta de revocar un rol. Y poner un `if` por el rol de negocio aquí sería meter `UserRole`
   dentro de la residencia, que es exactamente lo que D-50 saca.

Dicho en una línea: **el rol de cuidado enciende la marca y no la apaga.** Quien quiera apagarla lo
hace donde se decide quién ve datos de salud, que es `PATCH /staff/:userId/clinica`.

Y el CHECK no se toca ni se amplía: este bloque sólo ENCIENDE la marca, y encenderla nunca lleva al
estado que el CHECK prohíbe («lleva el rol del sanitario y la marca apagada»).

---

## 5 · La función de acceso, ampliada

**Se amplía LA función de clinica-1. No se escribe otra.** Con dos, cada pantalla de residencia
tendría que acordarse de cuál le toca, y la de la puerta —que tendrá quince tablets abiertas a la
vez— se equivocaría una vez y no volvería a notarse.

```
clínica encendida? → es sanitario? → ¿alcanza?
                                      ├── residencia: rol de cuidado vigente
                                      │   Y (alcance total O residente en mi zona)
                                      └── resto: ALL, o acceso vigente
```

La rama de residencia va **después** de las dos condiciones compartidas, y las dos razones importan:

- la del módulo, porque en una residencia la clínica está encendida por obligación (el CHECK), así
  que esa pregunta nunca cambia de respuesta por ser residencia;
- la de la marca sanitaria, porque si fuera antes, un rol de cuidado abriría la historia con la marca
  quitada a mano y la marca dejaría de significar nada.

Y **sustituye** al alcance de la clínica, no se suma: `clinicalScope` nace en `SELECTION` y en una
residencia nadie llena `ClinicalAccess`, así que sumarlas habría dejado a la plantilla entera sin ver
a nadie.

### En el resto de tenants contesta EXACTAMENTE lo que contestaba

El campo `residencia` del estado llega `null` y la rama no se mira. Es opcional en el tipo
(`residencia?: EstadoResidencia | null`) a propósito: todo el código que ya construía un
`EstadoClinico` —y los dobles de Prisma de la suite de la clínica— sigue compilando sin tocar una
línea, y un olvido cae del lado de «no es residencia», que es el lado que no cambia nada.

### Y no cuesta nada a los quince clientes de hoy

- `resolverAccesoClinico` pide **una columna más en un `select` que ya hacía**. No es una consulta
  nueva.
- La rama de residencia sólo se lee con el módulo encendido **y** siendo sanitario.
- Sin rol de cuidado no se piden la zona ni la cama; con alcance total no se pide la cama; sin zona
  tampoco.
- Y en una residencia **`ClinicalAccess` no se consulta nunca**: la tabla está vacía y preguntarle
  serían 49 idas a la base por turno.

Todo eso tiene su test con contador de llamadas.

### Dos motivos nuevos, y son dos porque se arreglan en sitios distintos

`SIN_ROL_DE_CUIDADO` se arregla en Personal (dale un rol). `RESIDENTE_FUERA_DE_TU_ZONA` se arregla en
Personal también pero en otra línea (dale la planta) o en Edificio (ponle cama al residente). Un
único «no puedes» habría dejado a la encargada probando.

Los dos contestan **403**, como `SIN_ACCESO_AL_PACIENTE`: el residente existe y es de este centro, lo
que falta es el permiso. El `Record<MotivoDenegado, number>` de `registro.ts` es exhaustivo, así que
el typecheck obligó a venir a decidir su HTTP — que es exactamente lo que se quiere.

### La tabla de casos

Los nueve que el prompt pide, uno por `it` con nombre, en `residencia-acceso.test.ts`: tenant
apagado, sin rol, rol revocado, rol de alcance total, auxiliar con zona y residente dentro, auxiliar
con zona y residente fuera, residente sin cama, cambio de habitación, residente dado de alta. Más la
marca sanitaria, más los mensajes, más la economía de consultas.

**Residente sin cama → no lo ve la auxiliar y sí la DUE**, y es correcto: a un ingreso pendiente lo
ve dirección o la DUE —que son quienes le van a asignar la habitación— y no la auxiliar de una planta
en la que todavía no está. Lo mismo tras darle de alta: su ocupación se cierra, sale de la zona de
todos, y lo siguen viendo los de alcance total — que tienen que poder, porque su historia se conserva
cinco años.

---

## 6 · Los turnos del centro

`CenterShift` con los tres de serie al encender el interruptor: mañana 08–15, tarde 15–22, noche
22–08. Horas de pared «HH:MM» y no timestamps, igual que `staff_shifts.start_time`: «la noche empieza
a las diez» no cambia el día del cambio de hora, y guardarlo como instante obligaría a reescribir
filas dos veces al año.

`residencia/turnos.ts::turnoDe` es **pura**. Las dos cosas que hacen que no sea un `>=` y un `<`:

1. **La noche cruza medianoche.** «¿Son las 02:00 un instante de la noche?» es
   `02:00 >= 22:00 OR 02:00 < 08:00` — una **disyunción**, no un rango. Escrito como rango, la
   madrugada entera se queda sin turno: justo el tramo en que una residencia está más sola.
2. **La hora es de pared, y la pared está en España.** El instante se convierte a hora de pared de
   `Europe/Madrid` con `utcToWallTime` (el helper de la agenda desde B-reservas-4) y sólo entonces se
   compara. Consecuencia buscada, y está en los tests: el 25-10-2026 los dos instantes de «las 02:30»
   —uno en +02:00 y otro en +01:00, separados por una hora real— son los dos turno de noche. Y el
   mismo instante UTC cae en turnos distintos según la estación, que también es correcto: comparar
   UTC habría hecho que el turno de mañana empezara a las nueve medio año.

El límite es **semiabierto**: las 15:00 son de la tarde. Si fuera cerrado por los dos lados, algo
tendría que elegir, y ese algo acabaría siendo el orden de la lista.

Un hueco en el cuadrante devuelve **`null`** y no «el primero»: adscribir un cuidado a un turno
equivocado es peor que decir que no se sabe. La pantalla de Turnos lo pinta en ámbar.

Y el barrido entero de los 1.440 minutos del día comprueba que los tres de serie no dejan hueco ni se
solapan.

---

## 7 · El dispositivo de puerta · LA DECISIÓN DEL `registerId`

El prompt pedía decidir entre hacer `Device.registerId` nullable con CHECK por `kind`, o colgar la
puerta de una caja técnica como la cocina, y explicarlo si el cambio resultaba más invasivo de lo que
parece.

**Nullable con CHECK**, que era la preferencia declarada, y resultó ser **menos invasivo de lo que
parece.** El informe, pieza por pieza:

### Por qué no la caja técnica

Porque un tenant de residencia tiene la caja APAGADA y **puede no tener ni una `Register` en la
base**: se comprobó, el alta de tenant del super-admin no crea ni tienda ni caja. Colgar la puerta de
una caja técnica obligaría a inventarse una caja —con su nombre, su serie y su identidad fiscal de
SIF— para un centro que no factura, y el día que alguien listara las cajas de Jardín de Gredos vería
49 cajas falsas. La tablet de cocina cuelga de una caja porque su bar YA tiene una.

### Lo que NO se rompe, comprobado uno por uno

| Pieza de `verifactu-1` | Qué le pasa |
| ---------------------- | ----------- |
| Índice `devices_one_active_per_register_key` | **No se toca.** Filtra `kind = 'TERMINAL'`, así que ninguna fila `ROOM` entra en él. Un test de la migración comprueba que este bloque ni lo nombra. |
| Trigger `devices_revoke_previous` | Se **reemplaza la función** (ver abajo) conservando la rama del TERMINAL letra por letra. |
| FK `devices_revoked_by_device_id_fkey` DEFERRABLE | Sin cambios, y es lo que permite que la rama nueva también deje traza. |
| Cadena de `fiscal_records` | Encadena por `fiscal_records.register_id`, que es **otra tabla** y sigue NOT NULL. Un `ROOM` no puede emitir un registro ni aunque se intente a mano: tiene su caso en el e2e. |
| Trigger `stores_rotate_lan_key` (kds-2) | Corre al revocar cualquier aparato y hace `WHERE id = (SELECT store_id FROM registers WHERE id = NEW.register_id)`. Con `register_id` NULL el subselect da NULL, no casa con nada y no revienta. |
| CHECK `devices_kitchen_sections`, `devices_kitchen_lan_solo_cocina` | Filtran por `kind`; una fila `ROOM` cae del lado correcto de los dos. |

### El CHECK que lo sostiene, y su mitad menos obvia

```sql
ALTER TABLE "devices" ADD CONSTRAINT "devices_register_o_habitacion" CHECK (
    ("kind" =  'ROOM' AND "room_id" IS NOT NULL AND "register_id" IS NULL)
 OR ("kind" <> 'ROOM' AND "room_id" IS NULL     AND "register_id" IS NOT NULL));
```

La primera mitad es la obvia. **La segunda es la que sostiene verifactu**: sin ella, un TERMINAL con
`register_id` NULL se saldría del índice único —en Postgres los NULL son distintos entre sí— y una
caja podría acabar con dos terminales vivos facturando en la misma cadena. O sea: hacer la columna
nullable habría reabierto exactamente lo que `verifactu-1` cerró, si no fuera por esa mitad. Tiene su
sabotaje con nombre en el e2e («un TERMINAL SIN CAJA no entra»).

### El relevo: una función, tres ramas

Se **reemplaza** `mipiacetpv_devices_revoke_previous` en vez de añadir un segundo trigger. Dos
triggers `BEFORE INSERT` sobre la misma tabla corren en orden alfabético de nombre, y el día que uno
cambie el orden deja de ser obvio.

La rama nueva: una puerta releva a **la puerta anterior de SU habitación**, y a nadie más — ni al
terminal de la caja (no tiene caja), ni a la puerta de la habitación de al lado. Sale por su propia
rama ANTES de llegar a la del TERMINAL, que queda idéntica.

Más el índice parcial `devices_one_active_per_room_key`: si el relevo dejara de correr, lo que sale
es un error y no dos tablets firmando el mismo registro.

### El coste real del cambio

- **En la base**: `DROP NOT NULL` sobre dos columnas, que es sólo catálogo (`pg_attribute.attnotnull`):
  no reescribe tabla ni valida filas. El CHECK sí hace un scan al crearse; con ~30 dispositivos es
  instantáneo.
- **En el código**: nueve sitios que leían `device.register` dando por hecho que existe
  (`devices/routes.ts`, `superadmin/devices.ts`, `kitchen/auth.ts`, `kitchen/ajustes-routes.ts`,
  `devices/ws-route.ts`, `holded/dejar-holded.ts`, `stores/routes.ts` ×2, `devices/auth.ts`). Todos
  pasan a ser explícitos. Ninguno cambia de comportamiento: donde la caja está garantizada por el
  CHECK se comprueba igual y se contesta lo prudente, porque un `!` es una afirmación que nadie
  vuelve a revisar.
- **En los tests**: una línea en el falso de cocina, que no tenía `registerId` porque ninguna ruta de
  cocina lo leía. Sin ella representaba una fila que el CHECK nuevo no admite, y las dos puertas de
  auth contestaban 401 a una pantalla perfecta.

### Y lo que la puerta NO hace

**No abre turno, no cobra, no emite registro fiscal y no releva a nadie.** Y no está comprobado en
los botones: está comprobado donde importa.

- `requireDeviceToken` —el preHandler de **todas** las rutas del TPV y también del login de
  cajero— devuelve **403 `ROOM_DEVICE_NOT_ALLOWED`** a un `ROOM`. El corte cae ANTES del PIN, así que
  una puerta nunca llega a tener una sesión de cajero con la que intentar nada. Es el mismo sitio y
  la misma razón de cuentas que el `KITCHEN` de kds-1: son decenas de rutas, y acordarse en cada una
  es la forma de que falte en la próxima.
- El **no relevar** lo decide el motor, y tiene su sabotaje: emparejar dos puertas no toca el
  `revoked_at` del terminal de la caja.
- El **no facturar** lo decide `fiscal_records.register_id NOT NULL`, y tiene el suyo.
- Y al revés: un TERMINAL llamando a `/residencia/puerta/me` recibe **403 `NOT_A_ROOM_DEVICE`**.

### El emparejamiento

Ruta propia: `POST /residencia/habitaciones/:roomId/pairing-codes`. No se reutiliza
`/admin/registers/:id/pairing-codes` porque ésa lleva `ensureCajaEnabled` y pedirle una caja a un
centro que no cobra para emparejar la tablet de una habitación era pedirle que se inventara una caja.
Es la otra mitad de la misma decisión del `registerId`.

Lo que sí se reutiliza letra por letra: el formato del código (6 dígitos con ceros a la izquierda,
`randomInt` sin sesgo), la ventana de una hora, el reintento por colisión y el uso único. Y el
emparejamiento en sí sigue siendo **`POST /devices/pair`**, el de siempre, que copia `kind` y la
habitación **del código** y no del cuerpo — si vinieran del cuerpo, cualquiera con un código se
emparejaría como la puerta de la 112 y vería quién duerme ahí.

### La APK en «modo puerta»

La misma APK, otra pantalla. El 403 de `/devices/me` **no es un error: es la señal**, igual que en
cocina. `bootstrap-decision.ts` gana su quinta salida (`room`) y el TPV pregunta a
`/residencia/puerta/me`.

Lo que pinta: el número de habitación a 120 px, la planta, la hora, el turno y quién ocupa cada
cama — **nombre y nada más**. Ni nivel de dependencia, ni grado, ni tipo de plaza, ni una alergia.
Una tablet colgada en la pared de un pasillo la ve la familia de la 110 cuando pasa, el técnico del
ascensor y el inspector de la Consejería; el nombre ya está en el timbre, el nivel de dependencia no.
Tiene test en los dos lados: el payload de la API y el DOM de la pantalla.

Fondo claro y no oscuro, al revés que cocina: un pasillo de residencia está iluminado y la pantalla
tiene que leerse de pie, a un metro.

Y **el turno lo calcula la tablet**, con los turnos que trajo el arranque. La regla está escrita dos
veces a propósito —servidor y tablet— porque en residencia-3 la tablet tendrá que adscribir un
registro a un turno **sin red**, y el servidor no puede contestar eso. Las dos copias son cinco
líneas y las dos están testeadas.

---

## 8 · Las pantallas del admin

Tres nuevas (`Residentes`, `Edificio`, `Turnos`) envueltas en `<ResidenciaGate>`, más la sección de
residencia de `Personal`. Las tres **sin `<CajaGate>`**: el cliente cero es una residencia sin caja.
Para Jardín de Gredos ÉSAS son su barra lateral, junto a Personal.

- **Residentes** · lista de una línea por residente con habitación, cama, nivel y plaza, y las dos
  acciones que se usan a diario —cambiar de habitación y dar de alta— en la propia línea, no dentro
  de la ficha. Alta, ficha (con el histórico de habitaciones) y el aviso del ingreso pendiente.
- **Edificio** · un árbol y no tres listas, porque así es el edificio y así lo nombra el personal.
  Cada habitación con quién ocupa cada cama y qué tablet es su puerta; el alta de una habitación crea
  sus camas de una vez (30 habitaciones y 49 camas de una en una era media mañana de alguien).
- **Turnos** · los tres, el «ahora» (que calcula el servidor con la misma función que usará la
  puerta) y la etiqueta «cruza medianoche», que no se corrige porque no es un error.
- **Personal** · roles de cuidado con su histórico («revocar no borra nada»), la zona en botones, el
  resumen de lo que la función de acceso contestaría hoy —calculado por la API, no por la pantalla— y
  el colegiado **sólo si el rol lo exige**, pedido antes de llegar al 400.

### Dos arreglos que salieron de las capturas y de los tests, no de pensarlos

1. **«Dar de alta» significaba dos cosas opuestas.** En una residencia dar de alta es que alguien SE
   VA, y el botón de la cabecera —que es para ADMITIR— decía exactamente lo mismo que el de cada
   línea. Lo encontró su propio test al no poder distinguirlos. Ahora la cabecera dice «Nuevo
   ingreso» y sólo las líneas dicen «Dar de alta». Es la clase de ambigüedad que se paga una vez, de
   noche, con la familia esperando.
2. **El nombre se quedaba en noventa píxeles a 320.** El nombre compartía línea con los dos
   distintivos y los dos botones, y «Manuel Cano Álvarez» salía «Manuel Ca…» — lo único que esa
   pantalla existe para decir. Ahora se lleva la línea entera hasta `sm`. Es el mismo arreglo que
   clinica-1 le hizo a la cabecera de Personal y por la misma razón: trunca el que sobra, y aquí no
   sobra el nombre.

Capturas en `docs/qa/2026-10-14-residencia-1/`: las cuatro pantallas a escritorio, 390 y 320, el
error del colegiado, y la pantalla de la puerta de la 112 en una tablet de pared.

---

## 9 · La tabla de sabotajes

| Garantía | Qué línea de producción se rompe | Qué se pone rojo | Mensaje real |
| -------- | -------------------------------- | ---------------- | ------------ |
| **El residente no se borra** | `ON DELETE RESTRICT` → `CASCADE` en `resident_profiles_client_id_fkey` | `residencia-1.e2e.ts` · «BORRAR AL RESIDENTE con perfil falla» + `residencia-migracion.test.ts` · «NINGUNA FK de las tres tablas es CASCADE» | `update or delete on table "clients" violates foreign key constraint "resident_profiles_client_id_fkey"` |
| **…ni con el tenant** | Lo mismo en `resident_profiles_tenant_id_fkey` | e2e · «BORRAR EL TENANT con residentes dentro falla» | `…violates foreign key constraint "resident_profiles_tenant_id_fkey"` |
| **Una cama, un residente** | Quitar `WHERE "to_at" IS NULL` (o el índice entero) de `bed_assignments_one_live_per_bed_key` | e2e · «DOS RESIDENTES EN LA MISMA CAMA → rechazado» | `Key (bed_id)=(…) already exists.` |
| **Un residente, una cama** | Lo mismo en `..._per_client_key` | e2e · «UN RESIDENTE EN DOS CAMAS → rechazado» | `Key (client_id)=(…) already exists.` |
| **…y el histórico cabe** | Hacer esos índices TOTALES | e2e · «tres traslados, tres filas cerradas, una viva» | `Key (client_id)=(…) already exists.` al segundo traslado |
| **Cambiar de habitación no edita** | Quitar el `UPDATE … SET to_at` de la transacción del cambio | e2e · «CAMBIAR DE HABITACIÓN sí: cerrar una y abrir otra» | `expected 1 to be 2` (una fila en vez de dos) |
| **La asignación de rol no se borra** | `revokedAt` → `delete` en la ruta de revocar | `residencia-rutas.test.ts` + e2e · «REVOCAR Y VOLVER A DAR sí» | `expected 1 to be 2` |
| **…y una viva por (persona, rol)** | Quitar `care_role_assignments_one_live_key` | e2e · «DOS ASIGNACIONES VIVAS del mismo rol → rechazado» | `Key (user_id, care_role_id)=(…) already exists.` |
| **Una zona de «todo el centro»** | Quitar el SEGUNDO índice parcial de zona | e2e · «DOS ZONAS DE «TODO EL CENTRO» → rechazado» | `Key (user_id)=(…) already exists.` |
| **Un rol de serie no cambia de categoría** | Quitar `NEW.category <> OLD.category` del trigger | e2e · «SABOTAJE · cambiar la CATEGORÍA de un rol de serie falla» | `RESIDENCIA_VIOLADA: de un rol de cuidado de serie (care_roles.<id>) sólo se puede cambiar el nombre, el orden y si está activo…` |
| **…ni se borra** | Quitar la rama `TG_OP = 'DELETE'` | e2e · «SABOTAJE · borrar un rol de serie falla» | `RESIDENCIA_VIOLADA: un rol de cuidado de serie no se borra (care_roles.<id>). Se desactiva…` |
| **Sólo lo ve quien debe** | `if (!estado.residencia.rolDeCuidadoVigente)` → `if (false)` | `residencia-acceso.test.ts` · casos 2 y 3 | `expected true to be false` |
| **…y la zona manda** | `residenteEnMiZona` → `true` fijo | acceso · caso 6 + `residencia-rutas.test.ts` · «la auxiliar lo intenta con el de la otra planta» | `expected 200 to be 403` |
| **Todo acceso a la ficha se apunta** | Quitar el `conHistoria` de `GET /residencia/residentes/:clientId` | rutas · «queda línea ALLOWED» | `expected [] to have a length of 1` |
| **…y el denegado también** | Apuntar sólo si pasa | rutas · «LA DENEGADA TAMBIÉN» | `expected [] to have a length of 1` |
| **La puerta no es una caja** | Quitar la mitad `kind <> 'ROOM'` del CHECK | e2e · «SABOTAJE · UN TERMINAL SIN CAJA NO ENTRA» | `new row … violates check constraint "devices_register_o_habitacion"` |
| **La puerta no releva al terminal** | Quitar `IF NEW.kind <> 'TERMINAL' THEN RETURN NEW` | e2e · «EMPAREJAR UNA PUERTA NO RELEVA AL TERMINAL» | `expected 2026-10-14T… to be null` |
| **…y sí a la puerta anterior de su habitación** | Quitar la rama `IF NEW.kind = 'ROOM'` | e2e · «UNA PUERTA NUEVA RELEVA A LA ANTERIOR» | `Key (room_id)=(…) already exists.` |
| **Una puerta viva por habitación** | Quitar `devices_one_active_per_room_key` | e2e · «SABOTAJE · sin el relevo, DOS PUERTAS VIVAS» | `Key (room_id)=(…) already exists.` |
| **La puerta no cobra ni abre turno** | Quitar el `if (device.kind === "ROOM")` de `requireDeviceToken` | `residencia-rutas.test.ts` · «un ROOM recibe 403 en la puerta de TODAS las rutas del TPV» | `expected 200 to be 403` |
| **…ni factura** | — (no hay línea que quitar: `fiscal_records.register_id` es NOT NULL) | e2e · «UN `ROOM` NO EMITE REGISTRO DE FACTURACIÓN» | `Code: 23502` |
| **Y un terminal no lee una puerta** | Quitar `if (device.kind !== "ROOM") return NOT_ROOM` | rutas · «un TERMINAL no puede leer la puerta» | `expected 200 to be 403` |
| **La puerta no enseña salud** | Añadir `dependencyLevel` al select de `puerta/me` | rutas · «NI UN DATO DE SALUD» + `residencia-puerta.test.tsx` | `expected '…DEPENDIENTE…' not to contain 'DEPENDIENTE'` |
| **404 y no 403** | `respondeComoRutaInexistente` → `reply.code(403)` | rutas · «la 404 es LA MISMA que la de una ruta que no existe» | `expected 403 to be 404` |
| **La noche cruza medianoche** | `minutos >= inicio \|\| minutos < fin` → `&&` | `residencia-turnos.test.ts` · «LAS 02:30 SON DE LA NOCHE» + el barrido de 1.440 min | `expected undefined to be 'N'` |
| **La hora es de pared** | `utcToWallTime(...)` → `instante.getUTCHours()` | turnos · «el MISMO instante UTC cae en turnos distintos según la estación» | `expected 'N' to be 'M'` |
| **El centro nace con roles y turnos** | Quitar `sembrarResidencia` de la transacción | `residencia-interruptor.test.ts` · «siembra los DIEZ roles» | `expected [] to have a length of 10` |
| **No se enciende sin la clínica** | Quitar el 409 y el CHECK | interruptor · «SIN la clínica, 409» + e2e · «apagar la clínica de un centro de residencia falla» | `new row … violates check constraint "tenants_residencia_exige_clinica"` |
| **Ningún tenant de hoy nota nada** | `@default(false)` → `true` en `residencia_enabled` | `residencia-acceso.test.ts` · «un tenant QUE NO ES RESIDENCIA no gasta ni una consulta» + toda la suite de la clínica | `expected 0 to be 1` |

---

## 10 · Decisiones tomadas sin preguntar

1. **`CareRole.tenantId` es NOT NULL** y los diez de serie se siembran por centro, aunque el mapa de
   datos lo dejaba abierto (`tenantId?`). Razón en §4; el coste (distribuir un rol nuevo pasa a ser
   un backfill) está aceptado y dicho.
2. **La lista de residentes y la vista del edificio NO pasan por `conHistoria`.** Razón en §2. Es la
   decisión 1 de clinica-1 aplicada a este bloque.
3. **`GET /residencia/puerta/me` tampoco deja línea en el registro de accesos.** Su identidad es el
   DISPOSITIVO, no una persona, y el registro existe para contestar «¿QUIÉN ha abierto la historia de
   mi madre?». Una línea sin persona no contesta eso. La pantalla que SÍ identifica a alguien (con
   PIN) es residencia-3, y dejará la suya.
4. **Los tres flags de `CareRole` (`recordsCare`, `requiresLicense`, `fullScope`) son columnas y no
   se deducen de la categoría.** «Calidad» es SUPERVISOR y ve todo el centro; «TO» es OPERATIVO y
   exige colegiado. Deducirlos habría obligado a inventar categorías para cada combinación.
5. **La zona se guarda con un `PUT` de la lista completa** y no con un POST/DELETE por planta. Es
   como se usa —la dirección mira la pantalla, marca dos casillas y guarda— y con rutas por planta el
   estado intermedio (ninguna planta marcada) es un momento en el que esa persona no ve a nadie.
6. **Las rutas de escritura de roles y zonas son `requireOwner`**, no `requireOwnerOrManager`: esto
   decide quién ve datos de salud, que es la misma clase de decisión que `PATCH /staff/:id/clinica`.
   El encargado lee.
7. **La lista de residentes le sale completa al OWNER y al MANAGER aunque no tengan rol de cuidado.**
   Son quien da de alta a los residentes y tienen que verlos antes de asignarles nada. Lo que NO les
   da es la ficha: ésa pasa por `conHistoria` y les dirá «sin rol de cuidado». La lista es el
   cuadrante; la ficha es historia.
8. **Un turno se puede borrar, un rol de serie no.** En este bloque nada apunta todavía a un turno
   (lo que se le adscribe es el `CareRecord` de residencia-3, que pondrá su propia FK `Restrict`); un
   rol de serie, en cambio, es el vocabulario con el que está firmado el histórico. Lo que no se
   puede es quedarse sin ningún turno (409 `ULTIMO_TURNO`).
9. **`from_at` / `to_at` y no `from` / `to`** en las tres tablas con vigencia: las dos palabras son
   reservadas en SQL y quedarían entre comillas en cada consulta a mano.
10. **Se arregló `clinicalRecordsEnabled` en el PATCH del super-admin** (§1), que es de clinica-1 y
    no de este bloque. Sin eso, la casilla que el prompt pide «junto a la de la clínica» sería una
    casilla que manda algo que el servidor tira en silencio.
11. **Se arregló `CORS_ORIGINS` en el banco de la agenda** (§12). Sin eso, el modo «puertos propios»
    que su propia config documenta no funcionaba, y los 40 capítulos morían en el login.

---

## 11 · Dudas abiertas

1. **Un centro mixto** —residencia con una consulta de podología dentro, que es el caso que Jardín de
   Gredos ya tiene con su médica— usa las dos reglas de alcance a la vez: la de residencia para sus
   residentes y la de la clínica para los pacientes de consulta. Hoy la función **elige una** por
   tenant: con `residenciaEnabled`, manda la de residencia y `clinicalScope` se ignora. Para el
   cliente cero vale (los pacientes de la médica SON los residentes). El día que una residencia abra
   consulta externa al pueblo, habrá que decidir si el alcance se compone o si el paciente externo es
   otra cosa. **No bloquea**; está apuntado aquí y en el comentario de la función.
2. **Reingreso.** Un residente al que se dio de alta y vuelve: hoy hay que quitarle la fecha de alta
   a mano (la ruta de cambiar de cama lo rechaza con 409 `RESIDENTE_DADO_DE_ALTA`). Lo limpio sería
   un «reingreso» que abra un episodio nuevo conservando el anterior, y eso se parece mucho a lo que
   la Fase 3 necesita para la vigencia de la plaza. Se deja para entonces.
3. **El `CareRoleAssignment` tiene `toAt` y `revokedAt`** y son cosas distintas (fin previsto vs.
   quitado por alguien). La unicidad de lo vivo la decide sólo `revokedAt`, así que dos asignaciones
   del mismo rol con `toAt` pasados y sin revocar no se pueden solapar aunque sus vigencias no se
   crucen. Es conservador y no ha molestado; si una residencia necesita «fue TO en 2024 y vuelve a
   serlo en 2026» tendrá que revocar la primera.
4. **El catálogo de roles de serie no se distribuye solo** a los centros ya encendidos (§4). Hoy hay
   cero centros; el día que haya cinco y se añada un rol, hace falta un script.
5. **Un turno que no cubre** deja `turnoDe` en `null`, y este bloque sólo lo pinta. Quien decida qué
   hacer con un registro sin turno es residencia-3; la recomendación escrita en la función es
   guardarlo sin turno y pintarlo como aviso, nunca rechazar el registro — «un cuidado hecho se
   apunta» es el equivalente de «cobrar siempre se puede».
6. **Cifrado a nivel de campo**: fuera de alcance y sin hacer, igual que en la clínica. El DNI y el
   NSS están en claro en la base.
7. **El conflicto RGPD / Ley 41/2002** que clinica-1 dejó abierto se hereda tal cual: aquí tampoco se
   borra nada nunca, que es el lado seguro, y la respuesta a «quiero que borréis los datos de mi
   madre» sigue siendo de abogado.

---

## 12 · Lo que NO cubre este bloque

Declarado en el prompt y respetado: la pantalla de la puerta (PIN, residente, tareas, «hecho»,
«como siempre», «algo no va bien», registro sellado offline) es residencia-3; el catálogo de
controles y el plan de cuidados, residencia-2; eventos, incidencias, relevo y panel de dirección,
residencia-4 y 5; pagadores, copago y facturación de plazas, Fase 3; medicación, escalas y `Lesión`,
Fase 2. Y que la dirección encienda la residencia desde Ajustes: fuera, y además no podría —exige la
clínica, así que el toggle tendría que explicarle por qué su casilla no obedece.

Verifactu, caja y cobro **no cambian de comportamiento** para nadie. `UserRole` no gana valores.

---

## 13 · Cómo se cierra

### Migración · HAY MIGRACIÓN, y son dos

- `20261014000000_residencia_1_tipos` — el interruptor, su CHECK, los cuatro tipos nuevos y
  `DeviceKind.ROOM`.
- `20261014010000_residencia_1_cimientos` — las nueve tablas, los cinco índices parciales, los dos
  CHECK de la puerta, el trigger de los roles de serie y la función de relevo reemplazada.

**Por qué son dos:** Postgres prohíbe USAR un valor de enum en la misma transacción en la que se
añade, y Prisma corre cada migración en una. `ROOM` hace falta escrito dentro del CHECK
`devices_register_o_habitacion` y del índice `devices_one_active_per_room_key`. clinica-1, -2 y -3
pagaron esta factura tres veces; aquí está pagada de entrada, y un test lo fija.

**Las dos son ADITIVAS**: ni un `DROP TABLE`, ni un `DELETE`, ni un `TRUNCATE`, ni un `UPDATE … SET`
fuera de la función del trigger. Lo único que toca una tabla con filas es el `DROP NOT NULL` de
`devices.register_id` y `pairing_codes.register_id`, que es sólo catálogo. Un test lo fija.

El **`down`** está escrito en la cabecera de las dos, incluido lo que no se puede deshacer: un valor
de enum no se quita en Postgres, así que `ROOM` se queda en `DeviceKind` para siempre (el `down` de
verdad es borrar las puertas y rehacer el tipo).

**Aplicada en una copia**, no en producción: `mipiacetpv_residencia1_copia`, creada con
`CREATE DATABASE … TEMPLATE mipiacetpv` (la base de desarrollo, con filas reales dentro). De paso
salió que esa copia arrastraba la misma precondición pendiente de `verifactu_1_registro` que se
encontró clinica-1 (dos TERMINAL activos en la misma caja) — **no es de este bloque**, se resolvió en
la copia como el propio mensaje de la migración indica.

### Despliegue

1. `prisma migrate deploy` (lo hace el arranque de la imagen).
2. Nada más. **Ningún tenant cambia de comportamiento**: la capability nace apagada y `ROOM` no lo
   lleva ningún dispositivo.
3. Para encender la residencia a un cliente:
   `PATCH /super-admin/tenants/:id` con `{"residenciaEnabled": true}` — exige la clínica encendida (y
   la clínica exige CRM y agenda). También desde la casilla nueva del detalle del tenant.
   Encenderla **siembra** los diez roles de cuidado y los tres turnos.

**Sin `COPY` nuevo en `infra/Dockerfile`**: no nace ningún paquete ni manifest; lo de este bloque va
bajo `apps/` y `packages/db/prisma/`, que entran por el `COPY . .`.

### Verde

- `pnpm test` · **356 ficheros, 4.742 tests, 3 skipped.** Verde.
- `pnpm test:e2e` · **34 ficheros, 629 tests.** Verde, sobre `mipiacetpv_residencia1_e2e`.
- `pnpm e2e:agenda` · **34 passed, 1 failed, 5 did not run.** Los capítulos **1 a 11 van enteros en
  verde** (los 34); el 12 es `mode: "serial"` y se para en su cuarto test, así que los dos que le
  quedan y los tres del final no llegan a correr.

  El fallo **es de `master` y no de esta rama**, y está comprobado: `git diff master...HEAD` sobre `packages/clinica-sesion`, `apps/tpv-web/src/clinica`,
  las rutas de sesión de la API y el propio `specs/12-clinica-sesion.spec.ts` **está vacío** — esta
  rama no toca ni una línea de lo que ese capítulo ejerce. Lo que falla es una ambigüedad del
  localizador:

  ```
  strict mode violation: getByRole('button', { name: 'Uña encarnada' }) resolved to 2 elements
    1) «Uña encarnada»        (packages/clinica-sesion/src/listas.ts:29)
    2) «Uña encarnada leve»   (packages/clinica-sesion/src/niveles.ts:53)
  ```

  Las dos etiquetas las puso `clinica-4` el 09-10. El arreglo es un `exact: true` en el spec, y **no
  se toca aquí**: el prompt dice «sin tocar sus specs». Queda dicho para quien abra ese bloque.

  Y para poder correrlo hubo que arreglar antes el banco: ver abajo.
- `tsc` de API, admin y tpv-web · limpio.
- CI · pendiente del push (se añade el enlace al abrir el PR).

### El arreglo del banco, que no era de esta rama pero la bloqueaba

`pnpm e2e:agenda` con **puertos propios** —el modo que su propia config documenta para que dos
worktrees no se pisen— no funcionaba: `env.CORS_ORIGINS` seguía en su default (5173/5174/5175), la
pantalla del banco vive en otro puerto, y el navegador manda `Origin: http://localhost:5283`. El
`origin` del plugin de CORS llama a `cb(new Error("CORS bloqueado: …"), false)` y eso sale como
**500**, así que el login del panel fallaba con «Ha ocurrido un error inesperado» y los 40 capítulos
morían en `entrarAdmin`.

Se esconde bien por dos razones, y las dos engañan: `curl` contra el mismo proxy contesta **200**
—sin cabecera `Origin` el plugin deja pasar, así que la API parece sana— y el síntoma es idéntico al
del reinicio de nodemon que la memoria de la casa tiene apuntado. Se diagnosticó abriendo el panel
con un navegador y leyendo la consola: `[http 500] /api/auth/login`.

`playwright.config.ts` pasa ahora `CORS_ORIGINS` a su API, derivado de los puertos del banco, y el
README lo dice.

### Lo nuevo de este bloque

- `residencia-acceso.test.ts` (22) · la tabla de casos de la función y la economía de consultas.
- `residencia-turnos.test.ts` (14) · la noche, el barrido del día y los dos cambios de hora.
- `residencia-migracion.test.ts` (31) · el contrato del SQL.
- `residencia-rutas.test.ts` (21) · el gate, el registro, la puerta y los datos de salud.
- `residencia-interruptor.test.ts` (17) · las guardas, la semilla y el bug de `clinicalRecordsEnabled`.
- `residencia-1.e2e.ts` (44) · los sabotajes contra Postgres.
- `residencia-pantallas.test.tsx` (20) · las cuatro pantallas y el tenant que no las ve.
- `residencia-puerta.test.tsx` (15) · la señal del modo puerta y el turno en la tablet.

---

## 14 · Commits

```
abfa0ab feat(residencia-1): el modelo de los cimientos de la residencia
66f17f5 feat(residencia-1): el interruptor del super-admin y la semilla del centro
1078dcb feat(residencia-1): la función de acceso, ampliada, y el turno de un instante
b099495 feat(residencia-1): residentes, edificio, roles de cuidado y turnos
b0873d3 feat(residencia-1): la puerta de la habitación es un dispositivo ROOM
fe94480 feat(residencia-1): las pantallas del centro y el modo puerta de la APK
561aa61 test(residencia-1): la tabla de casos, los sabotajes y las pantallas
3f27df2 docs(residencia-1): capturas de las cuatro pantallas, y el nombre entero a 320
<este>  docs(residencia-1): el done del bloque
```

## 15 · La rama

<pendiente de completar al hacer push y abrir el PR>

**Ni merge ni despliegue: eso lo hace Dirección.**
