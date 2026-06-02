# Impresoras · Documento maestro

Mipiacetpv imprime tickets de cobro al cliente final y, en hostelería, comanderas separadas por sección (BARRA / COCINA). La impresión es **componente crítico** del flujo de cobro — sin ticket no hay confianza del cliente final y en bares sin comanda no hay servicio.

Este documento es el punto único de entrada para todo lo que tiene que ver con impresión. Cualquier decisión, manual o spec va aquí o en sus subdocumentos.

---

## Índice

1. [Modos de conexión soportados](#modos-de-conexión)
2. [Decisión por vertical](#decisión-por-vertical)
3. [Modelos validados](#modelos-validados)
4. [Guía de despliegue · USB](despliegue-usb.md)
5. [Guía de despliegue · WiFi/LAN](despliegue-wifi.md)
6. [Arquitectura técnica](arquitectura.md)
7. [Troubleshooting](troubleshooting.md)
8. [ESC/POS · comandos usados](escpos-reference.md)

---

## Modos de conexión

### USB (recomendado para SERVICES)

- **Conexión**: cable USB de la impresora a la tablet/dispositivo del cajero.
- **Driver**: en Android usamos app puente (RawBT, Print Server) o WebUSB del navegador Chrome.
- **Ventajas**:
  - Cero dependencia del router del cliente (no requiere acceso admin a su red).
  - Configuración 100% controlada por el implantador.
  - Funciona aunque la WiFi del local caiga.
- **Desventajas**:
  - Una sola tablet imprime en esa impresora a la vez.
  - Si la tablet se rompe, hay que reemparejar.
  - El cajero debe aceptar permisos USB la primera vez.

### WiFi / LAN (recomendado para HOSPITALITY)

- **Conexión**: la impresora se une a la WiFi del local con IP fija (reserva DHCP en el router).
- **Driver**: ninguno. El backend abre socket TCP al puerto 9100 (o 8080 en algunas) y manda ESC/POS raw.
- **Ventajas**:
  - Multi-dispositivo: cualquier tablet / ordenador del local imprime en la misma impresora.
  - Si la tablet se rompe, otra sirve sin tocar nada.
  - Soporta varias impresoras (BARRA, COCINA, CAJA) sin complicación.
- **Desventajas**:
  - Requiere acceso al panel admin del router del cliente para reservar IP.
  - Si el cliente cambia el router o reinicia DHCP sin reservar la IP, deja de imprimir.
  - Vulnerable a cortes de la red interna del local.

---

## Decisión por vertical

| Vertical | Modo recomendado | Por qué |
|---|---|---|
| **SERVICES** (peluquería, clínica, taller) | USB | 1 tablet + 1 impresora. Control total. Cliente no suele tener técnico de red. |
| **RETAIL** (tienda) | USB o WiFi indistinto | Suele tener 1 caja. WiFi si quieren imprimir desde back-office. |
| **HOSPITALITY** (bar, restaurante) | WiFi | 2-3 impresoras (BARRA + COCINA + caja) + varias cajas. WiFi es obligatoria. |

El **implantador elige al activar la cuenta** y se persiste en `tenant.printingMode = "USB" | "WIFI"`. La UI del admin se adapta.

---

## Modelos validados

| Marca / firmware | Conexión | Estado | Notas |
|---|---|---|---|
| **OEM POS-80 V6.16F** (cuerpo blanco, marca genérica china) | USB + WiFi | 🟡 En pruebas con Peluquería Sole 2026-06-02 | Ancho 80mm. ESC/POS estándar. Cortador automático configurable. Soporta QR + EAN13. |

A medida que validamos más modelos se añaden aquí con su mode de cableado y configuración específica.

---

## Estado tras Fase 1: integración nativa LIVE (2026-06-02 → completada)

Bloque `v1-4-impresoras-fase-1` cierra la integración directa con hardware. Resumen de lo que entró:

- **Modelo `PrinterConfig`** (migración `b27_printer_configs`): una fila por impresora dada de alta en un register. Campos: `name`, `mode` (USB|WIFI), `ipAddress`+`port` si WIFI, `section` (BARRA/COCINA/SALON o NULL para "ticket de cobro"), `active`, `lastPrintOkAt`, `lastErrorAt`+`Msg`.
- **Panel admin `/admin/printers`**: el OWNER/MANAGER da de alta, edita, prueba y desactiva impresoras desde el navegador. Botón "Probar" emite un ESC/POS de prueba (USB devuelve binary base64, WIFI manda TCP).
- **Package `packages/escpos-builder`**: helpers ESC/POS puros (`escInit`, `escCut`, `escQrCode`, codepage PC850 para acentos) + builders de alto nivel:
  - `buildTicketReceipt` — ticket de cobro con cabecera comercio, líneas, TOTAL, pagos, QR del ticket público y pie.
  - `buildKitchenComanda` — comanda con tipografía 2x, sin precios, modifiers con sangría.
  - `buildTestPrint` — print mínimo para el botón "Probar".
- **Endpoints API**:
  - `POST /tickets/:id/print/escpos?target=usb|wifi` — ticket de cobro. USB → octet-stream para WebUSB; WIFI → TCP raw.
  - `POST /tickets/:id/send-to-kitchen/escpos` y `POST /tickets/:id/send-to-kitchen` — comanda por sección a impresoras WIFI. Si falta config para alguna sección → 409 antes de mandar nada. `?fallback=pdf` mantiene la generación legacy para pilotos sin impresoras todavía.
  - `GET /tpv/printer-info?section=ticket|barra|cocina|salon` — el TPV lo consulta para saber qué impresora propone.
- **TPV (`apps/tpv-web`)**:
  - Helper `src/lib/escposPrint.ts` con WebUSB (pair / paired-lookup / transferOut).
  - SuccessOverlay tras cobro muestra "Imprimir ticket (USB|WIFI)" según el PrinterConfig del register. Si USB y no hay impresora emparejada, ofrece "Conectar".
  - SalePage "Enviar comanda" ya no abre PDFs en pestaña: llama al endpoint ESC/POS y muestra toast con resumen por sección. Si alguna falla, el motivo aparece en el banner de error.

### Lo que NO entró en Fase 1 (próximo bloque)

- **`tenant.autoPrintTicket`** (auto-print sin clic) — diferido. Hace falta migración + endpoint + UI; el botón manual cubre los pilotos actuales.
- **Tests jsdom + mock `navigator.usb`** en el TPV — diferidos: no hay infra vitest en `apps/tpv-web` todavía (ver `project_b_product_images_carryovers`).
- **Múltiples impresoras USB simultáneas** en una sola tablet (Fase 2).
- **Agente local nativo** para Windows/Mac/Linux (Fase 3, si algún cliente lo pide).
- **Bluetooth**.
- **Soporte para fonts no-Latin** (chino, árabe).

---

## Convenciones

- Los documentos de despliegue están escritos para **implantadores no técnicos** (Natalia, futuros instaladores). Lenguaje claro, pasos numerados, fotos de la pantalla del router típico.
- Los documentos técnicos (arquitectura, ESC/POS) son para Code / desarrolladores.
- Toda nueva impresora validada se documenta en este README con marca, firmware y modo recomendado.
