# Bloque residencia-ingreso-documentos · el ingreso con guion y los documentos que se firman en el programa

Rama `residencia-ingreso-documentos`, worktree
`~/Developer/Claude/Projects/mipiacetpv-ingreso-documentos`, desde `origin/master`. PR contra `master`.
Escrito el 25-10-2026 desde el proyecto de Jardín de Gredos. Matías, al ver la pestaña «Ingreso y
documentos» de la ficha completa: «tiene mucha chicha; me gustaría que estuviera muy guionizada la
documentación a recoger, y que lo que sean contratos se creen y se firmen desde el mismo sistema, sin
tener que imprimir y escanear». Y después: «no sólo quiero el listado, sino la recogida de datos:
quiero que sea un **ingreso guiado**, **casi automático**». **Mockup:
`docs/mockups/residencia-ingreso-documentos.html`** (ocho pantallas: el asistente de ingreso, el
preingreso en el móvil de la familia, cómo va el ingreso en su ficha, un documento, firma aquí, firma a
distancia, el PDF firmado y las plantillas del centro). Planteamiento validado por Matías el
25-10-2026; el mockup, pendiente.

**Ábrelo cuando estén en `master` `historia-1`, `residencia-ficha-completa` y
`residencia-plaza-y-pago`** (el guion vive en la pestaña de la ficha, y el contrato y el mandato SEPA
se rellenan con la tarifa, la forma de pago y el IBAN). Si alguno no está, dilo y para.

Lee antes:
1. **El mockup**, con su leyenda en cada pantalla.
2. `docs/blocks/historia-1-done.md` (el ingreso guiado: `admission_checklist_items`, elementos que
   **se comprueban solos** y elementos con plazo) y su `IngresoResidentePage` / `IngresosPage`.
3. `docs/blocks/clinica-4-done.md` y `packages/consentimientos/` (plantillas versionadas, firmante y
   representante, informante, **la huella del texto se congela al firmar**, el trazo, la
   inmutabilidad, la tabla de sabotajes). **La firma de este bloque es esa, ampliada; no un segundo
   sistema de firma.**
4. `docs/code-prompts/bloque-contrato-lectura-completa.md` (no se acepta un texto sin recorrerlo
   entero: el mismo criterio vale aquí para quien firma).
5. `docs/blocks/residencia-3-done.md` (foto y consentimiento de imagen: se revoca con una fila nueva)
   y lo que haya en el repo para generar PDF (el informe de clinica-4) y para mandar email y SMS.

## Por qué existe

El expediente de un residente es lo que pide el inspector (R20: contrato firmado, PIAP, plan de
acogida) y hoy está en papel: se imprime el contrato, se firma, se escanea (o no), y los contratos del
Drive eran accesos directos rotos. Lo que falta se descubre cuando lo pide alguien. Y la familia
tiene que venir a la residencia a firmar cada papel.

¿Y qué?: el día del ingreso nadie tiene que acordarse de qué falta, porque el programa lo dice paso
a paso y en orden; ningún documento se teclea dos veces, porque sale relleno de la ficha; la familia
firma desde su móvil si no puede venir; y el expediente está completo y enseñable en un clic, sin
una sola hoja escaneada.

## El ingreso es un asistente, y casi automático

Esto manda sobre todo lo demás del bloque. No es una lista que manda a otras pantallas: **es un
asistente paso a paso con los campos dentro de cada paso**, y llega casi lleno porque lo rellenan la
familia y la lectura de documentos, no la dirección.

A. **«Nuevo ingreso» abre el asistente** (sustituye a la ventana de alta de alta-minima para los
   ingresos de verdad; «Añadir varios» se queda para cargar residentes que ya viven en el centro).
   Lo primero son 30 segundos: nombre de la residente, fecha prevista, y nombre y móvil de un
   familiar. Con eso existe un residente **en preingreso** (no sale en la puerta ni en el parte).
