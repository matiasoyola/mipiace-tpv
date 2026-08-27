# Checklist · preparación del terminal (antes de cualquier implantación)

Nace de las pruebas físicas sobre el AP11-1006 del 2026-08-27
(`docs/qa/2026-08-27-pruebas-fisicas-ap11.md`). **Se hace en el taller, no en el bar.** Un
terminal que llega al cliente sin estas puertas en verde no se instala: se lleva de vuelta.

Antes de esto, el checklist decía *"Chrome/WebView → mipiacetpv.com → login"*. Sobre un terminal
de fábrica eso pinta una interfaz rota y un cobro impracticable. Este documento es esa lección.

## Puerta 0 · La regla

**Ningún terminal se entrega con la PWA sobre el navegador de fábrica.** O se actualiza Chrome
antes de salir, o se entrega la APK. La APK dejó de ser fase 2 el 27 de agosto de 2026.

## 1 · Identificar lo que tenemos delante

- [ ] Modelo, pulgadas y resolución física.
- [ ] Versión de Android (`adb shell getprop ro.build.version.release`).
- [ ] **Versión de Chrome** y **versión del WebView del sistema** — son distintas y es lo que
      decide todo. En el AP11: Chrome **81** (2020) y WebView **93** (2021).
- [ ] Anotarlo en la ficha del terminal. Si Chrome < 84, la web se ve rota: no soporta `gap` en
      flexbox y toda nuestra separación se construye con `gap`.

## 2 · Densidad de pantalla

- [ ] `adb shell wm density 240` (o el valor que deje el viewport en **1280×800**).

  A densidad de fábrica 160, el AP11 da un lienzo de 1920 px sobre 10 pulgadas: texto de 1,8 mm,
  ilegible de pie. A 240 el viewport es exactamente el tamaño para el que está diseñada la UI.

- [ ] Comprobar que el cambio sobrevive a un reinicio.

## 3 · Cómo se instala el TPV

- [ ] **Vía preferente: la APK** (bloque A3 · `mipiacetpv.com/apk` + código de 6 dígitos). Usa el
      WebView del sistema, que es varias versiones más moderno que el Chrome de fábrica.
- [ ] Vía alternativa, sólo si la APK no está disponible: **actualizar Chrome desde Play Store** y
      volver a comprobar la versión. Sin actualizar, no se instala.
- [ ] Verificar la firma y el SHA-256 del binario descargado.

## 4 · Prueba de dedo (con la mano, no con el ratón)

Con el cajero técnico en modo prueba, sobre el terminal ya preparado:

- [ ] Vincular dispositivo por código de 6 dígitos.
- [ ] Login de cajero: el teclado del sistema **no** debe tapar el PIN.
- [ ] Abrir turno con fondo de caja: se teclea sin que salte el teclado de Android.
- [ ] Venta de dos líneas con IVA distinto y **cobro en efectivo**: el importe entregado se teclea
      con nuestro teclado, y el botón Cobrar sigue visible mientras se teclea.
- [ ] Cobro mixto (efectivo + tarjeta).
- [ ] Arqueo Z por denominaciones, sin que aparezca el teclado del sistema.
- [ ] **Botón Atrás del sistema**: cierra lo que haya abierto y **nunca** saca de la aplicación
      con un turno abierto.
- [ ] Ninguna acción destructiva muestra el diálogo del navegador (*"mipiacetpv.com dice…"*).
- [ ] Modo avión 2 min: venta offline → chip de outbox → reconectar → reenvío automático.

## 5 · Antes de meterlo en la caja

- [ ] Los tickets de la prueba nacieron `PRUEBA` y no hay ni un documento en el Holded del cliente.
- [ ] Brillo, bloqueo de pantalla y suspensión configurados para barra (pantalla que no se apaga
      sola en medio de un servicio).
- [ ] WiFi del local guardado y probado, no el del taller.
- [ ] Ficha del terminal cerrada: modelo, Android, Chrome, WebView, densidad, versión de la APK.

## Qué hacer si algo de esto no se puede cumplir

No se instala y se dice por qué. Un terminal entregado con la UI rota o con un cobro que depende
del teclado del sistema no es una implantación a medias: es una implantación que el cliente va a
abandonar en una semana, y que nos costará más recuperar que retrasarla hoy.
