# Despliegue de impresoras por WiFi / LAN

Guía paso a paso para implantadores.

**Aplica a**: vertical HOSPITALITY (bares, restaurantes) con varias impresoras (BARRA, COCINA, caja). También aplica a RETAIL si el cliente quiere imprimir desde back-office sin USB.

**Tiempo estimado**: 25-45 minutos, depende de si tienes acceso admin al router del cliente.

**Modelo de referencia**: OEM POS-80 V6.16F (cuerpo blanco, marca china genérica). Cualquier impresora ESC/POS con interfaz Ethernet/WiFi sirve.

---

## Material necesario

- Una o varias impresoras térmicas 80mm con WiFi o Ethernet.
- Acceso admin al router del local del cliente (para reservar IPs fijas).
- Cuenta admin de mipiacetpv.

---

## Visión general

A diferencia del flujo USB, en WiFi el backend de mipiacetpv abre directamente un socket TCP a `IP:9100` de cada impresora y le manda el ESC/POS. **Ninguna app puente, ningún driver, ninguna tablet implicada en la entrega**.

Por eso:
- La impresora necesita una **IP fija en la LAN**. Si DHCP la cambia, el backend deja de imprimir.
- El backend tiene que tener visibilidad de red con la LAN del cliente (mismas premisas que cualquier app cloud que pretenda mandar TCP a una red local — en pilotos actuales esto se resuelve porque el backend corre en una máquina del propio local; cuando se mueva a cloud habrá que enrutarlo via VPN/agente, fuera del scope de Fase 1).

---

## Pasos de instalación por impresora

Repetir para cada impresora del local (caja, BARRA, COCINA, etc.).

### 1. Imprimir el self-test

1. Apaga la impresora.
2. Mantén pulsado **FEED** y enciéndela. Suelta tras 2 segundos.
3. El self-test imprime varias páginas; en una de ellas aparece la sección de red. Anota:
   - **MAC address** (la usaremos para reservar IP en el router).
   - **IP actual** si ya está en la WiFi del local (típico: `192.168.x.x`).
   - **Puerto** (debe ser `9100` ESC/POS raw).

### 2. Configurar la WiFi de la impresora

Esto varía por modelo. En POS-80 V6.16F:

1. Conecta la impresora por USB a un PC con el utilitario del fabricante (incluido en el CD, o descargable de la web del proveedor).
2. Abre el utilitario y entra a **Network Configuration**.
3. Pestaña WiFi:
   - **SSID**: red WiFi del local.
   - **Password**: contraseña.
   - **Encryption**: WPA2 normalmente.
4. Guarda. La impresora se reinicia y se une a la red.

Alternativa: muchas impresoras tienen un modo AP (la impresora levanta su propia WiFi temporal `Printer_AP_xxxx`) en el que entras desde el móvil, te conectas a `192.168.1.1` y configuras desde ahí.

### 3. Reservar IP fija en el router del cliente

Si DHCP cambia la IP, el backend deja de mandar. Hay dos caminos:

**Camino A (recomendado): reserva DHCP en el router.**

1. Entra al panel admin del router (`192.168.1.1` o similar; pregunta al cliente las credenciales).
2. Busca sección **DHCP** → **DHCP Reservations** / **Static Leases** (varía según fabricante).
3. Añade entrada:
   - **MAC**: la del self-test.
   - **IP**: una libre fuera del pool DHCP, por ejemplo `192.168.1.50` para BARRA, `192.168.1.51` para COCINA.
4. Guarda y reinicia la impresora para que pida nueva IP al router.

**Camino B (manual): IP estática en la impresora.**

Si el router no permite reservas, configura IP estática directamente en la impresora desde el utilitario. Ojo: si el cliente cambia el router luego, hay que reconfigurar la impresora manualmente.

### 4. Probar conectividad TCP

Desde un PC en la misma red:

```bash
nc -v 192.168.1.50 9100
```

Si conecta sin error → la impresora está accesible. Sal con `Ctrl+C`.

### 5. Dar de alta la impresora en `/admin/printers`

