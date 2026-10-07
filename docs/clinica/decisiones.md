# Historia clínica · decisiones (valoración, 05-10-2026)

Ampliación de los contactos de mipiacetpv para pequeñas clínicas sanitarias (podología, fisioterapia). Referencia: la parte clínica de ClinicCloud, mejorada. **Estado: diseño funcional validado por Matías (6 piezas). Frente C del tablero desde el 05-10. Bloque `clinica-1` (cimientos) hecho: rama `clinica-1`, PR #7, CI en curso; lleva migración.**

## Cliente
- Una clínica de podología lo pide. Hoy lleva las historias en papel y archivos sueltos (no hay que migrar desde otro programa). No hay fichas que copiar: se diseñan desde cero.
- Se le implanta la secuencia entera: pacientes + agenda + cobro + bonos + historia, para que una sola persona lo lleve con fluidez.
- Hoy trabaja sola; a veces tiene recepcionista.
- Muchos pacientes son de edad avanzada y poco duchos en tecnología.

## Plataforma: iPad (Matías, 05-10)
- Matías: esta parte es «muy de iPad»; **ya no vale sólo con la APK**.
- Hoy el TPV sólo existe como app Android (Capacitor, `apps/tpv-android`, sólo `@capacitor/android`). No hay proyecto iOS.
- La cuenta de Apple Developer no es problema: Mi Piace la tendrá por otros proyectos (Matías).
- **Recomendación de Claude: app iOS con Capacitor** (mismo bundle que Android, patrón A4). Motivo: Safari puede borrar el almacenamiento local (IndexedDB) de una web que no se abre en unos días, y el TPV guarda ahí la caché y la cola offline; dentro de una app eso no pasa. Distribución sugerida: app personalizada vía Apple Business Manager (no pública) o TestFlight para el piloto.
- Impresión de tickets en iPad: no hay USB como en el AP12; habría que ir a impresora de red, Bluetooth o AirPrint.

## Marco
- Fisio y podología son sanitarios → historia clínica legal (Ley 41/2002 + RGPD art. 9): no se borra, conservación ≥ 5 años, autoría, registro de accesos, acceso del paciente. Mi Piace = encargado de tratamiento de datos de salud. Validar con abogado de protección de datos.
- Verifactu: mipiacetpv ya es el SIF (desde el 23-09); Verifactu no es motivo para conectar Holded.
- **Hueco detectado:** `packages/verifactu/src/registro.ts` declara siempre `S1` (sujeta y no exenta). Los servicios sanitarios suelen ser exentos (art. 20.Uno.3 LIVA) → bloque propio tras la asesoría.

## Roles y acceso (decidido por Matías)
- Roles visibles: **cajero**, **cajero-sanitario**, **sanitario** (solo su agenda + historias, sin caja). Dueña y encargado también pueden marcarse como sanitarios o no.
- Por dentro: rol de negocio y marca sanitaria guardados por separado.
- Cada sanitario tiene alcance **todos** o **selección** de pacientes.
- La selección se llena sola al asignarle una cita al sanitario (también al mover una cita a otra sanitaria); la dueña/encargado puede añadir a mano.
- Un paciente puede pertenecer a varios sanitarios.
- Al cambiar de especialista, el anterior **sigue viendo la historia mientras no se le revoque** el acceso. Una cita nueva con ese paciente le devuelve el acceso; la revocación queda registrada.
- Todo acceso a una historia queda registrado.

## Decisiones del cierre de clinica-1 (aceptadas por Matías, 05-10)
- **Supresión RGPD vs. conservación**: si un paciente pide borrar sus datos, la historia clínica se conserva (obligación legal de la Ley 41/2002; el RGPD exceptúa el borrado cuando hay obligación legal de conservar). Va a la consulta al abogado (tarea humana 11), no bloquea.
- **El módulo clínico lo enciende el super-admin, no la dueña desde Ajustes**: encenderlo es asumir un registro legal de datos de salud; se hace tras hablarlo con la clínica. Cambiarlo es una línea, ya marcada en el código.

## Diseño de la historia
- Regla: **mucho clic, poco escribir**, y **sin sobrecargar de texto la pantalla para que todo fluya** (lo imprescindible a la vista, el resto plegado).
- Estructura en 6 piezas, todas validadas: 1) valoración inicial y alertas · 2) exploración con mapa del pie · 3) sesión · 4) fotos · 5) consentimientos · 6) informe PDF. Las listas clínicas exactas las afina la podóloga.
- **La agenda sólo muestra datos de contacto** (la ve la recepcionista). Las alertas de salud viven sólo dentro de la historia.

