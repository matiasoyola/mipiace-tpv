---
id: anexo-economico-privada
version: 1
titulo: Anexo económico · plaza privada
cuando: plaza privada o temporal
firman: [residente-o-representante, centro]
estado: borrador-pendiente-revision-juridica
---

# Anexo económico del contrato de estancia · plaza privada

Residente: {residente.nombre_completo} · Habitación {cama.habitacion} {cama.letra}
({cama.tipo_habitacion}) · Ingreso: {plaza.fecha_ingreso}

## 1. Tipo de estancia

{plaza.tipo}.
<!-- si es temporal -->
Estancia temporal hasta el {plaza.fecha_fin}. Se paga por días: {tarifa.precio_dia} al día.
<!-- fin -->

## 2. Precio

| Concepto | Importe |
|---|---|
| Tarifa aplicada | {tarifa.nombre} |
| Precio mensual de la estancia | {tarifa.precio_mensual} |
| IVA | {tarifa.iva} |

El precio incluye todos los servicios que el reglamento de régimen interior da como incluidos en la
estancia. Los servicios no incluidos se facturan aparte, a los precios publicados en el reglamento,
sólo si se piden o se aceptan.

El primer y el último mes se pagan **por los días de estancia**, a razón de un treintavo del precio
mensual por día.

## 3. Cómo se paga

- Forma de pago: **{pago.forma}**.
- Día de cobro: el {pago.dia_cobro} de cada mes, por mes adelantado.
- La factura se emite a nombre de {pago.factura_a}.
<!-- si paga por recibo -->
- Cuenta de cargo: titular {pago.titular}, IBAN {pago.iban}. La autorización está en la orden de
  domiciliación SEPA firmada aparte. El centro avisa del importe y la fecha de cada cargo con al
  menos [2] días de antelación (preaviso pactado; sin pacto serían 14 días).
<!-- fin -->

## 4. Fianza

<!-- [decisión del centro: quitar esta cláusula si no se pide fianza] -->
Al ingresar se entrega una fianza de {tarifa.fianza}, que **no puede superar un mes de estancia**. No
es un pago a cuenta: se devuelve en los 30 días siguientes al final del contrato, descontando sólo
las cantidades que estén pendientes de pago, con su justificación.

## 5. Ausencias

- **Ausencias de un día o menos** (salidas, consultas): no cambian el precio.
- **Ausencias más largas** (vacaciones con la familia, ingreso hospitalario): la plaza se reserva. Se
  avisa al centro con la mayor antelación posible. Durante la ausencia se paga el [ ] % del precio
  diario a partir del día [ ] de ausencia, por el ahorro de manutención y servicios que no se prestan.
- Las ausencias voluntarias de más de [60] días al año pueden dar lugar a terminar la reserva, previo
  aviso por escrito.

## 6. Actualización del precio

Una vez al año, avisando por escrito con un mes de antelación (cláusula 4.3 del contrato).

---

Firmado en {lugar}, el {fecha}.

{firmantes}
