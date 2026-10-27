// personal-1 · `packages/cuadrante`.
//
// El paquete PURO del cuadrante y de la ficha de personal. Sin base de
// datos, sin reloj y sin Fastify, para que lo puedan ejecutar los tres
// sitios que lo necesitan:
//
//   · **la pantalla del cuadrante**, para pintar los avisos al momento
//     mientras alguien pinta celdas a toques — 21 × 31 celdas y un viaje
//     al servidor por toque es una pantalla que se arrastra;
//   · **el servidor**, al leer el cuadrante y al publicarlo (que es cuando
//     deja apuntado cuántos avisos tenía y cuáles);
//   · **personal-2**, que generará el cuadrante con IA y usará
//     `comprobarCuadrante` para validar lo que genere. Un generador sin
//     validador es un generador que inventa cuadrantes ilegales con buena
//     cara.
//
// Lo que vive aquí y por qué:
//
//   · `tipos.ts`            — el vocabulario: turno, persona, celda,
//     ausencia, aviso, reglas. Ni un id de Prisma ni un `Decimal`.
//   · `intervalos.ts`       — de una celda a un tramo de tiempo DE VERDAD.
//     Es el único fichero que sabe que la noche cruza medianoche y que el
//     24 de octubre dura una hora más.
//   · `reglas.ts`           — **`comprobarCuadrante`**, la pieza central
//     del bloque: las ocho reglas, su resumen, y la comprobación de la
//     configuración de los turnos del centro.
//   · `datos-que-faltan.ts` — qué le falta a una ficha de personal, con el
//     patrón de `datosQueFaltan` del residente (alta-minima), y cuándo se
//     avisa de que a un temporal se le acaba el contrato.
//   · `importar.ts`         — el CSV: leerlo, casarlo por nombre
//     normalizado contra las fichas que ya existen y decir fila a fila qué
//     va a pasar. Puro para que la vista previa y la idempotencia del
//     servidor decidan lo mismo.
//   · `fichado.ts`          — planificado frente a fichado, y el límite de
//     la salida olvidada cuando hay turno planificado (que `esSalidaOlvidada`
//     usa, y que sigue siendo el único sitio que DECIDE).
//   · `categorias.ts`       — las categorías profesionales de serie, que
//     dependen de los módulos encendidos.
//
// Y lo que **no** vive aquí: el convenio colectivo. Sus límites entrarán
// como parámetros cuando Matías los confirme (decisión 7).

export {
  AUSENCIAS,
  AUSENCIAS_QUE_NO_SUMAN_HORAS,
  ETIQUETA_DE_AUSENCIA,
  REGLAS_DE_SERIE,
  type Ausencia,
  type AvisoDelCuadrante,
  type CeldaDelCuadrante,
  type Cuadrante,
  type GravedadDeAviso,
  type IntervaloPlanificado,
  type PersonaDelCuadrante,
  type ReglaDelCuadrante,
  type ReglasDelCuadrante,
  type TurnoDelCuadrante,
} from "./tipos.js";

export {
  CUADRANTE_TZ,
  bloquesDe,
  cifra,
  diasDe,
  diasDelMes,
  horas,
  horasDeMinutos,
  intervaloDeTurno,
  intervalosDe,
  minutosDeTurno,
  olvidarInstantes,
  porPersona,
  rangoDelMes,
  sePisan,
  type BloqueDeDias,
} from "./intervalos.js";

export {
  comprobarCuadrante,
  comprobarTurnosDelTenant,
  resumenDeAvisos,
  type AvisoDeTurnos,
  type ProblemaDeTurnos,
  type ResumenDeAvisos,
} from "./reglas.js";

export {
  DIAS_DE_AVISO_DE_FIN,
  datosQueFaltanDePersonal,
  diasHastaElFin,
  elContratoSeAcaba,
  estadoDeLaFichaDePersonal,
  resumenDeFichasDePersonal,
  type CampoDeFichaDePersonal,
  type DatoQueFaltaDePersonal,
  type EstadoDeLaFichaDePersonal,
  type FichaDePersonalParaCompletar,
  type PesoDelDatoDePersonal,
  type ResumenDeFichasDePersonal,
} from "./datos-que-faltan.js";

export {
  COLUMNAS_DE_PERSONAL,
  CsvDePersonalInvalido,
  MAX_FILAS_CSV,
  claveDeFicha,
  claveDeFila,
  contratoDeCsv,
  fechaDeCsv,
  jornadaDeCsv,
  leerCsvDePersonal,
  planDeImportacion,
  planParaLaPantalla,
  type AccionDeImportacion,
  type CambioDeCampo,
  type CategoriaConocida,
  type ColumnaDePersonal,
  type CsvDePersonal,
  type ErrorDeFila,
  type FichaExistente,
  type FilaDePersonal,
  type PlanDeImportacion,
  type QueHacerConLaFila,
} from "./importar.js";

export {
  MARGEN_DE_TURNO_POR_DEFECTO,
  cuadreDelMes,
  finDelTurnoDelDia,
  limiteDeSalidaOlvidada,
  planificadoDelDia,
  planificadoVsFichado,
  type CuadreDelMes,
  type DentroPasadaSuHora,
  type EntradaParaElLimite,
  type FichadoSinTurno,
  type PlanificadoVsFichadoDeHoy,
  type SinFichar,
  type TramoFichado,
} from "./fichado.js";

export {
  CATEGORIAS_DE_RESIDENCIA,
  CATEGORIAS_SIN_CUIDADOS,
  categoriasDeSerie,
  type CategoriaDeSerie,
} from "./categorias.js";
