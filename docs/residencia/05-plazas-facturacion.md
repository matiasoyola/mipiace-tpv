# Residencia · plazas, pagadores y facturación (Fase 3)

Criterio de Claude con delegación de Matías (14-10-2026). Base real: la herramienta que ya factura las
concertadas de Jardín de Gredos (`jardin de gredos operativa/facturas plazas concertadas/`:
`calculo.py` + `generar.py`, primer mes septiembre 2026, verificada contra agosto 2026).
**Holded opcional** (D-36). **Facturación propia con Verifactu** sobre `FiscalRecord` de mipiacetpv.

¿Y qué?: la factura mensual a la Junta deja de montarse tecleando días y pensiones en un JSON: los días
salen solos de las ausencias registradas, el cálculo es el mismo que ya cuadra, y los recibos de los
residentes y sus extras salen del mismo cierre de mes.

---

## 1. Plazas y pagadores

- **Plaza** (contrato de estancia) por residente, con vigencia: `PRIVADA` · `CONCERTADA` · `TEMPORAL`.
  Un residente puede cambiar de tipo (pasa de privada a concertada al llegarle la concesión): se cierra
  una y se abre otra; la historia de plazas no se pierde.
- **Concesión de la JCCM** (concertadas y temporales), con vigencia y fecha de resolución:
  - **Régimen anterior**: la aportación del residente es un % de sus ingresos (Tabla I: 75 % días
    ordinarios / 40 % hospital-vacaciones; Tabla II), proporcional a días.
  - **Régimen Decreto**: copago fijo de la resolución, prorrateado si el mes no es completo
    (0,4/30 por día de hospital o vacaciones).
  - Grado (0-III) que fija la tarifa.
- **Ingresos del residente** (pensión, paga extra prorrateada, base de cálculo): sólo para régimen
  anterior. **Dato económico sensible**: lo ve sólo el rol de administración; nunca en la puerta.
- **Dos pagadores** en una misma plaza concertada: la Junta y el residente (D-01, sesión 1).

## 2. Tarifas

- **JCCM**: precio de estancia por grado, sin IVA, con vigencia (2026: 4 % de IVA, servicio en plaza
  concertada) y los factores del Decreto. Tabla del producto, actualizable por resolución.
- **Privadas**: tarifa del centro por grado o tipo de habitación, con vigencia
  (`TARIFA PRECIOS PLAZAS PRIVADAS`, `REGULARIZACION PRECIO GRADO III`). **Tipo de IVA a confirmar con
  la asesoría** antes de construir (no se supone).
- **Servicios extra** (D-09): peluquería, podología, otros; catálogo del centro = catálogo de productos
  y servicios de mipiacetpv. Los consume cualquier rol con permiso y se acumulan al mes.

## 3. El cierre de mes

1. El sistema propone la **estancia de cada residente**: días ordinarios / hospital / vacaciones,
   **derivados de las ausencias** (`03` §5). Administración revisa y corrige con motivo.
2. **Motor de liquidación**: `calculo.py` portado tal cual a un paquete puro
   (`packages/residencia-liquidacion`), con **test de oro** contra la liquidación real de septiembre 2026:
   mismo resultado céntimo a céntimo o no se mergea.
3. Administración **cierra el mes**. Cerrado no se toca: lo que haya que cambiar va por regularización
   el mes siguiente o por rectificativa.

## 4. Lo que sale del cierre

| Documento | A quién | Cómo |
|---|---|---|
| **Factura J-MM/AAAA** única con las estancias de los dos regímenes, menos lo abonado por los residentes | JCCM | PDF **calcado 1:1 al modelo de la Junta** + anexo por residente. Registro Verifactu. **La sube una persona a PECAM** (D-33): el sistema deja el paquete listo y registra quién lo subió y cuándo. |
| Recibo/factura de **aportación** del residente concertado | residente / familia | mensual |
| Factura de **cuota** del residente privado | residente / familia | mensual, con prorrateo de altas y bajas |
| **Extras** del mes | residente / familia | en la misma factura, líneas aparte |
| **Rectificativas y regularizaciones** | quien corresponda | por Verifactu, encadenadas |
| **Comunicación de alta/baja** a la Junta | JCCM | documento generado al dar el alta (`MODELO COMUNICACIÓN BAJAS`) |
| **Certificado anual de pagos** | familia (para su declaración) | a demanda o en enero (`certificado pago mensualidad resi.docx`) |

## 5. Cobro y tesorería

- **Remesa SEPA** de los recibos de residentes (fichero para el banco); **la sube una persona**.
- La factura de la Junta lleva su **estado de cobro**: emitida → cedida al factoring (Santander
  Factoring) → anticipada → pagada por la Junta. Da la vista de cuándo entra el dinero, que hoy no se
  sabe y es la razón de existir del factoring.
- Holded, si el centro lo usa: se le envía cada factura **ya emitida** como documento, para su
  contabilidad. Nunca emite Holded (no hay doble registro fiscal).

## 6. Fuera (declarado)

- Contabilidad general, nóminas y modelos fiscales: siguen en la gestoría / Holded.
- Envío directo a PECAM o al banco: no (D-33). Si algún día hay API y se decide, es un conector.

## 7. Entidades

`Placement` (plaza: tipo, vigencia) · `Concession` (régimen, grado, tabla, copago, resolución, vigencia)
· `ResidentIncome` (sólo régimen anterior, acceso restringido) · `RateTable` (JCCM y privadas, con
vigencia) · `MonthlyStay` (días por tipo, origen DERIVED | MANUAL con motivo) · `BillingPeriod`
(abierto / cerrado) · `Settlement` (resultado del motor, inmutable) · `Invoice` sobre `Ticket` +
`FiscalRecord` de mipiacetpv · `ExtraServiceConsumption` · `SepaBatch` · `ReceivableStatus` (factoring).
