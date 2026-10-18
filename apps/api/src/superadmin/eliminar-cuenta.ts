// puesta-en-marcha (parte C) · la baja de un cliente. ADR-021 §5.
//
// Dos cosas, en este orden y sin saltarse ninguna:
//
//   1. **EL EXPORT.** Un ZIP con los registros de facturación (con su huella
//      y su encadenamiento), los tickets, las devoluciones y los fichajes. Es
//      lo que el titular tiene que conservar cuatro años, y se le entrega a
//      él. Lo saca `exportarLaCuenta`.
//   2. **LA ELIMINACIÓN.** Borra el tenant y todo lo que cuelga. Sólo se
//      habilita tras descargar el export, y se confirma tecleando el nombre
//      del comercio.
//
// ── Por qué el export es una precondición y no un consejo ──────────────
//
// Porque esto no se puede deshacer y porque las facturas de un comercio son
// suyas, no nuestras. Un cliente que se va y descubre tres meses después que
// Hacienda le pide el detalle de sus facturas simplificadas de 2026 no tiene
// a quién pedírselas: nosotros ya no las tenemos. La comprobación no es un
// aviso en la pantalla —se lee y se pulsa igual— sino un 409 del servidor que
// mira el registro de auditoría.
//
// ── Lo que NO se elimina desde aquí ───────────────────────────────────
//
// Una cuenta con HISTORIA CLÍNICA o con RESIDENTES. Sus tablas no tienen
// ninguna escapatoria en sus triggers (clinica-1 §1), y no se les añade: una
// historia clínica se conserva por la Ley 41/2002 y su destrucción es una
// decisión con su propio marco legal. La eliminación se bloquea y lo dice; el
// export, en cambio, funciona —y para la historia clínica ya existe su propia
// devolución de datos, la del art. 28.3.g (`clinica/exportacion.ts`).

import { Prisma, type PrismaClient } from "@mipiacetpv/db";

import { Zip } from "../lib/zip.js";

type Tx = Prisma.TransactionClient | PrismaClient;

/** El nombre de la marca de transacción que abre los guardias. Vive aquí y
 *  en la migración `20261017010000_eliminar_cuenta`, y en ningún otro sitio
 *  del código. */
export const MARCA_ELIMINAR_TENANT = "mipiacetpv.eliminar_tenant";

export interface Bloqueo {
  codigo: string;
  mensaje: string;
}

export class TenantNoExisteError extends Error {
  constructor(public readonly tenantId: string) {
    super(`tenant ${tenantId} no existe`);
    this.name = "TenantNoExisteError";
  }
}

export class EliminacionBloqueadaError extends Error {
  constructor(public readonly bloqueos: Bloqueo[]) {
    super(`eliminación bloqueada: ${bloqueos.map((b) => b.codigo).join(", ")}`);
    this.name = "EliminacionBloqueadaError";
  }
}

export interface PrevisualizacionEliminacion {
  tenant: {
    id: string;
    name: string;
    esDePruebas: boolean;
    facturaDesde: string | null;
    onboardingState: string;
  };
  /** Qué hay en la cuenta. Es lo que se va a borrar. */
  contenido: {
    registrosFiscales: number;
    tickets: number;
    devoluciones: number;
    turnos: number;
    productos: number;
    contactos: number;
    clientes: number;
    citas: number;
    empleados: number;
    fichajes: number;
    enlacesPublicos: number;
    usuarios: number;
    terminales: number;
    tiendas: number;
    cajas: number;
  };
  /** Lo que impide eliminar. Vacío = se puede. */
  bloqueos: Bloqueo[];
  /** ¿Se ha descargado ya el export de esta cuenta? Y cuándo. */
  exportDescargadoAt: string | null;
  /** `true` si esta cuenta puede eliminarse sin export (las nuestras). */
  exportNoHaceFalta: boolean;
  puedeEliminar: boolean;
}

/** La acción del audit que PRUEBA que el export se descargó. La eliminación
 *  la busca; si no está, no hay camino. */
