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
 */
export interface GateFiscal {
  rechazo: { error: string; message: string } | null;
  faltaRegistro: boolean;
}

export function comprobarGateFiscal(
  tenant: TenantFiscalMode,
  fiscalRecord: unknown,
): GateFiscal {
  const emite = emiteMipiacetpv(tenant);
  if (!emite && fiscalRecord != null) {
    return {
      rechazo: {
        error: "FISCAL_MODE_OFF",
        message:
          "Este comercio factura con Holded: su TPV no emite registros de facturación. Actualiza la aplicación.",
      },
      faltaRegistro: false,
    };
  }
  return { rechazo: null, faltaRegistro: emite && fiscalRecord == null };
}
