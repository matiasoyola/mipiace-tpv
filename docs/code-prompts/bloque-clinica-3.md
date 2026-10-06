# Bloque clinica-3 · la sesión y el mapa del pie

Rama `clinica-3`, worktree `~/Developer/Claude/Projects/mipiacetpv-clinica-3`, desde `origin/master` =
`6e5361a` (o el que haya al lanzarlo). Frente C del tablero. Escrito por Dirección el 06-10-2026.

Lee antes, en este orden:
1. `docs/clinica/00-decisiones.md` — piezas 2 (exploración) y 3 (sesión).
2. `docs/mockups/clinica-3-sesion.html` — **la spec visual, validada por Matías el 06-10**. Recórrela
   con todos sus botones de arriba, incluidos los dos «Ver como». Se copia estructura, textos y
   estados; no se interpreta.
3. `docs/blocks/clinica-1-done.md` y `docs/blocks/clinica-2-done.md` — acceso, registro,
   inmutabilidad, el paquete `clinica-valoracion` (alertas y «¿puede recibir su primer
   tratamiento?»), el actor paciente, y las dos listas que fallan en silencio (COPY del Dockerfile y
   variables del compose, ya con test).

## Por qué existe

La valoración ya dice quién es el paciente. Falta lo que pasa en cada visita: qué tiene en el pie, qué
se le hizo, cuánto le duele y cuándo vuelve. Hoy la podóloga lo escribe en papel y luego cobra
aparte, de memoria.

¿Y qué?: la podóloga cierra la sesión con unos toques (la mayoría de visitas son «igual que la última
vez»), el cobro sale solo con lo que hizo, la paciente ve en la gráfica que le duele menos, y la
historia queda firmada y sin poder tocarse.

## Decisiones de producto ya tomadas (Matías, 05 y 06-10) — no se re-debaten

1. **Mucho clic, poco escribir; sin sobrecargar de texto.** Texto libre sólo en una nota plegada.
2. **Mapa de los dos pies** con zonas táctiles: cada dedo, bajo el dedo gordo, bajo el 2.º, bajo
   3.º–5.º, arco, borde exterior y talón. Se toca la zona → lesión (callo/heloma, dureza, uña
   encarnada, hongos en la uña, verruga, herida/úlcera, juanete/deformidad) → gravedad (leve,
   moderada, severa). **La gravedad se elige después de la lesión** (desactivada antes, con el
   motivo). Lo de la visita anterior en naranja suave; lo de hoy en naranja.
3. **Ninguna zona táctil por debajo de 44 px** (el mockup lo cumple: los dedos son círculos grandes
   sobre el pie). Se mide en la captura, no en el CSS.
4. **«Igual que la última vez» SUMA** lo de la visita anterior a lo marcado hoy; nunca lo borra.
5. **Exploración** en su pestaña: pulso de cada pie (presente/débil/ausente), puntos sin sensibilidad
   al monofilamento sobre el mismo mapa, tipo de pie (plano/normal/cavo). La siguiente parte de la
   última.
6. **Sesión**: tratamientos en botones, **dolor 0–10 obligatorio**, evolución mejor/igual/peor,
   consejos para casa en botones, próxima cita (2/4/8 semanas/sin cita), nota opcional. Gráfica del
   dolor sesión a sesión.
7. **Cabecera**: el nombre; los datos en **fichas con título** (edad, cita de hoy, nº de visita y
   fecha de la anterior, quién atiende, teléfono); **las alertas en franja roja intensa, con icono y
   «Cuidado», letra grande y palabras de la calle**. Aquí no prima la estética: si es alerta, se ve.
   Siguen viviendo sólo dentro de la historia (agenda y caja no las enseñan).
8. **Al cerrar**: la sesión queda **firmada** (autor, colegiado, hora) y **no se edita**; sólo
   anotaciones. Pasa a caja con lo hecho.
   - **Dueña / encargado / cajero-sanitario**: ven importes y pueden «Cobrar ahora».
   - **Sanitario sin caja**: **no ve importes en ninguna parte** (ni el total del pie de la sesión ni
     al cerrar); su botón dice «Cerrar sesión» y al cerrar ve «Enviada a recepción para cobrar» con la
     lista sin precios. La recepción la tiene en su lista de pendientes.

## Alcance

### 1 · Datos

- Nuevos `ClinicalEntryKind` para la **exploración** y la **sesión**, con su `body` versionado (zonas
  marcadas con lesión y gravedad; pulsos; monofilamento; tipo de pie / tratamientos, dolor,
  evolución, consejos, próxima cita, nota). Inmutables como todo lo de `ClinicalEntry`.
- Las **zonas, lesiones y consejos** son listas versionadas en el paquete compartido (como el
  cuestionario de `clinica-2`), con estos valores por defecto. Editarlas desde pantalla, fuera.
- **Qué botones de tratamiento salen** lo decide el catálogo: una marca en el servicio («es un
  tratamiento de la sesión»), igual que la marca de «primera valoración» de `clinica-2`. El precio y
  el IVA salen del catálogo, no de la historia.

### 2 · La puerta

