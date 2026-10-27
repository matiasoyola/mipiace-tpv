// personal-1 (decisión 7) · `comprobarCuadrante` · **LA PIEZA CENTRAL DEL
// BLOQUE.**
//
// Una función pura que recibe un cuadrante y los parámetros del centro y
// devuelve la lista de lo que está mal, con quién, qué día y cuánto se
// pasa o le falta.
//
// ── POR QUÉ ES PURA Y VIVE EN UN PAQUETE ────────────────────────────
//
// La ejecutan DOS sitios que tienen que decir lo mismo, y pronto TRES:
//
//   · la pantalla del cuadrante, para pintar los avisos **al momento**
//     mientras alguien pinta celdas a toques (sin ir al servidor a cada
//     toque: 21 × 31 celdas y un viaje por toque es una pantalla que se
//     arrastra);
//   · el servidor, al publicar, para dejar apuntado cuántos avisos tenía
//     y cuáles — y eso es lo que a los seis meses contesta «¿se publicó
//     sabiendo que el sábado faltaba una auxiliar?»;
//   · **personal-2**, para validar lo que la IA genere. Un generador sin
//     validador es un generador que inventa cuadrantes ilegales con buena
//     cara.
//
// Si cada uno lo calculara a su manera, la pantalla diría «3 avisos», el
// publicado guardaría «5» y la IA se daría por buena con un cuadrante que
// el panel pinta en rojo.
//
// ── LO QUE NO ESTÁ AQUÍ ─────────────────────────────────────────────
//
// **El convenio colectivo**, y no es un olvido: sus límites entran como
// parámetros cuando Matías los confirme. Meter en código lo que cada
// centro negocia es fijar en el producto algo que cambia cada tres años y
// que no es igual en dos sitios.
//
// Y **los avisos no bloquean publicar** (decisión 7). Publicar con avisos
// pide confirmarlo y los deja apuntados. Un cuadrante con un hueco real
// publicado es mejor que un cuadrante perfecto que nadie ve: el hueco se
// cubre llamando a alguien, no escondiéndolo.

import {
  bloquesDe,
  cifra,
  diasDe,
  diasDelMes,
  horas,
  horasDeMinutos,
  intervalosDe,
  porPersona,
  rangoDelMes,
  sePisan,
} from "./intervalos.js";
import type {
  AvisoDelCuadrante,
  Cuadrante,
  IntervaloPlanificado,
  PersonaDelCuadrante,
  ReglaDelCuadrante,
  ReglasDelCuadrante,
  TurnoDelCuadrante,
} from "./tipos.js";

/** Los días de una semana. La jornada contratada es SEMANAL por ley. */
const DIAS_DE_UNA_SEMANA = 7;

/**
 * **La función.** Recibe el cuadrante y las reglas, devuelve los avisos
 * ordenados: lo rojo primero y, dentro, por día — que es el orden en que
 * la dirección los va a cerrar.
 *
 * Determinista: con la misma entrada, el mismo orden. Sin eso, el
 * «5 avisos» que se guarda al publicar y el que la pantalla pintó serían
 * la misma cifra con otra lista, y comparar dos publicaciones del mismo
 * mes sería imposible.
 */
export function comprobarCuadrante(
  cuadrante: Cuadrante,
  reglas: ReglasDelCuadrante,
): AvisoDelCuadrante[] {
  const avisos: AvisoDelCuadrante[] = [];
  const intervalos = intervalosDe(cuadrante);
  const porId = new Map(cuadrante.turnos.map((t) => [t.id, t]));
  const persona = new Map(cuadrante.personas.map((p) => [p.employeeId, p]));

  avisos.push(...cobertura(cuadrante, porId, persona));
  avisos.push(...ratio(cuadrante, intervalos, persona, reglas));
  avisos.push(...descansoDiario(intervalos, persona, reglas));
  avisos.push(...dosSitiosALaVez(intervalos, persona));
  avisos.push(...descansoSemanal(cuadrante, intervalos, reglas));
  avisos.push(...horasContratadas(cuadrante, intervalos, reglas));
  avisos.push(...fueraDeContrato(cuadrante, porId, persona));

  return avisos.sort(ordenDeAvisos);
}

