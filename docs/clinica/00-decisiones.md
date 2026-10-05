# Historia clínica · decisiones (valoración, 05-10-2026)

Copia en el repo de `claude/historia-clinica-decisiones.md` (proyecto). Diseño funcional validado por
Matías pieza a pieza el 05-10-2026.

## Cliente
- Una clínica de podología lo pide. Hoy lleva las historias en papel y archivos sueltos (no hay que migrar desde otro programa). No hay fichas que copiar: se diseñan desde cero.
- Se le implanta la secuencia entera: pacientes + agenda + cobro + bonos + historia, para que una sola persona lo lleve con fluidez.
- Hoy trabaja sola; a veces tiene recepcionista.
- Muchos pacientes son de edad avanzada y poco duchos en tecnología.

## Plataforma: iPad
- Esta parte es «muy de iPad»: ya no vale sólo con la APK. Hoy sólo existe `@capacitor/android`.
- La cuenta de Apple Developer no es problema (Mi Piace la tendrá por otros proyectos).
- Recomendación: app iOS con Capacitor (mismo bundle; Safari puede borrar el IndexedDB de una web que no se abre en días, y ahí vive la caché y la cola offline). Distribución privada (Apple Business Manager o TestFlight para el piloto).
- Impresión en iPad: sin USB; impresora de red, Bluetooth o AirPrint.

## Marco
- Historia clínica legal (Ley 41/2002 + RGPD art. 9): no se borra, conservación ≥ 5 años, autoría, registro de accesos, acceso del paciente. Mi Piace = encargado de tratamiento. Validar con abogado de protección de datos.
- Verifactu: mipiacetpv ya es el SIF; no es motivo para conectar Holded.
- `packages/verifactu/src/registro.ts` declara siempre `S1`: los servicios sanitarios suelen ser exentos (art. 20.Uno.3 LIVA) → bloque propio tras la asesoría.

## Roles y acceso
- Roles visibles: cajero, cajero-sanitario, sanitario (sólo su agenda + historias, sin caja). Dueña y encargado, sanitarios o no.
- Por dentro: rol de negocio y marca sanitaria separados.
- Alcance por sanitario: todos o selección. La selección se llena sola al asignarle una cita; la dueña/encargado añade y revoca a mano.
- Un paciente puede pertenecer a varios sanitarios. El anterior sigue viéndola mientras no se le revoque; una cita nueva le devuelve el acceso.
- Todo acceso a una historia queda registrado.

## Diseño de la historia
- Mucho clic, poco escribir; sin sobrecargar de texto la pantalla para que todo fluya.
- La agenda sólo muestra datos de contacto. Las alertas de salud viven sólo dentro de la historia.
- 1 · Valoración inicial: test de crónicas que rellena el paciente (email al dar la cita o tablet en sala), lo valida el sanitario con confirmaciones antes del primer tratamiento. Pensado para mayores (una pregunta por pantalla, Sí/No grandes, «No lo sé», palabras de la calle, sin contraseñas, puede responder un familiar).
- 2 · Exploración: mapa de ambos pies; lesión + gravedad por zona; pulsos, monofilamento, tipo de pie. La visita siguiente parte de lo anterior.
- 3 · Sesión: desde la cita; «Igual que la última vez»; tratamientos en botones ligados a zona; dolor 0–10 con gráfica; evolución; consejos para casa; próxima cita con un toque; al cerrar pasa sola a caja; cerrada no se edita (sólo anotaciones).
- 4 · Fotos: cámara de la tablet, por zona, antes/después; nunca en la galería.
- 5 · Consentimientos: plantillas por tratamiento; firma con el dedo → PDF; la sesión la pide si el tratamiento lo requiere.
- 6 · Informe PDF: resumen o últimas sesiones con gráfica; para paciente, derivación o petición de acceso; con colegiado; queda registrado a quién se entregó.