B. **El preingreso lo hace la familia desde su móvil**: el programa le manda un enlace (SMS y
   email, mismas reglas de seguridad que la firma a distancia) a una página sin cuenta, con sus
   pasos: datos del residente, su familia, **fotos de los documentos**, cómo pagará (IBAN), lo que
   necesita (ayudas, costumbres) y las primeras firmas. Sólo se le piden los documentos que su caso
   necesita; puede dejarlo a medias y volver; lo que no tenga, lo trae el día del ingreso.
C. **El programa lee las fotos y rellena los campos**: DNI (nombre, apellidos, número, nacimiento,
   sexo, domicilio), tarjeta sanitaria (NSS / CIP), resolución de la Junta (número, fecha, grado,
   régimen, copago), recibo del banco (IBAN), informe médico y hoja de tratamiento (alergias,
   diagnósticos, dieta y textura, medicación, centro de salud). A la familia se le enseña lo leído
   **administrativo** para que diga «está bien»; **lo clínico no se le enseña para corregir**: lo
   confirma la DUE.
D. **Cada campo dice de dónde salió**: «Del DNI», «De la resolución», «Lo puso Antonio», «Del
   informe · confirma la DUE». Lo leído con poca seguridad o lo clínico se pinta en ámbar y **no
   cuenta como dato hasta que alguien lo confirma**; lo confirmado guarda quién y cuándo.
   **Nada clínico entra en la ficha clínica ni en la puerta sin la confirmación de un sanitario**
   (`is_clinician`), campo a campo.
E. **Los pasos del asistente** (mockup, pantalla 1), agrupados en «Antes del ingreso» y «El día del
   ingreso»: Así empieza (estado del preingreso) · ¿Quién ingresa? · Su familia · ¿Quién firma por
   ella? · Su plaza · Lo que paga y cómo · Su salud al entrar (DUE) · Su habitación (el programa
   **propone** una cama libre, revisada y adecuada a su dependencia) · Sus pertenencias (en la
   habitación, con la tablet) · Las firmas (los documentos ya preparados: firmar aquí uno tras otro o
   mandar los que falten juntos) · Confirmar el ingreso. Cada paso tiene su responsable (Carmen, DUE,
   administración, auxiliar, familia) y le sale en su panel si le toca.
F. **Se guarda solo, se deja a medias y se salta**: «Lo completo después» en todos los pasos salvo
   el nombre; «Seguir en otro momento» vuelve a la lista con el ingreso en curso marcado. Los pasos
   se pueden hacer en cualquier orden (columna de la izquierda), y el resumen final dice lo hecho, lo
   pendiente con quién y hasta cuándo, y las tareas de los primeros 30 días.
G. **Confirmar el ingreso** es lo que hace entrar al residente: aparece en la puerta de su planta, en
   el parte y en el panel, y se le carga el plan de cuidados de su nivel. Lo pendiente no lo frena
   (alta-minima: nada administrativo bloquea la atención).
H. **Después**, la pestaña «Documentos» de la ficha (antes «Ingreso y documentos»; ahí se enciende
   «Mandar a firmar a …» en cada línea de lo que falta) enseña cómo va (pantalla 3, revisada el
   27-10-2026): una línea con las condiciones que han formado su guion, las tres fases con su
   progreso y el siguiente paso con su botón; debajo **sólo lo que falta**, agrupado en «Falta hoy» y
   «En los primeros 30 días», cada línea con quién lo hace y **su acción en la misma línea**
   (Preparar, Reenviar, Empezar, Citar); y **lo hecho plegado** («Hecho 12 · Ver»). Sin las
   etiquetas Dato / Recoger / Firmar a la vista: el icono de cada línea lo dice. **Las firmas
   pendientes de una misma persona van juntas**: «Mandárselas a su móvil» (un solo enlace con todos
   sus documentos, uno detrás de otro) o «Firmarlas aquí seguidas». Pasados los 30 días, la pestaña
   es la de la ficha completa (lo que falta arriba, lo que ya está en fichas agrupadas).