/** Lo rojo primero, después por día, después por regla y por persona. */
function ordenDeAvisos(a: AvisoDelCuadrante, b: AvisoDelCuadrante): number {
  if (a.gravedad !== b.gravedad) return a.gravedad === "ROJO" ? -1 : 1;
  // Los avisos del mes (sin día) van al final de su grupo: son el resumen,
  // no una celda que tocar.
  if ((a.dia == null) !== (b.dia == null)) return a.dia == null ? 1 : -1;
  if (a.dia != null && b.dia != null && a.dia !== b.dia) {
    return a.dia.localeCompare(b.dia);
  }
  if (a.regla !== b.regla) return a.regla.localeCompare(b.regla);
  return (a.employeeId ?? "").localeCompare(b.employeeId ?? "");
}

// ── 1 · cobertura por turno ───────────────────────────────────────────

/**
 * Personas de **atención directa** en cada turno de cada día, frente al
 * mínimo del turno.
 *
 * Sólo cuenta quien tiene la marca: tres administrativas no cubren el
 * turno de noche de una residencia, y la marca vive en la categoría
 * profesional de la ficha (`countsAsDirectCare`), que es editable porque
 * qué cuenta como atención directa lo dice la acreditación del centro.
 *
 * Un turno con `coberturaMinima` a `null` **no se evalúa**: el centro no
 * lo ha declarado. Es la diferencia entre «no llega» y «no se sabe», y
 * tratar el segundo como un 0 diría «cumple» de todos los turnos de todos
 * los días.
 *
 * `celda` va a `null` y no a una celda concreta: lo que arregla un turno
 * corto de gente no es UNA casilla, es cualquiera de esa columna. La
 * pantalla lleva al día y al turno, que van en el aviso.
 */
function cobertura(
  cuadrante: Cuadrante,
  porId: Map<string, TurnoDelCuadrante>,
  persona: Map<string, PersonaDelCuadrante>,
): AvisoDelCuadrante[] {
  const conMinimo = cuadrante.turnos.filter((t) => t.coberturaMinima != null);
  if (conMinimo.length === 0) return [];

  // (día, turno) → personas de atención directa, sin repetir: un turno
  // partido de la misma persona no la cuenta dos veces.
  const cuenta = new Map<string, Set<string>>();
  for (const celda of cuadrante.celdas) {
    if (celda.turnoId == null) continue;
    if (!porId.has(celda.turnoId)) continue;
    if (persona.get(celda.employeeId)?.atencionDirecta !== true) continue;
    const clave = `${celda.dia}|${celda.turnoId}`;
    const set = cuenta.get(clave);
    if (set) set.add(celda.employeeId);
    else cuenta.set(clave, new Set([celda.employeeId]));
  }

  const fuera: AvisoDelCuadrante[] = [];
  for (const dia of diasDe(cuadrante.mes)) {
    for (const turno of conMinimo) {
      const minimo = turno.coberturaMinima!;
      const hay = cuenta.get(`${dia}|${turno.id}`)?.size ?? 0;
      if (hay >= minimo) continue;
      fuera.push({
        regla: "COBERTURA",
        gravedad: "ROJO",
        employeeId: null,
        dia,
        turnoId: turno.id,
        mensaje:
          `El turno de ${turno.name.toLocaleLowerCase("es-ES")} del ${dia} tiene ` +
          `${hay} ${hay === 1 ? "persona" : "personas"} de atención directa y pide ${minimo}.`,
        falta: minimo - hay,
        celda: null,
      });
    }
  }
  return fuera;
}

// ── 2 · la ratio de residencia ────────────────────────────────────────

