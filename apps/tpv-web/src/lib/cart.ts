// Modelo del carrito en cliente. Lo mantiene SalePage en useState, lo
// persiste suspender/recuperar en localStorage, y CheckoutPage lo
// transforma al payload para POST /tickets.

import {
  type CausaExencion,
  claveTramo,
  grossToNet,
  leerClaveTramo,
  netToGross,
  round2,
} from "@mipiacetpv/ticket-model";

// B-Bar-Modifiers: cada selección estructurada lleva el desnormalizado
// completo. El TPV lo calcula a partir del catálogo en memoria al
// confirmar el modal — no se vuelve a consultar al cobrar. El backend
// re-valida groupId/modifierId contra el catálogo del tenant y persiste
// el mismo snapshot en TicketLine.modifiers para auditoría inmutable.
export interface ModifierSelection {
  groupId: string;
  groupName: string;
  modifierId: string;
  label: string;
  priceDeltaCents: number;
}

export interface CartLine {
  // ID local — UUID v4 por línea (independiente del producto, porque la
  // misma referencia puede aparecer dos veces con modificadores distintos).
  id: string;
  productId: string | null;
  variantId: string | null;
  holdedProductId: string | null;
  sku: string;
  nameSnapshot: string;
  units: number;
  // BASE sin deltas — los suplementos de modificadores viven en
  // `modifierSelections` y `computeLine` los suma a runtime. Mantener
  // `unitPrice` "limpio" hace fácil renderizar el desglose "X € + delta".
  unitPrice: number;
  // v1.2-Lite Lote 4.B · T-5: si el cajero modifica el precio puntualmente
  // con el lápiz, queda aquí. null = sin override. Cuando hay override,
  // computeLine lo usa como base (los deltas de modificadores se siguen
  // aplicando encima). El payload del POST /tickets envía este valor y
  // mantiene unitPrice como histórico del catálogo.
  unitPriceOverride: number | null;
  priceGross: number; // unitPrice * (1 + taxRate/100) — sin modifiers
  discountPct: number;
  taxRate: number;
  // bloque iva-exento-sanitario · la causa de exención del producto, tal
  // como la trae el catálogo. Con causa, `taxRate` es 0 y `priceGross`
  // coincide con `unitPrice`: no hay conversión neto↔bruto que hacer
  // porque no hay IVA que añadir.
  //
  // Viaja en la línea del carrito —y no se vuelve a leer del catálogo al
  // cobrar— porque es lo que se manda en el POST y lo que se persiste como
  // snapshot en `ticket_lines.exemption_cause`.
  exemptionCause?: CausaExencion | null;
  // kds-1-cocina · los alérgenos del plato, copiados del catálogo al
  // añadir la línea. Viajan EN LA LÍNEA y no se vuelven a leer del
  // catálogo porque es lo que permite avisar «¡Lleva gluten!» al asignar
  // la silla sin un viaje a la API en medio del gesto. El cruce de verdad
  // —el que la pantalla de cocina grita— lo hace el servidor con el
  // snapshot de `KitchenOrderLine.allergens`.
  allergens?: string[];
  // Modificadores ad-hoc tipeados por el cajero ("Sin azúcar").
  modifiers: string[];
  // Modificadores estructurados (selección desde el modal).
  modifierSelections?: ModifierSelection[];
}

export interface SuspendedCart {
  id: string;
  label: string;
  createdAt: string;
  lines: CartLine[];
  contactHoldedId?: string;
  // T-3 (v1.1 Thalia): nombre del cliente snapshotted al suspender,
  // para que la lista de "Pendientes" lo muestre sin tener que ir a
  // BD. Opcional: carritos suspendidos antes de v1.1 no lo tienen.
  contactName?: string;
  notes?: string;
}

const SUSPENDED_KEY = "mipiacetpv-suspended-carts";

// v1.6-Precio-Sobre-Total: helpers puros de conversión neto↔bruto. El
// modelo del carrito y el contrato con la API SIGUEN en NETO — estos
// helpers viven sólo en la capa de entrada/presentación (el cajero de
// Frutos Secos Cachictos teclea el precio final con IVA incluido).
//
// bloque ticket-con-iva · viven en `@mipiacetpv/ticket-model` y aquí sólo
// se re-exportan: desde este bloque la conversión neto↔bruto la necesitan
// también el papel ESC/POS y el PDF, y tres copias del mismo redondeo
// acaban separándose. El contrato público de este módulo no cambia — quien
// importaba `netToGross` o `grossToNet` de aquí sigue importándolos de aquí.
export { grossToNet, netToGross, round2 };