### Pieza 1 · Valoración inicial
- Paciente nuevo → **valoración inicial** con un test de enfermedades crónicas que haya que conocer.
- **La rellena el paciente** antes de empezar, para ganar tiempo; **la valida el sanitario**, con confirmaciones previas **antes del primer tratamiento** (no se registra tratamiento sin validar). Lo que contestó el paciente no se borra; las correcciones del sanitario quedan con autor.
- Lo marcado como riesgo sube a la franja de alertas de la historia.
- Puede ser un servicio del catálogo («Primera valoración»). Se puede repasar más adelante sin sobrescribir la anterior.
- Canal: **enlace por email** al dar la cita + **tablet en la sala de espera** (bloqueada en el test). WhatsApp/SMS más adelante (no hay proveedor).
- Pensado para mayores: una pregunta por pantalla, letra grande, Sí/No enormes, «No lo sé» siempre, palabras de la calle, sin contraseñas, «pregunta 4 de 12», puede responder un familiar (queda dicho quién).

### Pieza 2 · Exploración con mapa del pie
- Dibujo de ambos pies (planta y dorso); se toca la zona y se elige lesión de una lista corta (heloma, hiperqueratosis, onicocriptosis, onicomicosis, verruga, úlcera, deformidad) con gravedad leve/moderada/severa.
- Pulsos pedios (presente/débil/ausente) y monofilamento marcando puntos en el mapa; tipo de pie (plano/normal/cavo).
- En la visita siguiente el mapa sale con lo anterior marcado: sólo se toca lo que cambia.

### Pieza 3 · Sesión
- Se abre desde la cita con paciente, servicio, fecha y sanitario puestos.
- Botón «Igual que la última vez».
- Tratamientos realizados en botones, ligados a la zona del mapa.
- Dolor 0–10 (EVA) en barra grande → gráfica de evolución; evolución mejor/igual/peor.
- Consejos para casa en botones → hoja impresa o por email.
- Próxima cita con un toque (2/4/8 semanas) directamente en la agenda.
- Al cerrar, pasa sola a caja con lo hecho (incluido lo añadido fuera de la cita).
- Cerrada no se edita: sólo anotaciones con fecha y autor. Texto libre opcional.

### Pieza 4 · Fotos
- Cámara de la tablet desde la sesión, tocando la zona del pie.
- Secuencia antes/después por zona.
- Sólo las ve quien puede ver la historia; nunca van a la galería de la tablet.

### Pieza 5 · Consentimientos
- Plantillas por tratamiento (cirugía ungueal, anestesia, fotos); pueden ser las que ella ya usa.
- Si el tratamiento lo requiere, la sesión pide la firma antes de empezar.
- Firma con el dedo en la tablet → PDF con fecha.
- **Desde el 07-10 se construye sobre la tabla común `ClientConsent`** (ver «Solapes», S3).

### Pieza 6 · Informe PDF
- Con un toque: resumen de la historia o últimas sesiones con la gráfica de dolor.
- Usos: entregar al paciente, derivar, atender una petición de acceso a la historia.
- Con datos de la clínica, nº de colegiado y fecha. Imprimir o email; queda registrado a quién se entregó.

## Solapes con la agenda común (07-10, OK de Matías)
Detalle completo y estado vivo en `claude/solapes-clinica-agenda.md` (documento compartido con la conversación de reservas).

### S3 · Consentimientos → tabla común `ClientConsent` (decidido)
- No hay tabla clínica de consentimientos: la pieza 5 se construye sobre `ClientConsent` (`kind = TREATMENT`), que también usa el spa.
- `client_id` pasa de `CASCADE` a `RESTRICT`; tabla de solo inserción. Revocar = fila nueva enlazada (también para `DATA`/RGPD).
- Plantilla común, versionada y atada al servicio; la fila congela versión, texto (o huella) y huella SHA-256 del PDF. Filas antiguas = «alta manual sin plantilla».
- Firmante (paciente o representante, con relación) e informante (`User`; sanitario obligatorio sólo si la plantilla es clínica).
- Plantilla marcada «clínica» → el PDF pasa por el control de acceso de la historia y queda en `ClinicalAccessLog`.
- **Lo clínico se firma en consulta**, con el sanitario delante; por enlace sólo se lee antes.
- **Supresión RGPD = bloquear y anonimizar al vencer el plazo de conservación.** Paciente con historia: plazo legal (≥ 5 años). Cliente sin nada que conservar: plazo 0. Pendiente de validar con el abogado (tarea humana 11).

### S1 · Enlaces públicos → una tabla y una puerta comunes (decidido)
- Huella SHA-256, caducidad y usos por `purpose`, revocación, 404 genérico, mismas cabeceras y límites.
- Perfiles: solo escribir (todo lo clínico; nunca devuelve datos de salud), solo leer (consentimiento antes de firmar), leer y actuar sobre su cita («mi cita»).
- El enlace de la valoración apunta a la valoración, no a la cita: mover o anular la cita no lo toca.
- La valoración de clinica-2 migra a la tabla común. `Ticket.publicSlug` queda fuera.

### S2 · Cuestionarios → pantalla y formato comunes, respuestas separadas (decidido)
- Un solo reproductor (el de `TestPaciente.tsx`) y un solo formato (versionado en código, ids estables).
- Las respuestas de la valoración siguen en `ClinicalAssessment`; las de satisfacción, en una tabla común.
- El cuestionario clínico no lo edita el centro.
- La encuesta post-visita común **no** se manda a citas de servicios clínicos salvo que la clínica la active.
- clinica-2 no se toca hasta el bloque de la encuesta, que extrae el reproductor.

