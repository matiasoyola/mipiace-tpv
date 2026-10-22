// residencia-3 (D-64) · **LA PUERTA, DE PRINCIPIO A FIN.**
//
// La máquina de estados de las seis pantallas y el único sitio del front
// que habla con la API de la puerta. Las pantallas no piden nada y no
// guardan nada: reciben datos y devuelven gestos.
//
// ── SIN RED, DE VERDAD ──────────────────────────────────────────────
//
// Es la mitad del bloque y está en tres sitios, los tres aquí:
//
//   1. **El arranque** se guarda en IndexedDB (`puerta-cache.ts`). Sin red
//      se lee de ahí, y con ella se refresca.
//   2. **El PIN** se resuelve contra el roster cacheado (`quienTeclea`)
//      cuando la API no contesta. Con red manda el servidor, que es el
//      autoritativo.
//   3. **«Lo que toca»** se calcula con `queToca` del paquete puro, en la
//      tablet, con el plan de la caché. Es para esto que ese paquete no
//      toca la base de datos (residencia-2 §5).
//
// Y lo que se registra **no espera a nadie**: va a la cola del TPV
// (`lib/outbox.ts`) ANTES de intentar el POST, igual que una venta desde
// v1.5. La pantalla 6 no depende de que haya red; depende de que esté
// escrito en la tablet.
//
// ── LA SESIÓN SE CIERRA SOLA AL MINUTO (decisión 8) ─────────────────
//
// Un minuto sin tocar y vuelve a la pantalla 1. Lo que se cierra es LO QUE
// SE PINTA: el token se queda (ver `puerta-cache.ts`) porque la cola lo
// necesita para subir lo que ya se apuntó, a lo mejor horas después y sin
// nadie delante.
//
// ── EL ORDEN DE LAS DOS LECTURAS, Y POR QUÉ IMPORTA ─────────────────
//
// Al entrar con el PIN se pide `lo-que-toca` al servidor. Si falla, se
// calcula en local. **Nunca al revés**: lo de la tablet no sabe lo que
// registró otra persona desde el panel ni lo que entró de otra tablet, y
// pintar un «Hecho» disponible sobre algo que ya está hecho lleva a hacer
// dos veces el mismo cuidado — que en un cambio postural es mover a
// alguien que acaban de mover.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  FRASE_PIN_POR_RENOVAR,
  addDays,
  diaDelTurno,
  gravedadDe,
  queToca,
  turnoDe,
  type Ocurrencia,
  type ReglaDeGravedad,
} from "@mipiacetpv/residencia-plan";

import { ApiError, apiConPuerta, apiWithDevice } from "../api.js";
import type { PuertaMeResponse } from "../hooks/useDeviceBootstrap.js";
import {
  flushOutbox,
  outboxAdd,
  outboxCounts,
  startOutboxSync,
  subscribeOutbox,
} from "../lib/outbox.js";
import { newId } from "../lib/ids.js";
import {
  DIAS_EN_LA_TABLET,
  apuntarEnLaTablet,
  guardarArranque,
  guardarSesion,
  leerArranque,
  leerSesion,
  loApuntadoEnLaTablet,
  olvidarApuntado,
  quienTeclea,
  type RegistroEnLaTablet,
  type SesionDePuerta,
} from "./puerta-cache.js";
import {
  ALGO_NO_VA_BIEN,
  algoNoVaBien,
  comoSiempre,
  dimensionesDeLaObservacion,
  noComoSiempre,
  registroADemanda,
  registroDeConstante,
  registroDeOcurrencia,
  TIPOS_DE_ALGO_NO_VA_BIEN,
  type ContextoDelGesto,
} from "./puerta-gestos.js";
import {
  PuertaConstante,
  type ConstanteParaTomar,
} from "./PuertaConstante.js";
import { PuertaAlgoNoVaBien } from "./PuertaAlgoNoVaBien.js";
import { PuertaApuntado, type LineaApuntada } from "./PuertaApuntado.js";
import { PuertaLoQueToca } from "./PuertaLoQueToca.js";
import { PuertaNoComoSiempre } from "./PuertaNoComoSiempre.js";
import { PuertaPin, type RolParaElegir } from "./PuertaPin.js";
import { PuertaScreen, diaDelTurnoEnLaTablet, turnoDeLaTablet } from "./PuertaScreen.js";
import type {
  EstadoDeLaIncidencia,
  LoQueToca,
  NivelDeLaPuerta,
  OcurrenciaDeLaPuerta,
  PuertaArranque,
  RegistroParaEnviar,
  ResultadoDelRegistro,
} from "./puerta-tipos.js";
import type { AvisoDeLaPantalla6 } from "./PuertaApuntado.js";

/** Un minuto sin tocar (decisión 8). */
const INACTIVIDAD_MS = 60_000;
/** Y la pantalla 6 vuelve a reposo a los 10 s. */
const APUNTADO_MS = 10_000;

type Vista =
  | { v: "reposo" }
  | { v: "pin" }
  | { v: "toca" }
  | { v: "no-como-siempre"; clientId: string; cambiadas?: Record<string, string> }
  | {
      v: "algo";
      clientId: string;
      /** Puesto cuando se llega desde la pantalla 4 con cambios ya hechos:
       *  el gesto es UNO y las dos cosas salen en el mismo lote. */
      cambiadas?: Record<string, string>;
    }
  // residencia-4 · el teclado de una constante. `codes` es uno, o los dos
  // de la tensión (`groupCode = "TA"`), que se toman en UNA pantalla.
  | {
      v: "constante";
      clientId: string;
      codes: string[];
      ocurrencia: OcurrenciaDeLaPuerta | null;
    }
  | { v: "apuntado" };

