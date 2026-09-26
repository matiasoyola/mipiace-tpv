// ¿Quién emite la factura de esta venta? (V1-verifactu, ADR-019 §3.1)
//
// Nunca pueden emitir los dos. Si el comercio usa Holded, Holded es el
// emisor y este bloque no cambia absolutamente nada para él. Si no lo usa,
// emite mipiacetpv y cada venta lleva su registro de facturación.
//
// No se crea ninguna capability nueva: el interruptor ya existe desde
// `catalogo-local` y responde exactamente a la pregunta que hace falta.

/** Lo mínimo del tenant para decidir quién emite. Estructural y no el tipo
 *  de Prisma, para que valga desde una tx, desde un test y desde un select
 *  parcial. */
export interface TenantFiscalMode {
  holdedEnabled: boolean;
}

/**
 * ¿Emite mipiacetpv la factura de este comercio?
 *
 * Se lee `=== false`, NUNCA `!holdedEnabled`. Es el criterio que el propio
 * `schema.prisma` documenta para esta columna y el mismo que usa
 * `fichajeEnabled`: sólo el valor explícito CONTRARIO al default cambia el
 * comportamiento de nadie. Un tenant de hoy tiene `true` y no ve ni una
 * diferencia.
 */
export function emiteMipiacetpv(tenant: TenantFiscalMode): boolean {
  return tenant.holdedEnabled === false;
}

/** Los datos fiscales del comercio que van en el registro.
 *
 *  `fiscalProfile` es un jsonb libre con varios alias históricos
 *  (`legalName`/`businessName`, `taxId`/`nif`/`fiscalNif`), los mismos que
 *  leen `superadmin/tenants.ts` y `onboarding-health.ts`. */
export interface IdentidadFiscalComercio {
  nif: string;
  razonSocial: string;
}

export function leerIdentidadFiscal(
  tenant: { name: string; fiscalProfile: unknown },
): IdentidadFiscalComercio | null {
  const nif = fiscalString(tenant.fiscalProfile, ["taxId", "nif", "fiscalNif"]);
  if (!nif) return null;
  const razonSocial =
    fiscalString(tenant.fiscalProfile, ["legalName", "businessName"]) ??
    tenant.name.trim();
  if (!razonSocial) return null;
  return { nif: nif.toUpperCase(), razonSocial };
}

function fiscalString(profile: unknown, keys: string[]): string | null {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return null;
  }
  const obj = profile as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

/** El gate de una venta: ¿cuadra lo que manda el terminal con quién emite?
 *
 *  Asimétrico a propósito, y la asimetría es la decisión:
 *
 *   · Comercio con Holded que manda registro → RECHAZO. No es un dato a
 *     medias, es un cliente equivocado emitiendo por dos vías a la vez, y
 *     guardar ese registro dejaría una factura que nadie ha emitido.
 *   · Comercio que emite y venta sin registro → la venta SIGUE. Es una APK
 *     vieja, y una APK vieja no puede dejar a un comercio sin cobrar. Se
 *     anota, se ve en el log y se ve en el panel de cadenas.
 *   · (addendum 1b) Venta del MODO PRUEBA que trae registro → el registro
 *     se DESCARTA y la venta sigue. Ni rechazo ni ingesta: ver abajo.
 */
export interface GateFiscal {
  rechazo: { error: string; message: string } | null;
  faltaRegistro: boolean;
  /** V1-verifactu addendum 1b · llegó un registro de una venta de prueba.
   *  No se ingesta y se deja en el log. */
  descartarRegistro: boolean;
}

/** ¿Quién cobra? Lo mínimo de la sesión de cajero para decidirlo.
 *  `isTest` lo pone `requireCashierSession` cuando el JWT lleva
 *  `purpose: "test-cashier"`. */
export interface SesionFiscal {
  isTest: boolean;
}

/**
 * V1-verifactu addendum 1b · una venta del modo prueba NO genera registro
 * de facturación y NO gasta número de serie.
 *
 * `fiscal_records` es append-only y el modo prueba PURGA sus tickets al
 * activar el comercio. Las dos cosas juntas no tienen arreglo posible: o
 * queda un número gastado que apunta a un ticket que ya no existe, o queda
 * una factura de prueba en la cadena real del cliente. Ninguna de las dos
 * se puede deshacer después, porque un registro de facturación no se borra.
 *
 * El camino de verdad es el de arriba: `GET /tpv/fiscal/head` le contesta
 * `emite: false` a una sesión de prueba, así que el terminal ni siquiera
 * genera nada. Esto de aquí es el ESPEJO DEL SERVIDOR — la APK vieja, el
 * outbox que arrastra un registro de antes, el cliente que se salta el
 * head. Se descarta y se anota.
 *
 * Y se descarta en vez de rechazar la petición a propósito: el modo prueba
 * existe para validar el flujo de cobro del TPV, y un 409 lo dejaría sin
 * poder cobrar por un dato que sobra. Cobrar siempre se puede.
 */
export function comprobarGateFiscal(
  tenant: TenantFiscalMode,
  fiscalRecord: unknown,
  sesion?: SesionFiscal,
): GateFiscal {
  const emite = emiteMipiacetpv(tenant);
  if (sesion?.isTest) {
    return {
      rechazo: null,
      // No es «falta»: es que no tiene que haberlo. Avisarlo llenaría el
      // log de una alarma que no lo es.
      faltaRegistro: false,
      descartarRegistro: fiscalRecord != null,
    };
  }
  if (!emite && fiscalRecord != null) {
    return {
      rechazo: {
        error: "FISCAL_MODE_OFF",
        message:
          "Este comercio factura con Holded: su TPV no emite registros de facturación. Actualiza la aplicación.",
      },
      faltaRegistro: false,
      descartarRegistro: false,
    };
  }
  return {
    rechazo: null,
    faltaRegistro: emite && fiscalRecord == null,
    descartarRegistro: false,
  };
}

/** El rechazo de las rutas de ANULACIÓN cuando quien llama es el modo
 *  prueba.
 *
 *  Aquí sí se rechaza con un 409 y no se descarta en silencio, y la
 *  diferencia con la venta es que no hay nada que proteger: una anulación
 *  no cobra a nadie. Lo que sí haría un ingest silencioso es meter un
 *  registro de prueba en la cadena REAL de la caja, que es exactamente lo
 *  que este addendum existe para impedir. */
export const RECHAZO_ANULACION_DE_PRUEBA = {
  error: "FISCAL_TEST_MODE",
  message:
    "El modo prueba no emite ni anula facturas: sus ventas no entran en la cadena de la caja.",
} as const;
