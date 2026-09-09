import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
export * from "@prisma/client";
// S1-sello · la lista canónica de columnas económicas (ver el módulo).
export * from "./sealed-fields.js";
