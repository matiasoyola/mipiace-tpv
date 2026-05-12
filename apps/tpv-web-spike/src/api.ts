import type { CartLine, Product, TicketResult } from "./types.ts";

interface ApiErrorBody {
  error: string;
  message?: string;
  detail?: unknown;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody | string,
  ) {
    const msg =
      typeof body === "object" && body
        ? `${body.error}${body.message ? ` · ${body.message}` : ""}`
        : `HTTP ${status}`;
    super(msg);
    this.name = "ApiError";
  }
}

async function readError(res: Response): Promise<ApiErrorBody | string> {
  const text = await res.text();
  try {
    return JSON.parse(text) as ApiErrorBody;
  } catch {
    return text;
  }
}

export async function fetchProducts(): Promise<Product[]> {
  const res = await fetch("/api/products");
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  return (await res.json()) as Product[];
}

export async function postTicket(lines: CartLine[]): Promise<TicketResult> {
  const res = await fetch("/api/tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lines }),
  });
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  return (await res.json()) as TicketResult;
}
