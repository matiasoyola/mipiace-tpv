# Bloque cogecop-1 · la historia de Rosario entra entera

Rama `cogecop-1`, worktree `~/Developer/Claude/Projects/mipiacetpv-cogecop-1`, desde `origin/master`. Escrito el
29-10-2026. Vertical **clínica**. Puede escribirse en paralelo a `clinica-11`; **correr contra producción solo con
clinica-11 desplegado** (Sentry sin datos de salud).

Lee antes:
1. El análisis: proyecto de Claude, `claude/cogecop-rosario-analisis.md` (Matías te lo pega si no lo tienes). Resumen
   abajo.
2. `packages/clinica-sesion/src/listas.ts` (`LESIONES_V1`, versionado), `mapa.ts` (`MAPA_PIE_V1`, zonas por pie),
   `historia.ts` (la historia viva, `estadoDeLasZonas`), `sesion.ts` / `sesion-v2.ts` (forma del `body` de una
   sesión).
3. `apps/api/src/clinica/cripto-campos.ts` (cifrado de `body` y de `Client.notesCifradas`), `historia.ts`, `notas.ts`.
4. `schema.prisma`: `Client`, `ClinicalEntry` (inmutable por trigger, `ClinicalEntryKind`), `ClinicalAssessment`.
5. Cómo se corre un script contra producción: `apps/api/src/scripts/` y la receta `docker exec -w /repo/apps/api
   mipiacetpv-api sh -lc "node_modules/.bin/tsx src/scripts/<script>.ts"`.

## Por qué existe

Rosario lleva su clínica en COGECOP (el programa del Consejo de Podólogos, Firebird, solo Windows). Nos ha dado su
copia: **3.681 pacientes, 9.569 visitas (feb-2025 → hoy), 52.003 lesiones marcadas en el mapa del pie, 5.962
tratamientos, dos podólogas** (Rosario, especialista 1: 6.130 visitas; Marta, especialista 2: 3.424). Sin agenda ni
facturas: eso no lo usaba.

¿Y qué?: **el primer día con nosotros, Rosario abre a cualquier paciente y ve todo lo que le hizo, y el mapa del pie
parte de cómo lo dejó en la última visita.** Si tiene que mirar el programa viejo, no deja el programa viejo. Y en
cada podóloga que venga de COGECOP (el que regala el Colegio) esto se repite.

## Los datos (ya exportados, fuera del repo)

Carpeta en el Mac de Matías: `~/Downloads/rosario-bbdd/export/`. JSON UTF-8, una lista de objetos por fichero:
`pacientes`, `visitas`, `marcas_pie`, `tratamientos_visita`, `paciente_especialista`, `personal`, `cat_tratamientos`,
`cat_patologias` (144), `cat_servicios`, `cat_formas_pago`, `cat_tipo_especialista`, `cat_profesion`, `cat_sexo`.
Abre los ficheros para ver los campos; **no copies ni un registro real al repo, a un test, a un log ni a un `-done`.**
Los tests usan un **generador de datos falsos con la misma forma**. Añade `*.gbk` y `**/cogecop-export/` a `.gitignore` por si acaso. El generador y el script comparten un esquema Zod
del export: un test valida que el generador produce exactamente esa forma.

Datos a saber (recuentos): móvil en 3.420, fijo 476, email 3, NIF 7, nacimiento 3.662, 2 fechas imposibles (una en el
año 8018), 63 sin LOPD marcada, 9 difuntos. Enfermedades, alergias, comentarios y otros datos son texto libre (sin
RTF); muchas alergias dicen «no»/«ninguna». Visitas: motivo, evolución, diagnóstico, recomendación (textos cortos), y
6 de cirugía y 9 de biomecánica con sus propios textos.

## Decisiones (Dirección, 29-10)

- **Sin pérdida.** Todo lo que tenga contenido entra. Lo que no tiene sitio propio va cifrado a las notas.
- **Lo importado es historia, no sesión.** No se puede editar (inmutable, como todo), no genera cobros ni cuenta como
  sesión cerrada para nada de caja o bonos, y se ve con la etiqueta «Importada de COGECOP» en su fecha real.
