# Implantación · clínica de podología de Rosario

Catálogo de servicios preparado el 07-10-2026 a partir de la hoja manuscrita de precios que
Rosario tiene en la consulta (foto de Matías). Transcripción y dudas en el doc del proyecto
`claude/rosario-servicios.md`.

## `catalogo-tpv.csv`

Las cinco columnas de siempre (`sku,nombre,precio_con_iva,iva,categoria`) **más tres nuevas**:

| Columna | Valores | Para qué |
|---|---|---|
| `tipo` | `PRODUCT` / `SERVICE` | Un servicio de clínica tiene que nacer `kind = SERVICE` para que la agenda lo vea. |
| `exencion` | vacío / `E1` | Servicio sanitario exento (art. 20.Uno.3º LIVA, bloque `iva-exento-sanitario`). Con `E1`, `iva` tiene que ser 0. |
| `duracion_min` | minutos | Crea la fila de `ServiceScheduling`: sin ella el servicio no se puede reservar. |

**clinica-8 · y CUATRO MÁS**, las que dejan la clínica lista para cobrar:

| Columna | Valores | Para qué |
|---|---|---|
| `tipo_visita` | `QUIROPODIA` / `PIE_RIESGO` / `CIRUGIA` / `BIOMECANICA` / `GENERAL` | Es de la **categoría** (S5): los servicios lo heredan y es lo que hace que la sesión ofrezca la tarjeta de cada tipo. Todas las filas de una misma categoría tienen que decir lo mismo. |
| `primera_valoracion` | `si` / `no` | El servicio con el que se cita la primera visita. |
| `tratamiento_sesion` | `si` / `no` | Sale como botón dentro de la sesión. **El servicio de la primera valoración tiene que llevarla también** (clinica-9, ver abajo). |
| `nivel_quiropodia` | 1 / 2 / 3 | «Este servicio **es** el nivel N». Es lo que convierte el nivel que la sesión propone en una línea de ticket. Uno por nivel. |

Sin estas cuatro, el catálogo entra igual —exento, reservable y con su
duración— **y la sesión dice «sin servicio» y cierra a 0,00 €**. Es lo que
la auditoría del 18-10 midió con los 17 servicios ya cargados.

**El importador del super-admin ya lee las tres** desde el bloque `catalogo-servicios-csv`
(`docs/blocks/catalogo-servicios-csv-done.md`). Cada línea entra como servicio exento, con su
duración de agenda y con el precio que paga la paciente. **Este fichero se puede cargar en cuanto el
bloque esté desplegado**, y no antes: contra una API anterior las tres columnas se ignoran y cada
servicio entraría como PRODUCTO al 0 % **sujeto** y sin duración.

### Cómo se carga

1. En la consola del super-admin, ficha del tenant → panel **«Cargar catálogo»**.
2. Elegir `catalogo-tpv.csv`. **La vista previa no escribe nada**: enseña las 17 filas con su tipo,
   su duración y «Exento · sanitario», y se repasa con Rosario delante.
3. Confirmar. Los 17 entran con su fila de agenda en la misma pasada: o entran todos con su
   duración, o no entra ninguno.

**clinica-8 · las marcas de clínica YA ENTRAN por el fichero** (la tabla de
arriba). Lo único que sigue poniéndose después, en el panel de la dueña
(Catálogo de agenda), son **los consentimientos que pide cada servicio**.

### Tres decisiones de este fichero, a confirmar con Rosario

Las tres son suyas y ninguna bloquea la carga; si cambia alguna, se edita la
columna antes de cargar (un SKU que ya existe no se pisa, así que después
habría que tocarlo en su panel).

1. **La «Cura» (POD-006) pasa de la categoría `quiropodia` a `cirugía`.** Una
   cura es la revisión de lo que se operó, y con `tipo_visita` por categoría
   dejarla en quiropodia la convertía en un servicio de quiropodia: no
   saldría en la tarjeta de «Cirugía · revisión», que es donde se marca. Es
   también donde la pone el mockup validado de clinica-5.
2. **Las órtesis de silicona van como `GENERAL`.** No son ni quiropodia ni
   biomecánica; se hacen en consulta dentro del tratamiento. Si ella las
   entiende como parte de la biomecánica, es cambiar una palabra.
3. **La «Consulta diagnóstico» (POD-001) es la primera valoración.** Es el
   servicio con el que se cita la primera visita; si cobra la primera visita
   de otra manera, la marca va en esa otra línea.

El comercio tiene que tener la **historia clínica encendida** antes de cargar: un `E1` en un tenant
sin ella es una fila saltada con su motivo, no un producto exento callado.

## clinica-9 · la primera consulta se cobra, y lleva LAS DOS marcas

Hasta el 24-10 este fichero traía `POD-001` con `primera_valoracion=si` y
`tratamiento_sesion=no`. Las dos columnas parecen la misma pregunta y no lo son:

- `primera_valoracion` dice **con qué servicio se CITA** la primera visita.
- `tratamiento_sesion` dice **qué botones salen dentro de la sesión**, o sea
  qué se puede marcar como hecho y qué pasa a caja al cerrarla.

Con la segunda en `no`, la «Consulta diagnóstico» no salía en «Qué se cobra»
de la sesión. La pasada en hierro del 24-10 cerró y firmó la primera visita de
una paciente **a 0,00 €** sin que nada lo dijera: la sesión no tenía ni una
línea que cobrar. Y le pasa a la primera visita de **cada** paciente nuevo, que
en una implantación es el día entero.

Está corregido en el fichero (`POD-001 … GENERAL,si,si,`) y el check de
onboarding **«Catálogo clínico completo» lo exige**: una primera valoración que
no es tratamiento de sesión bloquea la activación con el motivo escrito
(`la primera valoración no es tratamiento de sesión (no se podría cobrar la
primera visita)`). En la «Clínica demo» ya estaba corregido a mano desde el
panel de la dueña.

**Si el fichero ya se cargó con la marca mal**, un SKU que existe no se pisa:
hay que ponerla a mano en Catálogo de agenda (el servicio → «Se hace dentro de
la sesión»).

## Dudas abiertas con Rosario

Ninguna bloquea la carga: el fichero entra con las 17 líneas que hay hoy y las que falten se
añaden después (un SKU que ya existe no se pisa, así que una segunda carga sólo mete lo nuevo).

- **Plantillas a medida:** no están en la hoja. Referencia de mercado: 150–180 €; propuesta a
  Rosario, ~150 €. Se añade la línea cuando ella dé el precio.
- **IVA de las órtesis de silicona:** van como servicio exento (las hace ella en la consulta
  dentro del tratamiento). Confirmar con la asesoría; si fueran producto sanitario, irían al 10 %.
- **Revisión biomecánica de niños a 0 €:** confirmar con Rosario si es gratis siempre o va
  incluida con las plantillas.
- Cirugías: 2 h y 3 h son duración real de agenda (confirmado por Matías, 07-10).