export const ACCION_EXPORT = "export_cuenta" as const;

export async function previsualizarEliminacion(
  tx: Tx,
  tenantId: string,
): Promise<PrevisualizacionEliminacion> {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      esDePruebas: true,
      facturaDesde: true,
      onboardingState: true,
    },
  });
  if (!tenant) throw new TenantNoExisteError(tenantId);

  const [
    registrosFiscales,
    tickets,
    devoluciones,
    turnos,
    productos,
    contactos,
    clientes,
    citas,
    empleados,
    fichajes,
    enlacesPublicos,
    usuarios,
    terminales,
    tiendas,
    cajas,
    // Lo que BLOQUEA: historia clínica y residencia. Se cuentan las FILAS y
    // no la capability, porque lo que impide borrar son los datos, no el
    // interruptor — una cuenta con la clínica apagada hoy puede tener
    // historias de cuando la tuvo encendida.
    historias,
    anotaciones,
    valoraciones,
    consentimientos,
    fotosClinicas,
    accesosClinicos,
    residentes,
    incidencias,
  ] = await Promise.all([
    tx.fiscalRecord.count({ where: { tenantId } }),
    tx.ticket.count({ where: { tenantId } }),
    tx.refund.count({ where: { tenantId } }),
    tx.shift.count({ where: { register: { store: { tenantId } } } }),
    tx.product.count({ where: { tenantId } }),
    tx.contact.count({ where: { tenantId } }),
    tx.client.count({ where: { tenantId } }),
    tx.appointment.count({ where: { tenantId } }),
    tx.employee.count({ where: { tenantId } }),
    tx.timeEntry.count({ where: { tenantId } }),
    tx.publicLink.count({ where: { tenantId } }),
    tx.user.count({ where: { tenantId } }),
    tx.device.count({ where: { tenantId } }),
    tx.store.count({ where: { tenantId } }),
    tx.register.count({ where: { store: { tenantId } } }),
    tx.clinicalEntry.count({ where: { tenantId } }),
    tx.clinicalAddendum.count({ where: { tenantId } }),
    tx.clinicalAssessment.count({ where: { tenantId } }),
    tx.clientConsent.count({ where: { tenantId } }),
    tx.clinicalPhoto.count({ where: { tenantId } }),
    tx.clinicalAccessLog.count({ where: { tenantId } }),
    tx.residentProfile.count({ where: { tenantId } }),
    tx.incident.count({ where: { tenantId } }),
  ]);

  const bloqueos: Bloqueo[] = [];
  const clinico =
    historias + anotaciones + valoraciones + consentimientos + fotosClinicas +
    accesosClinicos;
  if (clinico > 0) {
    bloqueos.push({
      codigo: "TIENE_HISTORIA_CLINICA",
      mensaje:
        `Esta cuenta tiene historia clínica (${historias} entrada(s), ${anotaciones} anotación(es), ` +
        `${valoraciones} valoración(es), ${consentimientos} consentimiento(s), ${fotosClinicas} foto(s), ` +
        `${accesosClinicos} línea(s) de registro de accesos). No se elimina desde aquí: una historia ` +
        "clínica se conserva por la Ley 41/2002 y su destrucción tiene su propio marco legal. " +
        "La devolución de datos del centro (art. 28.3.g) sí se le puede entregar.",
    });
  }
  if (residentes > 0) {
    bloqueos.push({
      codigo: "TIENE_RESIDENTES",
      mensaje: `Esta cuenta tiene ${residentes} ficha(s) de residente. No se elimina desde aquí, por lo mismo que la historia clínica.`,
    });
  }
  // residencia-4 · EL LIBRO DE INCIDENCIAS, aparte de los residentes.
  //
  // Y no es redundante con el bloqueo de arriba, que es justo por lo que
  // existe: un centro puede tener el módulo encendido, **cero fichas de
  // residente** y una avería declarada en el libro. Ese caso parece
  // inalcanzable y no lo es —encender la residencia no exige dar de alta
  // a nadie, y lo primero que hace un centro al probarlo es declarar algo
  // del edificio— y sin este bloqueo el `DELETE FROM tenants` rebotaría
  // contra `incidents_tenant_id_fkey` con un error de Postgres en crudo
  // en vez de con una frase.
  //
  // Se bloquea en vez de borrarse por lo mismo que la historia: el libro
  // es la evidencia de las acciones correctoras que AENOR audita, y los
  // triggers `incidents_inmutable` e `incident_actions_append_only` **no
  // llevan la escapatoria del «padre borrado»** que sí llevan los de S1 y
  // F1. Darles una para esto sería abrir el libro a borrados por el único
  // camino que hoy no existe.
  if (incidencias > 0) {
    bloqueos.push({
      codigo: "TIENE_LIBRO_DE_INCIDENCIAS",
      mensaje:
        `Esta cuenta tiene ${incidencias} incidencia(s) en el libro. No se elimina desde aquí: el libro es la ` +
        "evidencia de las acciones correctoras del centro y se conserva. La devolución de datos (art. 28.3.g) sí se le puede entregar.",
    });
  }

  // ¿Se descargó el export? Lo contesta el registro de auditoría, que es la
  // única prueba que no depende de que la pantalla se porte bien.
  const export_ = await tx.superAdminAudit.findFirst({
    where: { tenantId, action: ACCION_EXPORT },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const exportNoHaceFalta = tenant.esDePruebas;
  if (export_ == null && !exportNoHaceFalta) {
    bloqueos.push({
      codigo: "SIN_EXPORT",
      mensaje:
        "Descarga primero el export de la cuenta y entrégaselo al titular: son sus facturas, sus ventas y sus fichajes, y tiene que conservarlos cuatro años. Después de descargarlo, el botón de eliminar se habilita.",
    });
  }

  return {
    tenant: {
      id: tenant.id,
      name: tenant.name,
      esDePruebas: tenant.esDePruebas,
      facturaDesde: tenant.facturaDesde?.toISOString() ?? null,
      onboardingState: tenant.onboardingState,
    },
    contenido: {
      registrosFiscales,
      tickets,
      devoluciones,
      turnos,
      productos,
      contactos,
      clientes,
      citas,
      empleados,
      fichajes,
      enlacesPublicos,
      usuarios,
      terminales,
      tiendas,
      cajas,
    },
    bloqueos,
    exportDescargadoAt: export_?.createdAt.toISOString() ?? null,
    exportNoHaceFalta,
    puedeEliminar: bloqueos.length === 0,
  };
}

// ══════════════════════════════════════════════════════════════════════
// EL EXPORT
// ══════════════════════════════════════════════════════════════════════

function csv(filas: (string | number | null)[][]): string {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // `;` como el resto de la casa (`fichaje/export.ts`): es lo que abre un
  // Excel español sin preguntar nada.
  return filas.map((f) => f.map(esc).join(";")).join("\r\n") + "\r\n";
}

export interface ResumenDelExport {
  registrosFiscales: number;
  tickets: number;
  devoluciones: number;
  fichajes: number;
  ficheros: number;
  bytes: number;
}

/**
 * El ZIP de la cuenta, para entregárselo al titular.
 *
 * Qué lleva y por qué cada cosa:
 *
 *   · `facturas/registros.json` — los registros de facturación ENTEROS, con
 *     su huella, la huella anterior, la cadena exacta sobre la que se calculó
 *     (`huellaInput`) y el payload tal y como lo generó el terminal. Con esto
 *     un tercero puede RECALCULAR las huellas y comprobar que la cadena era
 *     íntegra. Un CSV no puede llevar esto: el payload es un objeto.
 *   · `facturas/registros.csv` — lo mismo en una tabla que abre en Excel,
 *     para el asesor.
 *   · `facturas/cadena.txt` — el veredicto del propio motor
 *     (`mipiacetpv_fiscal_chain_summary`) caja por caja, en el momento de
 *     exportar. Es la prueba de que la cadena estaba íntegra cuando se
 *     entregó.
 *   · `ventas/tickets.json` y `.csv` — las ventas con sus líneas y sus pagos.
 *   · `ventas/devoluciones.csv` — los abonos.
 *   · `fichajes/fichajes.csv` — el registro de jornada (art. 34.9 ET), si la
 *     cuenta llevaba control horario.
 *   · `LEEME.txt` — qué es esto, qué hay que conservar y cuánto tiempo.
 *
 * No lleva: el catálogo ni los contactos. No son documentos que haya que
 * conservar por ley y el cliente los tiene en su ERP o en su cabeza; meterlos
 * convertiría el paquete en un volcado y haría más difícil encontrar lo que
 * de verdad importa. Si algún día hace falta, se añade.
 *
 * `ahora` entra por parámetro y no se lee del reloj: el mismo paquete con la
 * misma fecha tiene que dar los mismos bytes para que un test pueda
 * comprobarlo (mismo criterio que `lib/zip.ts`).
 */
export async function exportarLaCuenta(
  prisma: PrismaClient,
  input: { tenantId: string; ahora: Date },
  onTrozo: (trozo: Buffer) => void | Promise<void>,
): Promise<ResumenDelExport> {
  const { tenantId, ahora } = input;
  const zip = new Zip();
  let ficheros = 0;
  let bytes = 0;
  const soltar = async (nombre: string, contenido: string | Buffer) => {
    const buf = Buffer.isBuffer(contenido) ? contenido : Buffer.from(contenido, "utf8");
    const trozo = zip.anadir(nombre, buf, ahora);
    ficheros += 1;
    bytes += trozo.length;
    await onTrozo(trozo);
  };

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, fiscalProfile: true, facturaDesde: true },
  });
  if (!tenant) throw new TenantNoExisteError(tenantId);

  // ── Las facturas ────────────────────────────────────────────────────
  const registros = await prisma.fiscalRecord.findMany({
    where: { tenantId },
    orderBy: [{ registerId: "asc" }, { chainIndex: "asc" }],
    select: {
      id: true,
      registerId: true,
      kind: true,
      chainIndex: true,
      serie: true,
      numero: true,
      numSerieFactura: true,
      fechaExpedicion: true,
      tipoFactura: true,
      cuotaTotal: true,
      importeTotal: true,
      huella: true,
      huellaAnterior: true,
      primerRegistro: true,
      fechaHoraHusoGen: true,
      huellaInput: true,
      payload: true,
      ticketId: true,
      anulaRecordId: true,
      generatedAt: true,
      receivedAt: true,
      chainStatus: true,
      chainError: true,
      register: { select: { name: true, fiscalSeries: true, fiscalInstallationId: true } },
    },
  });
  await soltar(
    "facturas/registros.json",
    JSON.stringify(
      {
        comercio: tenant.name,
        datosFiscales: tenant.fiscalProfile,
        facturaDesde: tenant.facturaDesde?.toISOString() ?? null,
        exportadoEl: ahora.toISOString(),
        registros,
      },
      null,
      2,
    ),
  );
  await soltar(
    "facturas/registros.csv",
    csv([
      [
        "Caja",
        "Serie",
        "Número",
        "Factura",
        "Tipo",
        "Fecha expedición",
        "Base+cuota (total)",
        "Cuota IVA",
        "Posición en la cadena",
        "Huella",
        "Huella anterior",
        "Primer registro",
        "Generado (reloj del terminal)",
        "Recibido (reloj del servidor)",
        "Estado de la cadena",
      ],
      ...registros.map((r) => [
        r.register.name,
        r.serie,
        r.numero,
        r.numSerieFactura,
        r.kind,
        r.fechaExpedicion.toISOString().slice(0, 10),
        r.importeTotal.toString(),
        r.cuotaTotal.toString(),
        r.chainIndex,
        r.huella,
        r.huellaAnterior ?? "",
        r.primerRegistro ? "sí" : "no",
        r.fechaHoraHusoGen,
        r.receivedAt.toISOString(),
        r.chainStatus,
      ]),
    ]),
  );

  // El veredicto del motor, caja por caja. Se pide a la función de la base y
  // no se recalcula aquí: es la misma que usa el panel de cadenas, y que la
  // huella la recalcule Postgres es justo lo que hace que esto sea una
  // comprobación y no una copia.
  const cajas = await prisma.register.findMany({
    where: { store: { tenantId } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, fiscalSeries: true, fiscalInstallationId: true },
  });
  const lineas: string[] = [
    `Verificación de las cadenas de facturación de ${tenant.name}`,
    `Exportado el ${ahora.toISOString()}`,
    "",
    "La integridad la ha comprobado el propio motor de base de datos,",
    "recalculando la huella SHA-256 de cada registro desde su cadena de",
    "entrada. No es una copia de lo que decíamos nosotros: es el veredicto.",
    "",
  ];
  for (const c of cajas) {
    const filas = await prisma.$queryRaw<
      { total: bigint; integra: boolean; primer_fallo_index: number | null }[]
    >(Prisma.sql`SELECT * FROM mipiacetpv_fiscal_chain_summary(${c.id}::uuid)`);
    const f = filas[0];
    lineas.push(
      `Caja «${c.name}» · serie ${c.fiscalSeries ?? "—"} · instalación ${c.fiscalInstallationId ?? "—"}`,
      `  registros: ${f ? Number(f.total) : 0}`,
      `  cadena íntegra: ${f?.integra ? "SÍ" : "NO"}`,
      ...(f?.primer_fallo_index != null
        ? [`  primer fallo en la posición: ${f.primer_fallo_index}`]
        : []),
      "",
    );
  }
  await soltar("facturas/cadena.txt", lineas.join("\n"));

  // ── Las ventas ──────────────────────────────────────────────────────
  const tickets = await prisma.ticket.findMany({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      internalNumber: true,
      status: true,
      createdAt: true,
      paidAt: true,
      total: true,
      totalTax: true,
      totalDiscount: true,
      notes: true,
      contactHoldedId: true,
      register: { select: { name: true } },
      user: { select: { email: true, alias: true } },
      lines: {
        orderBy: { id: "asc" },
        select: {
          nameSnapshot: true,
          sku: true,
          units: true,
          unitPrice: true,
          unitPriceOverride: true,
          discountPct: true,
          taxRate: true,
          subtotal: true,
          total: true,
        },
      },
      payments: { select: { method: true, amount: true } },
    },
  });
  await soltar(
    "ventas/tickets.json",
    JSON.stringify({ comercio: tenant.name, tickets }, null, 2),
  );
  await soltar(
    "ventas/tickets.csv",
    csv([
      [
        "Referencia",
        "Estado",
        "Caja",
        "Cajero",
        "Fecha",
        "Cobrado",
        "Total",
        "IVA",
        "Descuento",
        "Métodos de pago",
      ],
      ...tickets.map((t) => [
        t.internalNumber,
        t.status,
        t.register.name,
        t.user.alias ?? t.user.email,
        t.createdAt.toISOString(),
        t.paidAt?.toISOString() ?? "",
        t.total.toString(),
        t.totalTax.toString(),
        t.totalDiscount.toString(),
        t.payments.map((p) => `${p.method} ${p.amount.toString()}`).join(" + "),
      ]),
    ]),
  );

  const devoluciones = await prisma.refund.findMany({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      status: true,
      createdAt: true,
      total: true,
      originalTicket: { select: { internalNumber: true } },
      user: { select: { email: true, alias: true } },
    },
  });
  await soltar(
    "ventas/devoluciones.csv",
    csv([
      ["Fecha", "Ticket original", "Estado", "Importe", "Quien la hizo"],
      ...devoluciones.map((r) => [
        r.createdAt.toISOString(),
        r.originalTicket.internalNumber,
        r.status,
        r.total.toString(),
        r.user?.alias ?? r.user?.email ?? "",
      ]),
    ]),
  );

  // ── Los fichajes ────────────────────────────────────────────────────
  const fichajes = await prisma.timeEntry.findMany({
    where: { tenantId },
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      employee: { select: { name: true, email: true } },
    },
  });
  if (fichajes.length > 0) {
    await soltar(
      "fichajes/fichajes.csv",
      csv([
        ["Empleado", "Email", "Entrada", "Salida"],
        ...fichajes.map((f) => [
          f.employee.name,
          f.employee.email ?? "",
          f.startedAt.toISOString(),
          f.endedAt?.toISOString() ?? "",
        ]),
      ]),
    );
  }

  // ── El LEEME ────────────────────────────────────────────────────────
  await soltar(
    "LEEME.txt",
    [
      `COPIA DE LOS DATOS DE ${tenant.name}`,
      `Generada el ${ahora.toISOString()} por mipiacetpv.`,
      "",
      "QUÉ HAY AQUÍ",
      "",
      `  facturas/registros.json   ${registros.length} registro(s) de facturación completos,`,
      "                            con su huella, su encadenamiento y el dato exacto",
      "                            sobre el que se calculó la huella.",
      "  facturas/registros.csv    los mismos, en una tabla para el asesor.",
      "  facturas/cadena.txt       la comprobación de integridad, caja por caja.",
      `  ventas/tickets.json       ${tickets.length} venta(s) con sus líneas y sus pagos.`,
      "  ventas/tickets.csv        las mismas, en tabla.",
      `  ventas/devoluciones.csv   ${devoluciones.length} devolución(es).`,
      ...(fichajes.length > 0
        ? [`  fichajes/fichajes.csv     ${fichajes.length} fichaje(s) del registro de jornada.`]
        : []),
      "",
      "QUÉ HAY QUE CONSERVAR, Y CUÁNTO",
      "",
      "  · Las facturas y sus registros: CUATRO AÑOS desde el fin del plazo de",
      "    presentación del impuesto al que correspondan (art. 66 y 70 de la Ley",
      "    General Tributaria). Si en ese plazo Hacienda pide el detalle de las",
      "    facturas simplificadas, esto es lo que hay que poder entregar.",
      "  · El registro de jornada: CUATRO AÑOS (art. 34.9 del Estatuto de los",
      "    Trabajadores).",
      "",
      "A PARTIR DE AHORA",
      "",
      "  Esta copia es la ÚNICA que queda: al eliminar la cuenta, mipiacetpv no",
      "  conserva ninguno de estos datos. Guárdala donde guardas la",
      "  contabilidad, no sólo en el ordenador del mostrador.",
      "",
    ].join("\n"),
  );

  const cierre = zip.cerrar();
  bytes += cierre.length;
  await onTrozo(cierre);

  return {
    registrosFiscales: registros.length,
    tickets: tickets.length,
    devoluciones: devoluciones.length,
    fichajes: fichajes.length,
    ficheros,
    bytes,
  };
}

