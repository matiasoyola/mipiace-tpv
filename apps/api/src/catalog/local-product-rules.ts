// catalogo-en-alta · LAS reglas del producto local, en un solo sitio.
//
// Hasta este bloque vivían dentro de `local-products.ts`, que era el
// único que las necesitaba. Ahora hay dos puertas de entrada al mismo
// catálogo —el alta de una ficha desde el panel del propietario y la
// carga de un fichero desde el super-admin— y la regla tiene que ser
// literalmente la misma función, no la misma idea escrita dos veces:
// dos copias de la regla es como nacen los catálogos que el TPV cobra
// mal.
//
// Lo que se decide aquí: el SKU, el nombre, el IVA, las etiquetas, el
// código de barras, los límites, y **el precio**.
//
// ── El precio, que es lo que más duele ────────────────────────────────
//
// `Product.basePrice` es el precio **NETO**, con cuatro decimales
// (`Decimal(12,4)`). No es una elección de este bloque: es lo que el
// resto de la cadena da por hecho.
//
//   · El TPV pinta `basePrice · (1 + IVA)` (`tpv-catalog/routes.ts`).
//   · El ticket trata `unitPrice` como neto y agrega por bucket de IVA
//     antes de redondear una sola vez (`tickets/totals.ts`, v1.4-b30).
//   · Holded factura sobre el neto con 4 decimales, que es la razón por
//     la que la columna tiene 4 y no 2.
//
// Y a la vez, **nadie teclea netos**. El dueño del bar lee su carta: el
// café con leche vale 1,60 €. El fichero de implantación trae una
// columna `precio_con_iva`. El formulario del panel tiene una etiqueta
// que dice «Precio con IVA». Las tres cosas hablan en bruto.
//
// Así que la conversión vive aquí, una vez, y las dos rutas la usan:
//
//     bruto 1,60 € al 10 %  →  neto 1,4545  →  el TPV pinta 1,60 €
//
// Medido sobre los 128 precios de `catalogo-tpv.csv` (La Maestranza):
// con 4 decimales el viaje de ida y vuelta es exacto en los 128, y el
// total de un ticket de 1 y de 10 unidades sale al céntimo. Hay test, y
// el test se pone rojo si alguien quita la conversión
// (`test/catalogo-en-alta-precio.test.ts`).

import { Prisma } from "@mipiacetpv/db";

// catalogo-local · el tipo de IVA del alta local (addendum 2).
//
// De dónde NO sale: de `TenantTax`. Esa tabla es el cache del catálogo
// fiscal de Holded y la pueblan los dos syncs (`initial-sync.ts:129`,
// `incremental-sync.ts:185`). El comercio que nos ocupa tiene CERO filas
// ahí por definición, así que el desplegable no tendría de dónde salir.
//
// De dónde sale: esta constante. Los cuatro tramos peninsulares —general,
// reducido, superreducido y exento—, con el 21 por delante porque es el
// caso normal de los verticales de hoy.
//
// Y no es una lista cerrada: los handlers aceptan CUALQUIER tipo entre 0
// y 100 con dos decimales (ver `normalizeTaxRate`). Las dos mitades
// tienen su motivo y son opuestas a propósito:
//
//   · La LISTA existe porque teclear `2,1` en vez de `21` se cobraría mal
//     en todos los tickets hasta que alguien lo notara, y el papel no lo
//     canta. Cuatro botones no se equivocan.
//   · La VÍA DE ESCAPE existe porque el IGIC canario (7, 3, 0 %) —y
//     cualquier tipo que cambie por ley— dejaría al cliente parado, sin
//     poder dar de alta su producto, esperando a que toquemos código y
//     despleguemos.
//
// Esto aplica SÓLO al catálogo local. Un `source = HOLDED` sigue
// trayendo su `taxRate` del sync.
export const LOCAL_TAX_RATES = [21, 10, 4, 0] as const;

// Dos decimales, que es la precisión de la columna (`Decimal(5,2)`).
// Más allá, la base redondearía en silencio y el producto quedaría con
// un IVA distinto del que el propietario tecleó.
const TAX_RATE_DECIMALS = 2;

