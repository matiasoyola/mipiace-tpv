# Pruebas físicas en terminal · AP11-1006 · 2026-08-27

Primera sesión de pruebas conducida **sobre el terminal físico**, no simulada. Claude condujo el
terminal por `adb` sobre WiFi; Matías sólo tecleó el código de vinculación y el PIN.

## Entorno

| | |
|---|---|
| Terminal | Smart-tpv **AP11-1006** (10,1"), Android **11** (SDK 30) |
| Pantalla | 1920×1200 físicos, densidad de fábrica **160** (dpr 1) |
| Navegador | **Chrome 81.0.4044.138** (2020) · WebView del sistema **93** (2021) |
| Conexión | WiFi 192.168.5.79, "Modo de depuración de red" ya activo de fábrica |
| Tenant | Cafetería Sirope · Tienda principal · Caja 1 |
| Cajero | `mipiacetpv-test-2e5c19f9` (isTestCashier → tickets PRUEBA, cero documentos en Holded) |
| Build | producción (`4669bfa`), sin v1.10.2 / v1.10.3 / v1.11 |

Capturas: `docs/qa/2026-08-27-ap11/`.

## Recorrido ejecutado

Vinculación de dispositivo → alta de cajero (email + PIN) → abrir turno con fondo 100 € →
mapa de sala → venta en M3 (Café Solo + Botellín) → cobro en efectivo → intento de cobro mixto →
segunda venta y cobro → cancelar mesa → cerrar turno con arqueo Z. Dos tickets emitidos
(`000017` y el siguiente), 4,50 € en efectivo, turno cerrado con descuadre de −0,50 €.

---

## Hallazgos

### H1 · La UI se pinta rota en el navegador de fábrica — BLOQUEANTE de implantación

Chrome 81 **no soporta `gap` en flexbox** (llegó en Chrome 84). Toda la separación de la UI
está construida con `gap`, así que **todos los espacios colapsan a cero**:

- "Sala5 abiertas · 18 libres", "Salón7", "Terraza8", "Barra8"
- "GEgemmamgc720,00 €" en cada tarjeta de mesa
- "mipiacetpvTienda principal · Caja 1" en la cabecera
- "Importe exacto·3,00 €", casillas pegadas a su etiqueta

El WebView del sistema es el 93 y **sí** lo soporta: la APK se ve bien, el navegador de fábrica no.

**Consecuencia**: ningún terminal puede entregarse a un cliente con la PWA sobre su Chrome de
fábrica. O se actualiza Chrome antes de salir, o se entrega la APK. Esto convierte la APK en
requisito de implantación, no en fase 2.

### H2 · El teclado del sistema hace impracticable el cobro — el peor de la sesión

Al tocar el importe en la hoja de cobro:

- el teclado ocupa el **52 % inferior** de la pantalla y tapa métodos de pago y botón Cobrar;
- aparece un menú nativo **Cortar / Copiar / Seleccionar todo** flotando sobre el ticket;
- el teclado que sale es el de símbolos (`- + . * / , ( ) =`), no un pad de caja;
- no hay "hecho": hay que cerrarlo con el botón Atrás del sistema.

Cobrar "me da cinco" son seis gestos y una pantalla que desaparece. **La APK NO arregla esto**:
el teclado es del sistema operativo. El arreglo es nuestro: **teclado numérico propio dentro de
la app, con el campo en sólo-lectura** (`readonly` + `user-select:none`). Es el cambio de mayor
valor de toda la lista.

Mismo problema en el alta de cajero: el teclado tapa el pad del PIN y la tarjeta no scrollea.

### H3 · Objetivos táctiles por debajo del mínimo

Medido sobre pantalla real (8,8 px/mm físicos):

| Elemento | Alto | |
|---|---|---|
| Chips de zona (Salón/Terraza/Barra), "Nueva venta rápida", "Tickets" | **5 mm** | ✗ |
| "Importe exacto", billetes 5/10/20/50/100 | **6 mm** | ✗ |
| Botones de método de pago | **7 mm** | ✗ |
| Barra "Cobrar" | 7 mm | ✗ |
| Casillas "Imprimir ticket" / "Enviar por email" / "Ticket regalo" | **2,5 mm** | ✗✗ |
| Tarjetas de producto y de mesa | 22–26 mm | ✓ |

Mínimo razonable: 9–10 mm. Lo que está bien dimensionado es lo que se toca una vez; lo que se
toca cien veces al día está a la mitad de tamaño.

### H4 · El cobro mixto sigue bloqueado (confirmado en físico)

Efectivo 2 € + Tarjeta 1 € sobre un total de 3,00 € → **"Falta 1,00 €"** y Cobrar desactivado.
"Resto con Efectivo" no se recalcula al teclear el efectivo. Es el fallo ya identificado el 20/08;
v1.10.3 lo corrige pero **no está desplegado**.

Matiz nuevo: por el camino "sólo importe de tarjeta + resto automático en efectivo" **sí funciona**.
El fallo aparece cuando el cajero teclea los dos importes, que es justo lo que hace un humano.

### H5 · Diálogos nativos del navegador en acciones destructivas

Vaciar mesa confirma con un `window.confirm()`: **"mipiacetpv.com dice: ¿Vaciar la mesa?"** con
botones azules de Chrome y dos "Cancelar" que significan cosas opuestas (cancelar la cuenta vs
cancelar el diálogo). Rompe la marca y confunde. Sustituir por modal propio.

### H6 · El botón Atrás del sistema saca del TPV

Durante el arqueo, el Atrás del sistema cerró el modal y acabó **expulsando al escritorio de
Android con el turno abierto**. Al volver con el icono de Chrome se abrió una **segunda pestaña**,
y esa pestaña **pidió el PIN otra vez** (la sesión de cajero no viaja entre pestañas). La APK
elimina las pestañas, pero el Atrás sigue existiendo en la barra de navegación: hay que
interceptarlo.

### H7 · El cierre de turno se disparó mientras se tecleaba el arqueo

El arqueo Z pide 14 denominaciones, cada una con el teclado del sistema tapando el modal y
desplazando el contenido. En ese baile **el turno se cerró sin que se pulsara deliberadamente
"Cerrar turno"**, con 104,00 € contados frente a 104,50 € esperados y **descuadre de −0,50 €**.
No se pudo reconstruir qué toque exacto lo disparó, pero el riesgo es real: cerrar el día con un
recuento a medias. v1.11 (arqueo opcional) mitiga; el botón destructivo no debe quedar bajo el
dedo mientras se teclea.

### H8 · La sala miente sobre el tiempo

"1181 h 53 m", "1205 h 45 m", "1182 h 09 m" — 49 días expresados en horas, en las cuatro mesas
zombi de Gemma y T1 abiertas desde el 9 de julio. Un mapa en el que no confías deja de mirarse.
Pendiente: barrido de mesas y turnos zombi.

### H9 · Densidad de fábrica inadecuada

A densidad 160 el navegador trabaja con un lienzo de 1920 px sobre 10 pulgadas: texto de ~1,8 mm.
Con `wm density 240` el viewport pasa a **1280×800**, que es exactamente el tamaño para el que
está diseñada la UI. **Añadir al checklist de implantación** (y valorar fijarlo desde la APK).

---

## Lo que funcionó sin un fallo

- IVA mixto al céntimo en el terminal: 1,50 € al 10 % + 1,50 € al 21 % → 2,60 + 0,40 = 3,00 €.
- Cobro en efectivo, emisión de ticket y vuelta directa al mapa con banner "Mesa cobrada".
- Arqueo Z: cash esperado, contado y descuadre calculados correctamente.
- Modo prueba: los dos tickets nacieron PRUEBA, cero documentos en el Holded del cliente.
- Vinculación de dispositivo por código de 6 dígitos, a la primera.

## Orden de trabajo propuesto

1. **Teclado numérico propio en la hoja de cobro y en el arqueo** (H2). Bloque nuevo.
2. **APK como requisito de implantación** (H1) + checklist: Chrome/WebView actualizados,
   `wm density 240`, Atrás interceptado (H6, H9).
3. **Objetivos táctiles a 9–10 mm** en fila de acciones, métodos de pago y billetes; plegar
   email/ticket regalo tras "Más opciones" (H3).
4. **Desplegar v1.10.3** (H4) y **v1.11** (H7).
5. Modal propio para acciones destructivas (H5).
6. Copy de tiempos + barrido de mesas zombi (H8).
