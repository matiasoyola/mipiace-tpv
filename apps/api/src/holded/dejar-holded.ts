// holded-desconectar · el camino de `holdedEnabled = true` + clave a
// `holdedEnabled = false` sin clave, en un comercio que ya vende. ADR-020.
//
// Este fichero es la ACCIÓN entera, en dos funciones que ven exactamente
// lo mismo:
//
//   previsualizarDejarHolded()  → qué va a pasar, con los números de ESE
//                                 comercio, y qué lo impide si algo lo
//                                 impide.
//   ejecutarDejarHolded()       → hace exactamente eso.
//
// Que sean dos funciones sobre las MISMAS consultas es el criterio 7 del
// bloque en código. La previsualización no es un texto de ayuda: es el
// plan, y la ejecución lo aplica. Por eso `ejecutarDejarHolded` empieza
// volviendo a previsualizar dentro de su transacción, y no se fía de lo
// que la pantalla vio hace treinta segundos.
//
// ── Lo que NO está aquí ────────────────────────────────────────────────
//
// El vaciado de las colas BullMQ vive en `dejar-holded-colas.ts`: Redis no
// entra en una transacción de Postgres y mezclarlos en el mismo fichero
// invitaría a mezclarlos en la misma función. La ruta llama primero a
// ésta y después a aquélla, y aquélla es re-ejecutable a mano.
//
// La VUELTA a Holded (reconectar y casar por SKU) es otro bloque. Lo que
// este deja preparado: `holded_product_id` intacto en las 86 fichas, el
// SKU final de cada una en el audit, y la puerta de `holded_disconnected_at`
// que impide reencender sin ese bloque.

import { Prisma, type PrismaClient } from "@mipiacetpv/db";

import { comprobarSueloFiscal, type SueloFiscal } from "../fiscal/activacion.js";

type Tx = Prisma.TransactionClient | PrismaClient;

// ── El SKU: la llave de la vuelta, y el índice que la va a pisar ───────
//
// Tras el corte TODA la ficha del comercio es `source = LOCAL`, así que el
// índice único parcial de ADR-017 §3.1 —`UNIQUE (tenant_id, sku) WHERE
// source = 'LOCAL'`— pasa a gobernar el catálogo entero. Y el catálogo que
// llega de Holded no lo cumple:
//
//   · SKU nulo o vacío. Medido en la copia de prod del 24-09: Thalía 1.
//   · SKU DUPLICADO, y aquí está el hallazgo del bloque. `buildAutoSku`
//     compone `AUTO-` + los 8 primeros caracteres alfanuméricos del id de
//     Holded, y un id de Holded es un ObjectId de Mongo cuyos 8 primeros
//     hex son EL TIMESTAMP. Todo lo que el cliente creó el mismo rato
//     comparte SKU. Medido: Thalía 55 fichas en 8 grupos (el mayor, 13),
//     PRUEBAS MIPIACE 26 en 3 grupos (el mayor, 20), Sirope 3 grupos de 2.
//     Sole, por suerte, 86 SKU distintos y ninguno vacío.
//
// La regla, y por qué tiene dos mitades opuestas:
//
//   · Lo que el SKU inventamos NOSOTROS se re-acuña. Un `AUTO-<8>`
//     repetido trece veces no era la llave de nada: ya estaba degenerado
//     en Holded el día que se subió. Acuñarlo único es una mejora
//     estricta y no pierde ningún dato del cliente.
//   · Lo que el SKU escribió EL CLIENTE no se toca nunca. `SKU215` en la
//     Coca-Cola y en la Coca-Cola zero de Sirope es un error suyo en su
//     ERP, y decidir cuál de los dos se queda no es cosa de una acción
//     automática. Sale listado en la previsualización, la acción no
//     arranca, y se resuelve donde se resuelven los SKU: en Holded (con
//     la clave todavía puesta) o en la pantalla "Revisión de SKU".
//
// Nunca se borra ni se fusiona una ficha. Cada `id` sigue siendo el mismo
// —de él cuelgan líneas de ticket, agenda, recursos, citas y
// modificadores— y eso es el criterio 6 del bloque.

/** El prefijo del SKU acuñado EN EL CORTE.
 *
 *  Tres prefijos y tres significados distintos, y no se mezclan:
 *
 *   · `AUTO-` (`buildAutoSku`) — lo asignó `runAutoSku` y lo SUBIÓ a
 *     Holded con GET-back, así que allí es canónico.
 *     `buildTicketSalesreceiptPayload` se apoya en esa promesa para
 *     mandarlo como identificador de línea (incidente de Peluquería Sole
 *     del 10-06-2026, ver `upload-ticket.ts`).
 *   · `LOC-` (`buildLocalSku`) — nació en mipiacetpv y no ha estado en
 *     Holded ni va a estar.
 *   · `CORTE-` (esto) — la ficha SÍ estuvo en Holded, pero este SKU NO es
 *     el que Holded tiene. Es la tercera cosa, y merece su propia palabra:
 *     poner `AUTO-` sería escribir una mentira justo en el campo donde esa
 *     mentira cuesta dinero, y poner `LOC-` negaría el histórico.
 */
export const SKU_PREFIJO_CORTE = "CORTE-";

/**
 * El SKU acuñado en el corte para una ficha que venía de Holded.
 *
 * Deriva del `holded_product_id` COMPLETO y no de sus 8 primeros
 * caracteres, que es el bug que obliga a existir a esta función. Con el id
 * entero la unicidad no es una esperanza: `(tenant_id, holded_product_id)`
 * ya es UNIQUE en `products`, así que dos fichas del mismo comercio no
 * pueden producir el mismo valor.
 *
 * Cabe de sobra en los 64 caracteres del SKU: `CORTE-` + 24 hex de un
 * ObjectId son 30.
 */
export function buildSkuDelCorte(holdedProductId: string): string {
  return `${SKU_PREFIJO_CORTE}${holdedProductId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()}`;
}

/** ¿Este SKU lo inventamos nosotros, o lo escribió el cliente?
 *
 *  `skuAutoAssignedAt` es la única señal fiable y la puso quien lo
 *  inventó: `runAutoSku` la sella al asignar, y la bandeja de revisión la
 *  pone a NULL cuando un humano escribe el SKU a mano
 *  (`catalog/routes.ts`). Comparar sólo el prefijo no bastaría — un
 *  cliente puede tener un SKU que empiece por `AUTO-` en su ERP. */
