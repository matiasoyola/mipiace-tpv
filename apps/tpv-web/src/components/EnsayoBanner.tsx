// puesta-en-marcha (ADR-021) · la banda del ENSAYO.
//
// Mientras la cuenta no ha arrancado, el TPV funciona entero —mesas,
// comanda, cobro, devolución, arqueo, cierre— y nada de lo que cobra es una
// factura. Eso TIENE que verse, y verse siempre: la banda, el papel y el
// panel del propietario son las tres cosas que impiden que alguien crea que
// ha facturado.
//
// ── Por qué es una banda en el flujo y no un aviso flotante ────────────
//
// Porque un aviso flotante se cierra, se tapa con el teclado numérico o
// queda detrás de un modal, y entonces desaparece justo cuando hace falta
// —al cobrar—. La banda ocupa su sitio arriba, igual que la del modo prueba
// (`TestModeBanner`, B-OnboardingV2), que es el patrón que ya está en
// producción en esta misma pantalla.
//
// ── Por qué no se puede cerrar ────────────────────────────────────────
//
// La del modo prueba lleva un botón «Salir» porque de aquel modo SE SALE
// (es una sesión del super-admin con caducidad). Del ensayo no se sale desde
// el terminal: se sale pulsando «Empezar a facturar» en la consola, con el
// cliente delante. Un botón aquí sería un botón que no hace nada, o peor:
// uno que parece hacerlo.
//
// El TPV no decide nada con esto. Quien no emite es el servidor, en cada
// cobro (`comprobarGateFiscal`). Esta banda es lo que lo CUENTA.

import { FlaskConical } from "lucide-react";

export function EnsayoBanner() {
  return (
    <div
      className="w-full bg-sky-100 border-b border-sky-300 text-sky-950 px-4 py-2.5 flex items-center gap-3 text-[13px]"
      role="status"
      data-testid="ensayo-banner"
    >
      <FlaskConical className="w-4 h-4 shrink-0" aria-hidden />
      <div className="flex-1 min-w-0">
        <strong>ENSAYO</strong> · estos cobros no son facturas
      </div>
    </div>
  );
}
