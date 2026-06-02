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

## Estado actual de la integración (2026-06-02)

- **Lote 2 v1.4-Bar-Operativa-MVP** generó "comanderas" como **PDFs por sección** que se abren en pestaña nueva del navegador. El cajero los imprime manual.
- **No hay integración directa con hardware todavía**. Próximo bloque (`v1-4-impresoras-fase-1`) lo añade.

Plan de la integración:

1. Modelo `PrinterConfig` en BD por register (mode USB|WIFI, IP/puerto si WiFi, nombre lógico).
2. Endpoint backend `POST /tickets/:id/print` que:
   - Si mode=WIFI → abre socket TCP a IP:9100 y manda ESC/POS.
   - Si mode=USB → devuelve el binario ESC/POS al cliente, que lo manda a la impresora vía WebUSB / app puente.
3. UI admin: panel "Impresoras" donde el implantador configura.
4. UI TPV: botón "Imprimir ticket" en el cobro + reintento si falla.
5. Tests + manuales.

---

## Convenciones

- Los documentos de despliegue están escritos para **implantadores no técnicos** (Natalia, futuros instaladores). Lenguaje claro, pasos numerados, fotos de la pantalla del router típico.
- Los documentos técnicos (arquitectura, ESC/POS) son para Code / desarrolladores.
- Toda nueva impresora validada se documenta en este README con marca, firmware y modo recomendado.