function esSkuNuestro(p: {
  sku: string | null;
  skuAutoAssignedAt: Date | null;
}): boolean {
  if (p.skuAutoAssignedAt == null) return false;
  return (
    p.sku != null &&
    (p.sku.startsWith("AUTO-") || p.sku.startsWith(SKU_PREFIJO_CORTE))
  );
}

/** Lo mínimo de un producto que el plan de SKU necesita. */
export interface ProductoParaPlan {
  id: string;
  name: string;
  kind: "PRODUCT" | "SERVICE";
  sku: string | null;
  source: "HOLDED" | "LOCAL";
  holdedProductId: string | null;
  skuAutoAssignedAt: Date | null;
  taxRate: Prisma.Decimal | number;
  sellableViaTpv: boolean;
  archivedFromHoldedAt: Date | null;
}

/** Un cambio de SKU que la acción va a escribir. */
export interface CambioSku {
  productoId: string;
  nombre: string;
  skuAntes: string | null;
  skuDespues: string;
  motivo: "vacio" | "duplicado";
}

/** Un choque de SKU que la acción NO puede resolver sola. */
export interface ChoqueSku {
  codigo: "SKU_DUPLICADO_DEL_CLIENTE" | "SKU_VACIO_SIN_ENLACE" | "SKU_ACUNADO_CHOCA";
  sku: string | null;
  productos: Array<{ id: string; nombre: string; sku: string | null }>;
  comoSeArregla: string;
}

export interface PlanSku {
  /** Fichas cuyo SKU ya sirve tal cual. */
  intactos: number;
  cambios: CambioSku[];
  choques: ChoqueSku[];
}

/**
 * El plan de SKU, calculado sobre TODAS las fichas del comercio.
 *
 * Sobre todas y no sólo sobre las `HOLDED`: tras el corte el índice
 * parcial gobierna el catálogo entero, así que una ficha local preexistente
 * con el mismo SKU que una de Holded también choca. Es el caso del
 * catálogo mixto que ADR-017 §2.6 deja documentado y que hoy no puede
 * nacer, pero que existe en las bases de los comercios que arrastran
 * locales de antes del interruptor.
 *
 * Determinista y sin efectos: el mismo catálogo da el mismo plan. Eso es
 * lo que permite que la previsualización y la ejecución lo calculen por
 * separado y coincidan.
 */
export function planificarSku(productos: ProductoParaPlan[]): PlanSku {
  const cambios: CambioSku[] = [];
  const choques: ChoqueSku[] = [];
  // SKU final de cada ficha tras aplicar el plan. Se va poblando.
  const skuFinal = new Map<string, string | null>();
  // Fichas a las que el paso 1 le ha ACUÑADO el SKU. Hace falta en el paso 2
  // para poder distinguir «este duplicado es del cliente» de «el SKU que
  // acabo de acuñar choca con uno del cliente»: son dos diagnósticos con dos
  // arreglos distintos, y `esSkuNuestro` no los separa porque mira el SKU
  // ANTERIOR, que en el primer caso es NULL.
  const acunadosEnPaso1 = new Set<string>();

  // ── Paso 1 · las vacías ─────────────────────────────────────────────
  for (const p of productos) {
    const vacio = p.sku == null || p.sku.trim().length === 0;
    if (!vacio) {
      skuFinal.set(p.id, p.sku);
      continue;
    }
    if (p.holdedProductId == null) {
      // Sin enlace no hay nada de lo que derivar. No se inventa un SKU
      // con un uuid: el SKU es del cliente y es la llave de su vuelta.
      choques.push({
        codigo: "SKU_VACIO_SIN_ENLACE",
        sku: null,
        productos: [{ id: p.id, nombre: p.name, sku: p.sku }],
        comoSeArregla:
          "Ponle un SKU a esta ficha desde Catálogo en el panel antes de dejar Holded.",
      });
      skuFinal.set(p.id, null);
      continue;
    }
    const nuevo = buildSkuDelCorte(p.holdedProductId);
    cambios.push({
      productoId: p.id,
      nombre: p.name,
      skuAntes: p.sku,
      skuDespues: nuevo,
      motivo: "vacio",
    });
    skuFinal.set(p.id, nuevo);
    acunadosEnPaso1.add(p.id);
  }

  // ── Paso 2 · los duplicados ─────────────────────────────────────────
  const porSku = new Map<string, ProductoParaPlan[]>();
  for (const p of productos) {
    const s = skuFinal.get(p.id);
    if (s == null) continue;
    const lista = porSku.get(s);
    if (lista) lista.push(p);
    else porSku.set(s, [p]);
  }

  for (const [sku, grupo] of porSku) {
    if (grupo.length < 2) continue;
    // Se re-acuña el grupo ENTERO, no "todos menos uno". Elegir cuál se
    // queda con el valor degenerado sería un desempate arbitrario (¿el más
    // antiguo? ¿el de id menor?) y un desempate arbitrario es una decisión
    // que nadie podría reproducir leyendo el código. Re-acuñar todos es
    // determinista y deja los trece SKU distintos entre sí.
    // Un grupo que contiene una ficha recién acuñada en el paso 1 no es un
    // duplicado del cliente: es NUESTRO SKU chocando con el suyo, y el
    // arreglo es otro (cambiar el suyo a mano, no re-acuñar el nuestro, que
    // volvería a derivar el mismo valor). Se diagnostica en el paso 3.
    if (grupo.some((p) => acunadosEnPaso1.has(p.id))) continue;
    const todosNuestros = grupo.every(
      (p) => esSkuNuestro(p) && p.holdedProductId != null,
    );
    if (!todosNuestros) {
      choques.push({
        codigo: "SKU_DUPLICADO_DEL_CLIENTE",
        sku,
        productos: grupo.map((p) => ({ id: p.id, nombre: p.name, sku: p.sku })),
        comoSeArregla:
          "Este SKU lo escribió el cliente y está repetido. Arréglalo en Holded (la clave sigue puesta) " +
          "o desde Catálogo en el panel, y vuelve a previsualizar. No se fusiona ni se borra ninguna ficha.",
      });
      continue;
    }
    for (const p of grupo) {
      const nuevo = buildSkuDelCorte(p.holdedProductId!);
      cambios.push({
        productoId: p.id,
        nombre: p.name,
        skuAntes: p.sku,
        skuDespues: nuevo,
        motivo: "duplicado",
      });
      skuFinal.set(p.id, nuevo);
    }
  }

  // ── Paso 3 · comprobar que el plan cierra ───────────────────────────
  //
  // Un SKU acuñado no puede chocar con otro acuñado (derivan de ids
  // únicos), pero SÍ podría chocar con uno que el cliente tenga escrito a
  // mano con esa forma exacta. Es astronómicamente improbable y aun así se
  // comprueba: si pasara, la alternativa es que el índice parcial tumbe la
  // transacción con un P2002 que nadie sabría leer.
  const finales = new Map<string, string[]>();
  for (const p of productos) {
    const s = skuFinal.get(p.id);
    if (s == null) continue;
    const lista = finales.get(s);
    if (lista) lista.push(p.id);
    else finales.set(s, [p.id]);
  }
  const porId = new Map(productos.map((p) => [p.id, p]));
  for (const [sku, ids] of finales) {
    if (ids.length < 2) continue;
    // Si ya se reportó como duplicado del cliente, no se duplica el aviso.
    if (choques.some((c) => c.sku === sku)) continue;
    choques.push({
      codigo: "SKU_ACUNADO_CHOCA",
      sku,
      productos: ids.map((id) => {
        const p = porId.get(id)!;
        return { id: p.id, nombre: p.name, sku: p.sku };
      }),
      comoSeArregla:
        "El SKU que la acción acuñaría ya existe en otra ficha. Cámbiaselo a mano y vuelve a previsualizar.",
    });
  }

  const cambiados = new Set(cambios.map((c) => c.productoId));
  return {
    intactos: productos.filter((p) => !cambiados.has(p.id)).length,
    cambios,
    choques,
  };
}