// ══════════════════════════════════════════════════════════════════════
// LA ELIMINACIÓN
// ══════════════════════════════════════════════════════════════════════

export interface ResultadoEliminacion {
  /** La foto de lo que había, para el audit. Después de esto no se puede
   *  volver a contar. */
  contenido: PrevisualizacionEliminacion["contenido"];
  borrado: {
    registrosFiscales: number;
    devoluciones: number;
    tickets: number;
    turnos: number;
    fichajes: number;
    empleados: number;
    enlacesPublicos: number;
  };
}

/**
 * Borra la cuenta entera.
 *
 * El ORDEN no es cosmético: lo imponen las claves ajenas `RESTRICT` y los
 * triggers. De abajo arriba:
 *
 *   1. `fiscal_records` — su FK a `tickets` es RESTRICT, así que tienen que
 *      irse antes que las ventas. Es la única operación de la casa que los
 *      borra, y pasa por el append-only con la marca de transacción.
 *   2. `refunds` — su FK a `tickets` también es RESTRICT.
 *   3. `tickets` — arrastran por cascada líneas, pagos, correcciones,
 *      comandas de cocina, pases y trabajos de email.
 *   4. `shifts` — `Ticket.shift` es RESTRICT, así que después de las ventas.
 *      Arrastran arqueos e informes Z.
 *   5. `time_entries` y `employees` — el registro de jornada.
 *   6. `public_links` — FK RESTRICT al tenant.
 *   7. `DELETE FROM tenants` — y la cascada se lleva el resto: catálogo,
 *      tiendas, cajas, terminales, cajeros, contactos, clientes, agenda,
 *      cocina, sala.
 *
 * Todo en UNA transacción con la marca puesta. Si algo falla por el camino no
 * queda media cuenta: queda la cuenta.
 */
