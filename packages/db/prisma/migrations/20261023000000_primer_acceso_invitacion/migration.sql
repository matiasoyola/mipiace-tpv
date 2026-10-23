-- primer-acceso · el tipo de enlace.
--
-- Decisión 1 del bloque: la invitación del primer acceso es un token como
-- el del reset, de otro tipo. Misma tabla, mismo hash, mismo `used_at`.
--
-- El DEFAULT 'RESET' es lo que hace que esta migración no toque ni una
-- fila existente: todo lo que hay escrito es de reset, y lo seguirá
-- diciendo sin un UPDATE sobre una tabla que en producción tiene tokens
-- vivos (un UPDATE masivo con un token en vuelo lo habría dejado igual,
-- pero el `ALTER` que no reescribe nada es el que no puede fallar).

CREATE TYPE "PasswordResetTokenType" AS ENUM ('RESET', 'INVITE');

ALTER TABLE "password_reset_tokens"
  ADD COLUMN "type" "PasswordResetTokenType" NOT NULL DEFAULT 'RESET';

-- El camino de aceptar una invitación busca «los INVITE vivos»: sin el
-- índice recorre también los resets de todas las cuentas de la casa, y
-- hace un argon2.verify por cada uno.
CREATE INDEX "password_reset_tokens_type_used_at_idx"
  ON "password_reset_tokens" ("type", "used_at");
