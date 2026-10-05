# Bloque clinica-2 · la valoración inicial

Rama `clinica-2`, worktree `~/Developer/Claude/Projects/mipiacetpv-clinica-2`, desde `master` = `0357ce2`
(o el que haya al lanzarlo). Frente C del tablero. Escrito por Dirección el 05-10-2026.

Lee antes, en este orden:
1. `docs/clinica/00-decisiones.md` — el diseño entero validado por Matías (pieza 1).
2. `docs/mockups/clinica-2-valoracion.html` — **la spec visual**, validada por Matías. Ábrelo en el
   navegador y recórrelo con sus tres botones de arriba. No se interpreta: se copia estructura,
   textos y estados.
3. `docs/blocks/clinica-1-done.md` — los cimientos sobre los que va esto (función de acceso, registro,
   gate, `ClinicalEntry`, inmutabilidad, §12 dudas abiertas).

## Por qué existe

La clínica de podología atiende a muchos pacientes mayores. Antes del primer tratamiento la podóloga
tiene que saber si el paciente es diabético, si toma anticoagulantes, si es alérgico a la anestesia o al
látex… Hoy lo pregunta de palabra y lo apunta en papel, en plena consulta.

¿Y qué?: el paciente contesta el test **antes** de entrar (en la tablet de la sala o desde un enlace del
email), la podóloga sólo lo revisa y valida en un minuto, y **nadie trata a un diabético anticoagulado
sin saberlo**, porque la historia no deja registrar un tratamiento sin la valoración validada.

## Decisiones de producto ya tomadas (Matías, 05-10) — no se re-debaten

1. Paciente nuevo → **valoración inicial** con un test de enfermedades crónicas.
2. **La rellena el paciente** (o un familiar, y queda dicho quién) y **la valida el sanitario**, con
   **tres confirmaciones** antes del primer tratamiento.
3. **Canales**: enlace por **email** al dar la cita, y **tablet de la sala** bloqueada en el test.
   WhatsApp/SMS **no** (no hay proveedor).
4. **Pensado para mayores**: una pregunta por pantalla, letra grande, «Sí» / «No» enormes, «No lo sé»
   siempre disponible, palabras de la calle, sin contraseñas, «Pregunta 4 de 10».
5. **Lo que contestó el paciente no se borra nunca**. Lo que corrige el sanitario es una corrección con
   su autor, al lado. En pantalla: **la respuesta del paciente en naranja (coral) relleno; la corrección
   en oscuro (ink), con la original del paciente con borde naranja**; filas con «Sí» con fondo coral
   suave; leyenda arriba. Está así en el mockup.
6. **Las alertas de salud viven sólo dentro de la historia**. La agenda y la caja sólo enseñan
   contacto. La recepcionista puede **mandar** el test y **abrir** la tablet en modo test, pero **no
   lee** las respuestas.
7. La valoración se puede **repasar** más adelante («¿algo ha cambiado?») creando una **nueva**, sin
   sobrescribir la anterior.

## Alcance

### 1 · El cuestionario

- Un cuestionario **versionado** (la valoración guarda con qué versión se contestó: si mañana cambia
  una pregunta, lo contestado ayer sigue leyéndose bien).
- La versión 1 es la del mockup: las 10 preguntas, sus ayudas, las dos de seguimiento (insulina si
  diabetes; a qué es alérgico, con botones, si alergias) y qué alerta sale de cada «Sí». Cárgala como
  dato por defecto del módulo clínico; **editar el cuestionario desde una pantalla queda fuera** (lo
  ajusta Mi Piace con la podóloga).

### 2 · La valoración en la historia

- Nuevo `ClinicalEntryKind` para la valoración inicial (y lo que necesites para guardar: respuestas del
  paciente, quién respondió, versión, canal —email o tablet—, estado `PENDIENTE_PACIENTE` →
  `RESPONDIDA` → `VALIDADA`).
- **Las respuestas del paciente son inmutables.** Las correcciones del sanitario van en su propia
  tabla o estructura, con autor y hora, sin tocar la respuesta original.
- **Validar** = las tres confirmaciones marcadas, ninguna respuesta «No lo sé» sin resolver, autor y
  hora. Una valoración validada no se edita: se repasa con una nueva (decisión 7).
- **Una sola función** responde «¿puede este paciente recibir su primer tratamiento?» (hay una
  valoración validada vigente). `clinica-3` (la sesión) la usará como puerta; aquí se escribe, se
  exporta y se testea. No inventes ahora la entrada de tratamiento.
- **Las alertas** salen de una función pura (respuestas vigentes, con las correcciones aplicadas →
  lista de alertas). Mientras la valoración está sin validar, se enseñan igual, marcadas como
  «por validar».

### 3 · El enlace del email

- Al dar una cita de un servicio marcado como **primera valoración** (marca nueva en el servicio del
  catálogo) a un paciente sin valoración, se crea la valoración `PENDIENTE_PACIENTE` y se manda **un
  email con el enlace** por la cola de email que ya existe (`email/sender.ts`). También un botón
  «Enviar el test» en la ficha, para mandarlo a mano.