export interface LineTotals {
  subtotalNet: number;
  tax: number;
  totalGross: number;
}

// v1.4-Precio-Decimales · b30: el `unitPrice` que llega a esta función
// es el NET con precisión de 4 decimales (tal como lo persiste Holded
// internamente, p.ej. `3.8843`). El cálculo intermedio NO redondea hasta
// el último paso: subtotal neto = units · (base + delta), gross = sub ·
// (1+IVA). El redondeo a 2 decimales sólo ocurre al devolver el valor
// que verá el cajero — y `computeCart` reagrega los netos crudos por
// bucket de IVA antes de redondear (esquema fiscal correcto).
export function computeLine(
  line: Pick<
    CartLine,
    "units" | "unitPrice" | "discountPct" | "taxRate"
  > & {
    modifierSelections?: ModifierSelection[];
    // v1.2-Lite Lote 4.B: override del cajero (lápiz). Si está
    // presente, prevalece sobre unitPrice del catálogo.
    unitPriceOverride?: number | null;
  },
): LineTotals {
  const deltaPerUnit = sumModifierDeltas(line.modifierSelections) / 100;
  const baseUnit =
    line.unitPriceOverride != null ? line.unitPriceOverride : line.unitPrice;
  const netPerUnit = (baseUnit + deltaPerUnit) * (1 - line.discountPct / 100);
  // Mantén los valores crudos hasta el último round2. Si redondeamos
  // subtotalNet a 2 decimales y luego multiplicamos por (1+IVA) perdemos
  // los cuatro decimales del NET y reaparece el drift de 1 céntimo.
  const subtotalNetRaw = netPerUnit * line.units;
  const totalGrossRaw = subtotalNetRaw * (1 + line.taxRate / 100);
  const subtotalNet = round2(subtotalNetRaw);
  const totalGross = round2(totalGrossRaw);
  return {
    subtotalNet,
    tax: round2(totalGross - subtotalNet),
    totalGross,
  };
}

// bloque ticket-con-iva · el unitario CON IVA de una línea del carrito:
// el precio que el cliente ve en la carta y el que se imprime en el
// papel que sale sin red (`buildLocalTicketBytes`).
//
// Parte del MISMO neto por unidad que `computeLine` —override del cajero
// si lo hay, más los deltas de los modificadores, antes del descuento— y
// lo convierte con `netToGross`. El descuento de línea NO se aplica aquí
// a propósito: lo que va en esta columna es el precio de lista, y el
// descuento ya está dentro del total de la línea.
export function unitPriceGrossOf(
  line: Pick<CartLine, "unitPrice" | "taxRate"> & {
    modifierSelections?: ModifierSelection[];
    unitPriceOverride?: number | null;
  },
): number {
  const deltaPerUnit = sumModifierDeltas(line.modifierSelections) / 100;
  const baseUnit =
    line.unitPriceOverride != null ? line.unitPriceOverride : line.unitPrice;
  return netToGross(baseUnit + deltaPerUnit, line.taxRate);
}

export function sumModifierDeltas(
  selections: ModifierSelection[] | undefined,
): number {
  if (!selections) return 0;
  let sum = 0;
  for (const s of selections) sum += s.priceDeltaCents;
  return sum;
}

export interface CartTotals {
  subtotalNet: number;
  tax: number;
  total: number;
  discount: number;
  itemCount: number;
}

