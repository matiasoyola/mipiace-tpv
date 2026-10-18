// residencia-4 (alcance 3) · **LA PANTALLA DE TOMAR UNA CONSTANTE.**
//
// Teclado numérico grande, la unidad a la vista y coma decimal. Y el
// nivel pintado ANTES de apuntar, en cuanto el número es válido.
//
// ── LAS CUATRO DECISIONES DE ESTA PANTALLA ──────────────────────────
//
// 1. **Teclas de 120 px**, el `tap-puerta-tecla` que residencia-3 fijó
//    para el teclado del PIN. El prompt pide ≥ 96 px; se reutiliza el
//    token que ya existe en vez de inventar uno de 96, porque quien
//    teclea aquí lleva los mismos guantes y está de pie delante de la
//    misma pared. Un token nuevo habría que justificarlo
//    (`docs/design/tokens.md` §4) y no hay nada que justificar: es el
//    mismo gesto.
//
// 2. **La unidad SIEMPRE a la vista**, pegada al número y en grande.
//    «38,4» sin «°C» al lado es un número que se puede teclear en el
//    control equivocado, y el control equivocado es una incidencia que no
//    se abre o una que se abre sin motivo.
//
// 3. **COMA decimal, no punto.** Es el separador de España y es lo que
//    está escrito en el termómetro. El punto es del JSON y la conversión
//    la hace `registroDeConstante`.
//
// 4. **Fuera de rango NO SE PUEDE APUNTAR.** El botón se apaga y la
//    frase dice por qué: «38,4 o 384». Es la única pantalla del bloque
//    que impide guardar algo, y la razón está en `registro.ts`: una
//    temperatura de 384 °C no es un cuidado que ocurrió, es un dedo que
//    se saltó la coma — y guardarla haría sonar el móvil de guardia a las
//    tres de la mañana por una fiebre que nadie tuvo.
//
// ── LA TENSIÓN SE TOMA EN UNA SOLA PANTALLA ─────────────────────────
//
// Sistólica y diastólica son DOS controles (residencia-2 los partió a
// propósito: un umbral es por valor y un dominio `NUMERIC` tiene una
// unidad y un rango, no dos). Pero se toman con el mismo aparato y en el
// mismo gesto, así que aquí son una pantalla con dos casillas y un solo
// «Apuntar»: el `groupCode = "TA"` del catálogo es lo que las junta.
//
// Y salen DOS registros, no uno. Eso es lo correcto y es lo que hace que
// «sistólica ≥ 180 → N2» siga siendo una regla sobre un número.
//
// ── EL NIVEL SE PINTA ANTES DE APUNTAR ──────────────────────────────
//
// En cuanto el número es válido, debajo sale «Esto es N2 · avisa a la
// enfermera». Lo calcula `gravedadDe` del paquete puro, en la tablet, con
// la plantilla que trajo el arranque — **también sin red**. El servidor
// la ejecuta otra vez y manda la suya: lo que esta pantalla pinta es una
// previsión honesta, y la pantalla 6 dice lo que de verdad pasó.

import { useMemo, useState } from "react";

import { gravedadDe, type ReglaDeGravedad } from "@mipiacetpv/residencia-plan";

import type { NivelDeLaPuerta, PlantillaDeLaPuerta } from "./puerta-tipos.js";

/** Lo que hace falta de un control para pedir su número. */
export interface ConstanteParaTomar {
  code: string;
  nombre: string;
  unidad: string | null;
  min: number | null;
  max: number | null;
  /** La ocurrencia del plan a la que responde, si responde a una. */
  planItemId?: string | null;
  occurrenceAt?: string | null;
}

export interface PuertaConstanteProps {
  nombreDelResidente: string;
  /** Una, o las dos de la tensión. El orden es el de las casillas. */
  constantes: ConstanteParaTomar[];
  plantilla: PlantillaDeLaPuerta | null;
  onApuntar: (
    valores: Array<{ constante: ConstanteParaTomar; numero: number }>,
    avisarEnfermera: boolean,
  ) => void;
  onVolver: () => void;
}