- **No sustituye a la valoración inicial.** Las enfermedades y alergias que traía son texto sin validar: se enseñan
  en la ficha como «De COGECOP · sin validar», y la primera vez que vuelva el paciente se hace la valoración como a
  cualquiera (regla de clinica-2). Pero que se vean: «nadie trata a un diabético anticoagulado sin saberlo».
- **Idempotente.** Correrlo dos veces no duplica nada: id determinista por paciente (UUID v5 de
  `cogecop:<tenantId>:paciente:<id>` en `Client.externalId`) y `cogecopId` en cada entrada importada.
- `marketingOptIn = false` para todos. Los difuntos entran (es historia clínica) marcados en sus notas y excluidos de
  avisos y recordatorios.

## Lo que entra

1. **`LESIONES_V2`** en `listas.ts`: las 7 de la V1 **más** onicogrifosis (7.022 marcas, la segunda más usada; label
   «Uña engrosada (onicogrifosis)»), hematoma subungueal, xerosis («Piel seca (xerosis)»), onicolisis y uña distrófica.
   V1 se queda tal cual (lo escrito se lee con su versión). La sesión nueva usa la V2. Comprobar que la pantalla de la
   sesión y el informe PDF la pintan sin cambios de layout a 390 px y 1280×800.
2. **Tabla de traducción de patologías** (144 → id de lesión V2 o `null`), en el paquete puro, con test. Partida:
   hiperqueratosis* y queratodermias → `dureza`; heloma* → `callo`; onicocriptosis → `unero`; onicomicosis* →
   `onico`; papilomas, verrugas, epidermodisplasia verruciforme → `verruga`; onicogrifosis → `onicogrifosis`; las
   úlceras → `herida`; hallux valgus / deformidades → `juanete`. Lo que no encaje, `null`. **Siempre se guarda además
   el nombre original** de COGECOP en la marca.
3. **Traducción de las marcas del mapa (X/Y → pie + zona de `MAPA_PIE_V1`).** Cada marca es un icono de 16×16 en
   píxeles sobre uno de tres dibujos:
   - **Dibujo 0** (~320×170): las diez **uñas** vistas desde arriba, cinco grupos por pie (centros aprox. x≈40, 60,
     85, 108, 140 y x≈220, 250, 275, 295, 310). → zonas de dedo `h`, `d2`…`d5`.
   - **Dibujo 2** (~330×290): las dos **plantas**: dedos arriba (y<60), antepié (y≈70–140) y talón (y≈240–270). →
     `h`/`d2`…`d5`, `m1`/`m2`/`m35`, `arco`/`lat`, `talon`.
   - **Dibujo 3**: 12 marcas. Sin zona.
   Hazlo con centroides **sacados de los datos** (agrupa por dibujo y mitad), fija la tabla resultante en código y
   pruébala. Las marcas lejos de todo centro → `null` de zona (se conservan con su nombre y su dibujo).
   **⚠ Qué mitad es el pie izquierdo no se adivina.** Va en una constante `LATERALIDAD_COGECOP` que el script exige
   confirmada (`--lateralidad=izquierdo-a-la-izquierda|izquierdo-a-la-derecha`, sin valor por defecto). Matías la
   confirma con una captura de la pantalla de quiropodia de Rosario.
4. **Pacientes → `Client`.** `firstName`/`lastName`; `phone` = móvil, si no fijo, si no trabajo (normalizado a E.164
   España); `email` = email1; `birthdate` si es válida (fechas imposibles → null, y se cuentan en el informe). Todo lo
   demás que tenga contenido (enfermedades, alergias, comentarios, otros datos, alerta, nº de historial antiguo,
   domicilio/población/CP/provincia, NIF, sexo, profesión, LOPD sí/no, difunto, primera y última visita, especialista
   asignada) → `notesCifradas`, como texto legible con un encabezado «Importado de COGECOP el <fecha>». Nada de eso en
   `notes` en claro.
