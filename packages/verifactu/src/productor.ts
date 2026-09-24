// Quién fabrica este sistema informático de facturación.
//
// El bloque `SistemaInformatico` del diseño de registro identifica al
// PRODUCTOR del SIF (nosotros), no al comercio que lo usa. Va dentro de
// cada registro de facturación, de alta y de anulación.
//
// ⚠ Estos valores tienen que coincidir LITERALMENTE con los de la
// declaración responsable del SIF. No son una etiqueta interna: son la
// forma en que la AEAT identifica al fabricante responsable de que este
// programa cumpla el RD 1007/2023. Cambiarlos aquí sin cambiarlos allí
// convierte cada registro emitido en una declaración falsa.
//
// Constantes y no variables de entorno (decisión de Matías, 24-09-2026):
// una variable que alguien puede dejar vacía al desplegar es un registro
// de facturación inválido esperando a pasar. `test/productor.test.ts` las
// valida —el NIF con su dígito de control incluido— y se pone rojo si
// alguna se vacía o se escribe mal.

// Por el SUBPATH y no por el barrel: `@mipiacetpv/util-validation` exporta
// también `temporary-password`, que importa `node:crypto` — y este paquete
// entra en el bundle del navegador. El barrel arrastraría Node entero al
// TPV y la build de Vite se cae. Mismo motivo por el que `tpv-web` importa
// `@mipiacetpv/util-validation/email` y no el índice.
import { validateSpanishTaxId } from "@mipiacetpv/util-validation/spanish-tax-id";

/** Nombre-razón social de la persona o entidad productora. Alfanumérico (120). */
export const PRODUCTOR_NOMBRE_RAZON = "MI PIACE INTERNET SOLUTIONS SL";

/** NIF de la entidad productora. FormatoNIF (9).
 *
 *  Sin el prefijo `ES`: ese es el del NIF-IVA intracomunitario y aquí el
 *  campo es `FormatoNIF (9)`, nueve posiciones. */
export const PRODUCTOR_NIF = "B45902186";

/** Código identificativo que el productor da a su producto SIF.
 *  Alfanumérico (2).
 *
 *  La unicidad global se consigue considerándolo junto al NIF del
 *  fabricante (FAQ AEAT §2): `(B45902186; MP)` es este producto y ningún
 *  otro. */
export const ID_SISTEMA_INFORMATICO = "MP";

/** Nombre del SIF dado por su productor. Alfanumérico (30). */
export const NOMBRE_SISTEMA_INFORMATICO = "mipiacetpv";

/** ¿Este SIF sólo puede funcionar en modo VERI*FACTU? Lista L4.
 *
 *  `S`, y eso tiene una consecuencia que ahorra un módulo entero: la FAQ
 *  de desarrolladores (§15, NOTA 1) exime del registro de eventos al
 *  productor «de un SIF que solo puede actuar exclusivamente en modo
 *  VERI*FACTU». El día que exista un modo NO VERI*FACTU, esta constante
 *  pasa a `N` y el registro de eventos pasa a ser obligatorio. */
export const TIPO_USO_POSIBLE_SOLO_VERIFACTU = "S";

/** ¿Permite llevar la facturación de varios obligados tributarios? L4.
 *
 *  `S`: mipiacetpv es multi-tenant. */
export const TIPO_USO_POSIBLE_MULTI_OT = "S";

/** ¿En el momento de generar ESTE registro el sistema está llevando la
 *  facturación de más de un obligado? L4.
 *
 *  `N`: cada caja es una instalación con un único obligado — su comercio.
 *  Es el criterio que la FAQ pide aplicar a los SIF en la nube: el
 *  indicador va por registro y mira la facturación que gestiona esa
 *  instalación, no el producto entero. */
export const INDICADOR_MULTIPLES_OT = "N";

export interface SistemaInformatico {
  NombreRazon: string;
  NIF: string;
  NombreSistemaInformatico: string;
  IdSistemaInformatico: string;
  Version: string;
  NumeroInstalacion: string;
  TipoUsoPosibleSoloVerifactu: string;
  TipoUsoPosibleMultiOT: string;
  IndicadorMultiplesOT: string;
}

/** Longitudes del diseño de registro. Se comprueban, no se confían. */
export const LIMITES_SISTEMA_INFORMATICO = {
  NombreRazon: 120,
  NombreSistemaInformatico: 30,
  IdSistemaInformatico: 2,
  Version: 50,
  NumeroInstalacion: 100,
} as const;

