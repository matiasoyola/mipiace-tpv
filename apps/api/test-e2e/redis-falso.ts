// residencia-5 · **EL REDIS EN MEMORIA DE LA SUITE, EN UN SOLO SITIO.**
//
// ── POR QUÉ HACE FALTA (residencia-3 §18) ───────────────────────────
//
// El PIN de cuidado pasa por el rate-limit, que vive en Redis, y el job
// `e2e` de CI **sólo levanta Postgres**. Con el cliente de `context.ts`
// (`maxRetriesPerRequest: null`, que lo exige BullMQ), un comando contra
// un Redis que no está **no falla: espera para siempre**. Son 48 minutos
// de runner y un log de `ECONNREFUSED`, y es una de las memorias de la
// casa.
//
// Lo que se sustituye es el **TRANSPORTE**, no el limitador: la ruta y
// `auth/rate-limit.ts` siguen siendo los de verdad, con sus ventanas y su
// candado. Lo único que cambia es dónde se guardan las claves.
//
// ── POR QUÉ ESTÁ AQUÍ Y NO COPIADO EN CADA FICHERO ──────────────────
//
// residencia-3 lo escribió inline, residencia-4 lo copió y residencia-5
// habría sido la tercera copia. Tres copias de un doble de Redis son tres
// sitios donde `expire` puede comportarse distinto, y entonces un
// rate-limit que falla en un bloque pasa en el de al lado.
//
// Se saca aquí y los tres lo importan. El `vi.mock` tiene que seguir en
// cada fichero —es por fichero, no global—, pero lo que hay dentro es uno.

interface Clave {
  valor: string;
  caducaEn: number | null;
}

/** La forma de lo que `getRedis()` devuelve, en lo que la suite usa. */
export interface RedisFalso {
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, valor: string, modo?: string, segundos?: number): Promise<string>;
  ttl(key: string): Promise<number>;
  expire(key: string, segundos: number): Promise<number>;
  del(...keys: string[]): Promise<number>;
  flushall(): Promise<string>;
  ping(): Promise<string>;
  disconnect(): void;
}

/**
 * Un Redis en memoria con TTL de verdad.
 *
 * El TTL es lo que importa y es la razón de que esto no sea un `Map`
 * pelado: el candado del PIN dura dos minutos y el test del escalado
 * mueve el reloj. Una clave «viva» se comprueba al leerla, no con un
 * temporizador — así `vi.setSystemTime` la caduca igual.
 */
export function redisFalso(): RedisFalso {
  const claves = new Map<string, Clave>();

  function viva(key: string): Clave | null {
    const c = claves.get(key);
    if (!c) return null;
    if (c.caducaEn !== null && c.caducaEn <= Date.now()) {
      claves.delete(key);
      return null;
    }
    return c;
  }

  return {
    async incr(key) {
      const c = viva(key);
      const valor = c ? Number(c.valor) + 1 : 1;
      claves.set(key, { valor: String(valor), caducaEn: c?.caducaEn ?? null });
      return valor;
    },
    async decr(key) {
      const c = viva(key);
      const valor = c ? Number(c.valor) - 1 : -1;
      claves.set(key, { valor: String(valor), caducaEn: c?.caducaEn ?? null });
      return valor;
    },
    async get(key) {
      return viva(key)?.valor ?? null;
    },
    async set(key, valor, _modo, segundos) {
      claves.set(key, {
        valor,
        caducaEn: segundos == null ? null : Date.now() + segundos * 1000,
      });
      return "OK";
    },
    async ttl(key) {
      const c = viva(key);
      if (!c) return -2;
      if (c.caducaEn === null) return -1;
      return Math.ceil((c.caducaEn - Date.now()) / 1000);
    },
    async expire(key, segundos) {
      const c = viva(key);
      if (!c) return 0;
      claves.set(key, { valor: c.valor, caducaEn: Date.now() + segundos * 1000 });
      return 1;
    },
    async del(...keys) {
      let n = 0;
      for (const k of keys) if (claves.delete(k)) n += 1;
      return n;
    },
    async flushall() {
      claves.clear();
      return "OK";
    },
    async ping() {
      return "PONG";
    },
    disconnect() {},
  };
}