export async function eliminarLaCuenta(params: {
  prisma: PrismaClient;
  tenantId: string;
}): Promise<ResultadoEliminacion> {
  const { prisma, tenantId } = params;
  // El tope de una transacción interactiva de Prisma son 5 s por defecto, y
  // esto borra la cuenta ENTERA de un comercio: dos años de ventas son
  // decenas de miles de filas en cascada. Con el default, un cliente grande
  // se iría en P2028 y no se borraría nada —seguro, pero inútil—. Cinco
  // minutos, y si no cabe ahí es que pasa algo que hay que mirar.
  return prisma.$transaction(
    async (tx) => {
    const previa = await previsualizarEliminacion(tx, tenantId);
    // Se vuelve a comprobar DENTRO de la transacción: entre la pantalla y el
    // botón puede haber entrado una historia clínica, o puede no estar el
    // export que la pantalla vio.
    if (!previa.puedeEliminar) {
      throw new EliminacionBloqueadaError(previa.bloqueos);
    }

    // LA MARCA. `SET LOCAL`, así que muere con esta transacción, y nombra a
    // este tenant: las filas de cualquier otro siguen protegidas igual.
    //
    // Va con `$executeRawUnsafe` y el uuid interpolado porque `SET LOCAL` no
    // acepta parámetros ($1) en Postgres. El valor NO viene del exterior: es
    // el `id` de una fila que acabamos de leer de `tenants`, así que es un
    // UUID por construcción. Se vuelve a validar aquí de todas formas —una
    // interpolación en SQL se mira dos veces, siempre.
    if (!/^[0-9a-fA-F-]{36}$/.test(previa.tenant.id)) {
      throw new Error(`id de tenant inesperado: ${previa.tenant.id}`);
    }
    await tx.$executeRawUnsafe(
      `SET LOCAL "${MARCA_ELIMINAR_TENANT}" = '${previa.tenant.id}'`,
    );

    const registrosFiscales = await tx.fiscalRecord.deleteMany({
      where: { tenantId },
    });
    const devoluciones = await tx.refund.deleteMany({ where: { tenantId } });
    const tickets = await tx.ticket.deleteMany({ where: { tenantId } });
    const turnos = await tx.shift.deleteMany({
      where: { register: { store: { tenantId } } },
    });
    const fichajes = await tx.timeEntry.deleteMany({ where: { tenantId } });
    const empleados = await tx.employee.deleteMany({ where: { tenantId } });
    const enlacesPublicos = await tx.publicLink.deleteMany({ where: { tenantId } });

    await tx.tenant.delete({ where: { id: tenantId } });

    return {
      contenido: previa.contenido,
      borrado: {
        registrosFiscales: registrosFiscales.count,
        devoluciones: devoluciones.count,
        tickets: tickets.count,
        turnos: turnos.count,
        fichajes: fichajes.count,
        empleados: empleados.count,
        enlacesPublicos: enlacesPublicos.count,
      },
    };
    },
    { timeout: 5 * 60_000, maxWait: 30_000 },
  );
}