- **Ruta pública sin sesión** siguiendo el patrón probado de `tickets/public-pdf-route.ts`: token
  opaco y largo, ligado a esa valoración, **caduca** (al responder y, si no, a los 30 días),
  rate-limit tras el proxy. El enlace **sólo** enseña el nombre de pila y el nombre de la clínica;
  nunca devuelve respuestas.
- **El email no lleva ningún dato de salud**: nombre de la clínica, día y hora de la cita, y el
  enlace. Asunto y texto en palabras de la calle.
- Responder por el enlace deja su línea en el registro de accesos (`WRITE`). Hoy
  `ClinicalAccessLog.userId` es obligatorio y el paciente no es un `User`: resuélvelo (por ejemplo un
  actor «paciente por enlace») y **dilo en el done**. Ningún camino puede escribir historia sin dejar
  línea.

### 4 · La tablet de la sala

- Desde la ficha del paciente o desde su cita, «**Test en la tablet**» deja el TPV en **modo
  paciente**: sólo el test de ese paciente, sin menú ni forma de salir a otra cosa. Para salir hace
  falta el **PIN** de alguien del personal.
- Lo puede abrir cualquier rol que vea la agenda (también la recepcionista), porque abrirlo no enseña
  nada.
- **El mismo componente** sirve para el enlace y para la tablet: un solo test, dos puertas.

### 5 · La pantalla del sanitario

Dentro de la historia del paciente (sólo quien tiene acceso por la función de `clinica-1`), tal como
el mockup: cabecera con estado (pill «por validar» / «validada»), **franja de alertas**, «Respuestas
del test» con la respuesta del paciente en naranja y la corrección en oscuro, «Antes del primer
tratamiento» con las tres confirmaciones, y **«Validar valoración» desactivado con el motivo escrito
al lado** mientras falte algo. Tras validar: el aviso verde con autora, colegiado y hora.

En la agenda del sanitario, la cita de un paciente con la valoración sin responder o sin validar lleva
un **aviso discreto** («Valoración pendiente»), sin ningún dato de salud.

## Respeta

- Todo lo de `clinica-1`: función única de acceso, registro en un único punto, 404 con el módulo
  apagado, `onDelete: Restrict`, nada de salud en logs, Sentry ni mensajes de error.
- **Sole y el resto de tenants no notan nada.** `pnpm e2e:agenda` y la suite, verdes sin tocar sus specs.
- El motor de reservas (`engine.ts`) no se toca.
- `sistema-visual-mipiace`: tokens, DM Sans, tap targets (**56 px mínimo en el test del paciente**,
  los botones Sí/No del mockup son más grandes y así se quedan), `prefers-reduced-motion`.

## Fuera de alcance (declarado)

- Editar el cuestionario desde una pantalla.
- El mapa del pie, la sesión y la entrada de tratamiento (`clinica-3`), fotos, consentimientos
  firmados, informe PDF.
- WhatsApp / SMS. Recordatorios del test si no lo contesta.
- App para iPad (Capacitor iOS) e IVA exento en Verifactu: bloques propios.
- Mover la ficha técnica (`ClientTechnicalNote`) dentro de la historia (duda 3 de `clinica-1`).

## Cómo se cierra

- Migración con su `down` pensado, probada en una copia (no en producción).
- Tests de las funciones puras: alertas (con y sin correcciones, seguimientos), «puede recibir primer
  tratamiento», validar (no se puede con «No lo sé» o sin las tres confirmaciones).
- Tests de ruta: el enlace caduca y no se reutiliza; no devuelve respuestas; el email no contiene
  ninguna palabra del cuestionario; la recepcionista abre el modo tablet pero recibe 404/denegado al
  leer respuestas (y queda en el registro); el paciente por enlace deja línea `WRITE`; módulo apagado →
  404.
- Un e2e con navegador (Playwright, como el banco de la agenda): dar cita de primera valoración →
  email en la cola → contestar por el enlace a 390 px → la podóloga corrige un «No lo sé», marca las
  tres y valida → la función de primer tratamiento dice sí.
- **Tabla de sabotajes** (`feedback_criterio_funciona_sabotaje`): inmutabilidad de lo contestado, el
  enlace de un solo uso, el email sin datos de salud, la validación con «No lo sé», la recepcionista
  sin lectura, el registro del enlace. Qué línea rompes, qué test se pone rojo, con qué mensaje.
- Bucle visual: capturas contra el mockup — test del paciente a **320, 390 y 1024 px**, pantalla final
  con y sin «No lo sé», vista del sanitario por validar / con corrección / validada, y el «Validar»
  desactivado con su motivo. En `docs/qa/`.
- CI verde (`ci`, `smoke`, `e2e`); `COPY` en `infra/Dockerfile` si nace paquete; el mock literal de
  `catalog.js`.
- `docs/blocks/clinica-2-done.md` con la estructura de la metodología: qué se hizo punto a punto, cómo
  se resolvió el actor del enlace en el registro, decisiones tomadas sin preguntar, dudas abiertas, cómo
  se despliega (hay migración). Dice si la rama está pusheada y si hay PR.
- Commits pequeños en español, push de la rama y **PR contra `master`**. Ni merges ni despliegues:
  eso lo hace Dirección.
