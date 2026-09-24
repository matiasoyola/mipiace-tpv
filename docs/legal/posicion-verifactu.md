---
title: Posición de mipiacetpv frente a Verifactu (RD 1007/2023)
estado: v1.0 — reescrito el 2026-09-24 (bloque V1-verifactu). PENDIENTE de validación por asesor fiscal
fecha: 2026-09-24
sustituye_a: v0.1 del 2026-06-13 («mipiacetpv no es un SIF»)
---

> **AVISO.** Documento canónico de la posición de mipiacetpv frente al Reglamento de sistemas
> informáticos de facturación. Es la argumentación del equipo; **debe ser validada por un
> asesor fiscal** antes de usarse como respuesta oficial a clientes o terceros.

> **QUÉ CAMBIA RESPECTO A LA VERSIÓN DE JUNIO.** La v0.1 sostenía que mipiacetpv **no es un
> SIF** porque la factura la hace Holded. Esa posición se apoyaba en una premisa que dejó de
> ser cierta: desde el bloque `catalogo-local` hay comercios que trabajan **sin Holded**, y
> para ellos la factura no la hacía nadie. Decisión de Matías del 23-09-2026: mipiacetpv
> cumple la ley entera como SIF. La v0.1 queda **derogada**; no se use como argumento.

# Posición frente a Verifactu

## 1. Resumen ejecutivo (la tesis)

**mipiacetpv es un sistema informático de facturación (SIF) adaptado al RD 1007/2023, en
modalidad VERI\*FACTU**, con dos modos de funcionamiento según el comercio:

| El comercio | Quién emite la factura | Qué hace mipiacetpv |
|---|---|---|
| **Usa Holded** (`holdedEnabled = true`) | **Holded** | Registra la venta y la transmite a Holded como *salesreceipt*. Exactamente igual que antes. |
| **No usa Holded** (`holdedEnabled = false`) | **mipiacetpv** | Expide una **factura simplificada** (art. 7 del RD 1619/2012) con su registro de facturación encadenado y su QR tributario. |

**Nunca emiten los dos.** El interruptor es una columna del comercio y lo mueve sólo el
super-admin; el servidor rechaza con 409 un registro de facturación que llegue de un comercio
con Holded.

## 2. Qué exige la norma, y cómo se cumple

| Exigencia | Dónde se cumple |
|---|---|
| Registro de facturación por cada factura, con los campos del anexo de la Orden HAC/1177/2024 | `packages/verifactu/src/registro.ts`; se guarda en `fiscal_records` |
| Huella SHA-256 encadenada, formato del documento técnico de la AEAT | `packages/verifactu/src/huella.ts`. Los tres ejemplos oficiales de la AEAT son tests dorados |
| Comprobación previa del art. 7.i (encadenamiento y reloj) antes de cada registro | `packages/verifactu/src/cadena.ts` |
| Inalterabilidad y conservación | Tabla append-only con trigger en Postgres, sin vía de corrección (ADR-019 §4.4) |
| Trazabilidad verificable | `mipiacetpv_verify_fiscal_chain()`, que recalcula las huellas dentro del motor |
| Numeración correlativa por serie | Índice único `(register_id, serie, numero)` |
| QR tributario con la URL de cotejo y sus cuatro parámetros | `packages/verifactu/src/qr.ts`; se imprime en el ticket y en el PDF |
| Leyenda «VERI\*FACTU» y texto «QR tributario:» | `packages/escpos-builder` y `packages/ticket-pdf` |
| Registro de eventos | **No aplica.** La FAQ de desarrolladores (§15, NOTA 1) exime al SIF que sólo puede actuar en modo VERI\*FACTU, que es nuestro caso (`TipoUsoPosibleSoloVerifactu = S`) |
| Firma electrónica XAdES del registro | **No aplica** en modalidad VERI\*FACTU: el diseño de registro la marca «obligatoria para conservación y para requerimiento, pero no para remisión» |
| **Remisión de los registros a la sede de la AEAT** | **PENDIENTE — bloque V2.** Ver §5 |

## 3. Los plazos, que son dos y no el mismo

**El del comercio.** El RD 1007/2023, tras el RDL 15/2025 de 2 de diciembre:

