# Plan · banco de pruebas de la agenda + vídeo «de cero a un día normal»

Rama `agenda-banco`. Plan de capítulos **antes de grabar nada**, como pidió
Dirección. Cada capítulo del vídeo es un spec del banco; el orden es el mismo
porque el estado se arrastra: el capítulo 6 reserva sobre el equipo que dio de
alta el 3.

## 0 · La stack y el seed (hecho, verificado)

| Pieza | Dónde | Estado |
|---|---|---|
| Postgres + Redis | `docker-compose.yml` | arriba |
| Base del banco | `mipiacetpv_agenda_banco_e2e` | creada y migrada (`migrate deploy`) |
| API | `pnpm dev:api` · :3001 | `/health` ok |
| Admin | `pnpm dev:admin` · :5173 | arriba |
| TPV | `pnpm dev:tpv` · :5174 | arriba |
| Seed | `apps/e2e-ui/seed/peluqueria-demo.ts` | idempotente, 2 pasadas iguales |

La base **no es la de desarrollo**: el `apps/api/.env` del worktree apunta a
`mipiacetpv_agenda_banco_e2e`, y el seed se niega a correr si el nombre de la
base no contiene `banco`, `e2e` o `test` (misma red de seguridad que
`apps/api/test-e2e/e2e-env.ts`).

Comprobado contra la stack de verdad, no supuesto:

- `POST /auth/login` con la dueña → tokens.
- `POST /shift/cashier-login` con el token del dispositivo y el PIN de Marta
  → sesión de cajera. O sea: los hashes del seed (argon2id del PIN y de la
  contraseña, sha256 del token del dispositivo) son los que la API espera.

### Qué deja el seed y qué NO

Deja el **sustrato**: tenant «Peluquería Demo» (SERVICES, CRM on, **Holded
off**, **agenda APAGADA**), su local, su caja, un dispositivo ya emparejado,
la dueña con contraseña, las tres profesionales como usuarias con PIN, los
servicios en el catálogo **sin datos de agenda**, y cuatro clientas (tres sólo
con nombre de pila, una con nombre completo y teléfono).

**No** deja duraciones, perfiles de profesional, colores, skills, turnos,
horario del centro, festivos ni citas: eso lo pone el banco **por la
pantalla**, y son los capítulos 1 a 4. Un seed que dejara la agenda
configurada probaría la base de datos, no la interfaz.

Idempotente por borrado: tira el tenant entero (CASCADE) y lo rehace con los
mismos ids fijos. El `globalSetup` de Playwright lo lanza en cada pasada, así
que «dos veces seguidas en verde» no depende de que los specs limpien nada.

## Los capítulos

Viewports: **TPV = 1280×800 CSS a `deviceScaleFactor` 1,5** (el AP11/AP12 en
horizontal, medido en `reservas-mostrador-done.md` §6) · **admin = 1280** ·
**móvil = 390**.

### 1 · Encender · admin + TPV · ~40 s

| | |
|---|---|
| Hace | TPV con la agenda apagada → el botón NO está. Admin: login de la dueña → Ajustes → «Agenda de citas» on → Guardar. TPV otra vez → el botón SÍ está |
| Comprueba en pantalla | el botón de agenda ausente antes y presente después; el menú del admin gana «Personal», «Agenda · servicios» y «Agenda · horario» |
| Comprueba en BD | `tenants.agenda_enabled` pasa de `false` a `true` |

El «antes» no es decorado: es la prueba del gate, y hoy es el estado de
producción para todos los tenants menos el que se encienda.

### 2 · Servicios · admin · ~50 s

| | |
|---|---|
| Hace | `/admin/agenda-catalog`: teclea duración y pausas de cada servicio |
| Comprueba en pantalla | cada servicio pasa de «Sin datos de agenda» a «30 min» / «90 min» / «120 min» |
| Comprueba en BD | una fila por servicio en `service_scheduling` con la duración exacta |

**Aquí sale el primer hallazgo** (ver §Hallazgos): la pausa de exposición del
tinte no se puede expresar.

### 3 · Equipo · admin · ~60 s