/**
 * Jornadas completas equivalentes de atención directa frente a
 * `ratio × plazas ocupadas` ese día.
 *
 * **En jornadas, no en personas** (decisión 7): tres auxiliares de cuatro
 * horas no son tres jornadas, y contarlas como tres es exactamente cómo se
 * cumple una ratio en un papel y no en el pasillo. El divisor —qué es una
 * jornada completa— es parámetro del centro.
 *
 * **Sólo si el módulo de residencia está encendido.** Un colegio no tiene
 * plazas y no tiene ratio; evaluarla le llenaría el mes de rojos por una
 * norma que no le aplica.
 *
 * Y sólo los días cuya ocupación se conoce. Un día que no está en el mapa
 * no se evalúa: suponer cero plazas diría «cumple» siempre, y suponer el
 * aforo diría lo contrario.
 *
 * La comparación va en MILÉSIMAS y con enteros. `0,2 × 48` en coma
 * flotante no es exactamente `9,6`, y una ratio que salta o no salta según
 * el último bit del doble es una ratio que no se puede defender delante de
 * un inspector.
 */
function ratio(
  cuadrante: Cuadrante,
  intervalos: IntervaloPlanificado[],
  persona: Map<string, PersonaDelCuadrante>,
  reglas: ReglasDelCuadrante,
): AvisoDelCuadrante[] {
  if (!reglas.conRatioDeResidencia) return [];
  const ocupacion = cuadrante.ocupacionPorDia;
  if (!ocupacion) return [];
  const jornada = reglas.minutosDeJornadaCompleta;
  if (jornada <= 0) return [];

  // Minutos de atención directa por día. El día es el de la CELDA, el
  // mismo criterio que el registro de jornada: una noche del 24 cuenta al
  // 24, aunque ocho de sus horas sean del 25.
  const minutos = new Map<string, number>();
  for (const i of intervalos) {
    if (persona.get(i.employeeId)?.atencionDirecta !== true) continue;
    const dura = Math.round((i.finAt.getTime() - i.inicioAt.getTime()) / 60_000);
    minutos.set(i.dia, (minutos.get(i.dia) ?? 0) + dura);
  }

  const porMil = Math.round(reglas.ratioAtencionDirecta * 1000);
  const fuera: AvisoDelCuadrante[] = [];
  for (const dia of diasDe(cuadrante.mes)) {
    const ocupadas = ocupacion[dia];
    if (ocupadas == null) continue;
    const exigidasPorMil = porMil * ocupadas;
    const hayPorMil = Math.round(((minutos.get(dia) ?? 0) * 1000) / jornada);
    if (hayPorMil >= exigidasPorMil) continue;
    const hay = hayPorMil / 1000;
    const exigidas = exigidasPorMil / 1000;
    fuera.push({
      regla: "RATIO",
      gravedad: "ROJO",
      employeeId: null,
      dia,
      turnoId: null,
      mensaje:
        `El ${dia} hay ${cifra(hay)} jornadas completas de atención directa y la ratio ` +
        `de ${cifra(reglas.ratioAtencionDirecta)} sobre ${ocupadas} plazas ocupadas pide ${cifra(exigidas)}.`,
      falta: Math.round((exigidas - hay) * 10) / 10,
      celda: null,
    });
  }
  return fuera;
}

// ── 3 · descanso entre jornadas (art. 34.3 ET) ────────────────────────

/**
 * Doce horas entre el fin de una jornada y el inicio de la siguiente.
 *
 * **El caso que tiene que saltar** y que es la razón de ser de esta regla:
 * una noche de 22:00 a 08:00 seguida de una mañana de 08:00 a 15:00 del
 * día siguiente. El hueco es de CERO horas y en un papel no se ve, porque
 * son dos casillas de dos columnas distintas en dos filas del Excel.
 *
 * Los huecos NEGATIVOS no se miran aquí: eso no es poco descanso, es estar
 * en dos sitios a la vez, y tiene su propia regla. Contarlo en las dos
 * sacaría dos avisos rojos del mismo error.
 *
 * Y los intervalos **no se fusionan** cuando se tocan. Un turno partido de
 * 08:00 a 12:00 y de 17:00 a 21:00 deja siete horas de hueco: esto lo
 * canta, y es correcto que lo cante — el parámetro está ahí para que un
 * centro con jornada partida lo baje a lo que su convenio permita. Lo que
 * no se puede es decidirlo nosotros y en silencio.
 */
