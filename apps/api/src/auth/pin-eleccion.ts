// pin-1 · EL TOKEN DE «TIENES QUE ELEGIR TU PIN ANTES DE ENTRAR».
//
// Mismo patrón, misma forma y mismo motivo que `must-change-password.ts`:
// cuando el login del TPV acierta pero el PIN es PROVISIONAL, no se emite
// sesión de cajero. Se devuelve este JWT, que no vale para nada más que
// para `POST /shift/cashier-pin` — la pantalla donde esa persona elige el
// suyo.
//
// Por qué un token y no «te dejo entrar y luego te lo pido»: porque un
// PIN provisional no abre nada (punto 3 del bloque). Si el login emitiera
// la sesión y la pantalla pidiera el PIN después, la sesión ya estaría
// emitida — y con la consola del navegador abierta se llega a la venta
// igual. La negativa tiene que estar en la emisión.
//
// TTL 10 minutos: es el rato de teclear dos veces cuatro cifras con la
// cola delante. Si caduca, se vuelve a teclear el PIN provisional en la
// pantalla del PIN y sale otro — no hay nada que recuperar.
//
// Lleva `did` (el device) a propósito: el token nace en un terminal
// concreto y se gasta en ese mismo terminal, igual que la sesión de
// cajero. No es una frontera de seguridad grande —quien tiene el token
// tiene el PIN provisional— pero evita que un token copiado de un sitio
// sirva en otro.

import jwt from "jsonwebtoken";

import { loadEnv } from "../env.js";

export interface PinEleccionPayload {
  sub: string; // userId
  tid: string; // tenantId
  did: string; // deviceId desde el que se está entrando
  purpose: "pin-eleccion";
}

const PIN_ELECCION_TTL = "10m";

export function signPinEleccionToken(
  payload: Omit<PinEleccionPayload, "purpose">,
): string {
  const env = loadEnv();
  return jwt.sign({ ...payload, purpose: "pin-eleccion" }, env.JWT_ACCESS_SECRET, {
    expiresIn: PIN_ELECCION_TTL as jwt.SignOptions["expiresIn"],
  });
}

export function verifyPinEleccionToken(token: string): PinEleccionPayload {
  const env = loadEnv();
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as PinEleccionPayload;
  // La comprobación que hace que esto NO sea un access token ni una
  // sesión de cajero: los tres se firman con el mismo secreto y lo único
  // que los distingue es este campo.
  if (payload.purpose !== "pin-eleccion") {
    throw new Error("not a pin-eleccion token");
  }
  return payload;
}