I. **En el asistente** (revisado el 27-10-2026): en «Su salud al entrar», si quien lo hace no es
   sanitario, un aviso dice que lo clínico sólo lo confirma una sanitaria y ofrece «Avisar a …
   (DUE)», que le pone el paso en su panel; en «Las firmas», «Firmar los n seguidos aquí» (uno tras
   otro, con la lectura completa de cada uno) o «Mandárselos a …».
J. **La habitación se elige en un plano, no en una lista** (lo pidió Matías el 27-10-2026). El paso
   «Su habitación» enseña **el edificio tal como es**. En Jardín de Gredos: una sola planta y 27
   habitaciones en tres alas en U (ala izquierda 20-27 bajando, ala de arriba 19…5 de izquierda a
   derecha, ala derecha 4…1 bajando), **con las habitaciones a un solo lado del pasillo** y la zona
   común en medio. Cada cama es un cuadro: ocupada (gris, con las iniciales de quien la ocupa), libre
   y revisada (verde), libre sin revisar (ámbar punteado: se puede elegir y se avisa a mantenimiento)
   y **la propuesta del programa ya marcada**, con su porqué debajo («a 8 m del control de
   enfermería; tiene disfagia y Alzheimer; comparte con alguien de su misma dependencia»). Tocar una
   cama libre la elige y cambia el porqué. En el pasillo, los hitos que el centro marque (control de
   enfermería, baño geriátrico, comedor, salida al jardín). Con más de una planta, una pestaña por
   planta con sus camas libres.
   **El plano es esquemático y sale solo** de los datos: cada habitación tiene su **ala** y su
   **orden dentro del ala**, y cada ala su posición (izquierda, arriba, derecha, abajo) y el lado del
   pasillo en que quedan las habitaciones (uno o los dos). Añade esos campos a `Room` y a una tabla
   de alas por planta, con migración; un centro sin alas se pinta como una sola fila. Dibujar el
   plano real a escala queda fuera.
   **Número y camas se cambian en el propio plano, en dos toques** (lo pidió Matías el 27-10-2026):
   *Configuración → Edificio* usa el mismo plano y, para dirección, el asistente también trae
   «Editar habitaciones». En ese modo se toca una habitación y debajo salen su **número** (texto
   libre: «12», «12 bis»), sus **camas** con un − / + (de 1 a 4; las camas nuevas nacen libres y
   sin revisar) y **«Fuera de servicio»**. Se guarda solo, sin botón, y queda en el registro de
   quién lo cambió. No se puede quitar una cama ocupada («Cambia antes de habitación a quien la
   ocupa») ni repetir un número de habitación; una habitación sin uso se marca fuera de servicio,
   no se borra. La API ya tiene `PATCH /residencia/habitaciones/:roomId` y `/camas`: úsala; lo que
   falta es la pantalla. Arrastrar para reordenar dentro del ala es deseable, no obligatorio.
   **El mismo selector** sirve para «Habitación» en la cabecera de la ficha (cambio de habitación),
   que deja su línea en Estancia.

### La lectura de documentos: cómo y con qué cuidado

- Con el modelo de visión de Claude por la API de Anthropic (Mi Piace ya trabaja con Claude), con
  salida estructurada por tipo de documento y **un nivel de confianza por campo**. Si no se lee bien,
  el campo queda vacío, no inventado.
- **Es un tratamiento de datos de salud y de identidad por un tercero**: Anthropic entra como
  **subencargado** de Mi Piace. Antes de encenderlo en producción hay que (1) revisar el contrato de
  encargado que aceptó el centro y añadir el subencargado (probablemente una versión nueva del
  contrato, que la propietaria acepta como la v2), (2) usar la API sin retención para entrenamiento,
  y (3) dejarlo en el registro de actividades. **El done lo dice como condición, no lo da por hecho.**