function descansoDiario(
  intervalos: IntervaloPlanificado[],
  persona: Map<string, PersonaDelCuadrante>,
  reglas: ReglasDelCuadrante,
): AvisoDelCuadrante[] {
  const limite = reglas.horasDescansoDiario * 3_600_000;
  const fuera: AvisoDelCuadrante[] = [];
  for (const [employeeId, lista] of porPersona(intervalos)) {
    const quien = persona.get(employeeId)?.nombre ?? "—";
    for (let i = 1; i < lista.length; i += 1) {
      const antes = lista[i - 1]!;
      const despues = lista[i]!;
      const hueco = despues.inicioAt.getTime() - antes.finAt.getTime();
      if (hueco < 0) continue; // es un solape: regla DOS_SITIOS_A_LA_VEZ
      if (hueco >= limite) continue;
      fuera.push({
        regla: "DESCANSO_DIARIO",
        gravedad: "ROJO",
        employeeId,
        dia: despues.dia,
        turnoId: despues.turnoId,
        mensaje:
          `${quien} descansa ${cifra(horas(hueco))} h entre el turno ${antes.code} del ` +
          `${antes.dia} y el ${despues.code} del ${despues.dia}; la ley pide ${reglas.horasDescansoDiario}.`,
        falta: Math.round((reglas.horasDescansoDiario - horas(hueco)) * 10) / 10,
        // La celda que lo arregla es la SEGUNDA: la primera ya se trabajó
        // (o se trabajará antes), y lo que se mueve es lo que viene
        // después.
        celda: { employeeId, dia: despues.dia },
      });
    }
  }
  return fuera;
}

// ── 4 · nadie en dos sitios a la vez ──────────────────────────────────

/**
 * Dos turnos de la misma persona que se pisan.
 *
 * Tocarse no es pisarse: una tarde que acaba a las 22:00 y una noche que
 * empieza a las 22:00 son una jornada larga —que el descanso diario ya
 * canta— y no un imposible físico.
 *
 * Se comparan sólo pares consecutivos porque la lista está ordenada por
 * inicio: si A no pisa a B y B no pisa a C, A tampoco puede pisar a C sin
 * pisar a B. Y si los pisa a los dos, el aviso de A-B ya manda a la misma
 * celda.
 */
function dosSitiosALaVez(
  intervalos: IntervaloPlanificado[],
  persona: Map<string, PersonaDelCuadrante>,
): AvisoDelCuadrante[] {
  const fuera: AvisoDelCuadrante[] = [];
  for (const [employeeId, lista] of porPersona(intervalos)) {
    const quien = persona.get(employeeId)?.nombre ?? "—";
    for (let i = 1; i < lista.length; i += 1) {
      const a = lista[i - 1]!;
      const b = lista[i]!;
      if (!sePisan(a, b)) continue;
      fuera.push({
        regla: "DOS_SITIOS_A_LA_VEZ",
        gravedad: "ROJO",
        employeeId,
        dia: b.dia,
        turnoId: b.turnoId,
        mensaje:
          `${quien} tiene el turno ${a.code} del ${a.dia} y el ${b.code} del ${b.dia} ` +
          `a la vez: se pisan ${cifra(horas(a.finAt.getTime() - b.inicioAt.getTime()))} h.`,
        exceso: horas(a.finAt.getTime() - b.inicioAt.getTime()),
        celda: { employeeId, dia: b.dia },
      });
    }
  }
  return fuera;
}

// ── 5 · descanso semanal (art. 37.1 ET) ───────────────────────────────

