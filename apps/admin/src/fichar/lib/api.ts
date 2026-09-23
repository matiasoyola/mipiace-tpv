// F1 · el cliente HTTP de la pantalla de fichar.
//
// Deliberadamente SEPARADO de `src/api.ts`. Aquel cliente habla con la
// sesión del propietario (access + refresh en storage, impersonación,
// reintento con refresh). Aquí la identidad es OTRA: el token del móvil,
// que no caduca, no se refresca y no abre nada del panel.
//
// Mezclarlos habría metido el fichaje dentro del flujo de login del
// admin, que es lo primero que el plan dice que no puede pasar: un
// empleado que abre su enlace no debe acabar nunca en /login.

const TOKEN_KEY = "mipiacetpv-fichar-token";

export class FicharApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FicharApiError";
  }
}

export function readEmployeeToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    // Modo privado restrictivo. Sin sitio donde guardar la identidad, la
    // pantalla pedirá el enlace otra vez — molesto, pero honesto.
    return null;
  }
}

export function storeEmployeeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ver readEmployeeToken */
  }
}

export function clearEmployeeToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ídem */
  }
}

export async function ficharApi<T>(
  path: string,
  init: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const token = init.token !== undefined ? init.token : readEmployeeToken();
  const res = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { "X-Employee-Token": token } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    throw new FicharApiError(
      res.status,
      typeof data.error === "string" ? data.error : "ERROR",
      typeof data.message === "string" ? data.message : "Algo ha ido mal",
    );
  }
  return data as T;
}

/** Un error del servidor que NO tiene sentido reintentar: el servidor ya
 *  dijo que no. Los de red y los 5xx sí se reintentan. Mismo criterio que
 *  `isPermanentRejection` del outbox del TPV. */
export function isPermanent(err: unknown): boolean {
  if (!(err instanceof FicharApiError)) return false;
  if (err.status === 408 || err.status === 429) return false;
  return err.status >= 400 && err.status < 500;
}
