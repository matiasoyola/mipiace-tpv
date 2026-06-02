# Despliegue de impresora por USB (Android)

Guía paso a paso para implantadores (Natalia o futuros instaladores).

**Aplica a**: vertical SERVICES (peluquerías, clínicas, talleres) con una sola tablet y una sola impresora.

**Tiempo estimado**: 10 minutos.

**Modelo de referencia**: OEM POS-80 V6.16F (cuerpo blanco, marca china genérica). Probado en Peluquería Sole 2026-06-02.

---

## Material necesario

- Impresora térmica de 80mm con USB (modelo de referencia o similar).
- Tablet Android del cajero con **Chrome instalado**.
- Cable USB de la impresora a la tablet (USB-A en la impresora, USB-C o microUSB en la tablet).
- Si la tablet es USB-C: **adaptador OTG USB-C → USB-A** que soporte datos (no solo carga).

> Tras `v1.4-impresoras-fase-1` ya no se usa RawBT. El TPV manda ESC/POS directamente a la impresora con **WebUSB API** del navegador. Sin app puente, sin Compartir, sin clic adicional por ticket.

---

## Pasos de instalación

### 1. Imprimir self-test de la impresora

Antes de conectar nada, valida que la impresora funciona sola:

1. Apaga la impresora.
2. Mantén pulsado el botón **FEED** (el único botón normalmente).
3. Sin soltar, **enciende** la impresora.
4. Espera 2 segundos y suelta.
5. La impresora debe imprimir un self-test con: versión de firmware, ancho de papel, interfaces disponibles (USB, WiFi, Ethernet), página de caracteres y un código QR con info de la red.

Anota del self-test:
- **Versión** (ej. V6.16F).
- **Interface** (debe incluir "USB Print").
- **Print Width** (debe ser 80mm).

Si NO imprime el self-test → la impresora está rota o sin papel. Soluciona antes de continuar.

### 2. Conectar la impresora a la tablet

1. Enciende la impresora.
2. Conecta el cable USB: USB-A a la impresora, el otro extremo a la tablet (con adaptador OTG si es USB-C).
3. Si Android muestra el popup "USB device connected. Open app?", cierra el popup — no necesitamos ninguna app puente.

### 3. Configurar la impresora en `/admin/printers`

1. Desde un navegador (puede ser el del implantador, no hace falta la tablet del cajero), entra a tu cuenta admin de mipiacetpv.
2. Menú lateral → **Impresoras**.
3. Localiza el register de la tienda y pulsa **"Añadir impresora"**.
4. Rellena:
   - **Nombre**: `Ticket caja` (o lo que prefieras para identificarla).
   - **Modo**: USB.
   - **Sección**: "Ticket de cobro (sin sección)" — la impresión de cocina sólo aplica a hostelería WIFI.
   - **Activa**: sí.
5. Guarda.

Cuando salgas del modal verás la impresora listada con badge `USB` y estado "sin uso reciente".

### 4. Emparejar la impresora desde el TPV (una vez)

1. Abre el TPV en Chrome de la tablet, loguea cajero.
2. Cobra un ticket de prueba (puedes usar el cajero técnico de modo prueba para no ensuciar Holded).
3. Tras el cobro, en la pantalla "Ticket emitido" aparece un banner ámbar **"Empareja la impresora — Conectar"**.
4. Pulsa **"Conectar"**.
5. Chrome muestra el diálogo nativo "Selecciona un dispositivo USB". Verás la impresora (algo tipo `POS-80 Printer`). Pulsa **"Conectar"** en el diálogo.
6. El TPV almacena el emparejamiento en `localStorage`. La próxima vez que se cobre **no volverá a pedirlo** (mientras la tablet no se resetee).

### 5. Imprimir un ticket

1. En la pantalla "Ticket emitido" pulsa **"Imprimir ticket (USB)"**.
2. El TPV pide al backend el binario ESC/POS y lo manda a la impresora vía `device.transferOut()`.
3. La impresora imprime el ticket completo (cabecera comercio, líneas, total, QR público, pie).
4. El botón cambia a "Ticket impreso" en verde durante 2 segundos.
5. Si la impresora no responde → aparece banner rojo con "Reintentar".

---

## Errores comunes y soluciones

### Error: Chrome no muestra el diálogo "Selecciona un dispositivo USB"

**Causa más probable**: la página no se sirve por HTTPS (Chrome bloquea WebUSB fuera de HTTPS) o el botón no se pulsó como interacción de usuario.

**Solución**:
1. Verifica que entras al TPV con `https://...` (no `http://`). En producción Caddy lo fuerza; en local con `localhost` Chrome lo permite también.
2. Si la URL es correcta y aún así no aparece nada al pulsar "Conectar", abre la pestaña, asegúrate de tocar el botón con el dedo (no via inspector) y reintenta.

### Error: la impresora no aparece en la lista del diálogo

**Causa**:
- Cable USB de sólo carga.
- Adaptador OTG sin pines de datos.
- Impresora apagada.

**Solución**:
1. Confirma que la impresora está encendida (LED verde).
2. Prueba con OTRO cable USB. El cable que viene con la impresora suele ser bueno.
3. Si usas adaptador OTG: cambia a uno conocido (datos + carga). Los baratos son sólo carga.

### Error: imprime caracteres raros / acentos mal

**Causa**: la impresora no aceptó la codepage PC850 que mandamos por defecto.

**Solución**: en `/admin/printers` pulsa **"Probar"** sobre la impresora. Si la prueba lo imprime correctamente, el problema está en tickets concretos con caracteres no soportados (chinos, árabe — ver sección "Out of scope" del README).

### Error: el botón "Imprimir ticket" no aparece tras el cobro

**Causa**: el register no tiene impresora configurada en el admin con `section=NULL` (ticket).

**Solución**:
1. Ve a `/admin/printers`.
2. Asegúrate de que el register correcto tiene al menos una impresora **activa** con sección "Ticket de cobro (sin sección)".
3. Vuelve al TPV. Recarga la pantalla "Ticket emitido" del último cobro o cobra otro.

---

## Configuración recomendada para Peluquería Sole

Tras `v1.4-impresoras-fase-1` el implantador sólo configura el alta en `/admin/printers`. No se tocan drivers ni configuraciones del lado tablet — el binario ESC/POS sale plano desde el backend.

- **Mode**: USB.
- **Sección**: Ticket de cobro (sin sección).
- **Cable**: el que viene con la impresora.
- **Adaptador OTG**: OTG con datos (no sólo carga).
- **Code page**: PC850 (lo manda el backend al inicio de cada print, no hay que tocar nada).

---

## Próximos pasos del producto

Fase 1 cubre el caso 1 tablet + 1 impresora USB del vertical SERVICES. Pendiente en fases posteriores:

- **Múltiples impresoras USB** simultáneas en una sola tablet.
- **Agente local nativo** Windows/Mac/Linux (si algún cliente lo pide).
- **Bluetooth**.

Para hostelería con varias impresoras (BARRA + COCINA + caja), ver `despliegue-wifi.md`.
