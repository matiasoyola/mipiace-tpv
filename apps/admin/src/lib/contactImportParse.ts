// v1.0-pilotos · Lote 6 (#22): parseo de archivos de clientes en el
// navegador. El admin sube .xlsx o .csv; aquí lo convertimos a filas
// normalizadas { name, nif, email, phone } que el backend valida y el
// worker procesa. Parsear en cliente evita el plugin multipart en la
// API y da feedback inmediato (recuento, columnas mal nombradas).
//
// xlsx → exceljs (elegido sobre SheetJS: el paquete `xlsx` de npm está
// congelado en 0.18.5 con CVE de ReDoS sin parchear en npm; exceljs se
// mantiene y lee en navegador). Se importa dinámico para que el chunk
// sólo cargue al entrar en la página del importador.
// csv → parser propio RFC-4180-ish (comillas, separador , o ;).

export interface ParsedContactRow {
  name: string;
  nif: string | null;
  email: string | null;
  phone: string | null;
}

export interface ParseOutcome {
  rows: ParsedContactRow[];
  // Filas saltadas por no tener nombre (vacías o residuales del Excel).
  skippedEmpty: number;
}

export const MAX_IMPORT_ROWS = 2_000;

// Cabeceras aceptadas (case/acento-insensitive) → campo canónico.
const HEADER_MAP: Record<string, keyof ParsedContactRow> = {
  nombre: "name",
  name: "name",
  "razon social": "name",
  nif: "nif",
  cif: "nif",
  dni: "nif",
  email: "email",
  "e-mail": "email",
  correo: "email",
  telefono: "phone",
  tel: "phone",
  movil: "phone",
  phone: "phone",
};

function normalizeHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export class ContactImportParseError extends Error {}

function mapHeaders(headers: string[]): Map<number, keyof ParsedContactRow> {
  const map = new Map<number, keyof ParsedContactRow>();
  headers.forEach((h, idx) => {
    const field = HEADER_MAP[normalizeHeader(h)];
    if (field && ![...map.values()].includes(field)) map.set(idx, field);
  });
  if (![...map.values()].includes("name")) {
    throw new ContactImportParseError(
      'El archivo necesita una columna "nombre" (descarga la plantilla para ver el formato).',
    );
  }
  return map;
}

function rowsFromMatrix(matrix: string[][]): ParseOutcome {
  if (matrix.length === 0) {
    throw new ContactImportParseError("El archivo está vacío.");
  }
  const headerMap = mapHeaders(matrix[0]!);
  const rows: ParsedContactRow[] = [];
  let skippedEmpty = 0;
  for (const cells of matrix.slice(1)) {
    const row: ParsedContactRow = { name: "", nif: null, email: null, phone: null };
    for (const [idx, field] of headerMap) {
      const value = (cells[idx] ?? "").trim();
      if (!value) continue;
      if (field === "name") row.name = value;
      else row[field] = value;
    }
    if (row.name.length === 0) {
      // Línea vacía o sin nombre — el Excel suele arrastrar filas
      // residuales al final. Las contamos para informar, no abortamos.
      if (row.nif || row.email || row.phone) skippedEmpty += 1;
      continue;
    }
    rows.push(row);
  }
  if (rows.length === 0) {
    throw new ContactImportParseError("El archivo no contiene ninguna fila con nombre.");
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new ContactImportParseError(
      `Máximo ${MAX_IMPORT_ROWS} filas por archivo (el tuyo tiene ${rows.length}). Divide el archivo y vuelve a intentarlo.`,
    );
  }
  return { rows, skippedEmpty };
}

// ── CSV ──────────────────────────────────────────────────────────────

// Detecta el separador: si la primera línea tiene más ';' que ',' (el
// Excel español exporta con ';'), usamos ';'.
function detectDelimiter(firstLine: string): string {
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semis = (firstLine.match(/;/g) ?? []).length;
  return semis > commas ? ";" : ",";
}

export function parseCsv(text: string): ParseOutcome {
  const clean = text.replace(/^\uFEFF/, ""); // BOM de Excel
  const firstLineEnd = clean.indexOf("\n");
  const delimiter = detectDelimiter(
    firstLineEnd === -1 ? clean : clean.slice(0, firstLineEnd),
  );
  const matrix: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim().length > 0)) matrix.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c.trim().length > 0)) matrix.push(row);
  return rowsFromMatrix(matrix);
}

// ── XLSX ─────────────────────────────────────────────────────────────

export async function parseXlsx(buffer: ArrayBuffer): Promise<ParseOutcome> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new ContactImportParseError("El Excel no tiene ninguna hoja.");
  }
  const matrix: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    // row.values es 1-based; normalizamos a 0-based y a string plano
    // (exceljs devuelve richText/objetos para celdas con formato).
    const values = row.values as unknown[];
    for (let c = 1; c < values.length; c += 1) {
      cells.push(cellToString(values[c]));
    }
    matrix.push(cells);
  });
  return rowsFromMatrix(matrix);
}

function cellToString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const obj = v as { text?: unknown; richText?: Array<{ text: string }>; result?: unknown; hyperlink?: unknown };
    if (Array.isArray(obj.richText)) {
      return obj.richText.map((r) => r.text).join("");
    }
    // Las celdas email suelen venir como hyperlink {text, hyperlink}.
    if (typeof obj.text === "string") return obj.text;
    if (obj.result != null) return cellToString(obj.result);
  }
  return String(v);
}

export async function parseContactFile(file: File): Promise<ParseOutcome> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) {
    return parseCsv(await file.text());
  }
  if (name.endsWith(".xlsx")) {
    return parseXlsx(await file.arrayBuffer());
  }
  throw new ContactImportParseError(
    "Formato no soportado. Sube un .xlsx o un .csv (plantilla descargable arriba).",
  );
}

// Plantilla CSV descargable — el separador ';' abre directo en el
// Excel español.
export function buildTemplateCsv(): string {
  return [
    "nombre;NIF;email;telefono",
    "María García López;12345678Z;maria@ejemplo.com;600123456",
    "Construcciones Pérez SL;B12345674;info@construccionesperez.es;912345678",
  ].join("\r\n");
}

// CSV de errores descargable con el motivo por fila.
export function buildErrorsCsv(
  errors: Array<{ row: number; name: string; nif: string | null; reason: string }>,
): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = ["fila;nombre;NIF;motivo"];
  for (const e of errors) {
    lines.push(
      [e.row, esc(e.name), esc(e.nif ?? ""), esc(e.reason)].join(";"),
    );
  }
  return lines.join("\r\n");
}