// Los cuatro decimales de `basePrice` (`Decimal(12,4)`). El neto se
// redondea a esta precisión y no a dos: con dos, el bruto no vuelve
// (1,60 € al 10 % daría 1,45 → 1,60 - 0,005 → 1,59 o 1,60 según el
// humor del redondeo, y a diez unidades el céntimo ya es visible).
export const PRICE_NET_DECIMALS = 4;

export const SKU_MAX = 64;
export const NAME_MAX = 200;
export const BARCODE_MAX = 64;
export const TAG_MAX = 40;
export const TAGS_MAX = 12;

// Precio máximo por unidad. La columna es Decimal(12,4), así que el
// techo de verdad son 99.999.999,9999 €; este límite es de producto, no
// de base de datos: un precio de siete cifras en un TPV de barrio es un
// dedo en el teclado numérico, no una venta.
export const PRICE_MAX = 999999.99;

export type RuleResult<T> = { ok: true; value: T } | { ok: false; message: string };

function ok<T>(value: T): RuleResult<T> {
  return { ok: true, value };
}

function bad<T>(message: string): RuleResult<T> {
  return { ok: false, message };
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/**
 * Precio NETO a partir del precio con IVA. Cuatro decimales, que es lo
 * que la columna guarda y lo que hace que el viaje de vuelta sea exacto.
 *
 * El IVA entra ya validado por `normalizeTaxRate`, así que el divisor
 * nunca es cero ni negativo (un IVA del 0 % divide por 1).
 */
export function netoDesdeBruto(bruto: number, taxRate: number): number {
  return round(bruto / (1 + taxRate / 100), PRICE_NET_DECIMALS);
}

/**
 * El camino de vuelta: lo que el cliente ve. Dos decimales, porque es
 * un precio de escaparate.
 *
 * La usan el TPV (`tpv-catalog/routes.ts`) y el serializador del panel,
 * para que la cifra que el propietario lee en su pantalla sea la misma
 * que el cajero ve en la rejilla. Antes de este bloque el TPV hacía esta
 * multiplicación a mano y el panel no la hacía en absoluto: enseñaba el
 * neto bajo una etiqueta que decía «Precio con IVA».
 */
export function brutoDesdeNeto(neto: number, taxRate: number): number {
  return round(neto * (1 + taxRate / 100), 2);
}

/**
 * Valida el tipo de IVA de un producto local. Fuera de rango es 400 con
 * una frase, nunca un 500 y nunca un redondeo callado.
 */
export function normalizeTaxRate(raw: number): RuleResult<number> {
  if (!Number.isFinite(raw)) {
    return bad("El tipo de IVA no es un número válido.");
  }
  if (raw < 0 || raw > 100) {
    return bad("El tipo de IVA tiene que estar entre 0 y 100.");
  }
  const rounded = round(raw, TAX_RATE_DECIMALS);
  if (rounded !== raw) {
    return bad("El tipo de IVA admite como mucho dos decimales.");
  }
  return ok(rounded);
}

/**
 * Normaliza y valida un SKU de producto local.
 *
 * Las reglas son las del prompt del bloque catalogo-local, y cada una
 * tiene su razón:
 *
 *  · **No vacío.** Es la regla madre: sin SKU el TPV no lo vende
 *    (`tpv-catalog/routes.ts` filtra `sku: { not: null }`) y el día del
 *    casamiento con Holded no hay por dónde casarlo.
 *  · **Sin espacios en los extremos.** Se recortan en silencio en vez de
 *    rechazar: un espacio pegado al pegar desde un Excel no es un error
 *    del propietario, es ruido del portapapeles.
 *  · **Sin espacios interiores.** Éste sí se rechaza. Un SKU con un
 *    espacio dentro viaja como identificador de línea a Holded y a la
 *    impresora térmica, y ahí parte el campo.
 */
export function normalizeSku(raw: string): RuleResult<string> {
  const sku = raw.trim();
  if (sku.length === 0) {
    return bad("El SKU es obligatorio.");
  }
  if (/\s/.test(sku)) {
    return bad("El SKU no puede llevar espacios. Usa guiones si necesitas separar.");
  }
  if (sku.length > SKU_MAX) {
    return bad(`El SKU no puede pasar de ${SKU_MAX} caracteres.`);
  }
  return ok(sku);
}

export function normalizeName(raw: string): RuleResult<string> {
  const name = raw.trim();
  if (name.length === 0) {
    return bad("El nombre es obligatorio.");
  }
  if (name.length > NAME_MAX) {
    return bad(`El nombre no puede pasar de ${NAME_MAX} caracteres.`);
  }
  return ok(name);
}

/**
 * El precio, en la única forma en la que se guarda: NETO.
 *
 * Acepta las dos maneras de pedirlo y exige exactamente una:
 *
 *   · `priceGross` — el precio con IVA. Es lo que manda el formulario del
 *     panel y lo que trae la columna `precio_con_iva` del fichero.
 *   · `basePrice`  — el neto ya calculado. Se mantiene porque es el
 *     contrato con el que nació `POST /catalog/products` y hay llamadas
 *     (y tests) que lo usan; quitarlo sería romper por gusto.
 *
 * Mandar las dos es un error del llamante, no una preferencia que
 * podamos resolver nosotros: si no coinciden, cualquiera de las dos
 * elecciones cobra mal.
 */
export function normalizePrice(input: {
  basePrice?: number;
  priceGross?: number;
  taxRate: number;
}): RuleResult<number> {
  const { basePrice, priceGross, taxRate } = input;
  if (basePrice !== undefined && priceGross !== undefined) {
    return bad(
      "Manda el precio una sola vez: `priceGross` (con IVA) o `basePrice` (sin IVA), no los dos.",
    );
  }
  const raw = priceGross ?? basePrice;
  if (raw === undefined) {
    return bad("El precio es obligatorio.");
  }
  if (!Number.isFinite(raw)) {
    return bad("El precio no es válido. Escribe un número, por ejemplo 12,50.");
  }
  if (raw < 0) {
    return bad("El precio no puede ser negativo.");
  }
  if (raw > PRICE_MAX) {
    return bad("El precio es demasiado alto. Revisa si se ha colado un dígito.");
  }
  return ok(priceGross !== undefined ? netoDesdeBruto(priceGross, taxRate) : round(raw, PRICE_NET_DECIMALS));
}

// Los tags se guardan como Holded los entrega —lowercase y sin
// duplicados— para que los chips de categoría del TPV salgan iguales
// vengan de donde vengan. La misma normalización que hacen los dos
// syncs; el TPV capitaliza al pintar.
export function normalizeTags(raw: string[] | undefined): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(raw.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0)),
  ).slice(0, TAGS_MAX);
}