1. Entra al admin de mipiacetpv.
2. Menú lateral → **Impresoras**.
3. Localiza el register correspondiente y pulsa **"Añadir impresora"**.
4. Rellena:
   - **Nombre**: `Comanda BARRA`, `Comanda COCINA`, o `Ticket caja` (úsalo para distinguir si tienes varias).
   - **Modo**: WIFI.
   - **IP**: `192.168.1.50` (la que reservaste o configuraste).
   - **Puerto**: `9100` (default).
   - **Sección**: BARRA / COCINA / SALON si es comandera, "Ticket de cobro (sin sección)" si es la del ticket de cobro al cliente.
   - **Activa**: sí.
5. Guarda.

### 6. Probar desde el admin

1. En la tarjeta de la impresora recién creada pulsa **"Probar"**.
2. Tras 1-3 segundos el banner verde "Prueba enviada correctamente" debe aparecer.
3. La impresora debe imprimir un ticket corto con cabecera "TEST IMPRESORA" y la fecha.
4. Si en su lugar aparece un banner rojo con error, ver sección **Errores comunes** abajo.

### 7. Validar end-to-end con un ticket / comanda real

- **Ticket de cobro**: cobra un ticket desde el TPV. En la pantalla "Ticket emitido" debería aparecer el botón **"Imprimir ticket (WIFI)"**. Púlsalo y verifica que la impresora del ticket lo saca.
- **Comanderas**: añade líneas a una mesa abierta del bar con tags mapeados a BARRA y COCINA. Pulsa **"Enviar comanda"**. El toast verde debe enumerar las secciones impresas. Comprueba que cada impresora emitió su papel.

---

## Errores comunes y soluciones

### "Timeout TCP" al pulsar Probar

**Causa**: el backend no puede abrir socket a `IP:9100`.

**Solución**:
1. Verifica con `nc -v IP 9100` desde una máquina en la misma red (paso 4).
2. Si `nc` también falla → la impresora no está en la red o tiene firewall. Recomprueba la config WiFi del paso 2.
3. Si `nc` funciona pero el backend no → el backend está en otra red sin ruta a la LAN del cliente. Habla con el equipo Code.

### "ECONNREFUSED"

**Causa**: la IP responde pero el puerto 9100 está cerrado.

**Solución**:
1. La impresora puede estar configurada en otro puerto (`8080`, `6101`). Recomprueba el self-test.
2. Edita la impresora en `/admin/printers` y pon el puerto correcto.

### El "Probar" funciona, pero las comandas reales no llegan

**Causa típica**: la sección asignada a la impresora no coincide con los tags de los productos.

**Solución**:
1. Ve a `/admin/tag-sections` y revisa qué tag se mapea a qué sección.
2. Si un producto tiene tag `cafes` mapeado a BARRA, asegúrate de que existe una impresora en `/admin/printers` con sección BARRA.
3. Si la sección no tiene impresora, el TPV recibe un 409 "Falta configurar impresora para BARRA".

### IP cambió tras reiniciar el router

**Causa**: no había reserva DHCP, sólo IP libre.

**Solución**: reservar IP en el router (paso 3 camino A). Mientras tanto, actualiza la IP en `/admin/printers` con el botón "Editar".

### Impresora apagada

**Síntoma**: timeout o ECONNREFUSED repetido.

**Solución**: el campo "Último error" en la tarjeta del admin lo refleja con `Timeout TCP` o `ECONNREFUSED`. Encender la impresora resuelve.

### Imprime caracteres raros / acentos mal

El backend manda `ESC t 2` (PC850) al inicio de cada print. Si aún así sale mal, la impresora puede ignorar la codepage. Soluciones:

1. Confirma desde el self-test qué codepages soporta la impresora.
2. Si no soporta PC850, abre incidencia en `docs/impresoras/troubleshooting.md` con marca y modelo, lo añadimos al spike.

---

## Estado y monitorización

En `/admin/printers` cada tarjeta muestra:

- **Estado**: `OK` (verde) si imprimió OK en <24h, `con error` (ámbar) si el último intento falló, `sin uso reciente` (gris) si nunca o hace tiempo.
- **Última impresión** (formato relativo "hace 5 min").
- **Último error**: texto resumido del fallo si lo hubo.

Si una impresora se queda silenciosa durante mucho rato debería pasar a ámbar y luego gris. Cuando el cajero pulse "Enviar comanda" el backend reintenta — no hay reintentos en background.

---

## Próximos pasos del producto

- Detección automática de impresoras desaparecidas (alerta en /admin/printers cuando >3 días sin uso).
- Reintentos automáticos en background con backoff exponencial.
- Soporte para impresoras Bluetooth (no priorizado).