// ── `sellableViaTpv` tras el corte ─────────────────────────────────────
//
// No se copia tal cual y no se pone a `true` a lo bruto. Las dos cosas
// serían un error visible en la rejilla del TPV al día siguiente:
//
//   · Copiarlo tal cual dejaría invisible para siempre la ficha cuyo único
//     problema era el SKU vacío, justo después de que la acción le haya
//     dado uno. Y desde el panel no hay forma de arreglarlo:
//     `sellableViaTpv` no está entre los campos que acepta
//     `PATCH /catalog/products/:id`.
//   · Ponerlo a `true` a lo bruto pondría a la venta al 0 % las fichas
//     cuyo IVA el sync NO PUDO RESOLVER. Ésas cobran de menos en cada
//     ticket y el papel no lo canta.
//
// La firma de "IVA sin resolver" es comprobable y sale de
// `upsertCatalogEntry`: cuando `resolveTaxRate` devuelve null, escribe
// `taxRate = 0` Y FUERZA `sellableViaTpv = false`. Un exento REAL queda
// vendible, así que el par `(taxRate = 0, sellableViaTpv = false)` sólo lo
// produce ese camino. Medido en la copia de prod: 9 fichas, ninguna de
// Sole (Thalía 4, PRUEBAS 4, más los dos comodines `TPV-OTROS-0`).
export function sellableTrasElCorte(p: {
  sku: string | null;
  taxRate: Prisma.Decimal | number;
  sellableViaTpv: boolean;
  archivedFromHoldedAt: Date | null;
}, skuFinal: string | null): boolean {
  // Los archivados de Holded SIGUEN ARCHIVADOS. Criterio 1 del bloque:
  // una ficha que se borró en el ERP no vuelve a la rejilla porque el
  // comercio deje el ERP.
  if (p.archivedFromHoldedAt != null) return p.sellableViaTpv;
  if (skuFinal == null || skuFinal.trim().length === 0) return false;
  const ivaSinResolver = Number(p.taxRate) === 0 && p.sellableViaTpv === false;
  return !ivaSinResolver;
}

// ══════════════════════════════════════════════════════════════════════
// LA PREVISUALIZACIÓN
// ══════════════════════════════════════════════════════════════════════

/** Algo que impide arrancar. La acción no empieza mientras quede uno. */
export interface Bloqueo {
  codigo:
    | "NO_USA_HOLDED"
    | "SIN_CLAVE"
    | "YA_DESCONECTADO"
    | "SUELO_FISCAL_INCOMPLETO"
    | "VENTAS_EN_VUELO"
    | "ABONOS_EN_VUELO"
    | "SUBIDAS_EN_VUELO"
    | "FIADO_VIVO"
    | "SKU_SIN_RESOLVER";
  /** Frase para la pantalla, en el idioma del que la va a leer. */
  mensaje: string;
  /** Cuántos casos, cuando el bloqueo cuenta cosas. */
  cuantos?: number;
}

export interface FilaEnVuelo {
  id: string;
  numero: string | null;
  estado: string;
  total: string;
  fecha: string;
  motivo?: unknown;
}