- **01-01-2027** para quienes declaren el Impuesto sobre Sociedades.
- **01-07-2027** para el resto (autónomos incluidos).

Las fechas se han movido dos veces (01-07-2025 → 01-01-2026 / 01-07-2026 → 01-01-2027 /
01-07-2027). Conviene confirmarlas antes de ponerlas por escrito a un cliente.

**El nuestro, como fabricante.** Desde el **29-07-2025** los productores y comercializadores
de SIF sólo pueden ofrecer producto adaptado. Ese plazo ya pasó, y es la razón de que esto se
haya hecho ahora y no en 2027.

La adopción temprana por parte del comercio es válida y la AEAT la recomienda expresamente:
los servicios están en producción desde el 23-04-2025.

## 4. Quién identifica al SIF

El bloque `SistemaInformatico` de cada registro lleva, como productor:

```
NombreRazon            MI PIACE INTERNET SOLUTIONS SL
NIF                    B45902186
IdSistemaInformatico   MP
NombreSistemaInformatico   mipiacetpv
```

⚠ **Estos valores tienen que coincidir literalmente con los de la declaración responsable del
SIF.** Viven en `packages/verifactu/src/productor.ts` con un test que los valida.

Y **cada caja registradora es una instalación distinta de SIF**, con su propio
`NumeroInstalacion`, su serie y su cadena. La justificación, con las citas de la AEAT, está en
`docs/design/adr-019-cada-caja-es-un-sif.md`.

Consecuencia comercial que hay que decir en la implantación: **un comercio con dos cajas emite
dos series**. Sus facturas no van 1, 2, 3 sino C1/1, C2/1, C1/2…

## 5. Lo que todavía NO se hace

- **No se remiten los registros a la AEAT.** Se generan, se encadenan, se conservan
  inalterables y quedan listos para remitir. Es el bloque V2.
- Mientras tanto, **el QR apunta al entorno de PRUEBAS** de la AEAT. Un cliente que lo escanee
  hoy no encontrará su factura allí. El ticket **no dice que se haya remitido**: imprime
  «VERI\*FACTU», que es la leyenda del sistema, no un acuse.
- **No hay facturas rectificativas ni devoluciones fiscales** (V3). Una venta cobrada se puede
  anular —genera su registro de anulación— pero una devolución de dinero todavía no emite
  rectificativa.
- **No hay factura completa** (art. 7.2/7.3): el cliente empresario que pida NIF, domicilio y
  cuota separada para deducirse el IVA no lo tiene todavía.

## 6. Cómo responder a un cliente

**Si usa Holded:**

> "Tu TPV registra los cobros y los manda a tu Holded. **Quien emite y conserva las facturas
> conforme a Verifactu es Holded**, que es tu sistema de facturación. Nosotros no lo
> sustituimos; lo alimentamos."

**Si no usa Holded:**

> "Tu TPV **es** tu sistema de facturación. Cada cobro emite una factura simplificada con su
> número de serie, su registro encadenado y su QR, y todo eso se genera en la tablet en el
> momento de cobrar, con red o sin ella. Ahora mismo estamos en el periodo en el que la
> remisión a Hacienda es voluntaria; cuando entre en vigor para ti, tu TPV ya está preparado."

## 7. Pendiente

- ☐ Validación formal por **asesor fiscal** de esta posición.
- ☐ **Declaración responsable del SIF**, con los datos del §4 y firmada.
- ☐ Obtener y archivar la declaración de Holded sobre su adaptación (sigue siendo relevante
  para los comercios que lo usan).
- ☐ Revisar la cláusula 2 del `contrato-piloto.md`: la frontera fiscal que describe ya no es
  la que hay para un comercio sin Holded.
- ☐ Decidir y documentar cuándo se pasa el QR a producción (bloque V2).

## Relación con otros documentos

- `docs/design/adr-019-cada-caja-es-un-sif.md` — la decisión técnica, con las fuentes.
- `docs/design/adr-015-sello-de-la-venta.md` — el sello de la venta, que convive.
- `docs/blocks/verifactu-1-plan.md` y `verifactu-1-done.md` — el bloque.
- `contrato-piloto.md` cláusula 2 (frontera fiscal), `dpa-encargado-tratamiento.md`.