| | |
|---|---|
| Hace | `/admin/staff`: perfil de Marta, Lucía e Irene **en ese orden** (sin tocar el selector de color), qué sabe hacer cada una, y el turno de cada una |
| Comprueba en pantalla | tres colores **distintos** propuestos solos (`#e8663c`, `#3c8ce8`, `#2fb686`); el tinte sin nadie marcado |
| Comprueba en BD | 3 `staff_profiles` con tres colores distintos, las filas de `staff_skills`, 3 `staff_shifts` con su `rrule` |

El tinte se deja **sin nadie** a propósito: es el aviso que provoca el
capítulo 5. Las mechas sólo las sabe Marta — es el «no» del capítulo 6.

### 4 · Horario del centro · admin · ~50 s

| | |
|---|---|
| Hace | `/admin/agenda-hours`: martes a sábado 9:00–20:00; el jueves **festivo** «Virgen del Prado» (cerrado); el viernes **día especial** 9:00–14:00 |
| Comprueba en pantalla | la rejilla del TPV del jueves dice cerrado con el nombre del festivo; la del viernes acaba a las 14:00 |
| Comprueba en BD | 5 `center_hours`, 2 `center_days` (uno `closed=true` sin horas, otro con las dos) |

### 5 · Panel de salud · TPV · ~45 s

| | |
|---|---|
| Hace | abre «Salud de la agenda» → aviso real (el tinte que nadie sabe hacer) → va al admin, se lo da a Marta y a Lucía → vuelve |
| Comprueba en pantalla | el aviso con su texto; después, el panel limpio |
| Comprueba en BD | las dos filas nuevas de `staff_skills`; `GET /agenda/health` sin avisos |

El panel vive en el **TPV** (`AgendaHealthPanel.tsx`), no en el admin: el
vídeo lo enseña donde está.

### 6 · Reservar desde el TPV · TPV · ~90 s

Los **sí**:

| Caso | Comprueba en BD |
|---|---|
| Clienta nueva sólo con nombre (Sonia) + corte | fila nueva en `clients` con `last_name` vacío, su `appointment` y su `appointment_assignment` |
| Clienta existente buscada (Carmen Ruiz) + mechas con Marta | la cita cuelga del `client_id` que ya existía |
| Una cita dentro de la pausa del tinte | las dos citas de Rosa (aplicación y lavado) y el corte de Pili **dentro** de los 40 min de exposición |

Los **no** — y cada uno comprueba **el mensaje que ve la cajera** y que la BD
**no cambió**:

| Caso | Qué para |
|---|---|
| En el pasado | el suelo de la agenda |
| Solapada | el `EXCLUDE USING gist` de **Postgres de verdad** |
| En el festivo | el techo del horario del centro: sin huecos |
| Lucía + mechas | Lucía no aparece en el selector |

El solape es la primera vez que el `EXCLUDE` se ve rechazar una fila **desde
la interfaz**: hasta ahora se simulaba en los tests del motor y sólo
`agenda-suelo.e2e.ts` lo había visto por la puerta de la API. Irá dicho en el
done.

### 7 · El día · TPV + móvil · ~70 s

| | |
|---|---|
| Hace | vista por profesional (columnas) · recepción (1280) · móvil (390, «mi día» + filtro); mueve una cita, cancela otra, marca una que no vino |
| Comprueba en pantalla | la cita en su columna nueva; la cancelada y la no-show con su estado |
| Comprueba en BD | `timeslot` movido; `status` `CANCELLED` / `NO_SHOW` y su `assignment.active = false` — un hueco cancelado deja de bloquear |

### 8 · Cobrar · TPV · ~70 s

| | |
|---|---|
| Hace | llega la clienta → se cobra **la cita**, en su borrador, al turno del instante; una en efectivo con vuelta y otra mixta |
| Comprueba en pantalla | la vuelta; la cita finalizada |
| Comprueba en BD | el `ticket` con sus `ticket_payments`, `appointments.ticket_id` enlazado y `status = COMPLETED` |

### 9 · Cerrar el día · TPV · ~45 s

