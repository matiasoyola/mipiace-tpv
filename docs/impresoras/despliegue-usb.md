# Despliegue de impresora por USB (Android)

Guía paso a paso para implantadores (Natalia o futuros instaladores).

**Aplica a**: vertical SERVICES (peluquerías, clínicas, talleres) con una sola tablet y una sola impresora.

**Tiempo estimado**: 15 minutos si todo va bien. 30-45 minutos si hay drivers que probar.

**Modelo de referencia**: OEM POS-80 V6.16F (cuerpo blanco, marca china genérica). Probado en Peluquería Sole 2026-06-02 con éxito.

---

## Material necesario

- Impresora térmica de 80mm con USB (modelo de referencia o similar).
- Tablet Android del cajero.
- Cable USB de la impresora a la tablet (USB-A en la impresora, USB-C o microUSB en la tablet).
- Si la tablet es USB-C: **adaptador OTG USB-C → USB-A** que soporte datos (no solo carga).

---

## Pasos de instalación

### 1. Imprimir self-test de la impresora

Antes de conectar nada, valida que la impresora funciona sola:

1. Apaga la impresora.
2. Mantén pulsado el botón **FEED** (el único botón normalmente).
3. Sin soltar, **enciende** la impresora.
4. Espera 2 segundos y suelta.
5. La impresora debe imprimir un self-test con: versión de firmware, ancho de papel, interfaces disponibles (USB, WiFi, Ethernet), página de caracteres, y un código QR con info de la red.

Anota del self-test:
- **Versión** (ej. V6.16F).
- **Interface** (debe incluir "USB Print").
- **Print Width** (debe ser 80mm).

Si NO imprime el self-test → la impresora está rota o sin papel. Soluciona antes de continuar.

### 2. Instalar RawBT en la tablet

1. Play Store → buscar **"RawBT"**.
2. Instalar la app gratuita (~5 MB, autor "Roman Mostov").
3. Abrir RawBT al menos una vez.

### 3. Conectar la impresora a la tablet

1. Encciende la impresora.
2. Conecta el cable USB: la punta USB-A va a la impresora, la otra a la tablet (con adaptador OTG si la tablet es USB-C).
3. Android debe mostrar un popup tipo **"USB device connected. Open app?"** → selecciona **RawBT**.
4. RawBT te pedirá permisos:
   - "Allow RawBT to access USB device?" → **OK** + marca **"Use by default"**.
5. RawBT debería detectar la impresora y aparecer como conectada en su pantalla principal.

### 4. Configurar driver y ancho

1. En RawBT, abre **Settings**.
2. **Driver**: prueba en este orden hasta que la impresión funcione:
   - "POS-80" / "POS80"
   - "Xprinter"
   - "ZJ-80"
   - "Generic ESC/POS"
   - "esc_general" (como último recurso)
3. **Ancho del papel (Print width)**: pon **576 puntos** (es lo correcto para 80mm). Si el texto se corta a la derecha, baja a 512. Si queda demasiado margen a la izquierda, sube a 600.
4. **Print mode**: si la opción aparece, elige **"Text mode"** o **"Native ESC/POS"** (NO "Bitmap" — satura el buffer en impresiones largas).
5. Guarda.

### 5. Test de RawBT

1. En RawBT, pulsa **"Test print"** o **"Self test"**.
2. La impresora debe imprimir un texto de prueba ocupando el ancho del papel.
3. Si imprime → ✅ paso 5 OK.
4. Si NO imprime, ver sección **Errores comunes** abajo.

### 6. Test end-to-end desde el TPV (provisional)

> Mientras la integración nativa con RawBT no esté hecha (bloque v1.4-impresoras-fase-1 pendiente), validamos manual.

1. Abre el TPV en Chrome de la tablet, loguea cajero.
2. Cobra un ticket de prueba (puedes usar el cajero técnico de modo prueba para no ensuciar Holded).
3. Tras el cobro, se abre el PDF del ticket en una pestaña nueva.
4. En esa pestaña: pulsa los 3 puntos (arriba derecha de Chrome) → **Compartir**.
5. En la lista de apps, selecciona **"RawBT Imprimir"**.
6. RawBT procesa el PDF, lo convierte a ESC/POS y lo manda a la impresora.
7. La impresora debe imprimir el ticket entero.

Si imprime → ✅ piloto validado.

---

## Errores comunes y soluciones

### Error: "no ACK" en impresiones largas (las cortas SÍ van)

**Causa**: la impresora se satura porque recibe datos más rápido que los procesa, y RawBT lo interpreta como pérdida de comunicación.

