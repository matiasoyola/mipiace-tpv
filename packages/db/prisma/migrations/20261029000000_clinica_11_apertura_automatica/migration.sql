-- clinica-11 · POR QUÉ SE ABRIÓ ESTE TURNO.
--
-- En una clínica no hay pantalla de «Abrir turno»: la podóloga llega,
-- atiende y cobra, y el turno lo abre el SERVIDOR al primer cobro del día
-- con el fondo que dejó el último cierre. Esta columna es el rastro de esa
-- apertura — el hermano exacto de `close_reason`, que v1.11 añadió cuando
-- el corte de día empezó a cerrar turnos sin que nadie los cerrase.
--
-- ── LO QUE PASA CON LOS TURNOS QUE YA EXISTEN ───────────────────────
--
-- Se quedan en `MANUAL`, que es la verdad: todos los turnos abiertos hasta
-- hoy los abrió una persona declarando un fondo de caja en el TPV. El
-- DEFAULT cubre a la vez las filas viejas y las nuevas de cualquier cuenta
-- que no sea una clínica, así que **ninguna ruta tiene que acordarse de
-- poner esta columna** salvo la apertura automática, que es la única que
-- dice algo distinto.
--
-- NOT NULL con DEFAULT y no nullable: «no se sabe por qué se abrió» no es
-- un estado que necesite existir. Un turno se abre a mano o lo abre el
-- servidor, y las dos cosas se saben en el momento de abrirlo.
--
-- ── POR QUÉ ESTO ES UNA COLUMNA Y NO UNA LÍNEA DE LOG ───────────────
--
-- Porque la pregunta se hace en el CIERRE, meses después: «este descuadre
-- de 40 € en el Z del 12 de marzo, ¿fue que alguien contó mal el cajón o
-- fue que nadie lo contó?». Un log de hace tres meses no está; la fila del
-- turno sí. Es la misma razón por la que `close_reason` es una columna.
--
-- Aditiva y sin reescrituras: un `ALTER TABLE ... ADD COLUMN ... DEFAULT`
-- en Postgres 11+ no reescribe la tabla.

-- CreateEnum
CREATE TYPE "ShiftOpenReason" AS ENUM ('MANUAL', 'AUTO_CLINICA');

-- AlterTable
ALTER TABLE "shifts"
  ADD COLUMN "open_reason" "ShiftOpenReason" NOT NULL DEFAULT 'MANUAL';