- **Interruptor por centro, apagado por defecto**: con la lectura apagada, el asistente funciona
  igual y los campos se teclean. Las fotos se guardan siempre (cifradas), se lean o no.
- Nada de lo leído va a logs. Las fotos se mandan a leer y no se guardan fuera del volumen del centro.

## Decisiones de producto ya tomadas — no se re-debaten

1. **Los pasos del asistente son el ingreso guiado de historia-1, ampliado** (no una lista nueva al
   lado). Cada paso
   tiene: **momento** (Antes del ingreso · El día del ingreso · Primeros 30 días), **clase**
   (**Dato**: se comprueba solo con la ficha · **Recoger**: un documento que trae alguien · **Firmar**:
   un documento que genera el programa), **quién lo hace** (rol), **por qué hace falta** (una frase),
   **condición** y **plazo** opcional en días desde el ingreso. Los códigos de historia-1 se
   conservan y se mapean.
2. **El guion se adapta al residente** con las condiciones de cada paso: siempre · plaza concertada ·
   plaza privada · paga por recibo domiciliado · firma un representante (y de qué clase) · sujeción
   prescrita (uno por tipo) · lo que el centro configure. **Lo que no aplica no sale**, y debajo se
   dice en una línea qué no aplica y por qué. Arriba: «Este guion se ha hecho para su caso» con las
   condiciones que lo han formado, y las tres fases con su progreso.
3. **«Siguiente paso»**, destacado arriba con su botón: el primero pendiente en orden, con su «por
   qué». Los pasos con plazo vencido se pintan en rojo y salen en el panel de dirección (ya lo hace
   historia-1 con los ingresos pendientes).
4. **Quién firma por el residente** es el segundo paso de todo ingreso, porque decide el resto: el
   propio residente, o un representante con su **base**: guardador de hecho · curador o medida
   judicial de apoyo (Ley 8/2021) · apoderado (poder notarial). Cada base pide su acreditación:
   «Declaración de guardador de hecho» (Firmar), resolución judicial o poder (Recoger). Amplía el
   `Firmante` de clinica-4 con la base; la relación sigue siendo obligatoria.
5. **Recoger** = foto o PDF desde la cámara de la tablet o del móvil, o un fichero, **desde el propio
   paso**, con varias páginas si hace falta. Cada documento recogido tiene tipo (DNI, tarjeta
   sanitaria, informe médico, resolución de la Junta, documento de representación…), se guarda
   cifrado como la foto del residente, se ve en su expediente y puede tener fecha de caducidad
   (el DNI caduca: aviso 30 días antes).
6. **Plantillas del centro** (*Configuración → Plantillas de documentos*): texto con **huecos que se
   eligen de una lista** (`{residente.nombre}`, `{residente.dni}`, `{cama.habitacion}`,
   `{plaza.tipo}`, `{tarifa.aportacion}`, `{pago.forma}`, `{pago.iban}`, `{representante.nombre}`,
   `{centro.nombre}`, `{fecha}`…), cuándo se pide (la condición del guion) y quién firma (uno o
   varios papeles: residente o representante, titular de la cuenta, el centro, el médico, una
   auxiliar). **Versionadas**: cambiar una plantilla crea la versión siguiente y lo firmado conserva
   la suya. Un editor de texto sencillo (párrafos, negrita, listas y huecos), no un procesador de
   textos. La lista de plantillas (pantalla 8) dice de cada una cuándo se pide, quién firma y su
   **estado**: «En uso · vN» o «Falta vuestro texto»; toda la fila abre la plantilla.