export function normalizeBarcode(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  return v.length === 0 ? null : v;
}

/** Lo que las dos rutas tienen que validar, validado de una vez. */
export interface LocalProductInput {
  name: string;
  sku: string;
  /** Con IVA. Excluyente con `basePrice`. */
  priceGross?: number;
  /** Sin IVA. Excluyente con `priceGross`. */
  basePrice?: number;
  taxRate: number;
  kind?: "PRODUCT" | "SERVICE";
  barcode?: string | null;
  tags?: string[];
  active?: boolean;
}

export interface LocalProductFields {
  name: string;
  sku: string;
  /** NETO, 4 decimales. Lo que va a la columna. */
  basePrice: number;
  taxRate: number;
  kind: "PRODUCT" | "SERVICE";
  barcode: string | null;
  tags: string[];
  active: boolean;
}

/**
 * Valida un producto local entero y devuelve los campos ya normalizados,
 * o el primer error con su frase y el nombre del campo que falla.
 *
 * El orden importa: el IVA se valida ANTES del precio porque el precio
 * se convierte con él. Un IVA inválido con un precio bruto daría un neto
 * inventado.
 */
export function validateLocalProduct(
  input: LocalProductInput,
): { ok: true; fields: LocalProductFields } | { ok: false; field: string; message: string } {
  const name = normalizeName(input.name);
  if (!name.ok) return { ok: false, field: "name", message: name.message };

  const sku = normalizeSku(input.sku);
  if (!sku.ok) return { ok: false, field: "sku", message: sku.message };

  const tax = normalizeTaxRate(input.taxRate);
  if (!tax.ok) return { ok: false, field: "taxRate", message: tax.message };

  const price = normalizePrice({
    basePrice: input.basePrice,
    priceGross: input.priceGross,
    taxRate: tax.value,
  });
  if (!price.ok) return { ok: false, field: "price", message: price.message };

  return {
    ok: true,
    fields: {
      name: name.value,
      sku: sku.value,
      basePrice: price.value,
      taxRate: tax.value,
      kind: input.kind ?? "PRODUCT",
      barcode: normalizeBarcode(input.barcode),
      tags: normalizeTags(input.tags),
      active: input.active ?? true,
    },
  };
}