/**
 * Día y medio **ininterrumpido** por período, con el cómputo que permita
 * el parámetro (hasta 14 días).
 *
 * El cálculo, y la parte que no es obvia: lo que se mide es el hueco más
 * largo **sin partirlo por el borde del bloque**. Se toman los huecos
 * entre intervalos consecutivos de la persona en el mes, se miran los que
 * **cruzan** el bloque y se cuenta su longitud ENTERA.
 *
 * Recortarlos al bloque habría dado falsos rojos justo donde más duele: un
 * descanso de viernes a domingo que empieza el último día de un bloque se
 * quedaría en unas horas y el cuadrante diría que esa persona no descansó
 * la semana que sí descansó. Y contar sólo los huecos que EMPIEZAN dentro
 * habría dejado a quien no trabaja ningún día del bloque sin ningún hueco
 * que ofrecer, o sea en rojo por no haber trabajado.
 *
 * Los dos bordes del mes se cierran con el mes mismo: el hueco de delante
 * del primer turno empieza el día 1 y el de detrás del último acaba el
 * último día. Es una COTA INFERIOR —lo de antes y lo de después está en
 * otro cuadrante, publicado aparte— y puede dar un rojo de más en el
 * primer o el último bloque. Está dicho en el done; la alternativa era
 * leer dos meses para pintar uno.
 */
function descansoSemanal(
  cuadrante: Cuadrante,
  intervalos: IntervaloPlanificado[],
  reglas: ReglasDelCuadrante,
): AvisoDelCuadrante[] {
  const bloques = bloquesDe(cuadrante.mes, reglas.diasComputoSemanal);
  if (bloques.length === 0) return [];
  const { desdeAt, hastaAt } = rangoDelMes(cuadrante.mes);
  const limite = reglas.horasDescansoSemanal * 3_600_000;
  const fuera: AvisoDelCuadrante[] = [];
  // FUERA del bucle. Dentro, `porPersona` reagrupaba los 651 intervalos de
  // un mes de Jardín de Gredos una vez por persona —veintiún recorridos de
  // la lista entera— y la pantalla llama a esto en cada toque.
  const agrupados = porPersona(intervalos);

  for (const p of cuadrante.personas) {
    const lista = agrupados.get(p.employeeId) ?? [];
    // Los huecos del mes, incluidos el de antes del primer turno y el de
    // después del último.
    const huecos: Array<{ desdeAt: number; hastaAt: number }> = [];
    let cursor = desdeAt.getTime();
    for (const i of lista) {
      if (i.inicioAt.getTime() > cursor) {
        huecos.push({ desdeAt: cursor, hastaAt: i.inicioAt.getTime() });
      }
      cursor = Math.max(cursor, i.finAt.getTime());
    }
    if (hastaAt.getTime() > cursor) {
      huecos.push({ desdeAt: cursor, hastaAt: hastaAt.getTime() });
    }

    for (const bloque of bloques) {
      let mejor = 0;
      for (const h of huecos) {
        // Cruza el bloque, en cualquier medida.
        if (h.hastaAt <= bloque.desdeAt.getTime()) continue;
        if (h.desdeAt >= bloque.hastaAt.getTime()) continue;
        mejor = Math.max(mejor, h.hastaAt - h.desdeAt);
      }
      if (mejor >= limite) continue;
      fuera.push({
        regla: "DESCANSO_SEMANAL",
        gravedad: "ROJO",
        employeeId: p.employeeId,
        dia: bloque.desde,
        turnoId: null,
        mensaje:
          `${p.nombre} no tiene día y medio seguido libre entre el ${bloque.desde} y el ` +
          `${bloque.hasta}: su descanso más largo es de ${cifra(horas(mejor))} h y la ley pide ${reglas.horasDescansoSemanal}.`,
        falta: Math.round((reglas.horasDescansoSemanal - horas(mejor)) * 10) / 10,
        // No es UNA celda: es poner libre uno de los días del bloque. La
        // pantalla lleva a la fila de esa persona en esa semana.
        celda: null,
      });
    }
  }
  return fuera;
}