7. **Los textos los escribe Mi Piace, desde cero, y los aprueba el centro** (decidido por Matías el
   27-10-2026: no se parte de los Word antiguos del centro, que estaban desfasados —el contrato de
   2021 citaba la LOPD 15/1999 y sometía a la familia al fuero del centro—). **La siembra son las
   plantillas de `docs/residencia/plantillas/`** (léelas enteras, empezando por `00-LEEME.md`):
   contrato de estancia (condiciones generales) + anexo económico de plaza privada o de plaza
   concertada (se elige por la condición del guion) · reglamento de régimen interior con su resumen
   en lectura fácil · protección de datos (información del art. 13 RGPD y tres consentimientos con
   sí/no) · imagen (un sí/no por uso) · consentimiento de sujeción (uno por medida, nunca genérico) ·
   salidas · declaración de guardador de hecho · inventario de pertenencias · mandato SEPA. **La lista
   de huecos de `00-LEEME.md` es la lista cerrada** de `{…}` que ofrece el editor. Los `[corchetes]`
   no son huecos: son texto que el centro escribe antes de aprobar, y **una plantilla con algún
   `[ ]` no se puede aprobar** (el editor los señala). Todas entran en estado **«Borrador ·
   pendiente de revisión jurídica»** (como `pendienteDeValidar` de clinica-4) y no se pueden usar
   para firmar hasta que la dirección del centro la apruebe, lo que publica la versión 1. Los
   comentarios `<!-- si … -->` / `<!-- fin -->` marcan párrafos condicionados (firma un
   representante, plaza temporal, paga por recibo, hay DPD): el generador los incluye o los quita.
   Las marcas ☐ son casillas que se contestan en la firma, una a una, y se guardan como datos (sí/no
   por consentimiento), no como dibujo.
8. **Preparar un documento** (pantalla 2 del mockup): el programa rellena la plantilla con la ficha y
   enseña la vista previa con **lo que viene de la ficha resaltado**. **Si falta un dato, no deja
   generarlo** y lleva al campo (el mismo `ANCLA_DEL_CAMPO` de alta-minima). Lo que dice el
   documento se cambia en la ficha, nunca en el documento.
9. **Firma aquí** (en la tablet o la pantalla del despacho): no se puede firmar sin haber llegado al
   final del texto; trazo con el dedo o el ratón (botón apagado sin trazo, como en clinica-4); queda
   quién firma, en calidad de qué, y quién le explicó el documento (el informante). **Un documento
   con varios firmantes no cuenta como firmado hasta que firman todos** (el contrato: la familia y
   el centro); cada firma queda con su hora.
10. **Firma a distancia**: «Enviar para firmar» manda **un enlace por SMS y email** al firmante, de un
    solo firmante (con uno o varios documentos suyos, que firma uno detrás de otro), que caduca (7 días por defecto). La página que abre no pide
    cuenta, enseña sólo ese documento, obliga a leerlo hasta el final, pide **un código de 6
    dígitos enviado al móvil que consta en la ficha** y recoge la firma con el dedo. Al firmar, la
    familia recibe su copia en PDF por email. El paso del guion pasa de «enviado» a «firmado» solo;
    si no se abre en 48 h, sale en el panel para llamar o reenviar. Se puede anular un envío.
11. **El PDF firmado**: el documento más **una hoja final de pruebas** (documento y versión de la
    plantilla, huella SHA-256, y por firmante: quién, en calidad de qué, cuándo, cómo —en persona y
    en qué dispositivo, o a distancia: canal, código verificado, IP, navegador—, quién informó). Se
    guarda en el expediente, **no se puede borrar ni editar** (como los consentimientos de
    clinica-4), y al abrirlo el programa comprueba la huella. Si algo cambia (otra tarifa, otra
    habitación), se genera un **anexo** o un documento nuevo; el anterior queda en el historial.
    Los consentimientos que se pueden retirar (imagen, datos) se revocan como en residencia-3.
