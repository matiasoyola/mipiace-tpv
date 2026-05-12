import argon2 from "argon2";

// Parametrización conservadora de argon2id, suficiente para un VPS
// modesto. Tiempo objetivo ~250 ms por hash en hardware típico.
const OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024, // 64 MB
  timeCost: 3,
  parallelism: 1,
};

export function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, OPTIONS);
}

export function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  return argon2.verify(hash, plaintext, OPTIONS);
}
