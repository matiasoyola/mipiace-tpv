# Checklist · dejar un terminal Android listo

Para el que está delante del terminal, con el cliente al lado. El super-admin le canta un
código de 6 dígitos por teléfono; el resto se hace en el propio terminal.

Hardware probado: **AP11-1006** (10,1", Android 11) y **AP12-1506** (15").

---

## Antes de salir

- [ ] La versión que se va a instalar está publicada (`/superadmin/descargas` la lista).
- [ ] Alguien con acceso de super-admin está localizable para generar el código: caduca a los
      60 minutos, así que no sirve pedirlo la noche antes.
- [ ] Apuntado el SHA-256 de la versión, o a mano el enlace de la consola para consultarlo.

## En el terminal

### 1. Permitir instalar apps desconocidas

Ajustes → Aplicaciones → acceso especial → **Instalar apps desconocidas** → dárselo **al
navegador que va a descargar** (Chrome). Android lo pide por app, no globalmente.

### 2. Descargar

Abrir `mipiacetpv.com/apk` y teclear el código de 6 dígitos.

La página está hecha para este navegador: sin JavaScript y con el botón en la mitad superior,
porque el teclado del sistema tapa la mitad inferior de la pantalla.

Si dice **"código caducado o agotado"**, pide otro: han pasado 60 minutos o ya se ha usado
3 veces. Si dice **"demasiados intentos"**, la IP está bloqueada 30 minutos.

### 3. Cotejar el SHA-256 — no te lo saltes

La página muestra el SHA-256 de la versión que acabas de descargar. Compáralo con el que
enseña la consola antes de instalar. Es lo único que distingue el binario que publicamos de
uno que haya cambiado por el camino.

### 4. Instalar y abrir

Abrir el `.apk` descargado desde la barra de notificaciones o el gestor de archivos.

### 5. Ajustar la densidad de pantalla

La UI está diseñada para un viewport de **1280×800**. En el AP11 eso es `density 240`.

Por menú: Ajustes → Pantalla → Tamaño de pantalla / Densidad.
Por ADB, si el terminal está conectado: `adb shell wm density 240`.

Sin esto la interfaz sale demasiado grande y las pantallas de venta no caben.

### 6. Primer login **online**

Importante que este primero sea con red: es el que baja el catálogo y el paquete offline
(roster de cajeros y sus PIN). Un terminal que estrena y se queda sin red antes de este paso
no puede ni loguear.

- [ ] Login de cajero correcto
- [ ] El catálogo pinta productos
- [ ] Abrir turno y cerrarlo funciona

### 7. Comprobar la versión instalada

Menú del TPV (hamburguesa arriba a la izquierda) → al pie del panel aparece
`1.10.2 (11002) · build a1b2c3d`. Confirma que es la que querías instalar.

Es también donde hay que mirar cuando el cliente llame: da versión y commit.

### 8. Dejar la app como lanzador, si el terminal lo permite

Ajustes → Aplicaciones → App predeterminada → Inicio. Así el terminal arranca en el TPV y el
cajero no llega al navegador ni al escritorio de Android.

No todos los terminales lo permiten sin MDM. Si no se puede, se deja y ya está: no es
bloqueante (el modo kiosco y el MDM son otro bloque).

---

## Lo que NO hay que hacer

- **No instalar por WhatsApp ni por USB desde un portátil cualquiera.** Recomprime o no deja
  traza de qué versión entró.
- **No saltarse el paso 3.** Cotejar el hash es medio minuto.
- **No hacer el primer login sin red.**

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| "Aplicación no instalada" | Ya hay una versión instalada con OTRA firma. Desinstalar antes (ojo: se pierden los datos locales). |
| La app abre pero no hace login | El APK se construyó sin `VITE_API_URL`. No debería pasar: el build aborta. Comprobar la versión en el menú y avisar. |
| Textos pegados y descuadrados | Estás en el navegador, no en la app. Esa es exactamente la razón de este procedimiento. |
| La interfaz se ve enorme | Falta el paso 5, la densidad. |