/**
 * Los datos del `create`, exactamente iguales los pida quien los pida.
 * Lo que define un producto local: sin enlace con Holded, con la
 * autoridad en casa, vendible desde que nace y sin pasar por la bandeja
 * de revisión de SKU —su SKU lo puso una persona—.
 */
export function buildLocalProductCreateData(
  tenantId: string,
  f: LocalProductFields,
): Prisma.ProductUncheckedCreateInput {
  return {
    tenantId,
    source: "LOCAL",
    holdedProductId: null,
    name: f.name,
    sku: f.sku,
    barcode: f.barcode,
    basePrice: new Prisma.Decimal(f.basePrice),
    taxRate: new Prisma.Decimal(f.taxRate),
    kind: f.kind,
    active: f.active,
    tags: f.tags,
    sellableViaTpv: true,
    needsSkuReview: false,
    skuAutoAssignedAt: null,
  };
}

// ¿El error de Prisma es el choque del índice único parcial de SKU
// local? P2002 es "unique constraint failed"; el `target` trae el nombre
// del índice. Se comprueba el nombre y no sólo el código porque
// `products` tiene DOS índices únicos y el otro —el del enlace con
// Holded— significa una cosa completamente distinta.
export function isLocalSkuConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== "P2002") return false;
  const target = err.meta?.target;
  const asText = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return asText.includes("products_tenant_id_sku_local_key") || asText.includes("sku");
}

export const SKU_CONFLICT = {
  error: "SKU_ALREADY_EXISTS",
  message: "Ya tienes otro producto con ese SKU. Cambia uno de los dos.",
};

/**
 * El fragmento de esquema JSON que comparten `POST` y `PATCH`. Vive aquí
 * para que los límites del esquema y los de las funciones de arriba no
 * puedan separarse.
 */
export const PRODUCT_BODY_PROPERTIES = {
  name: { type: "string", minLength: 1, maxLength: NAME_MAX },
  sku: { type: "string", minLength: 1, maxLength: SKU_MAX },
  // Las dos formas de mandar el precio. El esquema deja pasar ambas y es
  // `normalizePrice` quien exige que venga exactamente una: el mensaje
  // de "manda una sola" se explica mucho mejor con una frase que con un
  // `oneOf`, que el cliente recibe como "body/ debe coincidir con
  // exactamente un esquema en oneOf".
  basePrice: { type: "number", minimum: 0, maximum: PRICE_MAX },
  priceGross: { type: "number", minimum: 0, maximum: PRICE_MAX },
  // El esquema deja pasar todo el rango; los dos decimales y el mensaje
  // los pone `normalizeTaxRate`, que puede explicar el porqué. Un `enum`
  // aquí habría cerrado la puerta al IGIC.
  taxRate: { type: "number", minimum: 0, maximum: 100 },
  kind: { type: "string", enum: ["PRODUCT", "SERVICE"] },
  barcode: { type: ["string", "null"], maxLength: BARCODE_MAX },
  tags: {
    type: "array",
    maxItems: TAGS_MAX,
    items: { type: "string", minLength: 1, maxLength: TAG_MAX },
  },
  active: { type: "boolean" },
} as const;
