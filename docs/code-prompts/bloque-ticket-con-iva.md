# Bloque ticket-con-iva · el ticket del bar se lee como la carta y la base sale una sola vez

Rama `ticket-con-iva`, worktree `~/Developer/Claude/Projects/mipiacetpv-ticket-con-iva`, desde
`master` = `6e6f0df`. Escrito el 06-10-2026. **Tiene que estar en producción antes del miércoles
08-10**, que es el despliegue de La Maestranza (primera venta real, serie C1, VERI*FACTU).

## Ficha (§5 del tablero)

```
Vertical:          Ticket de cobro · precios de línea con IVA y base imponible única
Familia:           Fiscal / ticket
¿Qué cliente lo pide? Bar La Maestranza (despliegue 08-10). Probablemente todo comercio
¿Y qué?:           1) El cliente del bar lee en el ticket los mismos precios que en la carta.
                   2) La base imponible tiene un único valor en todo el documento, el mismo
                   que va al registro de facturación.
Peldaño:           2 (cliente esperando, fecha fija)
Primer daño:       miércoles 08-10, primera factura real de La Maestranza
Dueño:             bloque ticket-con-iva
```

## Lo que se vio (06-10, producción, tenant 81f2177b, venta de PRUEBA de 3 líneas)

1. **Líneas sin IVA, total con IVA.** «1 x 1,45 €» para un café con leche que en carta es 1,60 €.
   El total sí es 14,60 €. El cliente no puede cuadrar las líneas con el total.
2. **La base con dos valores en el mismo ticket.** «IVA 10 % s/13,26 €» y «Subtotal 13,27 €».
   Leído en `packages/ticket-model/src/desglose.ts`: `cuadrarDesglose` reparte el céntimo
   residual entre `subtotal` y las cuotas (`allocateRoundingRemainder`), pero deja la `base` de
   cada tramo sin tocar. Así el subtotal impreso se separa de Σ bases.

## Qué hay que hacer

### A. Base única (fiscal, lo primero)

- Regla: **subtotal impreso = Σ bases de los tramos**, siempre. El céntimo residual para que
  `Σ bases + Σ cuotas === total` se reparte **sólo entre las cuotas**, que es donde nace el
  redondeo. El comentario de `desglose.ts` ya dice que «el céntimo se reparte donde nace»; el
  código no lo cumple con el subtotal.
- `total` sigue siendo autoritativo y no se recalcula.
- Comprueba que el registro VERI*FACTU (`packages/verifactu/src/registro.ts`) toma la base y la
  cuota del mismo `DesgloseCuadrado` que el papel, y que `ImporteTotal = Σ BaseImponible +
  Σ CuotaRepercutida` al céntimo. Antes de decidir, mira la tolerancia que admite la AEAT entre
  `CuotaRepercutida` y `BaseImponible × TipoImpositivo`, y deja escrito en el informe que
  movernos un céntimo en la cuota cae dentro. Si no cae, para y explícalo: no improvises.
- Huella: no cambies registros ya emitidos. Sólo afecta a lo que se emita a partir del deploy.

### B. Precio de línea con IVA

- En el ticket (ESC/POS, vista previa web y ticket por email) cada línea muestra **unitario y
  total de línea con IVA**. El desglose de IVA de abajo sigue mostrando base y cuota por tramo.
- Averigua de dónde sale hoy `unitPrice` en `buildTicketReceipt` (`ticket-model/src/build.ts`)
  para producto local (`basePrice` neto) y para producto de Holded. No rompas los comercios con
  Holded: confirma con un test qué imprimen hoy y que después imprimen lo mismo o mejor.
- Σ de los totales de línea con IVA puede no coincidir con el total por redondeo por línea.
  Decide y documenta cómo se cuadra (no se imprime nada que no sume), con test.

### C. Menor (si cabe sin riesgo)

- «Mi cuenta» del propietario muestra «Conexión con Holded» en un tenant sin Holded. Ocultarla
  cuando el tenant no tiene Holded.

## Tests de sabotaje (obligatorios)

1. La venta real del 06-10: café con leche 1,60 + las otras dos líneas de 14,60 € en total,
   IVA 10 %. Debe dar base única 13,27 o 13,26 (la que corresponda a la regla) en subtotal y en
   tramo, y líneas que suman 14,60.
2. Barrido: 1.000 tickets aleatorios (1–15 líneas, precios con IVA de 0,50 a 30,00, tipos 10 y
   21 mezclados, descuentos de línea). Invariantes: subtotal = Σ bases; Σ bases + Σ cuotas =
   total; |cuota − base × tipo| ≤ tolerancia AEAT; Σ líneas impresas = total.
3. Rompe a propósito la regla (vuelve a meter `subtotal` en el reparto) y comprueba que el test 2
   falla. Déjalo anotado en el informe.
4. Snapshot del ticket ESC/POS de un comercio con Holded antes y después.

## Entrega

- PR contra `master` con CI verde. Informe en `docs/blocks/ticket-con-iva-done.md`: qué cambió,
  la tolerancia AEAT con fuente, y los 3 comandos para Matías (merge, deploy con IMAGE_TAG,
  health).
- No toques producción ni datos. No hagas ventas reales.
