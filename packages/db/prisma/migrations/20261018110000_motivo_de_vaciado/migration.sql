-- auditoria-sirope (#18) · por qué se vació una mesa con consumo.
--
-- El 18-10 se vaciaron cinco mesas con consumo en Cafetería Sirope y no
-- quedó nada: ni motivo, ni importe en el informe Z, ni una línea que
-- mirar al día siguiente. Vaciar una mesa con platos dentro es comida
-- que salió de la cocina y no se cobró, y hay tres formas muy distintas
-- de que eso pase —una invitación, un error de comanda, alguien que se
-- fue sin pagar—, que se gestionan de tres maneras distintas.
--
-- `void_reason` ya existía y dice por qué CAMINO se anuló (el TPV, el
-- barrido de las 05:00, el panel con PIN). Esto dice qué pasó en la
-- sala, que es la pregunta que el dueño puede usar.
--
-- NULL en todo lo que ya existe, y así se queda: una mesa vacía se
-- libera sin motivo, el barrido no tiene nada que contar y un ticket
-- que no está VOIDED no se vació.
--
-- ── down ──────────────────────────────────────────────────────────────
--
--   ALTER TABLE "tickets" DROP COLUMN "void_motivo";
--   DROP TYPE "MotivoVaciado";
--
-- Se pierde el motivo de las mesas vaciadas y el informe Z vuelve a no
-- poder desglosarlas (el recuento y el importe los sigue sacando de
-- `void_reason` + los totales, así que ésos no se van). No hay dinero ni
-- registro fiscal detrás: una mesa vaciada no cobró nada.

CREATE TYPE "MotivoVaciado" AS ENUM (
  'INVITACION',
  'ERROR_DE_COMANDA',
  'SE_FUERON_SIN_PAGAR',
  'OTRO'
);

ALTER TABLE "tickets" ADD COLUMN "void_motivo" "MotivoVaciado";
