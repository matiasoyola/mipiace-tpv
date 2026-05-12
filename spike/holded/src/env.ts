// Env schema específico del spike (Fase 0). El package
// @mipiacetpv/holded-client es agnóstico al modo de configuración; cada
// caller monta su zod schema. En producción este shape vive en apps/api.

import { z } from "zod";

export const HoldedEnv = z.object({
  HOLDED_API_KEY: z
    .string()
    .min(1, "Falta HOLDED_API_KEY en spike/holded/.env"),
  HOLDED_BASE_URL: z.string().url().default("https://api.holded.com/api"),
  HOLDED_TEST_NUMSERIE: z.string().default("TPV-SPIKE-01"),
});

export type HoldedEnv = z.infer<typeof HoldedEnv>;