// ── 6 · horas planificadas frente a jornada contratada ────────────────

/**
 * Por semana y por mes.
 *
 * Una persona **sin jornada contratada declarada no se evalúa**: no hay
 * contra qué comparar, y eso ya lo canta `datosQueFaltanDePersonal` como
 * dato imprescindible que falta. Inventarle 40 h sería inventar el aviso.
 *
 * ── Las dos asimetrías, que son decisiones ────────────────────────────
 *
 * **Por semana sólo se avisa de las horas de MÁS.** Una semana corta es
 * normal y se compensa en el mes (es para lo que el cómputo existe);
 * avisar de ella llenaría de ámbar el cuadrante de cualquier centro que
 * reparta turnos de siete horas. Una semana larga, en cambio, es una
 * persona trabajando más de lo que firmó, esa semana.
 *
 * **Por mes se avisa de las dos**, con una tolerancia de una jornada
 * completa. El mes es lo que tiene que cuadrar: si falta más de un día de
 * trabajo, alguien va a cobrar menos de lo contratado; si sobra, son horas
 * extra que nadie ha pactado. Y la tolerancia hace falta porque un mes no
 * son cuatro semanas exactas —30 ÷ 7 = 4,29— y sin ella saltaría siempre.
 */
function horasContratadas(
  cuadrante: Cuadrante,
  intervalos: IntervaloPlanificado[],
  reglas: ReglasDelCuadrante,
): AvisoDelCuadrante[] {
  const fuera: AvisoDelCuadrante[] = [];
  const agrupados = porPersona(intervalos);
  const semanas = bloquesDe(cuadrante.mes, DIAS_DE_UNA_SEMANA);
  const dias = diasDelMes(cuadrante.mes);

  const todosLosDias = diasDe(cuadrante.mes);

  for (const p of cuadrante.personas) {
    if (p.minutosContratados == null) continue;
    const lista = agrupados.get(p.employeeId) ?? [];
    // Los minutos de cada día, UNA vez. Antes esto era un `filter` sobre
    // la lista entera por cada semana y por cada persona, con un `Set`
    // nuevo cada vez: cinco recorridos por persona para sumar lo que cabe
    // en un mapa.
    const porDia = new Map<string, number>();
    for (const i of lista) {
      porDia.set(
        i.dia,
        (porDia.get(i.dia) ?? 0) +
          Math.round((i.finAt.getTime() - i.inicioAt.getTime()) / 60_000),
      );
    }
    const minutosDe = (de: string[]): number =>
      de.reduce((n, dia) => n + (porDia.get(dia) ?? 0), 0);

    // ── por semana ────────────────────────────────────────────────
    for (const semana of semanas) {
      const puestos = minutosDe(semana.dias);
      if (puestos <= p.minutosContratados) continue;
      const exceso = horasDeMinutos(puestos - p.minutosContratados);
      fuera.push({
        regla: "HORAS_SEMANA",
        gravedad: "AMBAR",
        employeeId: p.employeeId,
        dia: semana.desde,
        turnoId: null,
        mensaje:
          `${p.nombre} tiene ${cifra(horasDeMinutos(puestos))} h planificadas entre el ${semana.desde} y el ` +
          `${semana.hasta} y su jornada es de ${cifra(horasDeMinutos(p.minutosContratados))} h a la semana: ` +
          `${cifra(exceso)} h de más.`,
        exceso,
        celda: null,
      });
    }

    // ── por mes ───────────────────────────────────────────────────
    const delMes = minutosDe(todosLosDias);
    // Los días del mes a razón de su jornada semanal. No «cuatro
    // semanas»: febrero tiene cuatro y julio cuatro y media.
    const contratadoDelMes = Math.round(
      (p.minutosContratados * dias) / DIAS_DE_UNA_SEMANA,
    );
    const diferencia = delMes - contratadoDelMes;
    if (Math.abs(diferencia) <= reglas.minutosDeJornadaCompleta) continue;
    const cuanto = horasDeMinutos(Math.abs(diferencia));
    fuera.push({
      regla: "HORAS_MES",
      gravedad: "AMBAR",
      employeeId: p.employeeId,
      dia: null,
      turnoId: null,
      mensaje:
        `${p.nombre} tiene ${cifra(horasDeMinutos(delMes))} h planificadas en el mes y le corresponden ` +
        `${cifra(horasDeMinutos(contratadoDelMes))} h: ${cifra(cuanto)} h ${diferencia > 0 ? "de más" : "de menos"}.`,
      ...(diferencia > 0 ? { exceso: cuanto } : { falta: cuanto }),
      celda: null,
    });
  }
  return fuera;
}