**Solución por orden**:
1. **Cambia driver** en RawBT a uno más específico (POS-80 o Xprinter). El driver `esc_general` envía datos genéricos que muchas impresoras chinas no manejan bien.
2. **Print mode = Text** en lugar de Bitmap (Bitmap envía la imagen renderizada, mucho más pesada).
3. **Buffer size**: si existe la opción, bájala (ej. 512 bytes en lugar de 4096).
4. **Flow control = XON/XOFF**: actívalo si aparece en Settings → Advanced.
5. **Timeout**: súbelo (3000 ms en lugar de 500).

Caso validado en Peluquería Sole 2026-06-02: cambiar driver de `esc_general` a `POS-80` resolvió el problema para test prints cortos.

### ⚠️ Limitación conocida: PDFs grandes a través de RawBT NO funcionan en este modelo

Tras el spike de Peluquería Sole 2026-06-02 confirmamos:

- **Test print de RawBT** (texto plano corto, mandado como ESC/POS nativo) → ✅ imprime.
- **PDF del ticket TPV compartido con RawBT** (RawBT lo rasteriza a imagen bitmap) → ❌ error `no ACK` repetible, no se imprime aunque cambies driver, DPI, buffer size o flow control.

**Causa raíz**: la impresora OEM POS-80 V6.16F tiene un buffer interno demasiado pequeño para absorber un bitmap del tamaño de un ticket entero. RawBT manda el bitmap completo de golpe y la impresora pierde ACK.

**Conclusión**: el puente "PDF → RawBT" **NO es viable como solución de producción para este modelo**. Se necesita la integración nativa (bloque pendiente, task #8) que genera ESC/POS plano desde el backend y lo manda directo a la impresora sin pasar por PDF.

**Operativa provisional en Peluquería Sole hasta integración nativa**:

- Cliente recibe el ticket por email (el TPV ya lo hace automáticamente).
- Si el cliente pide papel: explicar que llega por email + el QR sirve como prueba digital del cobro.
- NO insistir en imprimir desde RawBT; perderéis tiempo.

### Error: la impresora no se detecta al conectar el USB

**Causa más probable**: cable USB de solo carga (sin pines de datos) o adaptador OTG sin datos.

**Solución**:
1. Prueba con OTRO cable USB. El cable que viene con la impresora suele ser bueno.
2. Si usas adaptador OTG (USB-C → USB-A): asegúrate de que soporta datos, no solo carga. Los adaptadores baratos suelen ser solo de carga.
3. Verifica que la impresora está ENCENDIDA antes de conectar.

### Error: Android no muestra el popup "Open app?"

**Solución**:
1. Desconecta el cable USB.
2. Asegúrate de que RawBT está instalado.
3. Vuelve a conectar.
4. Si no aparece popup, abre RawBT manualmente → opción "Connect printer" → la lista debería mostrar la impresora.
5. Si aún no aparece → reinicia la tablet con la impresora conectada.

### Error: imprime caracteres raros / acentos mal

**Causa**: page code mal configurado.

**Solución**:
1. RawBT → Settings → Encoding / Code page.
2. Selecciona **"PC850 (Multilingual)"** o **"PC858 (Western Europe)"** para español con acentos.
3. Imprime un test.

### Error: imprime pero corta el texto a la derecha

**Causa**: ancho mal configurado.

**Solución**: en RawBT → Settings → Print width, ajusta:
- 80mm → 576 puntos (estándar).
- Si corta → bajar a 512 o 480.
- Si queda mucho margen → subir a 600 o 640.

### Error: la impresora SE QUEDA SIN PAPEL durante una impresión

**Síntoma**: imprime parcial, luego se para.

**Solución**: cargar rollo nuevo. El sensor de papel se reactiva automáticamente. Cuando Code integre el TPV con la impresora, se mostrará alerta visual al cajero.

---

## Configuración recomendada para Peluquería Sole

Tras el spike del 2026-06-02:

- **Driver RawBT**: POS-80 (o el primero de la lista que funcione tras `esc_general` fallando con `no ACK`).
- **Print width**: 576 puntos.
- **Print mode**: Text / Native ESC/POS.
- **Code page**: PC850 (Multilingual) para acentos.
- **Cable**: el que viene con la impresora.
- **Adaptador OTG**: probado con OTG genérico que soporta datos.

---

## Próximos pasos del producto

Hoy esta guía describe el camino **manual** (cobro → PDF en Chrome → Compartir → RawBT). El bloque `v1.4-impresoras-fase-1` (task #8) automatizará:

1. Botón "Imprimir ticket" en el TPV que llama a RawBT directamente vía intent Android.
2. Reintento automático si la impresora no responde.
3. Configuración de la impresora desde el admin (no desde RawBT).
4. Soporte para múltiples impresoras (para hostelería).

Mientras eso llega, el flujo manual descrito en el paso 6 es lo que opera Sole y futuros pilotos SERVICES.