export interface PrevisualizacionDejarHolded {
  tenant: {
    id: string;
    nombre: string;
    holdedEnabled: boolean;
    holdedConectado: boolean;
    holdedDisconnectedAt: string | null;
    initialSyncStatus: string;
  };
  catalogo: {
    /** Fichas `source = HOLDED` que pasarán a `LOCAL`. */
    seConvierten: number;
    productos: number;
    servicios: number;
    /** Ya locales antes del corte (catálogo mixto heredado). */
    yaLocales: number;
    /** Conservan `holded_product_id` — el hilo de la vuelta. */
    conservanEnlace: number;
    /** Archivados en Holded: siguen archivados. */
    archivados: number;
    /** IVA que el sync no pudo resolver: siguen NO vendibles. */
    ivaSinResolver: number;
    /** Fichas que ganan visibilidad en el TPV por recibir SKU. */
    pasanAVendibles: number;
    /** Lo que cuelga de los `id` que NO cambian (criterio 6). */
    cuelgan: {
      lineasDeTicket: number;
      conAgenda: number;
      conRecursos: number;
      enCitas: number;
      conModificadores: number;
      conHabilidades: number;
    };
  };
  sku: PlanSku;
  ventasEnVuelo: {
    ticketsPendingSync: FilaEnVuelo[];
    ticketsSyncFailed: FilaEnVuelo[];
    abonosPendingSync: FilaEnVuelo[];
    abonosSyncFailed: FilaEnVuelo[];
    /** `HoldedUpload` PENDING cuyo ticket/abono SÍ existe. Bloquea. */
    subidasVivas: Array<{ externalId: string; kind: string; creado: string }>;
    /** `HoldedUpload` PENDING cuyo ticket/abono YA NO existe. La acción
     *  las cierra como SKIPPED: no hay nada que subir y nunca lo habrá. */
    subidasHuerfanas: Array<{ externalId: string; kind: string; creado: string }>;
    /** `HoldedUpload` FAILED. No bloquea por sí misma: lo que bloquea es
     *  el estado de su ticket/abono, que se cuenta arriba. */
    subidasFallidas: number;
    /** Fiados con deuda viva: al saldarse ya no subirían a Holded. */
    fiadosVivos: FilaEnVuelo[];
    /** Tickets DRAFT (mesas abiertas). No bloquean: se cobrarán después
     *  del corte, como factura simplificada nuestra. */
    borradores: number;
    /** Turnos abiertos. No bloquean; el guion de despliegue pide hacerlo
     *  con la tienda cerrada porque el arqueo se lee mejor. */
    turnosAbiertos: number;
  };
  contactosYCrm: {
    contactos: number;
    contactosActivos: number;
    ticketsConContacto: number;
    clientesCrm: number;
    clientesConEnlaceHolded: number;
    fiadosVivosConDeudor: number;
    deudaVivaTotal: string;
    /** Envíos automáticos de ticket por email que dependían del contacto. */
    emailsAutomaticosHistoricos: number;
    emailsManualesHistoricos: number;
  };
  devoluciones: {
    /** Tickets que Holded facturó y que siguen siendo devolvibles. Un
     *  abono suyo después del corte NO subirá a Holded. */
    ticketsFacturadosPorHolded: number;
    /** Lo mismo, pero sólo los de los últimos 90 días: los que de verdad
     *  se devuelven. */
    facturadosPorHoldedUltimos90d: number;
    abonosPorMes: Array<{ mes: string; cuantos: number; total: string }>;
  };
  fiscal: {
    suelo: SueloFiscal;
    cajas: Array<{
      id: string;
      nombre: string | null;
      tienda: string;
      serie: string | null;
      numeroInstalacion: string | null;
      registrosFiscales: number;
    }>;
    terminales: Array<{
      id: string;
      nombre: string | null;
      caja: string | null;
      apkVersion: string | null;
      apkCodigo: number | null;
      ultimoLatido: string | null;
    }>;
    avisoApk: string;
  };
  puedeArrancar: boolean;
  bloqueos: Bloqueo[];
}

export const AVISO_APK =
  "A partir del primer cobro tras el corte cada venta lleva su registro de facturación VERI*FACTU, " +
  "y ese registro LO GENERA EL TERMINAL. Un terminal con APK anterior a verifactu-1 cobra igual —la " +
  "venta nunca se cae por esto— pero no manda registro, y ese comercio no estaría facturando conforme " +
  "a ley hasta que actualice. Comprueba la versión de cada terminal antes de dar el corte.";

/**
 * Todo lo que la pantalla enseña, sacado de consultas reales sobre ESE
 * comercio. Nada estimado y nada de ejemplo.
 *
 * Acepta una `Tx` para que la ejecución pueda llamarla DENTRO de su
 * transacción y decidir sobre el estado real del momento, no sobre lo que
 * la pantalla vio hace treinta segundos.
 */