// ── 7 · nadie de alta fuera de su contrato ────────────────────────────

/**
 * Planificada antes de su fecha de alta o después del fin de su contrato.
 *
 * Es el error que más barato sale de cometer y más caro de descubrir: se
 * copia la semana anterior al mes siguiente y una persona que se iba el
 * día 15 sigue teniendo turnos el 20. Nadie lo nota hasta que esa persona
 * no aparece.
 *
 * **Sólo los turnos, no las ausencias.** Un «libre» fuera del contrato es
 * ruido: no compromete a nadie a nada, y avisar de él llenaría de rojo el
 * mes de quien entra el día 10 y tiene el resto del mes en blanco.
 */
function fueraDeContrato(
  cuadrante: Cuadrante,
  porId: Map<string, TurnoDelCuadrante>,
  persona: Map<string, PersonaDelCuadrante>,
): AvisoDelCuadrante[] {
  const fuera: AvisoDelCuadrante[] = [];
  for (const celda of cuadrante.celdas) {
    if (celda.turnoId == null || !porId.has(celda.turnoId)) continue;
    const p = persona.get(celda.employeeId);
    if (!p) continue;
    const antes = p.altaEl != null && celda.dia < p.altaEl;
    const despues = p.finEl != null && celda.dia > p.finEl;
    if (!antes && !despues) continue;
    fuera.push({
      regla: "FUERA_DE_CONTRATO",
      gravedad: "ROJO",
      employeeId: celda.employeeId,
      dia: celda.dia,
      turnoId: celda.turnoId,
      mensaje: antes
        ? `${p.nombre} tiene turno el ${celda.dia} y no entra hasta el ${p.altaEl}.`
        : `${p.nombre} tiene turno el ${celda.dia} y su contrato acaba el ${p.finEl}.`,
      celda: { employeeId: celda.employeeId, dia: celda.dia },
    });
  }
  return fuera;
}

// ── El resumen de arriba ──────────────────────────────────────────────

export interface ResumenDeAvisos {
  total: number;
  rojos: number;
  ambares: number;
  /** Cuántos de cada regla. Las que no tienen ninguno no aparecen. */
  porRegla: Partial<Record<ReglaDelCuadrante, number>>;
}

/**
 * Lo que pinta la cabecera de la pantalla, y lo que se guarda al publicar.
 *
 * Recibe los avisos y no el cuadrante: así la pantalla lo cuenta con lo
 * que ya tiene pintado y el servidor con lo que acaba de calcular, sin que
 * ninguno vuelva a recorrer las reglas. Mismo criterio que
 * `resumenDeFichas` en alta-minima.
 */
export function resumenDeAvisos(
  avisos: AvisoDelCuadrante[],
): ResumenDeAvisos {
  const porRegla: Partial<Record<ReglaDelCuadrante, number>> = {};
  for (const a of avisos) {
    porRegla[a.regla] = (porRegla[a.regla] ?? 0) + 1;
  }
  return {
    total: avisos.length,
    rojos: avisos.filter((a) => a.gravedad === "ROJO").length,
    ambares: avisos.filter((a) => a.gravedad === "AMBAR").length,
    porRegla,
  };
}

// ── Y la configuración de los turnos, que no es del cuadrante ─────────

export type ProblemaDeTurnos = "SOLAPE" | "HUECO" | "SIN_COBERTURA";