| | |
|---|---|
| Hace | cierra el turno |
| Comprueba | el arqueo del turno **cuadra** con la suma de lo cobrado por citas (en pantalla y contra los tickets de la BD) |

### 10 · Sin red · TPV · ~40 s

| | |
|---|---|
| Hace | `context.setOffline(true)`, alta de una clienta, vuelta a la red |
| Comprueba en pantalla | el chip del outbox con el pendiente, y que desaparece |
| Comprueba en BD | la clienta con su `external_id` (la idempotencia del alta offline) |

Va **el último** y marcado como opcional: si el TPV servido por Vite no
aguanta el modo sin red, se cae del vídeo y pasa a hallazgo, como dice el
prompt.

Total: ~9 minutos, por debajo del tope de 10.

## El vídeo

Un MP4 por capítulo y uno completo, 1080p. Rótulos en español inyectados por
el propio spec como overlay (`addStyleTag` + un `div`), **nunca tocando la
app**: uno al empezar cada capítulo y uno en cada paso que hay que entender
(«Lucía no sabe hacer mechas: no aparece»). Ritmo humano: pausas entre pasos,
nada de clics instantáneos. Portada «La agenda, de cero a un día normal».
Montaje con `ffmpeg`; los vídeos van a
`~/Developer/Claude/Projects/mipiacetpv-media/agenda/` y **no entran en git**.

## Hallazgos ya encontrados (leyendo, antes de grabar)

### 🟡 La pausa de exposición del tinte no se puede expresar

Un servicio tiene `durationMin`, `bufferBeforeMin` y `bufferAfterMin`, y las
pausas **ocupan** a la profesional: el motor calcula el hueco del staff como
`[inicio − pausaAntes, fin + pausaDespués)`
(`apps/api/src/agenda/engine.ts:417-423`). Y los servicios de una visita se
encadenan **seguidos**: `offset += req.durationMin`
(`engine.ts:183`), sin forma de dejar un hueco en medio.

Consecuencia para Sole: un tinte de 90 minutos tiene a la profesional ocupada
90 minutos, cuando en la realidad 40 de esos minutos la clienta está con el
tinte puesto y la peluquera puede cortar a otra. La agenda **funciona**, pero
**reserva de menos** — y ésa es la hora que un centro factura dos veces.

No se construye nada (regla del bloque). Queda en el done con esta severidad.

### ⚪ El banco mete Playwright en el repo, y eso contradice una nota vieja

Hasta hoy la regla era «Playwright vive en el scratchpad, no en el repo»
(bucle visual de capturas). El prompt de este bloque pide lo contrario y a
propósito: un paquete `apps/e2e-ui` con `@playwright/test` como dependencia de
desarrollo, fuera de CI, lanzado a mano con `pnpm e2e:agenda`. Se hace como
dice el prompt; se apunta aquí para que nadie lo lea como un descuido. El
bucle visual de capturas sigue en el scratchpad.

## Decidido · el tinte va partido en dos (Dirección, 04-10-2026)

El catálogo del banco lleva **«Tinte · aplicación» (30 min)** y **«Tinte ·
lavado y peinado» (30 min)** en vez de un tinte de 90. La visita de Rosa se
reserva como **dos citas** con **40 minutos de exposición** entre medias, y en
ese hueco entra el corte de Pili: el hueco es real y el motor lo ofrece solo.

40 minutos y no 30: con 30 el hueco mide exactamente lo que un corte, y una
cita que encaja al milímetro no prueba que el motor sepa meterla — prueba que
los números cuadran. Con 40, el corte entra y sobran 10.

El rótulo del vídeo dice en voz alta que el truco es partirlo, y el hallazgo
🟡 de arriba explica por qué hay que partirlo. La alternativa descartada era
grabar un tinte macizo de 90 y enseñar que la pausa no se puede usar: más fiel
a lo que hay hoy, inútil como vídeo para Sole.

## Qué NO cubre el banco (va al done y a la pasada en hierro)

Impresora y ticket en papel, teclado propio del hierro en los importes,
lector de códigos, el WebView real del AP11/AP12 y su rendimiento, el uso con
el dedo, y la red real del AP12. Todo eso es `docs/qa/agenda-banco-manual.md`.