/**
 * El bloque `SistemaInformatico` de un registro.
 *
 * Los dos datos que varían: la `Version` (la del despliegue que está
 * corriendo) y el `NumeroInstalacion` (el de la CAJA, no el del
 * dispositivo — ADR-019: cambiar de tablet continúa la cadena de la caja,
 * así que la instalación no puede colgar del aparato).
 */
export function buildSistemaInformatico(params: {
  version: string;
  numeroInstalacion: string;
}): SistemaInformatico {
  const version = params.version.trim();
  const numeroInstalacion = params.numeroInstalacion.trim();
  if (!version) {
    throw new RangeError("SistemaInformatico: Version vacía");
  }
  if (!numeroInstalacion) {
    throw new RangeError("SistemaInformatico: NumeroInstalacion vacío");
  }
  if (version.length > LIMITES_SISTEMA_INFORMATICO.Version) {
    throw new RangeError(
      `SistemaInformatico: Version de ${version.length} caracteres, el máximo es ${LIMITES_SISTEMA_INFORMATICO.Version}`,
    );
  }
  if (
    numeroInstalacion.length > LIMITES_SISTEMA_INFORMATICO.NumeroInstalacion
  ) {
    throw new RangeError(
      `SistemaInformatico: NumeroInstalacion de ${numeroInstalacion.length} caracteres, el máximo es ${LIMITES_SISTEMA_INFORMATICO.NumeroInstalacion}`,
    );
  }
  return {
    NombreRazon: PRODUCTOR_NOMBRE_RAZON,
    NIF: PRODUCTOR_NIF,
    NombreSistemaInformatico: NOMBRE_SISTEMA_INFORMATICO,
    IdSistemaInformatico: ID_SISTEMA_INFORMATICO,
    Version: version,
    NumeroInstalacion: numeroInstalacion,
    TipoUsoPosibleSoloVerifactu: TIPO_USO_POSIBLE_SOLO_VERIFACTU,
    TipoUsoPosibleMultiOT: TIPO_USO_POSIBLE_MULTI_OT,
    IndicadorMultiplesOT: INDICADOR_MULTIPLES_OT,
  };
}

/** ¿Las constantes del productor son coherentes?
 *
 *  Existe como función y no sólo como test para que el arranque de la API
 *  pueda llamarla: un despliegue con el NIF mal escrito no debería
 *  levantar, y desde luego no debería descubrirse cobrando. */
export function validarConstantesDelProductor(): string[] {
  const errores: string[] = [];
  if (!PRODUCTOR_NOMBRE_RAZON.trim()) {
    errores.push("PRODUCTOR_NOMBRE_RAZON está vacío");
  }
  if (
    PRODUCTOR_NOMBRE_RAZON.length > LIMITES_SISTEMA_INFORMATICO.NombreRazon
  ) {
    errores.push("PRODUCTOR_NOMBRE_RAZON pasa de 120 caracteres");
  }
  if (!validateSpanishTaxId(PRODUCTOR_NIF).valid) {
    errores.push(`PRODUCTOR_NIF no es un identificador fiscal español válido (${PRODUCTOR_NIF})`);
  }
  if (PRODUCTOR_NIF !== PRODUCTOR_NIF.trim().toUpperCase()) {
    errores.push("PRODUCTOR_NIF tiene espacios o minúsculas");
  }
  if (/^ES/i.test(PRODUCTOR_NIF)) {
    errores.push("PRODUCTOR_NIF lleva el prefijo ES del NIF-IVA");
  }
  if (
    ID_SISTEMA_INFORMATICO.length !==
    LIMITES_SISTEMA_INFORMATICO.IdSistemaInformatico
  ) {
    errores.push("ID_SISTEMA_INFORMATICO no tiene exactamente 2 caracteres");
  }
  if (!NOMBRE_SISTEMA_INFORMATICO.trim()) {
    errores.push("NOMBRE_SISTEMA_INFORMATICO está vacío");
  }
  if (
    NOMBRE_SISTEMA_INFORMATICO.length >
    LIMITES_SISTEMA_INFORMATICO.NombreSistemaInformatico
  ) {
    errores.push("NOMBRE_SISTEMA_INFORMATICO pasa de 30 caracteres");
  }
  return errores;
}
