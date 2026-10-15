# Bloque catalogo-servicios-csv · el fichero de alta también carga servicios de clínica

Rama `catalogo-servicios-csv`, worktree `~/Developer/Claude/Projects/mipiacetpv-catalogo-servicios-csv`,
desde `origin/master` (cf0bd91 o el que haya al lanzarlo). Frente C del tablero. Escrito el 07-10-2026.

Lee antes, en este orden:
1. `docs/blocks/catalogo-en-alta-done.md` — la ruta de carga del super-admin y sus cuatro promesas
   (vista previa que no escribe, SKU existente no se pisa, todo o nada, mismas reglas que el panel).
   **Las cuatro siguen valiendo.**
2. `docs/blocks/iva-exento-sanitario-done.md` — la causa de exención E1 y el CHECK `causa ⇒ taxRate = 0`.
3. `apps/api/src/services/routes.ts` (el `PUT` que hace `upsert` de `ServiceScheduling`) — de ahí
   salen las reglas de la duración y de los valores por defecto. No se inventan otras.
4. `docs/implantaciones/rosario/catalogo-tpv.csv` y su `README.md` — **el fichero real** que este
   bloque tiene que poder cargar.

## Por qué existe

La clínica de Rosario se da de alta sin Holded. Su catálogo son 17 servicios sanitarios: exentos de
IVA y con duración de agenda (de 10 min a 3 h). Hoy el cargador (`catalog/csv-catalogo.ts`) sólo
conoce cinco columnas y crea todo como `PRODUCT` sujeto. Cargado así, cada servicio:

- entra al **0 % sujeto**, no exento → mal en el papel y en el registro;
- entra como **producto** → la agenda no lo ve;
- entra **sin duración** → no se puede reservar.

Y en DRAFT no hay OWNER que lo arregle desde el panel. El fichero de alta es la única puerta.

¿Y qué?: el implantador carga el catálogo de una clínica en una sola pasada, con la dueña delante,
y cada servicio sale ya exento, reservable y con su duración. Sin repasar 17 fichas a mano.

## Decisiones ya tomadas — no se re-debaten

1. **Columnas nuevas, todas opcionales.** Un fichero con sólo las cinco de siempre (el de La
   Maestranza) se carga **exactamente igual que hoy**. Test con el CSV real de La Maestranza.
   - `tipo`: `PRODUCT` | `SERVICE`. Vacío o ausente = `PRODUCT`.
   - `exencion`: vacío | `E1`. Con `E1`, `iva` tiene que ser 0; si no, fila rechazada con motivo.
   - `duracion_min`: entero > 0. **Obligatoria si `tipo = SERVICE`**; prohibida si `tipo = PRODUCT`
     (fila rechazada, con motivo que lo diga).
2. **La exención y el tipo pasan por `validateLocalProduct`**, que ya acepta `kind` y
   `exemptionCause`. No hay una segunda validación en el parser.
3. **`ServiceScheduling` se crea en la MISMA transacción** que el producto, con los defaults del
   `PUT` de `services/routes.ts` (buffers 0, 1 profesional, no online, canales por defecto).
   `family` = la primera categoría de la fila. Si las reglas de la duración viven en ese `PUT`,
   se extraen a una función compartida: **la misma regla en las dos puertas**, como en
   catalogo-en-alta.
4. **Exento sólo en comercios con `clinicalRecordsEnabled`.** Un `E1` en el fichero de un bar es
   fila rechazada («este comercio no tiene la clínica encendida»), no un producto exento callado.
5. **La vista previa enseña lo nuevo:** tipo, duración y «Exento · sanitario» en cada fila. Es lo
   que la dueña revisa con el implantador antes de confirmar.
6. **Precio de un exento = lo que paga el paciente.** Con `iva = 0` la conversión bruto→neto ya da
   el mismo número; compruébalo con test, no de palabra.

## Lo que NO entra

- Marcas de clínica en el fichero (`primeraValoracion`, `tratamientoSesion`): se ponen en el panel.
- Editar o pisar servicios existentes (la promesa 2 sigue: SKU existente se salta).
- Cargar el catálogo de Rosario en producción: eso lo hace el implantador tras el despliegue.

## Cómo se da por hecho

- Suite verde en local y en CI.
- **Tabla de sabotajes en el -done.** Cada test nuevo se ha visto en rojo rompiendo a propósito el
  código que cubre: quitar la creación de `ServiceScheduling`, ignorar la columna `exencion`,
  aceptar `E1` con IVA 10, aceptar `SERVICE` sin duración, aceptar `E1` en un comercio sin clínica,
  romper la transacción a mitad (no puede quedar un producto sin su duración). Un test que no se pone
  rojo no cuenta.
- e2e: alta de un tenant clínica en DRAFT → vista previa del CSV real de Rosario → confirmar → los
  17 servicios aparecen en la agenda con su duración y un cobro de prueba sale exento.
- `docs/blocks/catalogo-servicios-csv-done.md` con qué cambia, sabotajes y «Al desplegar»
  (sin migración esperada; si la hay, decirlo).
- Actualiza `docs/implantaciones/rosario/README.md`: quitar el aviso de «no cargar todavía».
- **Push de la rama y PR abierto: autorizados.** Ni merge ni despliegue: eso es de Dirección.