export interface AvisoDeTurnos {
  problema: ProblemaDeTurnos;
  /** Los turnos implicados, por su código. */
  codigos: string[];
  mensaje: string;
}

/**
 * Lo que está mal en la CONFIGURACIÓN de los turnos del centro, que es
 * otra cosa que lo que está mal en un cuadrante.
 *
 * Tres cosas, y las tres son del mismo tipo: el centro ha puesto unas
 * horas que no dicen lo que cree que dicen.
 *
 *   · **SOLAPE** — dos turnos que se pisan. `turnoDe` resuelve el empate
 *     dando el primero de la lista (residencia-1 lo dejó escrito), así
 *     que no revienta nada; pero un fichaje de las 15:00 se adscribe a un
 *     turno u otro según el `sortOrder`, y nadie lo sabría.
 *   · **HUECO** — minutos del día que no son de ningún turno. `turnoDe`
 *     devuelve `null` ahí, y un cuidado o un fichaje de esa hora se queda
 *     sin turno. En una residencia de 24 horas es un error siempre; en un
 *     colegio, no (nadie ficha a las cuatro de la mañana), así que esto se
 *     devuelve como aviso y no como un 409 que no dejaría configurar un
 *     colegio.
 *   · **SIN_COBERTURA** — un turno sin mínimo declarado. No es un error:
 *     es el dato que falta para que la primera regla del cuadrante pueda
 *     evaluarse, y la pantalla lo pide.
 *
 * El barrido es de los 1 440 minutos del día, igual que el test de los
 * tres turnos de serie de residencia-1: es O(1 440 × turnos) y se lee de
 * un vistazo, contra una aritmética de intervalos que habría que creer.
 */
export function comprobarTurnosDelTenant(
  turnos: Array<
    Pick<TurnoDelCuadrante, "code" | "startsAt" | "endsAt" | "coberturaMinima">
  >,
): AvisoDeTurnos[] {
  const fuera: AvisoDeTurnos[] = [];
  if (turnos.length === 0) return fuera;

  const dentro = (min: number, t: { startsAt: string; endsAt: string }) => {
    const [hi, mi] = t.startsAt.split(":").map(Number);
    const [hf, mf] = t.endsAt.split(":").map(Number);
    const inicio = hi! * 60 + mi!;
    const fin = hf! * 60 + mf!;
    if (fin > inicio) return min >= inicio && min < fin;
    return min >= inicio || min < fin;
  };

  const solapados = new Set<string>();
  let huecos = 0;
  for (let min = 0; min < 1440; min += 1) {
    const cuales = turnos.filter((t) => dentro(min, t));
    if (cuales.length === 0) huecos += 1;
    if (cuales.length > 1) {
      for (const t of cuales) solapados.add(t.code);
    }
  }

  if (solapados.size > 0) {
    const codigos = [...solapados].sort();
    fuera.push({
      problema: "SOLAPE",
      codigos,
      mensaje:
        `Los turnos ${codigos.join(", ")} se solapan. Un fichaje de esas horas se adscribe ` +
        `al primero de la lista, que es el del orden más bajo, y no al que toca.`,
    });
  }
  if (huecos > 0) {
    fuera.push({
      problema: "HUECO",
      codigos: [],
      mensaje:
        `Hay ${huecos} ${huecos === 1 ? "minuto" : "minutos"} del día que no son de ningún turno. ` +
        `Lo que se fiche a esa hora se queda sin turno.`,
    });
  }
  const sinCobertura = turnos
    .filter((t) => t.coberturaMinima == null)
    .map((t) => t.code)
    .sort();
  if (sinCobertura.length > 0) {
    fuera.push({
      problema: "SIN_COBERTURA",
      codigos: sinCobertura,
      mensaje:
        `Los turnos ${sinCobertura.join(", ")} no dicen cuánta gente de atención directa ` +
        `necesitan, así que el cuadrante no puede comprobar su cobertura.`,
    });
  }
  return fuera;
}