5. **Visitas → `ClinicalEntry`** de un kind nuevo `IMPORTED_VISIT` (migración aditiva del enum), con `createdAt` = fecha
   de la visita (la historia ordena por ahí), autora = la usuaria que corresponde a su especialista (parámetros
   `--autora-1=<userId> --autora-2=<userId>`; si falta una, el script se niega), `body` cifrado con
   `{ origen: "cogecop", cogecopId, tipo: "quiropodia"|"cirugia"|"biomecanica"|"general", motivo, evolucion,
   diagnostico, recomendacion, alerta, tratamientos: [nombre], marcas: [{ dibujo, pie, zona, lesion, lesionOriginal,
   curado }] }`. Si el trigger de inmutabilidad o el CHECK del cuerpo cifrado no dejan insertar con `createdAt` del
   pasado, se ajusta en la migración **solo para este kind** y se justifica.
6. **Se ve en la historia**: la lista de visitas las enseña con su fecha, autora, tratamientos y textos, y la etiqueta
   «Importada de COGECOP». La historia viva (`historia.ts`) las tiene en cuenta: **el estado de los pies de partida
   es el de la última visita importada** (y lo dice). La primera sesión en mipiacetpv parte de ahí, como si fuera la
   sesión anterior.
7. **El script** `apps/api/src/scripts/importar-cogecop.ts`:
   - `--tenant=<id> --dir=<carpeta> --autora-1 --autora-2 --lateralidad` y `--dry-run` (por defecto) / `--ejecutar`.
   - El `--dry-run` no escribe y saca **solo recuentos**: pacientes nuevos / ya importados, visitas, marcas con y sin
     zona, lesiones sin traducir (por nombre de patología, que es catálogo, no dato de paciente), fechas imposibles,
     difuntos, sin teléfono. **Ni un nombre, teléfono ni texto clínico en la salida.**
   - Por lotes y en transacciones por paciente (o por lotes de pacientes), reanudable si se corta.
   - Rechaza correr si la cuenta no es de vertical clínica o no tiene clave clínica (`ClinicalTenantKey`).
8. **Personal**: Marta se da de alta a mano como sanitaria antes de correrlo (Matías). El script no crea usuarios.

## Lo que NO entra

- Las fotos y adjuntos: en su copia las carpetas vienen vacías.
- El banco de imágenes y los iconos de COGECOP (son del programa, no de Rosario).
- Agenda y facturas (no las usaba). Pie de riesgo, cirugía y biomecánica como pantallas nuevas: sus pocas visitas
  entran como historia con su `tipo`.
- Un importador en el panel para otras clínicas. Se hará cuando llegue la segunda; este script ya deja la traducción
  en el paquete puro para reutilizarla.

## Cómo se da por hecho

- Suite verde en local y CI. **Tabla de sabotajes en el `-done`**, fichero entero. Mínimo: correr dos veces no
  duplica; una marca de dibujo 0 en el centro de un grupo cae en su dedo; una patología sin traducir guarda su nombre
  original; el `--dry-run` no escribe; la salida del script no contiene ningún valor del generador marcado como
  personal (centinela); sin `--lateralidad` no corre; la entrada importada no se puede editar ni genera cobro; la
  historia viva parte de la última importada; la V1 de lesiones se sigue leyendo igual.
- **Ensayo con los datos reales EN LOCAL** (Postgres del Mac, nunca producción desde aquí): `--dry-run` y `--ejecutar`
  contra una cuenta de clínica local, y el informe de recuentos en el `-done` (solo recuentos). Comprobar a mano dos o
  tres fichas en el TPV local y decir qué se vio sin copiar datos.
- Capturas **con datos del generador**, no reales: ficha con «De COGECOP · sin validar», historia con visitas
  importadas, mapa de partida.
- `docs/blocks/cogecop-1-done.md` con lo hecho, decisiones tomadas sin preguntar, sabotajes, recuentos del ensayo y
  **«Al ejecutar en producción»**: los pasos para llevar la carpeta al VPS (`scp` a `/root/cogecop-rosario/`, `docker
  cp` al contenedor), `--dry-run`, `--ejecutar`, y **borrar las copias** del VPS y del contenedor al acabar. Requisito
  previo escrito arriba del todo: clinica-11 desplegado.
- **Push de la rama y PR abierto: autorizados.** Ni merge, ni despliegue, ni ejecutar contra producción.
