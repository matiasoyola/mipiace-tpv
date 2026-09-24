// ¿A qué entorno de la AEAT apunta el QR de cotejo?
//
// Mientras V2 no remita los registros, el comercio está en PRUEBAS: un QR
// que apuntase a producción prometería al cliente un cotejo que no puede
// salir bien, porque la factura no está allí. Y una factura que promete
// algo que no cumple es peor que una sin QR.
//
// Vive aparte de `env.ts` a propósito. `env.ts` valida con zod y REVIENTA el
// arranque si algo no cuadra, que es lo correcto para una clave de cifrado;
// aquí lo correcto es lo contrario: un valor raro cae a PRUEBAS —el entorno
// que no afirma nada— y deja una línea, en vez de tumbar la API.

import { type EntornoAeat } from "@mipiacetpv/verifactu";

export const VERIFACTU_ENTORNO_ENV = "VERIFACTU_ENTORNO";

/** El entorno configurado, o PRUEBAS.
 *
 *  Pasar a PRODUCCION es una decisión de V2, cuando los registros se
 *  remitan de verdad. Va anotado en el «Al desplegar» del -done. */
export function entornoAeat(): EntornoAeat {
  const raw = process.env[VERIFACTU_ENTORNO_ENV]?.trim().toUpperCase();
  return raw === "PRODUCCION" ? "PRODUCCION" : "PRUEBAS";
}

/** ¿El valor configurado es uno de los dos que existen? Para el `/health`:
 *  un `VERIFACTU_ENTORNO=produccion` mal escrito se comporta como PRUEBAS y
 *  lo razonable es que alguien se entere. */
export function entornoAeatConfigurado(): {
  valor: EntornoAeat;
  reconocido: boolean;
} {
  const raw = process.env[VERIFACTU_ENTORNO_ENV]?.trim().toUpperCase();
  if (raw === undefined || raw === "") {
    return { valor: "PRUEBAS", reconocido: true };
  }
  return {
    valor: raw === "PRODUCCION" ? "PRODUCCION" : "PRUEBAS",
    reconocido: raw === "PRODUCCION" || raw === "PRUEBAS",
  };
}
