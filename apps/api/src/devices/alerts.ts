import geoip from "geoip-lite";

import { getPrisma } from "../context.js";
import { getEmailSender, type EmailSender } from "../email/sender.js";
import { loadEnv } from "../env.js";

// Alertas proactivas al propietario (§17.4). Tres disparadores:
//   1. Primer login del device (lastEmailAlertAt es null).
//   2. Cambio de país respecto al last_known_ip_country.
//   3. Re-aparición tras N días sin email (default 30 días).
//
// El tenant puede desactivar el envío vía
// `tenant.deviceNewLoginAlertEnabled = false`.

const REAPPEAR_THRESHOLD_DAYS = 30;

interface MaybeAlertInput {
  deviceId: string;
  ip: string | null;
  now?: Date;
}

export async function evaluateDeviceAlert(
  input: MaybeAlertInput,
  emailSender: EmailSender = getEmailSender(),
): Promise<{ alertSent: boolean; reason?: string }> {
  const prisma = getPrisma();
  const now = input.now ?? new Date();
  const device = await prisma.device.findUnique({
    where: { id: input.deviceId },
    select: {
      id: true,
      name: true,
      tenantId: true,
      registerId: true,
      lastKnownIpCountry: true,
      lastEmailAlertAt: true,
      register: { select: { name: true, store: { select: { name: true } } } },
      tenant: {
        select: {
          id: true,
          deviceNewLoginAlertEnabled: true,
          users: {
            where: { role: "OWNER" },
            select: { email: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!device) return { alertSent: false };
  if (!device.tenant.deviceNewLoginAlertEnabled) {
    return { alertSent: false, reason: "tenant_disabled" };
  }

  const country = input.ip ? lookupCountry(input.ip) : null;
  const shouldAlert =
    device.lastEmailAlertAt == null ||
    (country != null && country !== device.lastKnownIpCountry) ||
    (device.lastEmailAlertAt != null &&
      now.getTime() - device.lastEmailAlertAt.getTime() >
        REAPPEAR_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);

  if (!shouldAlert) {
    // Aún así actualizamos el country si vino y era null antes (primera
    // ip resoluble).
    if (country && country !== device.lastKnownIpCountry) {
      await prisma.device.update({
        where: { id: device.id },
        data: { lastKnownIpCountry: country },
      });
    }
    return { alertSent: false, reason: "throttled" };
  }

  const ownerEmail = device.tenant.users[0]?.email;
  if (ownerEmail) {
    const env = loadEnv();
    const deviceLabel = device.name ?? "Sin nombre";
    const registerLabel = device.register?.name ?? "caja desconocida";
    const storeLabel = device.register?.store?.name ?? "tienda";
    const countryLabel = country ?? "país desconocido";
    const subject = `Nuevo acceso desde tu TPV · ${storeLabel} · ${registerLabel}`;
    const text = [
      `Se ha registrado actividad nueva en tu TPV.`,
      ``,
      `Dispositivo: ${deviceLabel}`,
      `Caja: ${registerLabel} (${storeLabel})`,
      `Ubicación aproximada: ${countryLabel}`,
      `Fecha: ${now.toISOString()}`,
      ``,
      `Si has sido tú, ignora este mensaje. Si no te suena, revoca el`,
      `dispositivo desde el panel de administración:`,
      `${env.PUBLIC_ADMIN_URL}/admin/devices`,
      ``,
      `mipiacetpv`,
    ].join("\n");
    await emailSender.send({ to: ownerEmail, subject, text });
  }

  await prisma.device.update({
    where: { id: device.id },
    data: {
      lastEmailAlertAt: now,
      lastKnownIpCountry: country ?? device.lastKnownIpCountry,
    },
  });
  return { alertSent: true };
}

export function lookupCountry(ip: string): string | null {
  // geoip-lite no resuelve IPs locales — devuelve null. En tests
  // mockeamos `evaluateDeviceAlert` o el sender directamente.
  if (ip === "::1" || ip.startsWith("127.") || ip === "localhost") return null;
  const hit = geoip.lookup(ip);
  return hit?.country ?? null;
}
