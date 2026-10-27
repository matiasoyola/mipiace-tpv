---
id: mandato-sepa
version: 1
titulo: Orden de domiciliación de adeudo directo SEPA
cuando: si paga por recibo domiciliado
firman: [titular-cuenta]
estado: borrador-pendiente-revision-juridica
nota: Texto normalizado del esquema SEPA Core (EPC). Sólo cambian los datos; el texto legal no se toca.
---

# Orden de domiciliación de adeudo directo SEPA · SEPA Direct Debit Mandate

**Referencia de la orden de domiciliación:** {pago.referencia_mandato}
**Identificador del acreedor:** {centro.acreedor_sepa}
**Nombre del acreedor:** {centro.razon_social}
**Dirección:** {centro.domicilio} · España

Mediante la firma de esta orden de domiciliación, el deudor autoriza (A) al acreedor a enviar
instrucciones a la entidad del deudor para adeudar su cuenta y (B) a la entidad para efectuar los
adeudos en su cuenta siguiendo las instrucciones del acreedor. Como parte de sus derechos, el deudor
está legitimado al reembolso por su entidad en los términos y condiciones del contrato suscrito con
la misma. La solicitud de reembolso deberá efectuarse dentro de las ocho semanas que siguen a la
fecha de adeudo en cuenta. Puede obtener información adicional sobre sus derechos en su entidad
financiera.

| | |
|---|---|
| Nombre del deudor (titular de la cuenta) | {pago.titular} |
| NIF del deudor | {pago.titular_nif} |
| Dirección del deudor (calle, código postal, población, país) | {pago.titular_domicilio} |
| Número de cuenta · IBAN | {pago.iban} |
| Swift BIC | {pago.bic} |
| Entidad | {pago.entidad} |
| Tipo de pago | Pago recurrente |
| Concepto | Estancia de {residente.nombre_completo} en {centro.nombre_comercial} |
| Fecha y localidad | {fecha}, {lugar} |

{firmantes}

*Todos los campos han de ser cumplimentados obligatoriamente. Una vez firmada, esta orden de
domiciliación debe ser enviada al acreedor para su custodia.*
