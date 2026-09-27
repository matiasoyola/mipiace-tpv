#!/usr/bin/env tsx
//
// Busca en el Holded de UN comercio los documentos que dejó el TPV, para
// encontrar los huérfanos: el documento existe allí (aprobado y numerado)
// y en nuestra base no hay ni id ni número, porque el `silent_reject` lo
// perdía. Es el inventario del bloque abonos-holded, punto 5.
//
// SOLO LECTURA. La única petición que hace es `GET`; `httpGet` rechaza
// cualquier otro método y el script no tiene ninguna función que escriba.
// Aun así: ejecútalo contra la cuenta que quieras MIRAR, nada más.
//
// Cómo se usa:
//
//   pnpm --filter @mipiacetpv/api exec tsx ../../scripts/holded-orphan-docs.ts \
//     --key <API_KEY_DEL_COMERCIO> --from 2026-09-01 --to 2026-09-30
//
//   Opciones:
//     --key <k>       API key de Holded (o la variable HOLDED_API_KEY).
//     --from / --to   ventana de fechas (YYYY-MM-DD). Sin ellas, todo.
//     --uuid <uuid>   sólo estos uuid (repetible). Sin ellos, todos los
//                     documentos con etiqueta del TPV en las notas.
//     --json          salida JSON en vez de tabla.
//     --base <url>    base de la API (por defecto la de Holded).
//
// Las dos etiquetas que el TPV escribe en `notes` y que este script busca:
//
//   · `TPV-uuid: <uuid>`         → una VENTA (upload-ticket)
//   · `TPV-refund-uuid: <uuid>`  → un ABONO  (upload-refund)
//
// Qué marca cada fila:
//
//   · CERO           el documento está a 0 € → es de los que hay que
//                    anular en Holded (el fallo de Peluquería Sole).
//   · DUPLICADO      hay más de un documento con el mismo uuid: el
//                    primero se quedó huérfano y un reintento creó otro.
//   · SIGNO          un abono con total positivo, o una venta con total
//                    negativo.

const SALESRECEIPT = "/invoicing/v1/documents/salesreceipt";
const DEFAULT_BASE = "https://api.holded.com/api";

interface HoldedDocSummary {
  id: string;
  docNumber?: string | null;
  date?: number;
  total?: number;
  paymentsPending?: number;
  paymentsTotal?: number;
  notes?: string | null;
}

interface Found {
  uuid: string;
  kind: "venta" | "abono";
  id: string;
  docNumber: string;
  date: string;
  total: number;
  paymentsPending: number;
  flags: string[];
}

function parseArgs(argv: string[]) {
  const out: {
    key?: string;
    from?: string;
    to?: string;
    uuids: string[];
    json: boolean;
    base: string;
  } = { uuids: [], json: false, base: process.env.HOLDED_BASE_URL ?? DEFAULT_BASE };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === "--key") out.key = argv[++i];
    else if (a === "--from") out.from = argv[++i];
    else if (a === "--to") out.to = argv[++i];
    else if (a === "--uuid") out.uuids.push(String(argv[++i]).toLowerCase());
    else if (a === "--base") out.base = String(argv[++i]);
    else if (a === "--json") out.json = true;
    else if (a === "-h" || a === "--help") {
      console.log(helpText());
      process.exit(0);
    } else {
      console.error(`opción desconocida: ${a}`);
      process.exit(2);
    }
  }
  out.key = out.key ?? process.env.HOLDED_API_KEY;
  return out;
}

function helpText(): string {
  return [
    "holded-orphan-docs · SOLO LECTURA",
    "",
    "  --key <k>      API key de Holded (o HOLDED_API_KEY)",
    "  --from <fecha> YYYY-MM-DD (opcional)",
    "  --to <fecha>   YYYY-MM-DD (opcional)",
    "  --uuid <uuid>  buscar sólo estos uuid (repetible)",
    "  --json         salida JSON",
    "  --base <url>   base de la API de Holded",
  ].join("\n");
}

