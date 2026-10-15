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

Dos cosas que el fichero **no** trae y se ponen después, en el panel de la dueña (Catálogo de
agenda): las marcas de clínica (`primera valoración`, `tratamiento de sesión`, el nivel de la
quiropodia) y los consentimientos que pide cada servicio.

El comercio tiene que tener la **historia clínica encendida** antes de cargar: un `E1` en un tenant
sin ella es una fila saltada con su motivo, no un producto exento callado.

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
