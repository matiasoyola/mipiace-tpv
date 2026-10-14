// clinica-7 · siembra el banco SIN el paso de docker: Postgres y Redis ya
// están arriba en este Mac (el `docker compose` del script no encuentra el
// socket del contexto de este usuario, y los contenedores sí responden).
import { PrismaClient } from "@mipiacetpv/db";
import { sembrar } from "./seed/peluqueria-demo.js";
import { sembrarClinica } from "./seed/clinica-demo.js";

const url = process.env.DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });
try {
  await sembrar(prisma);
  console.log("· peluquería sembrada");
  await sembrarClinica(prisma);
  console.log("· clínica sembrada");
} finally {
  await prisma.$disconnect();
}
