// Singletons compartidos entre el server HTTP y los workers BullMQ.

import { PrismaClient } from "@mipiacetpv/db";
import { Redis } from "ioredis";

import { loadEnv } from "./env.js";

let _prisma: PrismaClient | null = null;
export function getPrisma(): PrismaClient {
  if (!_prisma) _prisma = new PrismaClient();
  return _prisma;
}

let _redis: Redis | null = null;
export function getRedis(): Redis {
  if (!_redis) {
    const env = loadEnv();
    _redis = new Redis(env.REDIS_URL, {
      // BullMQ exige maxRetriesPerRequest=null para reconexiones limpias.
      maxRetriesPerRequest: null,
    });
  }
  return _redis;
}

export async function shutdown(): Promise<void> {
  if (_prisma) {
    await _prisma.$disconnect();
    _prisma = null;
  }
  if (_redis) {
    _redis.disconnect();
    _redis = null;
  }
}