/** De «38,4» a 38.4, o `null` si no es un número. */
export function aNumero(tecleado: string): number | null {
  if (tecleado.trim() === "" || tecleado === "," || tecleado === "-") return null;
  const n = Number(tecleado.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** ¿Cabe este número en el rango de entrada de su control? */
export function cabeEnElRango(
  n: number,
  c: { min: number | null; max: number | null },
): boolean {
  if (c.min != null && n < c.min) return false;
  if (c.max != null && n > c.max) return false;
  return true;
}

/** El nivel que saldría, con las reglas de la plantilla en la tablet. */
export function nivelPrevisto(
  valores: Array<{ constante: ConstanteParaTomar; numero: number }>,
  reglas: ReglaDeGravedad[],
): { nivel: NivelDeLaPuerta; tipo: string } | null {
  let mejor: { nivel: NivelDeLaPuerta; tipo: string } | null = null;
  const orden = ["N0", "N1", "N2", "N3", "N4"];
  for (const v of valores) {
    const g = gravedadDe(v.constante.code, v.numero, reglas);
    if (!g) continue;
    if (mejor == null || orden.indexOf(g.nivel) > orden.indexOf(mejor.nivel)) {
      mejor = { nivel: g.nivel, tipo: g.tipo };
    }
  }
  return mejor;
}

const TECLAS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "←"];

export function PuertaConstante({
  nombreDelResidente,
  constantes,
  plantilla,
  onApuntar,
  onVolver,
}: PuertaConstanteProps) {
  const [tecleado, setTecleado] = useState<string[]>(() =>
    constantes.map(() => ""),
  );
  const [activa, setActiva] = useState(0);
  const [avisar, setAvisar] = useState(false);

  const numeros = useMemo(
    () => tecleado.map((t) => aNumero(t)),
    [tecleado],
  );
  const completas = numeros
    .map((n, i) => (n == null ? null : { constante: constantes[i]!, numero: n }))
    .filter((x): x is { constante: ConstanteParaTomar; numero: number } => x != null);
  const fueraDeRango = completas.filter(
    (v) => !cabeEnElRango(v.numero, v.constante),
  );
  // **Todas** las casillas, no sólo la activa: la tensión no se apunta a
  // medias. Una sistólica sin diastólica es media toma, y la mitad que
  // falta no se puede inventar después.
  const listo =
    completas.length === constantes.length && fueraDeRango.length === 0;
  const nivel = listo
    ? nivelPrevisto(completas, (plantilla?.reglas as ReglaDeGravedad[]) ?? [])
    : null;

  function teclear(t: string) {
    setTecleado((prev) => {
      const copia = [...prev];
      const actual = copia[activa] ?? "";
      if (t === "←") copia[activa] = actual.slice(0, -1);
      // Una sola coma, y no al principio. Lo corta aquí y no en el
      // `Number`: con «,,8» el campo se queda escrito y la auxiliar no
      // sabe qué ha hecho mal.
      else if (t === ",") copia[activa] = actual.includes(",") || actual === "" ? actual : actual + ",";
      else if (actual.length < 6) copia[activa] = actual + t;
      return copia;
    });
  }

  return (
    <div className="min-h-screen bg-mipiace-stone text-mipiace-ink flex flex-col">
      <header className="px-8 pt-7">
        <h1 className="text-[40px] font-semibold leading-tight">
          {nombreDelResidente}
        </h1>
        <p className="mt-2 text-[24px] text-slate-600">
          {constantes.length > 1
            ? "Tensión arterial"
            : constantes[0]?.nombre}
        </p>
      </header>

      <main className="flex-1 px-8 py-6 flex flex-wrap gap-8 items-start justify-between">
        <div className="flex-1 min-w-[320px] space-y-5">
          {constantes.map((c, i) => {
            const n = numeros[i];
            const malo = n != null && !cabeEnElRango(n, c);
            return (
              <button
                key={c.code}
                type="button"
                onClick={() => setActiva(i)}
                aria-label={`${c.nombre} en ${c.unidad ?? ""}`}
                className={`w-full text-left rounded-2xl border-2 px-7 py-5 ${
                  i === activa
                    ? "border-mipiace-coral bg-white"
                    : "border-slate-300 bg-white/60"
                } ${malo ? "border-red-500" : ""}`}
              >
                <span className="block text-[20px] text-slate-500">
                  {constantes.length > 1 ? c.nombre : "Valor"}
                </span>
                <span className="flex items-baseline gap-3">
                  <span className="text-[64px] font-semibold tabular-nums leading-tight">
                    {tecleado[i] || "—"}
                  </span>
                  {/* La unidad, SIEMPRE a la vista. */}
                  {c.unidad && (
                    <span className="text-[32px] text-slate-500">{c.unidad}</span>
                  )}
                </span>
                {malo && (
                  <span className="block mt-1 text-[20px] text-red-700">
                    {n} no es una lectura posible ({c.min ?? "?"}–{c.max ?? "?"}
                    {c.unidad ? ` ${c.unidad}` : ""}). ¿{formatearDuda(n)}?
                  </span>
                )}
              </button>
            );
          })}

          {/* El nivel, ANTES de apuntar. */}
          {nivel && (
            <p
              role="status"
              className={`rounded-xl px-6 py-4 text-[24px] ${colorDelNivel(nivel.nivel)}`}
            >
              {fraseDelNivel(nivel.nivel)}
            </p>
          )}
          {listo && !nivel && (
            <p className="rounded-xl bg-slate-100 text-slate-600 px-6 py-4 text-[22px]">
              Queda apuntado. Este valor no avisa a nadie por sí solo.
            </p>
          )}
        </div>

        {/* El teclado. Teclas CUADRADAS de 120 px, como el del PIN.
            `w-` y `h-` y no `min-h-`: con sólo el alto, la rejilla las
            estiraba a lo largo y las dejaba en 50 px de ancho — una
            tecla de 120×50 cumple el mínimo sobre el papel y falla con
            un dedo con guantes. Lo midió el bucle visual mirando la
            captura, no el test. */}
        <div className="grid grid-cols-3 gap-3 shrink-0">
          {TECLAS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => teclear(t)}
              className="w-tap-puerta-tecla h-tap-puerta-tecla rounded-2xl bg-white border-2 border-slate-300 text-[40px] font-semibold active:bg-slate-100"
            >
              {t}
            </button>
          ))}
        </div>
      </main>

      <footer className="px-8 pb-7 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={onVolver}
          className="min-h-tap-puerta rounded-xl border-2 border-slate-300 px-7 text-[22px]"
        >
          Volver
        </button>
        {/* El botón de la enfermera, encendido (alcance 7). Es un
            interruptor y no una acción: lo que hace es que lo que se
            apunte salga con al menos N2. */}
        <button
          type="button"
          aria-pressed={avisar}
          onClick={() => setAvisar((v) => !v)}
          className={`min-h-tap-puerta rounded-xl px-7 text-[22px] font-semibold border-2 ${
            avisar
              ? "bg-red-600 text-white border-red-600"
              : "border-red-500 text-red-700"
          }`}
        >
          {avisar ? "✓ Se avisará a la enfermera" : "No puede esperar: avisar a la enfermera"}
        </button>
        <button
          type="button"
          disabled={!listo}
          onClick={() => onApuntar(completas, avisar)}
          className="flex-1 min-h-tap-puerta rounded-2xl bg-mipiace-coral text-white text-[28px] font-semibold active:bg-mipiace-coral-dark disabled:bg-slate-300 disabled:text-slate-500"
        >
          Apuntar
        </button>
      </footer>
    </div>
  );
}

