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

**Hoy el importador del super-admin NO lee esas tres columnas** (`apps/api/src/catalog/csv-catalogo.ts`
sólo conoce las cinco). Cargado tal cual, cada línea entraría como PRODUCTO al 0 % **sujeto**
(no exento) y sin duración: mal en el papel, mal en el registro y fuera de la agenda.
**No cargarlo hasta que el importador acepte las columnas nuevas.**

## Pendiente antes de cargar
- **Plantillas a medida:** no están en la hoja. Referencia de mercado: 150–180 €; propuesta a
  Rosario, ~150 €. Se añade la línea cuando ella dé el precio.
- **IVA de las órtesis de silicona:** van como servicio exento (las hace ella en la consulta
  dentro del tratamiento). Confirmar con la asesoría; si fueran producto sanitario, irían al 10 %.
- **Revisión biomecánica de niños a 0 €:** confirmar con Rosario si es gratis siempre o va
  incluida con las plantillas.
- Cirugías: 2 h y 3 h son duración real de agenda (confirmado por Matías, 07-10).
