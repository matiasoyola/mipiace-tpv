// agenda-lista · las capacidades del tenant, en un sitio y con quien las
// mira suscrito.
//
// Antes vivían en un `useState` dentro de `AdminShell.tsx`, leído UNA VEZ
// al montar. Eso dejaba dos filos:
//
//   · **El de la visita** (hallazgo 🟡 3 del banco): la dueña enciende la
//     agenda en Ajustes, guarda, y el menú sigue igual. No hay nada roto
//     —recargar lo arregla— pero quien acaba de darle a un interruptor y
//     no ve cambiar nada concluye que no ha funcionado. Y el que lo va a
//     encender delante de Sole es Matías.
//   · Dos consumidores independientes (el shell, para el banner de
//     Holded, y cada `NavList`) hacían cada uno su par de peticiones a
//     `/admin/tenant/settings` y `/auth/me`. En una pantalla con el
//     drawer móvil montado son tres pares.
//
// Así que: una caché de módulo, una petición en vuelo compartida, y
// `refrescarCapacidades()` para quien acaba de cambiarlas. No es un
// estado global de la app — es el único dato que se consulta desde dos
// sitios que no se pueden pasar props (la pantalla es el PADRE de su
// propio `AdminShell`, así que un contexto no llega al revés).
//
// La caché se tira cuando no queda nadie suscrito. Es a propósito: al
// navegar entre pantallas el shell se desmonta y se vuelve a montar, así
// que se vuelve a pedir — exactamente lo que pasaba antes de este
// fichero. Sin eso, un `logout` + `login` con otro tenant heredaría las
// capacidades del anterior.

import { useSyncExternalStore } from "react";

import { api } from "./api.js";

export interface TenantCapabilities {
  caja: boolean;
  // F1 (ADR-018) · el control horario. `=== true` como las demás; la
  // columna nace apagada y sólo el encendido explícito la abre.
  agenda: boolean;
  fichaje: boolean;
  // H1 · no es una columna: es "tiene clave de Holded", que sale de
  // `/auth/me`. Se trata igual que las otras para gatear el sidebar.
  holded: boolean;
  // catalogo-local (addendum 3) · ¿está PREVISTO que use Holded? Sí es
  // una columna (`Tenant.holdedEnabled`). Se guarda aparte de `holded` a
  // propósito, porque responden a preguntas distintas y confundirlas es
  // el bug que el addendum viene a arreglar: `holded` gatea las
  // secciones que sólo tienen sentido con el ERP conectado, y esta gatea
  // la ALARMA de que el ERP no responde.
  holdedEnabled: boolean;
  // holded-desconectar (ADR-020) · ¿DEJÓ Holded? Tercera pregunta, y no se
  // deduce de las otras dos: `holdedEnabled === false` lo contestan igual el
  // comercio que nació sin Holded y el que lo dejó con 270 facturas detrás.
  // Sólo el segundo tiene devoluciones que llevarle al asesor a mano.
  holdedDejado: boolean;
  // clinica-1 · la HISTORIA CLÍNICA. Columna del tenant, sólo la mueve el
  // super-admin. La pantalla de Personal pinta la sección clínica —puesto,
  // colegiado, alcance, pacientes— sólo si está encendida: en Sole y en
  // los demás, Personal es exactamente la de hoy.
  clinica: boolean;
}

// El valor con el que se sigue adelante si alguna de las dos peticiones
// falla. Es el mismo que tenía el `.catch()` de `AdminShell`: se asume
// caja y Holded (el caso de casi todos) y se esconde lo demás, porque
// esconder una sección es más barato que enseñar una que no toca.
const POR_DEFECTO: TenantCapabilities = {
  agenda: false,
  caja: true,
  fichaje: false,
  holded: true,
  holdedEnabled: true,
  holdedDejado: false,
  // clinica-1 · false al fallar, como `agenda` y `fichaje`: esconder una
  // sección es más barato que enseñar una que no toca, y aquí la que no
  // toca enseñaría datos de salud donde no los hay.
  clinica: false,
};

let cache: TenantCapabilities | null = null;
let enVuelo: Promise<void> | null = null;
const suscritos = new Set<() => void>();

function avisar(): void {
  for (const fn of suscritos) fn();
}

async function pedir(): Promise<void> {
  try {
    const [s, me] = await Promise.all([
      api<{
        settings: {
          agendaEnabled?: boolean;
          cajaEnabled?: boolean;
          fichajeEnabled?: boolean;
          clinicalRecordsEnabled?: boolean;
        };
      }>("/admin/tenant/settings"),
      api<{
        tenant: {
          hasHoldedKey?: boolean;
          holdedEnabled?: boolean;
          holdedDisconnectedAt?: string | null;
        };
      }>("/auth/me"),
    ]);
    cache = {
      agenda: s.settings.agendaEnabled ?? false,
      caja: s.settings.cajaEnabled !== false,
      fichaje: s.settings.fichajeEnabled === true,
      clinica: s.settings.clinicalRecordsEnabled === true,
      holded: me.tenant.hasHoldedKey === true,
      holdedEnabled: me.tenant.holdedEnabled !== false,
      holdedDejado: me.tenant.holdedDisconnectedAt != null,
    };
  } catch {
    cache = POR_DEFECTO;
  }
  avisar();
}

function cargarSiHaceFalta(): void {
  if (cache != null || enVuelo != null) return;
  enVuelo = pedir().finally(() => {
    enVuelo = null;
  });
}

/**
 * Vuelve a pedir las capacidades y avisa a todo el que las esté mirando.
 *
 * La llama la pantalla que acaba de cambiarlas — hoy sólo Ajustes, al
 * guardar los «Módulos del negocio». Devuelve la promesa para que quien
 * quiera pueda esperarla; nadie está obligado.
 *
 * Reentrante: si ya hay una petición en vuelo se engancha a ella en vez
 * de disparar otra.
 */
export function refrescarCapacidades(): Promise<void> {
  if (enVuelo != null) return enVuelo;
  enVuelo = pedir().finally(() => {
    enVuelo = null;
  });
  return enVuelo;
}

function suscribir(fn: () => void): () => void {
  suscritos.add(fn);
  cargarSiHaceFalta();
  return () => {
    suscritos.delete(fn);
    // Nadie mirando: fuera la caché. Ver la cabecera del fichero.
    if (suscritos.size === 0) cache = null;
  };
}

function leer(): TenantCapabilities | null {
  return cache;
}

/**
 * `null` mientras no se sabe. Quien gatea algo tiene que decidir qué
 * hace con ese `null`: las entradas del menú se esconden (no parpadear)
 * y el banner de Holded no se pinta (una alarma que parpadea es peor que
 * una que tarda medio segundo).
 */
export function useTenantCapabilities(): TenantCapabilities | null {
  return useSyncExternalStore(suscribir, leer, leer);
}

/**
 * Sólo para las pruebas: deja el módulo como recién importado. En la app
 * no hace falta porque la caché ya se tira al quedarse sin suscritos,
 * pero un test que renderiza y desmonta varias veces dentro del mismo
 * fichero comparte el módulo.
 */
export function __resetCapacidadesParaTests(): void {
  cache = null;
  enVuelo = null;
  suscritos.clear();
}
