# Bloque clinica-4 · fotos, consentimientos e informe

Rama `clinica-4-fotos-consentimientos-informe`, worktree
`~/Developer/Claude/Projects/mipiacetpv-clinica-4`, desde `origin/master` (`b7bc8be` o posterior:
lleva clinica-5 y clinica-6, y clinica-6 está en producción). Frente C. Escrito por Dirección el
08-10-2026.

Lee antes, en este orden:
1. `docs/mockups/clinica-4-fotos-consentimientos-informe.html` — **la spec visual, validada por
   Matías el 08-10.** Recórrela entera: las tres pestañas, la cámara con zona elegida antes de
   disparar, el comparador, la firma con el dedo y los cuatro tipos de informe. Se copia estructura,
   textos y estados; no se interpreta. **Los datos y los textos de las plantillas son inventados.**
   Si el mockup choca con una decisión de abajo (sobre todo con S3), **manda la decisión**, y lo
   dices en el `-done`.
2. `docs/clinica/solapes-clinica-agenda.md` §S3 (consentimientos sobre la tabla común) y §S1
   (enlaces públicos: aquí NO se usa ninguno).
3. `docs/blocks/clinica-6-done.md` — la historia viva deja dos huecos que este bloque llena: el
   comparador «Sin fotos de esta zona» y la fila de consentimientos de «Documentos».
4. `docs/blocks/clinica-5-done.md` y `clinica-3-done.md` — la sesión, el mapa del pie
   (`MapaDelPie.tsx`, el único sitio donde se dibuja) y la firma de la sesión (`clinicianLicense`).
5. `docs/clinica/decisiones.md` (piezas 4, 5 y 6) y `docs/blocks/clinica-1-done.md` (acceso,
   `conHistoria`, `ClinicalAccessLog`).

## Por qué existe

Rosario hoy hace las fotos con el móvil (acaban en su galería, junto a las de su familia), firma
los consentimientos en papel y, cuando un paciente pide su historia o lo deriva, la fotocopia.

¿Y qué?: (1) la foto de la uña queda en la historia del paciente, por zona y por fecha, y se compara
antes/hoy con un toque, sin pasar por su móvil; (2) una cirugía no se empieza sin el consentimiento
firmado, y la firma vale (quién, qué texto, cuándo, delante de quién); (3) el informe para el
paciente, el colega o la petición de acceso sale con un toque y queda apuntado a quién se entregó.

## Decisiones ya tomadas — no se re-debaten

### Consentimientos (S3, decidido el 07-10)
1. **No hay tabla clínica de consentimientos.** Se construye sobre `ClientConsent`
   (`kind = TREATMENT`), que ya usa el spa desde la ficha del cliente (`crm/routes.ts`). Lo que hoy
   funciona ahí sigue funcionando.
2. Migración de `ClientConsent`: `client_id` pasa de `CASCADE` a **`RESTRICT`**; **tabla de solo
   inserción** (trigger que rechaza `UPDATE` y `DELETE`, como el sello de S1). Revocar = fila nueva
   enlazada a la que revoca (también para `DATA`). Las filas que ya existen quedan como «alta
   manual sin plantilla». Mira antes qué rompe el `RESTRICT` (borrado de clientes, tests, seed) y
   resuélvelo sin volver a `CASCADE`.
3. **Plantillas versionadas en código** (como el cuestionario de clinica-2; el centro no las edita
   en este bloque): cirugía ungueal, anestesia local y fotos clínicas. Ids estables, versión y una
   marca «clínica». Textos de ejemplo, marcados como pendientes de Rosario (ella ya usa los suyos).
4. **La plantilla se ata al servicio**: la dueña marca en el servicio qué consentimientos pide.
   Usa el sitio donde hoy se configura el servicio. «Fotos clínicas» no se ata a ningún servicio:
   la pide la primera foto.
5. La fila congela: plantilla, versión, huella del texto, **huella SHA-256 del PDF**, firmante
   (paciente o representante, con su relación) e informante (`User`; con plantilla clínica, un
   sanitario es obligatorio).
6. **Lo clínico se firma en consulta**, con el sanitario delante: firma con el dedo en la pantalla
   → PDF con fecha (con `pdf-lib`, como el Z y la declaración responsable). **En este bloque no hay
   enlace para leerlo antes**: eso queda para el bloque común de enlaces.
7. **La sesión no empieza** si su servicio pide un consentimiento que no está firmado y vigente (sin
   revocar). Hoy: un aviso y el botón «Firmar ahora», no un error.
8. Un PDF de plantilla clínica se abre por `conHistoria` y deja su línea en `ClinicalAccessLog`.