export interface PuertaAppProps {
  me: PuertaMeResponse;
  onRefresh: () => void;
}

export function PuertaApp({ me, onRefresh }: PuertaAppProps) {
  const [arranque, setArranque] = useState<PuertaArranque | null>(null);
  const [vista, setVista] = useState<Vista>({ v: "reposo" });
  const [sesion, setSesion] = useState<SesionDePuerta | null>(null);
  const [eligiendoRol, setEligiendoRol] = useState<{
    nombre: string;
    roles: RolParaElegir[];
    pin: string;
  } | null>(null);
  const [errorDelPin, setErrorDelPin] = useState<string | null>(null);
  const [comprobando, setComprobando] = useState(false);
  const [toca, setToca] = useState<LoQueToca | null>(null);
  const [apuntadas, setApuntadas] = useState<LineaApuntada[]>([]);
  const [ultimoId, setUltimoId] = useState<string | null>(null);
  const [pendientes, setPendientes] = useState(0);
  const [hayRed, setHayRed] = useState(() => navigator.onLine);
  // residencia-4 · lo que la pantalla 6 pinta del aviso. `nivelPrevisto`
  // lo calcula la TABLET con la plantilla de su caché, al instante y
  // también sin red; `servidor` llega cuando el lote sale y es el que
  // manda. Mientras sea `null` y el nivel previsto sea N2 o más, la
  // pantalla dice que el aviso NO ha salido.
  const [aviso, setAviso] = useState<AvisoDeLaPantalla6 | null>(null);
  /** El `externalId` del item de la cola del gesto que se está pintando,
   *  para casarlo con su respuesta. */
  const envioEnCurso = useRef<string | null>(null);
  const ultimoToque = useRef(Date.now());
  const [segundosParaCerrar, setSegundosParaCerrar] = useState(60);

  // ── La cola, montada aquí y no en `App.tsx` ─────────────────────────
  //
  // `App.tsx` corta en la rama `room` ANTES de montar el outbox del
  // terminal, y eso sigue siendo correcto: una puerta no cobra, no abre
  // turno y no emite registro de facturación. Lo que sí tiene es su propia
  // cola de registros, y se monta aquí — el mismo módulo, el mismo
  // IndexedDB, el mismo reenvío al arrancar / al evento `online` / cada
  // 15 s. No se inventa otro mecanismo.
  useEffect(() => {
    const parar = startOutboxSync();
    const quitar = subscribeOutbox((e) => {
      void outboxCounts().then((c) => setPendientes(c.pending + c.rejected));
      // ── residencia-4 · LA RESPUESTA DEL LOTE ───────────────────────
      //
      // La cola es quien habla con el servidor, así que el nivel que
      // manda y los canales en los que ha sonado llegan por aquí y no
      // por el `await` de `encolar` — que vuelve en cuanto el gesto está
      // escrito en la tablet, que es lo que la pantalla 6 promete.
      //
      // Se casa por `externalId` con el gesto que se está pintando: sin
      // eso, un lote viejo que sale ahora (la cola reintenta cada 15 s)
      // pintaría su nivel encima del gesto que la auxiliar acaba de
      // hacer.
      if (e.type !== "sent" || e.externalId !== envioEnCurso.current) return;
      // ── LO QUE YA SALIÓ, FILA A FILA ──────────────────────────────
      //
      // residencia-3 pintaba «en la tablet» / «enviado» por fila, y la
      // segunda mitad **no llegaba nunca**: `enLaTablet` se ponía a
      // `true` al encolar y nadie lo bajaba. La pantalla 6 decía «Sin
      // red. Lo guarda la tablet» y, dos líneas más abajo, «Avisado en
      // enfermería» — las dos cosas a la vez.
      //
      // Lo encontró el bucle visual de residencia-4 mirando la captura,
      // no un test: el de la cola comprueba que el lote sale, y el de la
      // pantalla le pasa `enLaTablet` a mano.
      setApuntadas((ls) => ls.map((l) => ({ ...l, enLaTablet: false })));
      const cuerpo = e.response as { registros?: ResultadoDelRegistro[] } | null;
      const conIncidencia = cuerpo?.registros?.find((r) => r.incidencia);
      if (!conIncidencia?.incidencia) return;
      const i = conIncidencia.incidencia;
      setAviso({
        nivelPrevisto: i.nivel,
        servidor: {
          incidenciaId: i.id,
          nivel: i.nivel,
          nombreDelTipo: i.nombreDelTipo,
          avisadoEn: i.avisadoEn,
          acusadoPor: null,
          acusadoComo: null,
          acusadoEn: null,
        },
      });
    });
    void outboxCounts().then((c) => setPendientes(c.pending + c.rejected));
    return () => {
      parar();
      quitar();
    };
  }, []);

  useEffect(() => {
    const sube = () => setHayRed(true);
    const baja = () => setHayRed(false);
    window.addEventListener("online", sube);
    window.addEventListener("offline", baja);
    return () => {
      window.removeEventListener("online", sube);
      window.removeEventListener("offline", baja);
    };
  }, []);

  // ── El arranque: red primero, caché después ─────────────────────────
  useEffect(() => {
    let vivo = true;
    void (async () => {
      // La caché primero para pintar sin esperar, y el refresco después.
      // Al contrario que en «lo que toca», aquí el orden es ése: lo que la
      // pantalla 1 pinta son nombres y fotos, y un nombre de ayer es el
      // mismo nombre.
      const cacheado = await leerArranque();
      if (vivo && cacheado) setArranque(cacheado);
      try {
        const fresco = await apiWithDevice<PuertaArranque>(
          "/residencia/puerta/arranque",
        );
        if (!vivo) return;
        setArranque(fresco);
        await guardarArranque(fresco);
      } catch {
        /* sin red: se queda lo cacheado */
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  // La sesión guardada, para que la cola pueda salir y para que «Seguir»
  // no vuelva a pedir el PIN si alguien recarga la pantalla.
  useEffect(() => {
    setSesion(leerSesion());
  }, []);

  // ── La ventana de inactividad ───────────────────────────────────────
  const tocar = useCallback(() => {
    ultimoToque.current = Date.now();
  }, []);

  useEffect(() => {
    if (vista.v === "reposo" || vista.v === "pin") return;
    const id = setInterval(() => {
      const quedan = Math.ceil(
        (INACTIVIDAD_MS - (Date.now() - ultimoToque.current)) / 1000,
      );
      setSegundosParaCerrar(quedan);
      if (quedan <= 0) {
        // Al cerrarse NO se borra el token: la cola lo necesita. Lo que se
        // borra es lo que se está pintando.
        setVista({ v: "reposo" });
        setToca(null);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [vista.v]);

  // La pantalla 6 vuelve a reposo a los 10 s… salvo que haya un aviso
  // vivo esperando acuse. Entonces se queda: lo que la auxiliar necesita
  // saber antes de irse es si va alguien, y una pantalla que se apaga a
  // los diez segundos la deja sin esa respuesta.
  useEffect(() => {
    if (vista.v !== "apuntado") return;
    const esperandoAcuse =
      aviso?.servidor != null &&
      aviso.servidor.avisadoEn.length > 0 &&
      aviso.servidor.acusadoPor == null;
    if (esperandoAcuse) return;
    const id = setTimeout(() => setVista({ v: "reposo" }), APUNTADO_MS);
    return () => clearTimeout(id);
  }, [vista.v, aviso]);

  // ── residencia-4 · ¿YA VA ALGUIEN? ────────────────────────────────
  //
  // Un GET corto cada cinco segundos mientras la pantalla 6 está delante
  // y el aviso sigue sin acusar. No un socket: la pantalla 6 vive poco y,
  // sobre todo, **la puerta puede no tener red** — con el GET, sin red
  // simplemente falla y lo que se pinta no cambia; con un socket se
  // quedaría esperando algo que no va a llegar.
  useEffect(() => {
    const incidenciaId = aviso?.servidor?.incidenciaId;
    if (vista.v !== "apuntado" || !incidenciaId) return;
    if (aviso?.servidor?.acusadoPor) return;
    let vivo = true;
    const preguntar = async () => {
      try {
        const estado = await apiConPuerta<EstadoDeLaIncidencia>(
          `/residencia/puerta/incidencias/${incidenciaId}`,
        );
        if (!vivo) return;
        const acusado = estado.avisos.find((a) => a.acusadoPor);
        if (!acusado) return;
        setAviso((prev) =>
          prev?.servidor
            ? {
                ...prev,
                servidor: {
                  ...prev.servidor,
                  acusadoPor: acusado.acusadoPor,
                  acusadoComo: acusado.acusadoComo,
                  acusadoEn: acusado.acusadoEn,
                },
              }
            : prev,
        );
      } catch {
        /* sin red: la pantalla se queda como está, sin fingir nada */
      }
    };
    void preguntar();
    const id = setInterval(() => void preguntar(), 5000);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [vista.v, aviso?.servidor?.incidenciaId, aviso?.servidor?.acusadoPor]);

  const dimensiones = useMemo(
    () =>
      arranque
        ? dimensionesDeLaObservacion(arranque.controles, (code) => {
            const a = arranque.ajustes.find((x) => x.controlCode === code);
            // La AUSENCIA de ajuste no apaga nada, igual que en `queToca`:
            // un control sin fila de ajuste es un dato que falta, no una
            // decisión del centro.
            return a ? a.active : true;
          })
        : [],
    [arranque],
  );

  // ── residencia-4 · la plantilla de gravedad que trajo el arranque ──
  //
  // Ausente en una caché de antes del bloque: entonces la tablet no
  // previene ningún nivel y lo dice el servidor al subir el lote. No se
  // inventa nada.
  const reglas = useMemo<ReglaDeGravedad[]>(
    () => (arranque?.plantilla?.reglas as ReglaDeGravedad[] | undefined) ?? [],
    [arranque],
  );

  /** Las constantes activas del centro, para «+ Constante». */
  const constantesDisponibles = useMemo(() => {
    if (!arranque) return [];
    const alias = new Map(arranque.ajustes.map((a) => [a.controlCode, a]));
    return arranque.controles
      .filter((c) => c.valueDomain === "NUMERIC")
      .filter((c) => {
        const a = alias.get(c.code);
        return a ? a.active : true;
      })
      // La tensión sale UNA vez: las dos mitades se toman en la misma
      // pantalla, así que ofrecer «Tensión sistólica» y «Tensión
      // diastólica» por separado sería pedir dos veces lo mismo.
      .filter((c) => c.groupCode == null || c.code === "TA_SISTOLICA")
      .map((c) => ({
        code: c.code,
        nombre:
          c.groupCode === "TA"
            ? "Tensión"
            : (alias.get(c.code)?.alias ?? c.name),
      }));
  }, [arranque]);

  /** De un código a lo que la pantalla del teclado necesita. */
  const constanteParaTomar = useCallback(
    (code: string, ocurrencia: OcurrenciaDeLaPuerta | null): ConstanteParaTomar | null => {
      const c = arranque?.controles.find((x) => x.code === code);
      if (!c) return null;
      const alias = arranque?.ajustes.find((a) => a.controlCode === code)?.alias;
      return {
        code: c.code,
        nombre: alias ?? c.name,
        unidad: c.unit ?? null,
        min: c.inputMin ?? null,
        max: c.inputMax ?? null,
        planItemId: ocurrencia?.planItemId ?? null,
        occurrenceAt: ocurrencia?.at ?? null,
      };
    },
    [arranque],
  );

  const fotos = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const o of arranque?.ocupantes ?? []) m[o.clientId] = o.tieneFoto;
    return m;
  }, [arranque]);

  // ── El PIN ──────────────────────────────────────────────────────────
  const entrarConPin = useCallback(
    async (pin: string, assignmentId?: string) => {
      tocar();
      setComprobando(true);
      setErrorDelPin(null);
      try {
        const res = await apiWithDevice<{
          necesitaElegirRol?: boolean;
          nombre?: string;
          roles?: RolParaElegir[];
          token?: string;
          inactividadSegundos?: number;
          usuario?: { id: string; nombre: string };
          rol?: { assignmentId: string; code: string; name: string };
        }>("/residencia/puerta/pin", {
          method: "POST",
          body: assignmentId
            ? { pin, careRoleAssignmentId: assignmentId }
            : { pin },
        });
        if (res.necesitaElegirRol) {
          setEligiendoRol({
            nombre: res.nombre ?? "",
            roles: res.roles ?? [],
            pin,
          });
          return;
        }
        const s: SesionDePuerta = {
          token: res.token!,
          // El TTL del token lo decide el servidor; aquí se guarda el
          // instante para que la cola sepa si sigue sirviendo sin tener
          // que decodificar un JWT en la tablet.
          expiraEn: Date.now() + 12 * 3600_000,
          userId: res.usuario!.id,
          nombre: res.usuario!.nombre,
          careRoleAssignmentId: res.rol!.assignmentId,
          rolCode: res.rol!.code,
          rolName: res.rol!.name,
        };
        guardarSesion(s);
        setSesion(s);
        setEligiendoRol(null);
        await abrirLoQueToca(s);
      } catch (err) {
        // ── SIN RED: el roster cacheado ────────────────────────────────
        //
        // Sólo cuando el fallo es de RED. Un 401 del servidor es un PIN
        // malo y resolverlo en local sería dejar entrar a quien el
        // servidor acaba de rechazar.
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
          setErrorDelPin(err.message);
          return;
        }
        if (!arranque) {
          setErrorDelPin(
            "Esta tablet no ha podido hablar con el servidor y no tiene nada guardado. Avisa a dirección.",
          );
          return;
        }
        const quien = await quienTeclea(pin, arranque);
        if (!quien || quien.roles.length === 0) {
          setErrorDelPin("Ese PIN no es correcto.");
          return;
        }
        // residencia-6 (D-68) · **y sin red tampoco entra el PIN que se
        // quedó corto.** El servidor manda el booleano ya calculado, así
        // que la tablet llega a la misma conclusión sin volver a escribir
        // la regla. Con red lo contesta la ruta (403 `PIN_POR_RENOVAR`) y
        // la frase es la misma: una sola, en las tres pantallas.
        if (quien.porRenovar) {
          setErrorDelPin(FRASE_PIN_POR_RENOVAR);
          return;
        }
        if (quien.roles.length > 1 && !assignmentId) {
          setEligiendoRol({
            nombre: quien.nombre,
            roles: quien.roles,
            pin,
          });
          return;
        }
        const rol =
          quien.roles.find((r) => r.assignmentId === assignmentId) ??
          quien.roles[0]!;
        // **Sin token**: no hay servidor que lo emita. La sesión local
        // deja registrar (que es lo que no se puede perder) y la cola
        // esperará a tener token — el primer PIN con red lo consigue, y
        // entonces sube todo con su `recordedAt` original.
        const s: SesionDePuerta = {
          token: leerSesion()?.token ?? "",
          expiraEn: leerSesion()?.expiraEn ?? 0,
          userId: quien.userId,
          nombre: quien.nombre,
          careRoleAssignmentId: rol.assignmentId,
          rolCode: rol.code,
          rolName: rol.name,
        };
        setSesion(s);
        setEligiendoRol(null);
        await abrirLoQueTocaEnLocal(s);
      } finally {
        setComprobando(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [arranque, tocar],
  );

  /** Pide `lo-que-toca` al servidor, y si no puede lo calcula en local. */
  const abrirLoQueToca = useCallback(
    async (s: SesionDePuerta) => {
      try {
        const datos = await apiConPuerta<LoQueToca>(
          "/residencia/puerta/lo-que-toca",
        );
        setToca(datos);
        setVista({ v: "toca" });
      } catch (err) {
        if (err instanceof ApiError && err.code === "HABITACION_FUERA_DE_TU_ZONA") {
          // D-51 · fuera de su zona no ve DATOS. La frase del servidor,
          // tal cual, en la pantalla del PIN.
          setErrorDelPin(err.message);
          setVista({ v: "pin" });
          return;
        }
        await abrirLoQueTocaEnLocal(s);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [arranque],
  );

  /** Lo mismo, con `queToca` en la tablet y la caché. */
  const abrirLoQueTocaEnLocal = useCallback(
    async (_s: SesionDePuerta) => {
      if (!arranque) return;
      const ahora = new Date();
      const turno = turnoDe(ahora, arranque.turnos);
      const careDay = diaDelTurno(ahora, turno);
      const desde = new Date(ahora.getTime() - 12 * 3600_000);
      const hasta = new Date(ahora.getTime() + 12 * 3600_000);
      const ocurrencias = queToca(
        arranque.plan.map((l) => ({
          id: l.id,
          clientId: l.clientId,
          controlCode: l.controlCode,
          frecuencia: {
            kind: l.frecuencia.kind,
            everyNHours: l.frecuencia.everyNHours ?? undefined,
            everyNDays: l.frecuencia.everyNDays ?? undefined,
            weekdays: l.frecuencia.weekdays ?? [],
            monthDay: l.frecuencia.monthDay ?? undefined,
            shiftCodes: l.frecuencia.shiftCodes ?? [],
            momentCodes: l.frecuencia.momentCodes ?? [],
          },
          fromAt: new Date(l.fromAt),
          toAt: l.toAt ? new Date(l.toAt) : null,
        })),
        arranque.ajustes.map((a) => ({
          controlCode: a.controlCode,
          active: a.active,
        })),
        arranque.turnos,
        arranque.momentos,
        desde,
        hasta,
      );
      const alias = new Map(
        arranque.ajustes.map((a) => [a.controlCode, a.alias]),
      );
      const nombreDe = (code: string) =>
        alias.get(code) ??
        arranque.controles.find((c) => c.code === code)?.name ??
        code;
      // ── residencia-6 · LO QUE ESTA TABLET YA APUNTÓ ───────────────
      //
      // residencia-3 §15.3: sin red la lista salía ENTERA por hacer,
      // porque la tablet no sabía nada. La mitad que sí sabe es lo
      // propio: lo que se registró aquí, aunque no haya subido.
      //
      // Dos días del centro —hoy y ayer— porque la noche cruza
      // medianoche y es lo que esta pantalla puede llegar a pintar.
      const dias = Array.from({ length: DIAS_EN_LA_TABLET }, (_, i) =>
        addDays(careDay, -i),
      );
      const apuntado = await loApuntadoEnLaTablet(dias);

      const comoOcurrencia = (o: Ocurrencia): OcurrenciaDeLaPuerta => ({
        controlCode: o.controlCode,
        nombre: nombreDe(o.controlCode),
        planItemId: o.planItemId,
        at: o.at.toISOString(),
        until: o.until?.toISOString() ?? null,
        esFranja: o.esFranja,
        shiftCode: o.shiftCode,
        momentCode: o.momentCode,
      });
      setToca({
        habitacionLibre: arranque.ocupantes.length === 0,
        turno: turno
          ? { id: turno.id, code: turno.code, name: turno.name }
          : null,
        careDay,
        residentes: arranque.ocupantes.map((o) => ({
          clientId: o.clientId,
          bedLabel: o.bedLabel,
          nombre: o.nombre,
          tieneFoto: o.tieneFoto,
          toca: ocurrencias
            .filter(
              (oc) =>
                oc.clientId === o.clientId &&
                (turno == null || oc.shiftCode === turno.code),
            )
            .map(comoOcurrencia),
          // residencia-6 · **lo que ESTA tablet apuntó**, con su marca.
          // Lo registrado desde OTRA tablet sin red sigue sin poderse
          // saber —y la pantalla lo dice, ver `PuertaLoQueToca`— pero lo
          // suyo ya no se le olvida.
          //
          // El servidor sigue siendo idempotente por ocurrencia, así que
          // volver a marcar algo entra como corrección y no como un
          // cuidado de más: lo que esto quita no es un riesgo, es un
          // viaje de más por el pasillo.
          registros: apuntado.filter((r) => r.clientId === o.clientId),
        })),
        controles: arranque.controles.map((c) => ({
          code: c.code,
          nombre: nombreDe(c.code),
          layer: c.layer,
          nature: c.nature,
          valueDomain: c.valueDomain,
          unit: c.unit ?? null,
          inputMin: c.inputMin ?? null,
          inputMax: c.inputMax ?? null,
          opciones: c.opciones.map((o) => ({
            code: o.code,
            isAsUsual: o.isAsUsual,
          })),
        })),
        serverTime: ahora.toISOString(),
      });
      setVista({ v: "toca" });
    },
    [arranque],
  );

  // ── El contexto de un gesto, con el reloj de la tablet ──────────────
  const contextoDe = useCallback(
    (clientId: string): ContextoDelGesto => {
      const ahora = new Date();
      const turno = turnoDeLaTablet(ahora, arranque?.turnos ?? me.turnos);
      return {
        clientId,
        recordedAt: ahora,
        centerShiftId: turno?.id ?? null,
        careDay: diaDelTurnoEnLaTablet(ahora, turno ?? null),
      };
    },
    [arranque, me.turnos],
  );

  /**
   * Encola un gesto y pasa a la pantalla 6.
   *
   * **A LA COLA ANTES DEL POST**, igual que una venta desde v1.5: la
   * pantalla de «Apuntado» depende de que esté escrito en la tablet, no de
   * que el servidor haya contestado. Un `flushOutbox` después lo intenta
   * ya, y si no hay red el reenvío periódico se encarga.
   */
  const encolar = useCallback(
    async (
      registros: RegistroParaEnviar[],
      textos: string[],
      /** residencia-4 · el nivel que la TABLET prevé para este gesto, con
       *  la plantilla de su caché. Decide si la pantalla 6 pinta la banda
       *  ámbar del «el aviso NO ha salido» mientras el lote espera. */
      nivelPrevisto: NivelDeLaPuerta | null = null,
    ) => {
      if (registros.length === 0) return;
      const externalId = newId();
      envioEnCurso.current = externalId;
      setAviso(nivelPrevisto ? { nivelPrevisto, servidor: null } : null);
      await outboxAdd({
        externalId,
        kind: "care-record",
        path: "/residencia/puerta/registros",
        body: { registros } as unknown as Record<string, unknown>,
        auth: "puerta",
        label: textos.join(", "),
        // `total` es del cobro y aquí no significa nada; va a 0 para no
        // inventarle un número que el chip de pendientes pintaría como
        // euros.
        total: 0,
      });

      // ── residencia-6 · Y SE APUNTA EN LA TABLET ──────────────────
      //
      // **Después de la cola**, no antes: la cola es lo que no se puede
      // perder (residencia-3 §7). Esto es para que SE VEA — que «lo que
      // toca» sin red no vuelva a salir entero por hacer cuando la
      // auxiliar sale y vuelve a entrar con su PIN.
      //
      // Se escribe aunque haya red: la red puede irse entre este gesto y
      // el siguiente, y entonces lo de hace un minuto tiene que seguir
      // constando.
      //
      // Lo que se guarda es lo que la pantalla necesita para pintar «ya
      // hecho»: la ocurrencia, la hora y quién firmó. Nada que no esté ya
      // en la cola de esta misma tablet.
      const quien = sesion;
      await apuntarEnLaTablet(
        registros.map(
          (r): RegistroEnLaTablet => ({
            id: r.id,
            controlCode: r.controlCode,
            clientId: r.clientId,
            valor: r.valor,
            nota: r.nota ?? null,
            tieneVoz: r.voz != null,
            recordedAt: r.recordedAt,
            careDay: r.careDay,
            occurrenceAt: r.occurrenceAt ?? null,
            shiftCode: null,
            sinTurno: r.centerShiftId == null,
            firmadoPor: quien?.nombre ?? "",
            firmadoPorUserId: quien?.userId ?? "",
            rolCode: quien?.rolCode ?? "",
            anulado: false,
            corrigeA: null,
            // `vigente` porque es el valor de ahora de su ocurrencia: lo
            // que lo dejaría de ser es una corrección posterior, y ésa
            // llega por aquí y sobrescribe esta misma fila por su `id`.
            vigente: true,
            enLaTablet: true,
          }),
        ),
      );

      setApuntadas(
        registros.map((r, i) => ({
          id: r.id,
          texto: textos[i] ?? textos[0] ?? "Registro",
          enLaTablet: true,
        })),
      );
      setUltimoId(registros[registros.length - 1]!.id);
      setVista({ v: "apuntado" });
      void flushOutbox();
    },
    [sesion],
  );

  if (!arranque) {
    // Sin arranque todavía: la pantalla de residencia-1, que ya pinta lo
    // que hay en `/puerta/me`. Nunca un spinner: una tablet de pared en
    // blanco parece estropeada.
    return <PuertaScreen me={me} onRefresh={onRefresh} pendientes={pendientes} />;
  }

  const residenteDe = (clientId: string) =>
    toca?.residentes.find((r) => r.clientId === clientId);

  if (vista.v === "reposo") {
    return (
      <PuertaScreen
        me={me}
        onRefresh={onRefresh}
        pendientes={pendientes}
        fotos={fotos}
        onRegistrar={() => {
          tocar();
          setErrorDelPin(null);
          setEligiendoRol(null);
          setVista({ v: "pin" });
        }}
      />
    );
  }

  if (vista.v === "pin") {
    return (
      <PuertaPin
        numeroDeHabitacion={arranque.habitacion.number}
        nombreDelTurno={
          turnoDeLaTablet(new Date(), arranque.turnos)?.name ?? null
        }
        comprobando={comprobando}
        error={errorDelPin}
        eligiendoRol={eligiendoRol}
        onPin={(pin) => void entrarConPin(pin)}
        onRol={(assignmentId) =>
          void entrarConPin(eligiendoRol?.pin ?? "", assignmentId)
        }
        onVolver={() => setVista({ v: "reposo" })}
      />
    );
  }

  if (vista.v === "toca" && toca && sesion) {
    const aDemandaPorResidente: Record<
      string,
      Array<{ code: string; nombre: string }>
    > = {};
    for (const r of toca.residentes) {
      const suyos = arranque.plan
        .filter(
          (l) =>
            l.clientId === r.clientId &&
            l.toAt == null &&
            l.frecuencia.kind === "ON_DEMAND",
        )
        .map((l) => ({
          code: l.controlCode,
          nombre:
            toca.controles.find((c) => c.code === l.controlCode)?.nombre ??
            l.controlCode,
        }));
      aDemandaPorResidente[r.clientId] = suyos;
    }
    return (
      <div onPointerDown={tocar}>
        <PuertaLoQueToca
          numeroDeHabitacion={arranque.habitacion.number}
          quien={{ nombre: sesion.nombre, rolName: sesion.rolName }}
          datos={toca}
          segundosParaCerrar={segundosParaCerrar}
          dimensiones={dimensiones}
          aDemandaPorResidente={aDemandaPorResidente}
          onComoSiempre={(clientId) => {
            const ctx = contextoDe(clientId);
            void encolar(
              comoSiempre(ctx, dimensiones),
              dimensiones.map(() => "Como siempre"),
            );
          }}
          onNoComoSiempre={(clientId) =>
            setVista({ v: "no-como-siempre", clientId })
          }
          onHecho={(clientId, o, opcion) => {
            const ctx = contextoDe(clientId);
            void encolar(
              [
                registroDeOcurrencia(ctx, {
                  controlCode: o.controlCode,
                  planItemId: o.planItemId,
                  occurrenceAt: o.at,
                  opcion: opcion ?? null,
                }),
              ],
              [o.nombre],
            );
          }}
          onCorregir={(clientId, o) => {
            // Corregir es volver a registrar: la fila nueva apunta a la
            // corregida y lo decide el servidor (`registro.ts`), no la
            // pantalla. Aquí es el mismo gesto que «Hecho».
            const ctx = contextoDe(clientId);
            void encolar(
              [
                registroDeOcurrencia(ctx, {
                  controlCode: o.controlCode,
                  planItemId: o.planItemId,
                  occurrenceAt: o.at,
                }),
              ],
              [`${o.nombre} (corrección)`],
            );
          }}
          constantesDisponibles={constantesDisponibles}
          onTomarConstante={(clientId, controlCode, ocurrencia) => {
            // La TENSIÓN se toma en UNA pantalla, aunque sean dos
            // controles. Lo que las junta es el `groupCode` del
            // catálogo, no una lista escrita a mano aquí.
            const control = arranque.controles.find((c) => c.code === controlCode);
            const codes =
              control?.groupCode != null
                ? arranque.controles
                    .filter((c) => c.groupCode === control.groupCode)
                    .map((c) => c.code)
                : [controlCode];
            setVista({ v: "constante", clientId, codes, ocurrencia });
          }}
          onADemanda={(clientId, controlCode) => {
            const ctx = contextoDe(clientId);
            const nombre =
              toca.controles.find((c) => c.code === controlCode)?.nombre ??
              controlCode;
            void encolar([registroADemanda(ctx, controlCode)], [nombre]);
          }}
          onAlgoNoVaBien={(clientId) => setVista({ v: "algo", clientId })}
          onTerminar={() => {
            setVista({ v: "reposo" });
            setToca(null);
          }}
        />
      </div>
    );
  }

  if (vista.v === "no-como-siempre") {
    const r = residenteDe(vista.clientId);
    return (
      <div onPointerDown={tocar}>
        <PuertaNoComoSiempre
          nombreDelResidente={r?.nombre ?? ""}
          dimensiones={dimensiones}
          onGuardar={(cambiadas) => {
            const ctx = contextoDe(vista.clientId);
            const registros = noComoSiempre(ctx, dimensiones, cambiadas);
            void encolar(
              registros,
              dimensiones.map((d) =>
                cambiadas[d.code] ? `${d.name}: no como siempre` : "Como siempre",
              ),
            );
          }}
          onTambienAlgoNoVaBien={(cambiadas) =>
            setVista({ v: "algo", clientId: vista.clientId, cambiadas })
          }
          onVolver={() => setVista({ v: "toca" })}
        />
      </div>
    );
  }

  if (vista.v === "constante") {
    const r = residenteDe(vista.clientId);
    const constantes = vista.codes
      .map((c) => constanteParaTomar(c, vista.ocurrencia))
      .filter((c): c is ConstanteParaTomar => c != null);
    if (constantes.length === 0) {
      // El control se desactivó mientras la pantalla estaba abierta. Se
      // vuelve en vez de pintar un teclado que no sabe qué apunta.
      setVista({ v: "toca" });
      return null;
    }
    return (
      <div onPointerDown={tocar}>
        <PuertaConstante
          nombreDelResidente={r?.nombre ?? ""}
          constantes={constantes}
          plantilla={arranque.plantilla ?? null}
          onVolver={() => setVista({ v: "toca" })}
          onApuntar={(valores, avisarEnfermera) => {
            const ctx = contextoDe(vista.clientId);
            // Dos registros para la tensión, y es lo correcto: «sistólica
            // ≥ 180 → N2» es una regla sobre UN número.
            const registros = valores.map((v) =>
              registroDeConstante(ctx, {
                controlCode: v.constante.code,
                numero: v.numero,
                planItemId: v.constante.planItemId ?? null,
                occurrenceAt: v.constante.occurrenceAt ?? null,
                avisarEnfermera,
              }),
            );
            const textos = valores.map(
              (v) =>
                `${v.constante.nombre}: ${String(v.numero).replace(".", ",")}${
                  v.constante.unidad ? ` ${v.constante.unidad}` : ""
                }`,
            );
            // El nivel que la tablet prevé, con la MISMA función que el
            // servidor y con la plantilla de su caché.
            let previsto: NivelDeLaPuerta | null = null;
            const orden = ["N0", "N1", "N2", "N3", "N4"];
            for (const v of valores) {
              const g = gravedadDe(v.constante.code, v.numero, reglas);
              if (!g) continue;
              if (previsto == null || orden.indexOf(g.nivel) > orden.indexOf(previsto)) {
                previsto = g.nivel;
              }
            }
            if (avisarEnfermera) {
              previsto =
                previsto == null || orden.indexOf(previsto) < orden.indexOf("N2")
                  ? "N2"
                  : previsto;
            }
            void encolar(registros, textos, previsto);
          }}
        />
      </div>
    );
  }

  if (vista.v === "algo") {
    const r = residenteDe(vista.clientId);
    return (
      <div onPointerDown={tocar}>
        <PuertaAlgoNoVaBien
          nombreDelResidente={r?.nombre ?? ""}
          onApuntar={({ texto, vozBase64, evento, matiz, avisarEnfermera }) => {
            const ctx = contextoDe(vista.clientId);
            // Si se llegó desde la pantalla 4, las dos cosas salen en EL
            // MISMO lote: fue un gesto y es una firma, y partirlo en dos
            // peticiones dejaría media observación apuntada si la primera
            // entra y la segunda no.
            const registros = [
              ...(vista.cambiadas
                ? noComoSiempre(ctx, dimensiones, vista.cambiadas)
                : []),
              algoNoVaBien(ctx, {
                texto,
                vozBase64,
                evento,
                matiz,
                avisarEnfermera,
              }),
            ];
            const textos = [
              ...(vista.cambiadas
                ? dimensiones.map((d) =>
                    vista.cambiadas![d.code]
                      ? `${d.name}: no como siempre`
                      : "Como siempre",
                  )
                : []),
              etiquetaDelTipo(evento),
            ];
            // El nivel que la tablet prevé para el evento, con la misma
            // función que el servidor.
            const g = reglas.length
              ? gravedadDeEventoLocal(reglas, evento, matiz)
              : null;
            const orden = ["N0", "N1", "N2", "N3", "N4"];
            let previsto: NivelDeLaPuerta | null = g?.nivel ?? null;
            if (avisarEnfermera) {
              previsto =
                previsto == null || orden.indexOf(previsto) < orden.indexOf("N2")
                  ? "N2"
                  : previsto;
            }
            void encolar(registros, textos, previsto);
          }}
          onVolver={() =>
            setVista(
              vista.cambiadas
                ? { v: "no-como-siempre", clientId: vista.clientId }
                : { v: "toca" },
            )
          }
        />
      </div>
    );
  }

  // Pantalla 6.
  const ahora = new Date();
  return (
    <PuertaApuntado
      numeroDeHabitacion={arranque.habitacion.number}
      firmadoPor={sesion?.nombre ?? ""}
      hora={ahora.toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
      })}
      nombreDelTurno={turnoDeLaTablet(ahora, arranque.turnos)?.name ?? null}
      // «Hay red» para ESTA pantalla es «lo que acabo de apuntar ha
      // salido», no «la cola está vacía»: con un lote viejo atascado de
      // otro turno, la segunda mitad diría que no hay red cuando lo
      // suyo acaba de entrar. Lo que la auxiliar necesita saber es si LO
      // SUYO salió — que es lo que la cabecera de `PuertaApuntado` pide
      // desde residencia-3.
      hayRed={hayRed && apuntadas.every((l) => !l.enLaTablet)}
      lineas={apuntadas}
      onDeshacer={
        ultimoId
          ? () => {
              void (async () => {
                try {
                  await apiConPuerta(
                    `/residencia/puerta/registros/${ultimoId}/anular`,
                    { method: "POST" },
                  );
                  // residencia-6 · y se borra lo apuntado en la tablet:
                  // el servidor lo anuló, así que ya no es verdad. Sin
                  // esto, perder el wifi justo después dejaría «lo que
                  // toca» diciendo que aquello sigue hecho.
                  await olvidarApuntado(ultimoId);
                  setApuntadas((ls) => ls.filter((l) => l.id !== ultimoId));
                  setUltimoId(null);
                } catch (err) {
                  // No se puede deshacer sin red: la fila todavía no
                  // existe en el servidor, así que no hay nada que anular.
                  // Se dice en vez de callarse, porque si no la auxiliar
                  // se queda creyendo que lo deshizo.
                  setApuntadas((ls) =>
                    ls.map((l) =>
                      l.id === ultimoId
                        ? {
                            ...l,
                            rechazo:
                              err instanceof ApiError
                                ? err.message
                                : "todavía no ha llegado al servidor: no se puede deshacer hasta que vuelva la red",
                          }
                        : l,
                    ),
                  );
                }
              })();
            }
          : null
      }
      aviso={aviso}
      onSeguir={() => {
        tocar();
        setAviso(null);
        if (sesion) void abrirLoQueToca(sesion);
        else setVista({ v: "reposo" });
      }}
    />
  );
}

/** Lo que se lee en la lista de la pantalla 6 por el tipo elegido. */
function etiquetaDelTipo(evento: string | null): string {
  if (!evento) return "Algo no va bien";
  return (
    TIPOS_DE_ALGO_NO_VA_BIEN.find((t) => t.evento === evento)?.etiqueta ??
    "Algo no va bien"
  );
}

/**
 * El nivel de un EVENTO con las reglas de la tablet.
 *
 * `gravedadDeEvento` del paquete puro hace exactamente esto; se repite
 * aquí la llamada en vez de importarla porque lo único que esta pantalla
 * necesita es el nivel, y el `null` de «esta plantilla no conoce ese
 * evento» tiene que caer a N1 —que es lo que vale «algo no va bien» a
 * secas— y no a «sin nivel».
 */
function gravedadDeEventoLocal(
  reglas: ReglaDeGravedad[],
  evento: string | null,
  matiz: string | null,
): { nivel: NivelDeLaPuerta } | null {
  const buscado = evento ?? "ALGO_NO_VA_BIEN";
  const suyas = reglas.filter(
    (r) => r.kind === "EVENT" && r.evento === buscado,
  ) as Array<Extract<ReglaDeGravedad, { kind: "EVENT" }>>;
  if (suyas.length === 0) return null;
  const conMatiz = matiz ? suyas.filter((r) => r.matiz === matiz) : [];
  const candidatas = conMatiz.length > 0 ? conMatiz : suyas.filter((r) => r.matiz == null);
  const lista = candidatas.length > 0 ? candidatas : suyas;
  const orden = ["N0", "N1", "N2", "N3", "N4"];
  return lista.reduce<{ nivel: NivelDeLaPuerta }>(
    (mejor, r) =>
      orden.indexOf(r.nivel) > orden.indexOf(mejor.nivel) ? { nivel: r.nivel } : mejor,
    { nivel: lista[0]!.nivel },
  );
}

export { ALGO_NO_VA_BIEN };