/** «¿38,4 o 384?» — la pregunta que explica el rechazo sin dar una
 *  lección. Si el número tiene coma, se propone sin ella, y al revés. */
export function formatearDuda(n: number): string {
  const texto = String(n);
  if (texto.includes(".")) return `${texto.replace(".", ",")} o ${texto.replace(".", "")}`;
  if (texto.length > 2) {
    return `${texto.slice(0, texto.length - 1)},${texto.slice(-1)} o ${texto}`;
  }
  return texto;
}

export function colorDelNivel(nivel: NivelDeLaPuerta): string {
  switch (nivel) {
    case "N4":
      return "bg-red-600 text-white font-semibold";
    case "N3":
      return "bg-red-100 text-red-900";
    case "N2":
      return "bg-amber-100 text-amber-900";
    case "N1":
      return "bg-slate-100 text-slate-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

/** Lo que la auxiliar necesita leer, que **no es el código del nivel**.
 *  «N2» no significa nada delante de una puerta; «avisa a la enfermera»
 *  sí. El código va detrás, entre paréntesis, porque es lo que después
 *  aparece en el libro y en el relevo. */
export function fraseDelNivel(nivel: NivelDeLaPuerta): string {
  switch (nivel) {
    case "N4":
      return "Emergencia (N4). Llama al 112.";
    case "N3":
      return "Hay que tomar una decisión clínica (N3). Avisa a la enfermera y a dirección.";
    case "N2":
      return "Alguien tiene que verlo ahora (N2). Avisa a la enfermera.";
    case "N1":
      return "Queda apuntado para el turno siguiente (N1).";
    default:
      return "Queda constancia (N0).";
  }
}
