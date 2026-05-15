// Validación de identificadores fiscales españoles: NIF (persona física),
// NIE (extranjeros con residencia) y CIF (entidades). Implementa el
// dígito de control real, no sólo el regex. Spec oficial AEAT.

export type SpanishTaxIdType = "NIF" | "NIE" | "CIF";

export type SpanishTaxIdResult =
  | { valid: true; type: SpanishTaxIdType }
  | { valid: false; type: null };

const NIF_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
const CIF_CONTROL_LETTERS = "JABCDEFGHI";
const CIF_LETTER_TO_DIGIT_REQUIRED = "PQRSNW"; // control debe ser letra
const CIF_DIGIT_TO_DIGIT_REQUIRED = "ABEH"; // control debe ser dígito
// El resto (C, D, F, G, J, U, V) admite ambos formatos.

export function validateSpanishTaxId(raw: string): SpanishTaxIdResult {
  if (typeof raw !== "string") return { valid: false, type: null };
  const taxId = raw.trim().toUpperCase().replace(/[-\s]/g, "");
  if (taxId.length !== 9) return { valid: false, type: null };

  if (/^[0-9]{8}[A-Z]$/.test(taxId)) {
    return validateNif(taxId);
  }
  if (/^[XYZ][0-9]{7}[A-Z]$/.test(taxId)) {
    return validateNie(taxId);
  }
  if (/^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$/.test(taxId)) {
    return validateCif(taxId);
  }
  return { valid: false, type: null };
}

function validateNif(taxId: string): SpanishTaxIdResult {
  const digits = parseInt(taxId.slice(0, 8), 10);
  const expected = NIF_LETTERS[digits % 23];
  return taxId[8] === expected
    ? { valid: true, type: "NIF" }
    : { valid: false, type: null };
}

function validateNie(taxId: string): SpanishTaxIdResult {
  // El primer carácter (X/Y/Z) se sustituye por 0/1/2 y luego se valida
  // con la misma tabla del NIF.
  const prefixMap: Record<string, string> = { X: "0", Y: "1", Z: "2" };
  const prefix = prefixMap[taxId[0]!];
  if (prefix === undefined) return { valid: false, type: null };
  const digits = parseInt(prefix + taxId.slice(1, 8), 10);
  const expected = NIF_LETTERS[digits % 23];
  return taxId[8] === expected
    ? { valid: true, type: "NIE" }
    : { valid: false, type: null };
}

function validateCif(taxId: string): SpanishTaxIdResult {
  const initial = taxId[0]!;
  const digits = taxId.slice(1, 8);
  const control = taxId[8]!;

  let sumEven = 0;
  let sumOdd = 0;
  for (let i = 0; i < digits.length; i++) {
    const n = parseInt(digits[i]!, 10);
    // Posiciones 1,3,5,7 (índices 0,2,4,6) → impares → doblar y sumar dígitos.
    // Posiciones 2,4,6 (índices 1,3,5) → pares → sumar directo.
    if (i % 2 === 0) {
      const doubled = n * 2;
      sumOdd += Math.floor(doubled / 10) + (doubled % 10);
    } else {
      sumEven += n;
    }
  }
  const total = sumEven + sumOdd;
  const lastDigit = total % 10;
  const controlDigit = lastDigit === 0 ? 0 : 10 - lastDigit;
  const controlLetter = CIF_CONTROL_LETTERS[controlDigit]!;
  const controlDigitStr = String(controlDigit);

  // Algunas letras iniciales fuerzan el formato del control:
  if (CIF_DIGIT_TO_DIGIT_REQUIRED.includes(initial)) {
    return control === controlDigitStr
      ? { valid: true, type: "CIF" }
      : { valid: false, type: null };
  }
  if (CIF_LETTER_TO_DIGIT_REQUIRED.includes(initial)) {
    return control === controlLetter
      ? { valid: true, type: "CIF" }
      : { valid: false, type: null };
  }
  // El resto admite ambos.
  if (control === controlDigitStr || control === controlLetter) {
    return { valid: true, type: "CIF" };
  }
  return { valid: false, type: null };
}