async function httpGet<T>(base: string, key: string, path: string): Promise<T> {
  const url = `${base}${path}`;
  const res = await fetch(url, {
    method: "GET", // este script NO escribe nunca.
    headers: { key, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET ${path} → HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as T;
}

// Las fechas se interpretan en la hora de Madrid, que es la que usa
// Holded: un documento de hoy queda guardado con el epoch de las 00:00 de
// Madrid, o sea las 22:00 UTC de AYER. Con una ventana calculada en UTC,
// los documentos del propio día se quedaban fuera.
function madridOffsetMinutes(atMs: number): number {
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Madrid",
    timeZoneName: "longOffset",
  }).format(new Date(atMs));
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(s);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

function epochOf(date: string | undefined, endOfDay: boolean): number | undefined {
  if (!date) return undefined;
  const asUtc = Date.parse(`${date}T${endOfDay ? "23:59:59" : "00:00:00"}Z`);
  if (Number.isNaN(asUtc)) throw new Error(`fecha inválida: ${date}`);
  return Math.floor((asUtc - madridOffsetMinutes(asUtc) * 60_000) / 1000);
}

// Etiquetas del TPV en las notas del documento.
const TAG_REFUND = /TPV-refund-uuid:\s*([0-9a-f-]{36})/i;
const TAG_TICKET = /TPV-uuid:\s*([0-9a-f-]{36})/i;

function readTag(notes: string | null | undefined): { uuid: string; kind: "venta" | "abono" } | null {
  if (!notes) return null;
  const refund = TAG_REFUND.exec(notes);
  if (refund) return { uuid: refund[1]!.toLowerCase(), kind: "abono" };
  const ticket = TAG_TICKET.exec(notes);
  if (ticket) return { uuid: ticket[1]!.toLowerCase(), kind: "venta" };
  return null;
}

async function listDocuments(
  base: string,
  key: string,
  from?: string,
  to?: string,
): Promise<HoldedDocSummary[]> {
  const params: string[] = [];
  const start = epochOf(from, false);
  const end = epochOf(to, true);
  if (start != null) params.push(`starttmp=${start}`);
  if (end != null) params.push(`endtmp=${end}`);
  const all: HoldedDocSummary[] = [];
  const seen = new Set<string>();
  // Holded devuelve la lista completa en la primera página en cuentas
  // pequeñas, pero paginamos por si acaso y paramos en cuanto una página
  // no aporta nada nuevo.
  for (let page = 1; page <= 100; page += 1) {
    const qs = [...params, `page=${page}`].join("&");
    const batch = await httpGet<HoldedDocSummary[]>(base, key, `${SALESRECEIPT}?${qs}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    let nuevos = 0;
    for (const d of batch) {
      if (!d?.id || seen.has(d.id)) continue;
      seen.add(d.id);
      all.push(d);
      nuevos += 1;
    }
    if (nuevos === 0) break;
  }
  return all;
}

function formatDate(epoch: number | undefined): string {
  if (!epoch) return "—";
  // Holded guarda la fecha del documento a las 00:00 de Madrid, que en UTC
  // es el día anterior a las 22:00/23:00. Formatear en UTC restaba un día.
  const f = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return f.format(new Date(epoch * 1000));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.key) {
    console.error("Falta la API key: --key <k> o HOLDED_API_KEY.\n");
    console.error(helpText());
    process.exit(2);
  }
  const docs = await listDocuments(args.base, args.key, args.from, args.to);
  const wanted = new Set(args.uuids);
  const found: Found[] = [];
  const byUuid = new Map<string, number>();

  for (const d of docs) {
    const tag = readTag(d.notes);
    if (!tag) continue;
    if (wanted.size > 0 && !wanted.has(tag.uuid)) continue;
    byUuid.set(tag.uuid, (byUuid.get(tag.uuid) ?? 0) + 1);
    const total = Number(d.total ?? 0);
    const flags: string[] = [];
    if (total === 0) flags.push("CERO");
    if (tag.kind === "abono" && total > 0) flags.push("SIGNO");
    if (tag.kind === "venta" && total < 0) flags.push("SIGNO");
    found.push({
      uuid: tag.uuid,
      kind: tag.kind,
      id: d.id,
      docNumber: d.docNumber ?? "—",
      date: formatDate(d.date),
      total,
      paymentsPending: Number(d.paymentsPending ?? 0),
      flags,
    });
  }
  for (const f of found) {
    if ((byUuid.get(f.uuid) ?? 0) > 1) f.flags.push("DUPLICADO");
  }
  found.sort((a, b) => (a.date === b.date ? a.docNumber.localeCompare(b.docNumber) : a.date.localeCompare(b.date)));

  if (args.json) {
    console.log(JSON.stringify({ documentosLeidos: docs.length, conEtiquetaTPV: found.length, found }, null, 2));
    return;
  }

  console.log(`Documentos leídos de Holded: ${docs.length}`);
  console.log(`Con etiqueta del TPV en las notas: ${found.length}`);
  if (args.uuids.length > 0) {
    const sinDocumento = args.uuids.filter((u) => !byUuid.has(u));
    console.log(`uuid pedidos: ${args.uuids.length} · sin ningún documento en Holded: ${sinDocumento.length}`);
    for (const u of sinDocumento) console.log(`  SIN DOCUMENTO  ${u}`);
  }
  if (found.length === 0) return;
  console.log("");
  console.log(
    ["fecha".padEnd(10), "tipo".padEnd(6), "número".padEnd(12), "total".padStart(10), "pend.".padStart(10), "id".padEnd(26), "uuid".padEnd(36), "marcas"].join(" "),
  );
  for (const f of found) {
    console.log(
      [
        f.date.padEnd(10),
        f.kind.padEnd(6),
        f.docNumber.padEnd(12),
        f.total.toFixed(2).padStart(10),
        f.paymentsPending.toFixed(2).padStart(10),
        f.id.padEnd(26),
        f.uuid.padEnd(36),
        f.flags.join(","),
      ].join(" "),
    );
  }
  const cero = found.filter((f) => f.flags.includes("CERO")).length;
  const dup = new Set(found.filter((f) => f.flags.includes("DUPLICADO")).map((f) => f.uuid)).size;
  console.log("");
  console.log(`A revisar: ${cero} documento(s) a 0 € · ${dup} uuid con más de un documento`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