- **No se puede abrir una sesión** de un paciente sin valoración validada vigente: usa la función de
  `clinica-2`. En su lugar se enseña «Falta validar la valoración inicial» con el camino para hacerlo.
  La exploración sí se puede registrar (es parte de la primera visita).

### 3 · La sesión desde la cita

- Se abre desde la cita del día (agenda del sanitario) con paciente, servicio, fecha y profesional
  puestos. «Igual que la última vez» con la regla 4.
- **Cerrar** = firmar + crear **una sola vez** el cobro pendiente de esa cita con las líneas de los
  tratamientos. **Reutiliza el camino que ya existe de la cita a la caja** (el de `B-reservas-5`
  cita→caja): no inventes un segundo cobro. Cerrar dos veces o con la red cortada a medias no crea dos
  cobros (idempotente, como el resto del TPV).
- **La próxima cita** queda como **propuesta** («dentro de 4 semanas») visible para la recepción al
  cobrar o en la agenda; la recepción elige el hueco con el paciente. No se reserva sola.
- La **hoja de consejos** se guarda en la sesión; imprimirla o mandarla por email va con el informe
  PDF (bloque siguiente).

### 4 · Lo que ve cada rol

- La regla 8, **comprobada en la API, no sólo escondida en pantalla**: las respuestas que llegan a un
  `CLINICIAN` no llevan precios ni totales.
- La recepción, en su lista de pendientes de cobro, ve la cita, el paciente y las líneas con precio;
  **nada de la historia** (ni lesiones, ni dolor, ni alertas).

### 5 · Pantallas

Tal cual el mockup: cabecera (fichas + franja roja), pestañas «Sesión de hoy» / «Exploración», mapa,
gráfica del dolor, panel de la sesión, pie con resumen y botón, pantalla «Sesión cerrada» en sus dos
variantes. Sigue `metodologia-front-mipiace` y `sistema-visual-mipiace`. iPad apaisado manda; en
móvil los pies bajan a una fila cada uno sin scroll horizontal.

## Respeta

- Todo lo de `clinica-1` y `clinica-2` (acceso, registro en un único punto, 404 con el módulo
  apagado, `Restrict`, nada de salud en logs ni Sentry).
- **Sole, La Maestranza y el resto no notan nada**; `pnpm e2e:agenda` y la suite verdes sin tocar sus
  specs. **La caja es lo que más se toca en este bloque y la usan clientes reales**: el camino de cobro
  de una cita que no es clínica no cambia ni una línea de comportamiento.
- El motor de reservas (`engine.ts`) no se toca.

## Fuera de alcance (declarado)

- Fotos, consentimientos firmados, informe PDF e impresión/email de la hoja de consejos (`clinica-4`).
- **IVA exento en Verifactu** (`registro.ts` sigue declarando `S1`): bloque propio tras la asesoría.
  Mientras tanto el ticket lleva el IVA que diga el catálogo; **no escribas «exento» en ningún ticket
  real** si el registro no lo declara así. En pantalla, el texto de IVA sale del catálogo, no fijo.
- Editar listas (zonas, lesiones, consejos) desde pantalla. Arrastrar en el mapa. App iOS.

## Cómo se cierra

- Migración con su `down`, probada en una copia.
- Tests de las funciones puras: «igual que la última vez» suma y no borra; la gravedad sin lesión no
  se guarda; el resumen del pie de la sesión según rol.
- Tests de ruta: sin valoración validada no hay sesión; sesión cerrada inmutable (sólo anotaciones);
  cerrar dos veces = un cobro; un `CLINICIAN` no recibe precios en ninguna respuesta de este bloque;
  la recepción no recibe nada clínico; módulo apagado → 404; una cita no clínica cobra igual que
  antes.
- E2E con navegador (como el banco de la agenda): paciente con valoración validada → la podóloga
  abre la sesión desde la cita, marca una zona, «igual que la última vez», dolor, cierra → (dueña)
  cobra el ticket con sus líneas · (sanitario sin caja) cierra sin ver importes y la recepción lo
  cobra.
- **Tabla de sabotajes**: la puerta de la valoración, la inmutabilidad, el cobro único, los precios
  ocultos al `CLINICIAN` en la API, la suma de «igual que la última vez», nada clínico en la caja.
  Qué línea rompes, qué test se pone rojo, con qué mensaje real.
- Bucle visual contra el mockup: sesión (vacía, con marcas, con la gravedad desactivada), exploración,
  cerrar en las dos variantes de rol, a **1024 px apaisado, 390 y 320**. **Mide los objetivos táctiles
  del mapa en la captura** (≥ 44 px). En `docs/qa/`.
- CI verde; `COPY` del Dockerfile y variables del compose si nace algo (sus tests ya lo vigilan).
- `docs/blocks/clinica-3-done.md` con la estructura de la metodología, decisiones tomadas sin
  preguntar, dudas abiertas y cómo se despliega. Dice si la rama está pusheada y si hay PR.
- Commits pequeños en español, **push de la rama y PR contra `master` (autorizado)**, y espera la CI
  del PR. Ni merges ni despliegues: eso lo hace Dirección. **Un árbol, un escritor**: no abras otra
  sesión sobre este worktree.