12. **Nivel legal, dicho con honestidad**: esto es firma electrónica con evidencias (eIDAS art. 25;
    avanzada si se cumplen las condiciones del art. 26), válida para contratos privados como el de
    estancia. **No es firma cualificada** ni lleva sello de tiempo cualificado; el sello es la hora
    del servidor. El done dice qué nivel se alcanza y qué haría falta para subirlo (un prestador de
    confianza), sin prometerlo en pantalla.
13. **Inventario de pertenencias y PAI**: son pasos del guion, pero su formulario no es de este bloque.
    El inventario, mientras no exista el de familias (`04` §4), es un documento que se firma con una
    tabla de objetos que se rellena en el momento; el PAI enlaza a historia-2 cuando exista y hasta
    entonces se queda como paso con plazo.

## Lo técnico que hay que resolver (decídelo y cuéntalo)

- **SMS**: usa el proveedor que ya tenga el repo; si no hay ninguno, el código va por email, el envío
  del enlace por email, y el done propone proveedor (precio por SMS en España) para que Matías lo
  contrate. No se bloquea el bloque por el SMS.
- **El enlace público**: token largo de un solo uso por firmante, caducidad, límite de intentos del
  código (5) y de envíos, sin datos del residente en la URL ni en el SMS más allá del nombre de pila.
  Nada de salud en el SMS ni en el asunto del email (la lección de clinica-4).
- **Generación de PDF**: la que ya exista en el repo (el informe de clinica-4); el PDF final se
  sella con su huella al cerrarse la última firma.
- **El motor de firma sirve para más que residentes** (contratos de personal, consentimientos de la
  clínica a distancia): que el modelo lo permita sin hacerlo ahora.

## Respeta

- Ni un camino nuevo que se salte el registro de accesos; abrir un documento del expediente deja su
  línea, como la historia.
- La auxiliar no gana ni un toque en la puerta: el guion es del despacho (salvo el inventario, que se
  rellena en la habitación con la tablet).
- Comercios, clínicas y bares no notan nada; las plantillas de residencia sólo existen con
  `residencia` encendida.
- Sistema visual y metodología de front de Mi Piace; el mockup manda en disposición y jerarquía.

## Fuera de alcance (declarado)

Firma cualificada y sello de tiempo cualificado · leer documentos de otros países o idiomas · un editor tipo Word · el formulario del inventario de
pertenencias y el PAI (sus bloques) · contratos de personal · enviar nada a la Junta · la revisión
jurídica de los textos (la encarga el centro; el programa sólo impide usarlos sin aprobar).

## Cómo se cierra

- Tests: el preingreso de la familia rellena los campos y cada uno guarda su origen; lo leído no
  cuenta como dato hasta confirmarlo y lo clínico sólo lo confirma un sanitario; con la lectura
  apagada el asistente funciona igual; un residente en preingreso no sale en la puerta y confirmar
  el ingreso lo hace entrar; el guion de una concertada con recibo y guardador de hecho tiene exactamente sus pasos y no
  los que no aplican; cambiar la forma de pago a transferencia quita el mandato SEPA; sin un dato no
  se genera el documento; no se firma sin llegar al final ni sin trazo; un contrato con una sola de
  dos firmas no cuenta como firmado; el enlace caduca, es de un solo uso y bloquea al quinto código
  mal; el PDF firmado no se puede borrar ni editar y su huella se comprueba; cambiar una plantilla no
  toca lo ya firmado; nada de salud en SMS, emails ni logs.
- Tabla de sabotajes como la de clinica-4 (borrar un PDF firmado, editar la plantilla de un firmado,
  reutilizar un enlace, firmar por otro…).
- Bucle visual: capturas de las ocho pantallas del mockup (1366 y 390) en `docs/qa/`; la firma a
  distancia, también en un móvil de verdad.
- CI verde (`ci`, `smoke`, `e2e`).
- `docs/blocks/residencia-ingreso-documentos-done.md` con la estructura de la metodología. Dice si la
  rama está pusheada y si hay PR.
- Commits pequeños en español, push y **PR contra `master`**. Ni merges ni despliegues.