// v1.4-Precio-Decimales · b30: para el total del carrito agregamos los
// netos crudos POR BUCKET DE IVA (sin redondear por línea) y aplicamos
// el % de IVA al neto agregado del bucket. Esto reproduce la aritmética
// de Holded y evita el drift de 1 céntimo que aparecía al redondear cada
// línea por separado.
export function computeCart(lines: CartLine[]): CartTotals {
  // bucketNetByRate[taxRate] = suma de netos crudos (4dec) por bucket.
  const bucketNetByRate = new Map<number, number>();
  let grossNoDiscount = 0;
  let itemCount = 0;
  for (const l of lines) {
    const deltaPerUnit = sumModifierDeltas(l.modifierSelections) / 100;
    const baseUnit =
      l.unitPriceOverride != null ? l.unitPriceOverride : l.unitPrice;
    const netPerUnit = (baseUnit + deltaPerUnit) * (1 - l.discountPct / 100);
    const netLineRaw = netPerUnit * l.units;
    bucketNetByRate.set(
      l.taxRate,
      (bucketNetByRate.get(l.taxRate) ?? 0) + netLineRaw,
    );
    // "Bruto sin descuento" para el cálculo del % global de descuento
    // incluye los deltas de modificadores — son parte del precio "lista".
    // En precisión 4dec; el redondeo final ocurre abajo.
    grossNoDiscount += (baseUnit + deltaPerUnit) * l.units;
    itemCount += l.units;
  }

  let subtotalNetRaw = 0;
  let taxRaw = 0;
  let totalRaw = 0;
  for (const [taxRate, netSum] of bucketNetByRate) {
    const taxBucket = netSum * (taxRate / 100);
    subtotalNetRaw += netSum;
    taxRaw += taxBucket;
    totalRaw += netSum + taxBucket;
  }

  return {
    subtotalNet: round2(subtotalNetRaw),
    tax: round2(taxRaw),
    total: round2(totalRaw),
    discount: round2(grossNoDiscount - subtotalNetRaw),
    itemCount,
  };
}

// V1-verifactu (ADR-019) · el desglose por tipo de IVA del carrito.
//
// `computeCart` agrega por bucket y tira los buckets al salir, porque el
// cajero sólo ve el total. El registro de facturación SÍ los necesita: el
// `Desglose` del anexo lleva una entrada por tipo impositivo con su base y
// su cuota.
//
// Mismo cálculo exacto que `computeCart` —netos crudos por bucket, redondeo
// al final— para que el desglose y el total no puedan separarse. Lo que
// cuadra el céntimo residual es `cuadrarDesglose`, compartido con el papel.
export interface CartTaxBucket {
  rate: number;
  base: number;
  tax: number;
  // bloque iva-exento-sanitario · presente sólo en los tramos EXENTOS.
  exemptionCause?: CausaExencion | null;
}

// bloque iva-exento-sanitario · la clave del tramo es (tasa, causa).
//
// Es la misma función `claveTramo` que usa `buildTicketDocument` en el
// servidor, importada y no reescrita: si el dispositivo agrupara distinto
// que el servidor, el papel que sale sin red y el que sale del histórico
// declararían desgloses distintos de la misma venta — y el test
// byte-a-byte de `verifactu-un-solo-papel` sólo lo vería si su fixture
// llevara una línea exenta.
export function computeCartTaxBuckets(lines: CartLine[]): CartTaxBucket[] {
  const bucketNetByTramo = new Map<string, number>();
  for (const l of lines) {
    const deltaPerUnit = sumModifierDeltas(l.modifierSelections) / 100;
    const baseUnit =
      l.unitPriceOverride != null ? l.unitPriceOverride : l.unitPrice;
    const netPerUnit = (baseUnit + deltaPerUnit) * (1 - l.discountPct / 100);
    const clave = claveTramo(l.taxRate, l.exemptionCause ?? null);
    bucketNetByTramo.set(
      clave,
      (bucketNetByTramo.get(clave) ?? 0) + netPerUnit * l.units,
    );
  }
  return [...bucketNetByTramo.entries()]
    .map(([clave, netSum]) => {
      const { rate, causa } = leerClaveTramo(clave);
      return {
        rate,
        base: round2(netSum),
        // Un tramo exento no tiene cuota: no hay tipo que aplicar (§15.5).
        tax: causa ? 0 : round2(netSum * (rate / 100)),
        ...(causa ? { exemptionCause: causa } : {}),
      };
    })
    // El orden de impresión (exentos primero) lo fija `cuadrarDesglose`;
    // aquí sólo hace falta que sea estable.
    .sort(
      (a, b) =>
        a.rate - b.rate ||
        (a.exemptionCause ?? "").localeCompare(b.exemptionCause ?? ""),
    );
}

export function getSuspendedCarts(): SuspendedCart[] {
  const raw = localStorage.getItem(SUSPENDED_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as SuspendedCart[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveSuspendedCart(cart: SuspendedCart): void {
  const list = getSuspendedCarts().filter((c) => c.id !== cart.id);
  list.unshift(cart);
  localStorage.setItem(SUSPENDED_KEY, JSON.stringify(list.slice(0, 20)));
}

export function removeSuspendedCart(id: string): void {
  const list = getSuspendedCarts().filter((c) => c.id !== id);
  localStorage.setItem(SUSPENDED_KEY, JSON.stringify(list));
}