### S4 · Notas → ficha técnica común (no salud) e historia (salud) (decidido por delegación)
- En citas de servicios clínicos, el botón de nota abre la historia; la ficha técnica se sigue leyendo en la cabecera, plegada.
- En centros con módulo clínico, la ficha técnica avisa «no escribas datos de salud aquí»; las alergias van a las alertas de la valoración.
- Lo logístico de una cita va en la nota de la cita. Lo clínico suelto, en la nota de la historia.
- Ficha técnica de solo inserción. Nada se migra solo de la ficha a la historia.

### S5 · Especialidad → en la categoría del catálogo (decidido por delegación)
- No hay tabla de familias: el agrupador único es la categoría del catálogo (`Product.tags` + `TagAlias`); `ServiceScheduling.family` desaparece.
- La especialidad (lista cerrada en código) se asigna a la categoría con el patrón de `TagSection`; los servicios la heredan.
- Dos especialidades distintas en un servicio: no se guarda. En centro clínico, servicio de sesión sin especialidad: no se guarda.
- La especialidad sólo actúa en citas, sólo propone el IVA exento y se congela en cada `ClinicalEntry`.

### S6 · Bonos → el común de B-8, reservar al citar y consumir al cobrar (decidido, OK de Matías)
- Vale por servicio o por categoría; un bono por cita; el libro manda sobre el saldo.
- Al dar la cita (o «próxima cita» desde la sesión) se reserva; al cobrar se consume contra lo hecho, línea a 0 €; si lo hecho no lo cubre, se libera y se cobra normal.
- Sanitario sin caja: «quedan N · M reservadas», nunca euros. Bono del paciente. Caducado no se borra.
- Venta = ticket nuestro, exenta si el servicio lo es. El consumo no se enciende en producción sin la asesoría. Bonos en papel = «alta inicial» a mano.

## Historia viva · mockup v2 validado por Matías (07-10)
Mockup: `docs/mockups/clinica-historia-v2.html` (sustituye a `clinica-historia-ficha.html` como referencia visual). Regla de Matías: **muy visual, muy fácil, muy moderno, y eficaz** (no basta con que guste).
- **«Carmen en 10 segundos»** bajo las alertas: Hoy toca · Dolor · Última vez · Ojo hoy.
- **«Hoy toca»** es la tarjeta grande (doble ancho), en coral luminoso, y **se pulsa**: abre la nueva visita con el tipo ya marcado. No desaparece hasta que se hace; al cerrar la sesión sin hacerlo, pregunta.
- **Pie vivo**: los dos pies con cada zona coloreada por estado (activa / mejorando / curada); al tocar una zona, su evolución en línea y foto antes/hoy con deslizador. Capa de sensibilidad (monofilamento).
- **Tipos de visita** (de COGECOP): Quiropodia · Pie de riesgo · Biomecánica · Cirugía · General. «Nueva visita» los ofrece en tarjetas y recomienda uno (lo que toca hoy, o pie de riesgo si es diabética). Cada tipo abre su pantalla con sus botones.
- **Quiropodia en 3 niveles** (básica 25 € · completa 26 € · extra 27 €, mismos 30 min): la cita se da como «Quiropodia»; en la sesión el programa **propone el nivel según lo hecho** y se cambia con un toque. En «Visitas» se ve el nivel (título + 3 barras). **Pendiente: qué incluye cada nivel, preguntar a Rosario.**
- **Sesión por tipo de visita** (mockup `docs/mockups/clinica-sesion-v2.html`): **una visita puede tener varios tipos** (Matías, 07-10: «permitimos, se anotan y se cobran»). Cada tipo marcado añade su tarjeta y su línea a caja (p. ej. quiropodia completa + cura de la cirugía). Quiropodia propone el nivel por lo hecho; pie de riesgo calcula el riesgo y propone el plazo de revisión; la revisión de cirugía valora la herida. Alertas cruzadas con lo que se hace (anticoagulada + cortar; diabética + infección). Reglas y precios del mockup son de ejemplo hasta validarlos con Rosario.
- Referencia del software actual de Rosario: `docs/clinica/referencia-cogecop.md`. Gancho de venta: migración desde COGECOP (Firebird + carpeta de adjuntos), con contrato de encargado firmado antes.

## Pendiente
- `clinica-1`: CI verde → merge del PR #7 → copia de la BD → despliegue (lleva migración).
- Siguiente bloque: valoración inicial (pieza 1), con su mockup antes.
- Confirmar la impresora para iPad.
- Próxima visita a Rosario: qué incluye cada nivel de quiropodia; fotos de su COGECOP (ficha y una visita de cada tipo); copia de su base de datos para preparar la migración.
- Asesoría: IVA exento de los servicios y obligación de facturar.
- Abogado de protección de datos: contrato de encargado, evaluación de impacto, supresión vs. conservación (ahora: «bloquear y anonimizar al vencer el plazo»).