export async function previsualizarDejarHolded(
  tx: Tx,
  tenantId: string,
): Promise<PrevisualizacionDejarHolded> {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      holdedEnabled: true,
      holdedApiKeyCiphertext: true,
      holdedDisconnectedAt: true,
      initialSyncStatus: true,
      fiscalProfile: true,
    },
  });
  if (!tenant) throw new TenantNoExisteError(tenantId);

  const productos = (await tx.product.findMany({
    where: { tenantId },
    select: {
      id: true,
      name: true,
      kind: true,
      sku: true,
      source: true,
      holdedProductId: true,
      skuAutoAssignedAt: true,
      taxRate: true,
      sellableViaTpv: true,
      archivedFromHoldedAt: true,
    },
  })) as ProductoParaPlan[];

  const plan = planificarSku(productos);
  const skuFinalPorId = new Map<string, string | null>();
  for (const p of productos) skuFinalPorId.set(p.id, p.sku);
  for (const c of plan.cambios) skuFinalPorId.set(c.productoId, c.skuDespues);

  const deHolded = productos.filter((p) => p.source === "HOLDED");
  const pasanAVendibles = deHolded.filter(
    (p) =>
      !p.sellableViaTpv &&
      sellableTrasElCorte(p, skuFinalPorId.get(p.id) ?? null),
  ).length;

  const idsDeHolded = deHolded.map((p) => p.id);

  const [
    lineasDeTicket,
    conAgenda,
    conRecursos,
    enCitas,
    conModificadores,
    conHabilidades,
  ] = await Promise.all([
    idsDeHolded.length === 0
      ? Promise.resolve(0)
      : tx.ticketLine.count({ where: { productId: { in: idsDeHolded } } }),
    idsDeHolded.length === 0
      ? Promise.resolve(0)
      : tx.serviceScheduling.count({ where: { productId: { in: idsDeHolded } } }),
    idsDeHolded.length === 0
      ? Promise.resolve(0)
      : tx.serviceResourceNeed.count({ where: { serviceId: { in: idsDeHolded } } }),
    idsDeHolded.length === 0
      ? Promise.resolve(0)
      : tx.appointmentItem.count({ where: { serviceId: { in: idsDeHolded } } }),
    idsDeHolded.length === 0
      ? Promise.resolve(0)
      : tx.productModifierGroup.count({ where: { productId: { in: idsDeHolded } } }),
    idsDeHolded.length === 0
      ? Promise.resolve(0)
      : tx.staffSkill.count({ where: { serviceId: { in: idsDeHolded } } }),
  ]);

  // ── Ventas en vuelo ────────────────────────────────────────────────
  const filaTicket = (t: {
    id: string;
    internalNumber: string | null;
    status: string;
    total: Prisma.Decimal;
    createdAt: Date;
    syncError?: unknown;
  }): FilaEnVuelo => ({
    id: t.id,
    numero: t.internalNumber,
    estado: t.status,
    total: t.total.toFixed(2),
    fecha: t.createdAt.toISOString(),
    motivo: t.syncError ?? undefined,
  });

  const SELECT_VUELO = {
    id: true,
    internalNumber: true,
    status: true,
    total: true,
    createdAt: true,
    syncError: true,
  } as const;

  const [
    ticketsPendingSync,
    ticketsSyncFailed,
    abonosPendingSync,
    abonosSyncFailed,
    fiadosVivos,
    borradores,
    turnosAbiertos,
    uploadsPendientes,
    subidasFallidas,
  ] = await Promise.all([
    tx.ticket.findMany({
      where: { tenantId, status: "PENDING_SYNC" },
      select: SELECT_VUELO,
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    tx.ticket.findMany({
      where: { tenantId, status: "SYNC_FAILED" },
      select: SELECT_VUELO,
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    tx.refund.findMany({
      where: { tenantId, status: "PENDING_SYNC" },
      select: SELECT_VUELO,
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    tx.refund.findMany({
      where: { tenantId, status: "SYNC_FAILED" },
      select: SELECT_VUELO,
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    tx.ticket.findMany({
      where: { tenantId, status: "ON_CREDIT" },
      select: SELECT_VUELO,
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    tx.ticket.count({ where: { tenantId, status: "DRAFT" } }),
    tx.shift.count({
      where: { closedAt: null, register: { store: { tenantId } } },
    }),
    tx.holdedUpload.findMany({
      where: { tenantId, status: "PENDING" },
      select: { externalId: true, kind: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: 500,
    }),
    tx.holdedUpload.count({ where: { tenantId, status: "FAILED" } }),
  ]);

  // ¿La subida pendiente tiene todavía un documento detrás? En la copia
  // de prod del 24-09 Sole arrastra DOS filas PENDING del 26-05 cuyo
  // ticket ya no existe (los purgó la activación del comercio). Una fila
  // así no se puede subir nunca y no tiene sentido que frene el corte:
  // la acción la cierra como SKIPPED. Una cuyo documento SÍ existe es
  // otra cosa — ésa es una venta que le falta a su contabilidad.
  const externalIds = uploadsPendientes.map((u) => u.externalId);
  const [ticketsDeEsasSubidas, abonosDeEsasSubidas] = await Promise.all([
    externalIds.length === 0
      ? Promise.resolve([] as Array<{ externalId: string }>)
      : tx.ticket.findMany({
          where: { tenantId, externalId: { in: externalIds } },
          select: { externalId: true },
        }),
    externalIds.length === 0
      ? Promise.resolve([] as Array<{ externalId: string }>)
      : tx.refund.findMany({
          where: { tenantId, externalId: { in: externalIds } },
          select: { externalId: true },
        }),
  ]);
  const vivos = new Set([
    ...ticketsDeEsasSubidas.map((t) => t.externalId),
    ...abonosDeEsasSubidas.map((r) => r.externalId),
  ]);
  const subidasVivas = uploadsPendientes
    .filter((u) => vivos.has(u.externalId))
    .map((u) => ({ externalId: u.externalId, kind: u.kind, creado: u.createdAt.toISOString() }));
  const subidasHuerfanas = uploadsPendientes
    .filter((u) => !vivos.has(u.externalId))
    .map((u) => ({ externalId: u.externalId, kind: u.kind, creado: u.createdAt.toISOString() }));

  // ── Contactos, CRM y fiado ─────────────────────────────────────────
  const [
    contactos,
    contactosActivos,
    ticketsConContacto,
    clientesCrm,
    clientesConEnlaceHolded,
    fiadosVivosConDeudor,
    deudaViva,
    emailsHistoricos,
  ] = await Promise.all([
    tx.contact.count({ where: { tenantId } }),
    tx.contact.count({ where: { tenantId, active: true } }),
    tx.ticket.count({ where: { tenantId, contactHoldedId: { not: null } } }),
    tx.client.count({ where: { tenantId } }),
    tx.client.count({ where: { tenantId, holdedContactId: { not: null } } }),
    tx.ticket.count({
      where: { tenantId, status: "ON_CREDIT", contactHoldedId: { not: null } },
    }),
    tx.ticket.aggregate({
      where: { tenantId, status: "ON_CREDIT" },
      _sum: { creditPending: true },
    }),
    tx.ticketEmailJob.findMany({
      where: { ticket: { tenantId } },
      select: { ticket: { select: { contactHoldedId: true } } },
    }),
  ]);
  const emailsAutomaticosHistoricos = emailsHistoricos.filter(
    (j) => j.ticket.contactHoldedId != null,
  ).length;

  // ── Devoluciones ───────────────────────────────────────────────────
  const hace90d = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const [ticketsFacturadosPorHolded, facturadosPorHoldedUltimos90d, abonosTodos] =
    await Promise.all([
      tx.ticket.count({
        where: { tenantId, holdedDocumentId: { not: null }, status: "SYNCED" },
      }),
      tx.ticket.count({
        where: {
          tenantId,
          holdedDocumentId: { not: null },
          status: "SYNCED",
          createdAt: { gte: hace90d },
        },
      }),
      tx.refund.findMany({
        where: { tenantId },
        select: { createdAt: true, total: true },
      }),
    ]);
  const porMes = new Map<string, { cuantos: number; total: number }>();
  for (const r of abonosTodos) {
    const mes = r.createdAt.toISOString().slice(0, 7);
    const acc = porMes.get(mes) ?? { cuantos: 0, total: 0 };
    acc.cuantos += 1;
    acc.total += Number(r.total);
    porMes.set(mes, acc);
  }
  const abonosPorMes = [...porMes.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([mes, v]) => ({ mes, cuantos: v.cuantos, total: v.total.toFixed(2) }));

  // ── Fiscal ─────────────────────────────────────────────────────────
  const suelo = await comprobarSueloFiscal(tx, tenantId);
  const cajasRaw = await tx.register.findMany({
    where: { store: { tenantId } },
    select: {
      id: true,
      name: true,
      store: { select: { name: true } },
      fiscalSeries: true,
      fiscalInstallationId: true,
      _count: { select: { fiscalRecords: true } },
    },
  });
  const cajas = cajasRaw.map((r) => ({
    id: r.id,
    nombre: r.name,
    tienda: r.store.name,
    serie: r.fiscalSeries ?? null,
    numeroInstalacion: r.fiscalInstallationId ?? null,
    registrosFiscales: r._count.fiscalRecords,
  }));
  const terminalesRaw = await tx.device.findMany({
    where: { tenantId, revokedAt: null, kind: "TERMINAL" },
    select: {
      id: true,
      name: true,
      lastSeenAt: true,
      register: { select: { name: true } },
      heartbeat: { select: { appVersionName: true, appVersionCode: true, reportedAt: true } },
    },
  });
  const terminales = terminalesRaw.map((d) => ({
    id: d.id,
    nombre: d.name,
    caja: d.register.name,
    apkVersion: d.heartbeat?.appVersionName ?? null,
    apkCodigo: d.heartbeat?.appVersionCode ?? null,
    ultimoLatido: (d.heartbeat?.reportedAt ?? d.lastSeenAt)?.toISOString() ?? null,
  }));

  // ── Los bloqueos ───────────────────────────────────────────────────
  const bloqueos: Bloqueo[] = [];
  if (tenant.holdedDisconnectedAt != null) {
    bloqueos.push({
      codigo: "YA_DESCONECTADO",
      mensaje: `Este comercio ya dejó Holded el ${tenant.holdedDisconnectedAt.toISOString().slice(0, 10)}.`,
    });
  } else if (tenant.holdedEnabled === false) {
    bloqueos.push({
      codigo: "NO_USA_HOLDED",
      mensaje:
        "Este comercio ya tiene Holded apagado. No hay nada que desconectar: " +
        "esta acción es para el que lo tiene conectado y vendiendo.",
    });
  } else if (tenant.holdedApiKeyCiphertext == null) {
    bloqueos.push({
      codigo: "SIN_CLAVE",
      mensaje:
        "Este comercio no tiene clave de Holded conectada. Apágalo con el interruptor de siempre: " +
        "esta acción es para el que ya está subiendo tickets.",
    });
  }
  if (!suelo.ok) {
    bloqueos.push({
      codigo: "SUELO_FISCAL_INCOMPLETO",
      mensaje:
        "Desde el corte este comercio emite sus propias facturas simplificadas y le faltan datos fiscales: " +
        suelo.problemas.join(" "),
    });
  }
  const ventasCuantas = ticketsPendingSync.length + ticketsSyncFailed.length;
  if (ventasCuantas > 0) {
    bloqueos.push({
      codigo: "VENTAS_EN_VUELO",
      cuantos: ventasCuantas,
      mensaje:
        `Hay ${ventasCuantas} venta(s) sin cerrar con Holded (PENDING_SYNC o SYNC_FAILED). ` +
        "Súbelas con la clave todavía puesta, o resuélvelas en la bandeja de errores del panel. " +
        "Borrar la clave ahora las dejaría mudas para siempre.",
    });
  }
  const abonosCuantos = abonosPendingSync.length + abonosSyncFailed.length;
  if (abonosCuantos > 0) {
    bloqueos.push({
      codigo: "ABONOS_EN_VUELO",
      cuantos: abonosCuantos,
      mensaje:
        `Hay ${abonosCuantos} devolución(es) sin cerrar con Holded. El dinero ya salió del cajón, ` +
        "así que el abono TIENE que existir en su contabilidad: créalo en Holded y ciérralo desde la " +
        'bandeja de errores con "Marcar resuelto" pegando el id del documento.',
    });
  }
  if (subidasVivas.length > 0) {
    bloqueos.push({
      codigo: "SUBIDAS_EN_VUELO",
      cuantos: subidasVivas.length,
      mensaje:
        `Hay ${subidasVivas.length} subida(s) a Holded pendientes con su documento detrás. ` +
        "Espera a que la cola las termine y vuelve a previsualizar.",
    });
  }
  if (fiadosVivos.length > 0) {
    bloqueos.push({
      codigo: "FIADO_VIVO",
      cuantos: fiadosVivos.length,
      mensaje:
        `Hay ${fiadosVivos.length} fiado(s) con deuda viva. Un fiado NO sube a Holded hasta que se ` +
        "salda (variante B), así que si se salda después del corte su factura no llegaría nunca a su " +
        "contabilidad. Cóbralos antes, o anúlalos.",
    });
  }
  if (plan.choques.length > 0) {
    const fichas = plan.choques.reduce((n, c) => n + c.productos.length, 0);
    bloqueos.push({
      codigo: "SKU_SIN_RESOLVER",
      cuantos: fichas,
      mensaje:
        `Hay ${fichas} ficha(s) con un SKU que la acción no puede arreglar sola. Tras el corte todo el ` +
        "catálogo es local y el SKU tiene que ser único por comercio. Están listadas abajo, una a una.",
    });
  }

  return {
    tenant: {
      id: tenant.id,
      nombre: tenant.name,
      holdedEnabled: tenant.holdedEnabled,
      holdedConectado: tenant.holdedApiKeyCiphertext != null,
      holdedDisconnectedAt: tenant.holdedDisconnectedAt?.toISOString() ?? null,
      initialSyncStatus: tenant.initialSyncStatus,
    },
    catalogo: {
      seConvierten: deHolded.length,
      productos: deHolded.filter((p) => p.kind === "PRODUCT").length,
      servicios: deHolded.filter((p) => p.kind === "SERVICE").length,
      yaLocales: productos.length - deHolded.length,
      conservanEnlace: deHolded.filter((p) => p.holdedProductId != null).length,
      archivados: deHolded.filter((p) => p.archivedFromHoldedAt != null).length,
      ivaSinResolver: deHolded.filter(
        (p) => Number(p.taxRate) === 0 && p.sellableViaTpv === false,
      ).length,
      pasanAVendibles,
      cuelgan: {
        lineasDeTicket,
        conAgenda,
        conRecursos,
        enCitas,
        conModificadores,
        conHabilidades,
      },
    },
    sku: plan,
    ventasEnVuelo: {
      ticketsPendingSync: ticketsPendingSync.map(filaTicket),
      ticketsSyncFailed: ticketsSyncFailed.map(filaTicket),
      abonosPendingSync: abonosPendingSync.map(filaTicket),
      abonosSyncFailed: abonosSyncFailed.map(filaTicket),
      subidasVivas,
      subidasHuerfanas,
      subidasFallidas,
      fiadosVivos: fiadosVivos.map(filaTicket),
      borradores,
      turnosAbiertos,
    },
    contactosYCrm: {
      contactos,
      contactosActivos,
      ticketsConContacto,
      clientesCrm,
      clientesConEnlaceHolded,
      fiadosVivosConDeudor,
      deudaVivaTotal: Number(deudaViva._sum.creditPending ?? 0).toFixed(2),
      emailsAutomaticosHistoricos,
      emailsManualesHistoricos: emailsHistoricos.length - emailsAutomaticosHistoricos,
    },
    devoluciones: {
      ticketsFacturadosPorHolded,
      facturadosPorHoldedUltimos90d,
      abonosPorMes,
    },
    fiscal: { suelo, cajas, terminales, avisoApk: AVISO_APK },
    puedeArrancar: bloqueos.length === 0,
    bloqueos,
  };
}

export class TenantNoExisteError extends Error {
  constructor(public readonly tenantId: string) {
    super(`tenant ${tenantId} no existe`);
    this.name = "TenantNoExisteError";
  }
}

/** La acción no puede arrancar. Lleva los bloqueos para que la ruta los
 *  devuelva tal cual: el que pulsó el botón tiene que leer lo MISMO que
 *  le enseñó la previsualización, no un 409 genérico. */
export class DejarHoldedBloqueadoError extends Error {
  constructor(public readonly bloqueos: Bloqueo[]) {
    super(`dejar Holded bloqueado: ${bloqueos.map((b) => b.codigo).join(", ")}`);
    this.name = "DejarHoldedBloqueadoError";
  }
}

// ══════════════════════════════════════════════════════════════════════
// LA EJECUCIÓN
// ══════════════════════════════════════════════════════════════════════

export interface ResultadoDejarHolded {
  /** `true` si esta llamada hizo el corte; `false` si ya estaba hecho y
   *  esta llamada sólo terminó lo que faltaba (reanudación). */
  cortado: boolean;
  holdedDisconnectedAt: string;
  productosConvertidos: number;
  skuAcunados: CambioSku[];
  subidasHuerfanasCerradas: number;
  /** El plan tal cual, para el audit y para que la ruta lo devuelva. */
  previa: PrevisualizacionDejarHolded;
}

/**
 * El corte. Atómico en Postgres, reanudable en lo que no puede serlo.
 *
 * ── Qué es atómico y qué no ──────────────────────────────────────────
 *
 * TODO lo de la base va en UNA transacción: los SKU acuñados, el
 * `source = LOCAL`, el borrado de la clave y del OAuth, el interruptor, la
 * fecha del corte y las subidas huérfanas. O está todo o no está nada. No
 * existe el estado "catálogo convertido y clave todavía puesta", que es el
 * que dejaría al sync incremental pisando fichas locales durante quince
 * minutos.
 *
 * Lo que NO puede entrar en esa transacción son las COLAS: Redis no hace
 * rollback con Postgres. Así que el vaciado va DESPUÉS
 * (`dejar-holded-colas.ts`) y es re-ejecutable: relanzar la acción sobre un
 * comercio ya cortado no repite nada de la base —lo ve por
 * `holded_disconnected_at`— y vuelve a barrer las colas. Eso es el
 * criterio 9 del bloque.
 *
 * ── Por qué re-previsualiza dentro de la transacción ─────────────────
 *
 * Porque entre que la pantalla previsualizó y el super-admin pulsó
 * "Confirmar" pueden haber pasado cosas: un cobro, una devolución, un
 * fiado. Fiarse de lo que vio la pantalla sería el criterio 7 al revés.
 * El `SELECT ... FOR UPDATE` del tenant serializa dos ejecuciones
 * simultáneas.
 */
export async function ejecutarDejarHolded(options: {
  prisma: PrismaClient;
  tenantId: string;
  /** Instante del corte. Inyectable para el test; en producción, ahora. */
  now?: Date;
}): Promise<ResultadoDejarHolded> {
  const { prisma, tenantId } = options;
  const now = options.now ?? new Date();

  return await prisma.$transaction(async (tx) => {
    // Cerrojo de fila. Dos super-admins dándole al botón a la vez es
    // improbable y un doble corte sería difícil de entender después.
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;

    const previa = await previsualizarDejarHolded(tx, tenantId);

    // ── Reanudación ──────────────────────────────────────────────────
    //
    // Ya cortado: la parte de base está hecha y es idempotente por
    // construcción. Se devuelve el resultado sin tocar nada para que la
    // ruta siga con el vaciado de colas, que es lo que puede haber
    // quedado a medias.
    if (previa.tenant.holdedDisconnectedAt != null) {
      return {
        cortado: false,
        holdedDisconnectedAt: previa.tenant.holdedDisconnectedAt,
        productosConvertidos: 0,
        skuAcunados: [],
        subidasHuerfanasCerradas: 0,
        previa,
      };
    }

    // Cualquier otro bloqueo sí es un no. Se devuelven TAL CUAL los que
    // calculó la previsualización.
    if (!previa.puedeArrancar) {
      throw new DejarHoldedBloqueadoError(previa.bloqueos);
    }

    // ── 1 · los SKU acuñados ─────────────────────────────────────────
    //
    // ANTES de convertir a LOCAL, y ése es el orden y no otro: el índice
    // parcial sólo mira las filas `source = 'LOCAL'`, así que mientras el
    // catálogo siga siendo de Holded los SKU repetidos conviven y se
    // pueden arreglar de uno en uno sin pelearse con el índice. Al
    // revés —convertir primero— la primera fila duplicada tumbaría la
    // transacción con un P2002.
    for (const cambio of previa.sku.cambios) {
      await tx.product.update({
        where: { id: cambio.productoId },
        data: {
          sku: cambio.skuDespues,
          // Deja de ser un `AUTO-` canónico en Holded: este valor NO está
          // allí. Es el mismo criterio con el que la bandeja de revisión
          // lo pone a NULL cuando un humano escribe el SKU a mano.
          skuAutoAssignedAt: null,
        },
      });
    }

    // ── 2 · el catálogo cambia de dueño ──────────────────────────────
    //
    // `UPDATE`, nunca `DELETE` + `INSERT`. El `id` de cada ficha es la
    // identidad de la que cuelgan líneas de ticket, la extensión de
    // agenda, las necesidades de recurso, las citas, los modificadores y
    // la matriz de habilidades. Recrearlas rompería las seis cosas a la
    // vez, y `ticket_lines.product_id` es `ON DELETE SET NULL`: el
    // histórico se quedaría sin poder decir qué se vendió. Criterio 6.
    //
    // `holded_product_id` NO se borra. Es el hilo de la vuelta a Holded
    // en 2027, y es lo que hace que reencender sin el bloque de la vuelta
    // sea peligroso (ver `holded_disconnected_at` en el schema).
    //
    // `name`, `basePrice`, `taxRate`, `tags`, `imageUrl`, `imageMime`,
    // `imageCachedAt`, `barcode` y `raw` tampoco se tocan: la ficha es la
    // misma, sólo cambia quién manda sobre ella. El `taxRate` ya es un
    // decimal concreto desde el sync (ADR-017 §3.2), así que no hay
    // ningún IVA que resolver contra `TenantTax` en este momento.
    const deHolded = await tx.product.findMany({
      where: { tenantId, source: "HOLDED" },
      select: {
        id: true,
        sku: true,
        taxRate: true,
        sellableViaTpv: true,
        archivedFromHoldedAt: true,
      },
    });
    // Las que GANAN visibilidad: venían no vendibles por no tener SKU y
    // el paso 1 se lo ha dado. Se calculan antes del `updateMany` para no
    // tener que recorrer el catálogo fila a fila: en Thalía son 974
    // fichas y un `update` por cada una son 974 idas y venidas dentro de
    // una transacción con la tienda esperando.
    //
    // Sólo hay transiciones de `false` a `true`: `sellableTrasElCorte`
    // devuelve `false` únicamente con el SKU vacío (imposible después del
    // paso 1, y si no lo fuera el plan habría bloqueado) o con el IVA sin
    // resolver (que ya venía en `false`). Los archivados conservan el
    // suyo tal cual.
    const gananVisibilidad = deHolded
      .filter((p) => !p.sellableViaTpv && sellableTrasElCorte(p, p.sku))
      .map((p) => p.id);

    await tx.product.updateMany({
      where: { tenantId, source: "HOLDED" },
      data: { source: "LOCAL" },
    });
    if (gananVisibilidad.length > 0) {
      await tx.product.updateMany({
        where: { tenantId, id: { in: gananVisibilidad } },
        data: { sellableViaTpv: true },
      });
    }
    // La bandeja "Revisión de SKU" existe porque el auto-SKU subió un SKU
    // a Holded y Holded lo descartó en silencio (ADR-010). Sin Holded esa
    // bandeja no tiene sentido y su texto entero habla de Holded: dejar la
    // marca puesta condenaría la ficha a una pantalla que ya no le
    // corresponde. `sellableViaTpv` NO se toca por esto: si la ficha sigue
    // sin poder venderse será por su IVA, y eso se arregla editándola.
    await tx.product.updateMany({
      where: { tenantId, needsSkuReview: true },
      data: { needsSkuReview: false },
    });

    // ── 3 · las subidas que ya no pueden subir ───────────────────────
    //
    // Filas `HoldedUpload` PENDING cuyo ticket o abono ya no existe. En la
    // copia de prod del 24-09 Sole arrastra dos del 26-05: el ticket lo
    // purgó la activación del comercio y la fila se quedó atrás. El
    // sweeper las re-encola cada cinco minutos contra un documento que no
    // está. `SKIPPED` es el estado que v1.5-consistencia-B §3.a inventó
    // para exactamente esto.
    let subidasHuerfanasCerradas = 0;
    for (const h of previa.ventasEnVuelo.subidasHuerfanas) {
      const r = await tx.holdedUpload.updateMany({
        where: { externalId: h.externalId, tenantId, status: "PENDING" },
        data: {
          status: "SKIPPED",
          lastError: { skipped: "sin_documento_al_dejar_holded" },
        },
      });
      subidasHuerfanasCerradas += r.count;
    }

    // ── 4 · Holded se calla ──────────────────────────────────────────
    //
    // La clave y el OAuth se BORRAN, no se marcan. Un secreto que no hace
    // falta no se guarda, y mientras el ciphertext esté ahí cualquier
    // camino que se olvide de mirar el interruptor puede llamar a Holded.
    // El CHECK de la base (`tenants_holded_desconectado_ck`) convierte eso
    // en una invariante: con la fecha puesta, no puede haber clave.
    //
    // `initialSyncStatus → NOT_APPLICABLE` es el estado que ADR-016 §4
    // inventó para "esto no aplica a este comercio", y es además el que
    // `registerAllExistingRepeatables` y los checks `requires: "holded"` de
    // la salud del onboarding ya saben leer. Lo que el comercio sí
    // sincronizó en su día sigue escrito en `lastIncrementalSyncAt`.
    await tx.tenant.update({
      where: { id: tenantId },
      data: {
        holdedEnabled: false,
        holdedApiKeyCiphertext: null,
        holdedOauthAccess: null,
        holdedOauthRefresh: null,
        holdedOauthExpiresAt: null,
        initialSyncStatus: "NOT_APPLICABLE",
        holdedDisconnectedAt: now,
      },
    });

    return {
      cortado: true,
      holdedDisconnectedAt: now.toISOString(),
      productosConvertidos: deHolded.length,
      skuAcunados: previa.sku.cambios,
      subidasHuerfanasCerradas,
      previa,
    };
  });
}
