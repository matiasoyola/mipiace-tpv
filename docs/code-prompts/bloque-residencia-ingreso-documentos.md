# Bloque residencia-ingreso-documentos · el ingreso con guion y los documentos que se firman en el programa

Rama `residencia-ingreso-documentos`, worktree
`~/Developer/Claude/Projects/mipiacetpv-ingreso-documentos`, desde `origin/master`. PR contra `master`.
Escrito el 25-10-2026 desde el proyecto de Jardín de Gredos. Matías, al ver la pestaña «Ingreso y
documentos» de la ficha completa: «tiene mucha chicha; me gustaría que estuviera muy guionizada la
documentación a recoger, y que lo que sean contratos se creen y se firmen desde el mismo sistema, sin
tener que imprimir y escanear». **Mockup: `docs/mockups/residencia-ingreso-documentos.html`**
(seis pantallas: el guion, preparar un documento, firma aquí, firma a distancia, el PDF firmado y las
plantillas del centro). Planteamiento validado por Matías el 25-10-2026; el mockup, pendiente.

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

## Decisiones de producto ya tomadas — no se re-debaten

1. **El guion ES el ingreso guiado de historia-1, ampliado** (no una lista nueva al lado). Cada paso
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
   textos.
7. **Los textos legales son del centro.** No se inventan cláusulas: Mi Piace carga la primera vez los
   Word que use el centro (contrato de estancia, reglamento de régimen interior, autorización de
   imágenes, consentimiento de sujeciones…) convirtiéndolos en plantillas. La siembra trae **sólo**
   el mandato SEPA (texto normalizado) y, para el resto, plantillas **marcadas «pendiente del texto
   del centro»** que no se pueden usar hasta que se aprueben.
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
    solo firmante y un solo documento, que caduca (7 días por defecto). La página que abre no pide
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

Firma cualificada y sello de tiempo cualificado · un editor tipo Word · el formulario del inventario de
pertenencias y el PAI (sus bloques) · contratos de personal · enviar nada a la Junta · la carga de los
Word del centro (la hace Mi Piace con la herramienta de plantillas cuando esté).

## Cómo se cierra

- Tests: el guion de una concertada con recibo y guardador de hecho tiene exactamente sus pasos y no
  los que no aplican; cambiar la forma de pago a transferencia quita el mandato SEPA; sin un dato no
  se genera el documento; no se firma sin llegar al final ni sin trazo; un contrato con una sola de
  dos firmas no cuenta como firmado; el enlace caduca, es de un solo uso y bloquea al quinto código
  mal; el PDF firmado no se puede borrar ni editar y su huella se comprueba; cambiar una plantilla no
  toca lo ya firmado; nada de salud en SMS, emails ni logs.
- Tabla de sabotajes como la de clinica-4 (borrar un PDF firmado, editar la plantilla de un firmado,
  reutilizar un enlace, firmar por otro…).
- Bucle visual: capturas de las seis pantallas del mockup (1366 y 390) en `docs/qa/`; la firma a
  distancia, también en un móvil de verdad.
- CI verde (`ci`, `smoke`, `e2e`).
- `docs/blocks/residencia-ingreso-documentos-done.md` con la estructura de la metodología. Dice si la
  rama está pusheada y si hay PR.
- Commits pequeños en español, push y **PR contra `master`**. Ni merges ni despliegues.