### Fotos
9. Se hacen **desde la sesión, tocando la zona del mapa**; la zona se elige antes de disparar
   (mockup). Cámara dentro de la app (`getUserMedia`), **nunca un `<input type=file>` que pase por
   la app de cámara ni por la galería**. Si hace falta el permiso de cámara en
   `apps/tpv-android`, añádelo y dilo en «Al desplegar» (obliga a una APK nueva).
10. **Antes de la primera foto de un paciente, el consentimiento de fotos firmado** (si no lo hay,
    la pantalla lleva a firmarlo, como en el mockup).
11. Se guardan **fuera de la base de datos y fuera de todo lo que se sirve en estático**: un
    volumen propio en `docker-compose.prod.yml`, con el patrón de `z_reports`. Nombre de fichero
    sin datos del paciente. Se sirven sólo por la API, por `conHistoria`, con su línea en el
    registro de accesos. Nunca en `product_images` ni detrás de Caddy directo.
12. **La copia de seguridad tiene que llevarlas**: amplía `infra/backup-postgres.sh` (o un hermano
    que corra con él) para que el volumen de fotos y PDFs entre en la copia. Una historia cuyas
    fotos no se pueden recuperar no se conserva cinco años.
13. Una foto no se borra (la historia no se borra): se puede **retirar** con autor y motivo, y deja
    de verse en el comparador, pero sigue en la historia y en el registro.
14. En la historia viva (clinica-6), el comparador antes/hoy de cada zona deja de decir «Sin fotos
    de esta zona» cuando las hay: la más antigua y la última, con su fecha.

### Informe
15. Cuatro tipos, como el mockup: **resumen de la historia**, **últimas sesiones** (las 5 últimas,
    con la gráfica del dolor), **derivación** (con un texto breve que escribe el sanitario) e
    **historia completa** (derecho de acceso). Se abre desde la historia viva.
16. Lleva los datos de la clínica, el nombre del sanitario, su **nº de colegiado**
    (`clinicianLicense`) y la fecha. **Sin importes en ningún sitio.**
17. Se **imprime** o se **envía por email**. Por email: al email del paciente o al que se escriba
    del profesional; **el cuerpo del email no lleva ningún dato de salud** (el PDF va adjunto). Toda
    entrega queda apuntada: qué informe, a quién, por qué canal, quién y cuándo, en una tabla de solo
    inserción o en `ClinicalAccessLog`; elige una y explica por qué.
18. Las fuentes de datos ya existen (clinica-2, -3, -5 y las funciones de clinica-6). El informe no
    recalcula reglas clínicas: usa las del paquete `packages/clinica-sesion`.

### Historia viva
19. La pestaña «Documentos» enseña los consentimientos firmados de verdad (con su PDF) y los
    informes entregados. Fuera el «Llega pronto».

## Lo que NO entra
- Enlaces públicos para leer el consentimiento antes, y la supresión RGPD (bloquear y anonimizar):
  bloques propios.
- Editor de plantillas para el centro. App iOS. Bonos. Dictado por voz.
- Cifrar las fotos en disco: se decide con la evaluación de impacto del abogado (tarea humana 11).
  Déjalo anotado en el `-done`, no lo construyas.

## Cómo se da por hecho
- Migración con su `down` pensado y probada en una copia, no en producción.
- Suite verde en local y CI (`ci`, `smoke`, `e2e`). **Tabla de sabotajes en el `-done`**, cada test
  visto en rojo, con el fichero de test entero (no `-t`). Como mínimo: `ClientConsent` rechaza
  `UPDATE`/`DELETE`; borrar un cliente con consentimiento no lo borra; la sesión no empieza sin el
  consentimiento que pide su servicio; un consentimiento revocado no vale; la primera foto pide el
  de fotos; la foto no sale sin `conHistoria` ni sin línea en el registro; la foto retirada sigue
  en la historia; la huella SHA-256 del PDF cuadra con el fichero; el informe no lleva importes; el
  email no lleva datos de salud en el cuerpo; la entrega queda apuntada; el spa sigue dando de alta
  su consentimiento desde la ficha.
- Bucle visual: el mockup recorrido en el producto real a **1366, 1024 y 390**, en
  `docs/qa/2026-10-xx-clinica-4/`, midiendo en la página (no a ojo) los toques ≥ 44 px y que nada
  se apile donde el mockup lo pone en fila. Paciente de demo con historia mezclada v1 + v2.
- `docs/blocks/clinica-4-done.md` con lo hecho, decisiones tomadas sin preguntar, **lo pendiente de
  Rosario** (sus textos de consentimiento, qué servicios los piden), lo pendiente del abogado
  (cifrado, email con PDF de salud) y **«Al desplegar»**: migración, volumen nuevo, copia de
  seguridad ampliada, APK nueva si hay permiso de cámara, y variables de entorno sólo si las añades.
- **Push de la rama y PR abierto: autorizados.** Ni merge ni despliegue: eso es de Dirección.
