# Bloque kds-2 · la cocina sigue recibiendo aunque se caiga internet

## Por qué existe este bloque

La decisión 9 de `docs/kds/00-decisiones.md` dice que, si se cae internet, el TPV y la tablet de cocina
siguen en la **misma wifi del local** y pueden hablarse directamente. kds-1 dejó el modelo preparado:
cada envío lleva un `clientSendId` idempotente y la pantalla guarda su estado. Este bloque construye el
**camino directo**.

¿Y qué? En un bar de pueblo con internet que se cae (La Maestranza, Las Lomas con 4G), la cocina sigue
recibiendo comandas, anulaciones y urgentes, y el camarero sigue viendo el «LISTO». Hoy, sin internet,
solo queda el papel de respaldo.

**No es lo que se descartó** (`project_offline_scope`: varias cajas cobrando sin internet y cuadrando
dinero entre ellas). Aquí no circula dinero: solo comandas hacia cocina y estados de vuelta. Las cajas
**no se sincronizan entre sí**; eso sigue fuera.

## Leer antes

1. `docs/kds/00-decisiones.md`, decisión 9 entera.
2. `docs/blocks/kds-1-cocina-done.md`: dónde viven `clientSendId`, el latido, el respaldo en papel y el
   estado local de la pantalla.
3. El offline de un terminal de v1.10 (la cola del TPV) y el puente nativo de la APK (el plugin USB de
   A1 es el ejemplo de plugin propio que funciona; ojo con `project_usb_unsupported_ap12`).
4. `reference_dos_sesiones_mismo_terminal` y el incidente A5 del 04-09: **nada de laboratorio en la APK
   de un cliente**. Ni orígenes `http`, ni flags de prueba encendidos en la build de producción.

## Base de rama

Rama `kds-2-wifi` **desde `kds-1-cocina`**. Mientras kds-1 no esté en `master`, el PR va **contra
`kds-1-cocina`**. Cuando kds-1 se mergee, se rebasa sobre `master` y el PR pasa a ir contra `master`.

## Decisiones ya tomadas (no reabrir)

- **Dos caminos a la vez**: cada envío, anulación, marcha, urgente y «Servido» sale **a la nube y,
  además, directamente por la wifi** a las pantallas de cocina de la tienda. Quien recibe descarta los
  duplicados por `clientSendId`, o por el id de la operación en las que no son envíos.
- **Con internet, el camino directo es solo refuerzo**: la verdad sigue en el servidor. **Sin
  internet, el directo es lo único que hay**.
  - La tablet guarda lo que recibe y lo que marca (tachado, «Lista», «Visto»), con su hora.
  - El TPV guarda lo que ha mandado.
  - Al volver internet, los dos lo suben con los mismos ids, el servidor no duplica y las
    estadísticas quedan completas.
- **Quién manda en cada estado** cuando se cruzan: cocina en tachado, «Lista» y «Visto»; el TPV en
  envíos, anulaciones, marchas, urgentes y «Servido». Gana la marca de tiempo **del aparato que manda
  en ese estado**, nunca la del otro.
- **El papel de respaldo se queda**: solo sale si **no llega ni por la nube ni por la wifi**.

## Alcance

### 1 · La tablet de cocina escucha en la wifi

- Pieza nativa en la APK (Capacitor) que, **solo en un dispositivo `KITCHEN`**, abre un pequeño servidor
  en la red local (puerto fijo, configurable). Un terminal de caja no abre nada.
- **Autenticación obligatoria.** Al emparejar la cocina, el servidor le da una **clave de tienda**. Los
  terminales de esa tienda la reciben al conectarse. Cada mensaje por la wifi va **firmado** con esa
  clave y con un sello de tiempo, y se rechaza si la firma no vale, si es de otra tienda o si es
  demasiado viejo.
  - Cualquiera en la wifi del bar (un cliente con el móvil) **no puede meter ni leer comandas**.
  - La clave se rota al revocar un dispositivo.
- **El TPV y la tablet se encuentran**:
  - La tablet anuncia su IP y su puerto **en el latido** que ya manda al servidor, y el TPV los guarda.
  - Si la IP cambia sin internet (el router la reasigna), **redescubrimiento en la red local** (NSD,
    servicio propio) y, si tampoco, se reintenta con la última conocida.
- El TPV llama por la wifi **desde el puente nativo**: una página https no puede llamar a una IP local
  por http.

### 2 · El TPV manda por los dos caminos

- Cada operación de cocina sale a los dos sitios con el mismo id.
- La pantalla del TPV no espera a ninguno: la marca «enviado» la pone el primer acuse que llegue.
- Sin internet:
  - el TPV sigue enviando por la wifi;
  - el **«LISTO»** le llega preguntando a la tablet cada pocos segundos. Mientras haya internet, eso lo
    hacen los eventos de la nube;
  - **el «Deshacer» de 5 s funciona igual**.
- El papel solo sale si fallan los dos caminos. El aviso del TPV dice cuál ha fallado.

### 3 · La pantalla de cocina sabe por dónde le llega

- **Con internet**: como hoy, «En línea».
- **Sin internet pero recibiendo por la wifi** (algún terminal de la tienda le ha hablado hace poco):
  **franja ámbar** arriba, «Sin internet · recibiendo por la wifi del local». La pantalla **no se pone
  roja**, porque las comandas llegan.
- **Ni internet ni wifi**: la pantalla roja de kds-1, «SIN CONEXIÓN · las comandas no llegan».
- Al volver internet, lo recibido solo por la wifi se sube **sin duplicar**. Lo que llegue tarde por la
  nube y ya estuviera recibido no se pinta otra vez.

### 4 · Comprobarlo el día de la implantación

- En el TPV (ajustes de cocina) hay un botón **«Probar conexión directa con cocina»**. Manda un mensaje
  firmado por la wifi y dice, en palabras claras, si llega, cuánto tarda y, si no llega, la causa
  probable («el router aísla los aparatos: desactívalo o usa otra red»).
- Va al guion de implantación como puerta: **sin esa prueba en verde, el bar depende del papel cuando
  se va internet**.

## Restricciones

- **El terminal de caja no se ve afectado**: el cobro, el turno y el offline de v1.10 funcionan
  exactamente igual. Si el camino directo falla, solo cae a papel.
- **Nada de laboratorio en la build de producción** (lección A5): ni orígenes `http` en la APK, ni
  claves de prueba, ni puertos abiertos en un `TERMINAL`.
- Ni la alergia ni la comanda salen de la red del local en claro: lo que va por la wifi va firmado, y
  **cifrado** si el coste es razonable. Si no se cifra, el `-done` explica por qué.
- WebView 101 y la tablet de cocina: el servidor local es nativo, no depende del WebView.

## Verificación

Cada fila: se rompe el código, se ve el rojo, el mensaje real va al `-done`, y se restaura.

| Sabotaje | Debe caer |
|---|---|
| Quitar el descarte por id | el mismo envío por nube y wifi → una sola comanda en la tablet y en el servidor |
| Aceptar un mensaje sin firma o con la clave de otra tienda | 401/403 y nada en pantalla |
| Aceptar un mensaje firmado de hace 10 min | rechazado por viejo |
| Abrir el servidor local en un `TERMINAL` | un terminal no escucha en ningún puerto |
| Sin internet, el TPV no manda por la wifi | comanda en la tablet con la nube caída |
| Al volver internet, duplicar | tras reconectar, el servidor tiene cada comanda una vez y los tachados con su hora de cocina |
| Pisar la hora de cocina con la del TPV en un tachado | el `doneAt` es el de la tablet |
| Papel con la wifi funcionando | sin internet pero con wifi → no sale papel |
| Pantalla roja con la wifi funcionando | franja ámbar, no roja |
| La IP de la tablet cambia sin internet | redescubre y la siguiente comanda llega |
| Clave sin rotar al revocar | el terminal revocado no puede mandar por la wifi |

### La pasada en el hierro (criterio de cierre)

- Cuenta ENSAYO, D8 (AP13) como TPV y AP11 como cocina.
- **Se desenchufa el cable de internet del router dejando la wifi encendida.** No basta con el modo
  avión, que corta también la wifi.

Pasos, cronometrados:
1. Comanda de la M5 con el celíaco en la silla 3 → aparece en la tablet. Anotar los segundos.
2. «−» y «Deshacer», «Marchar 2º» y urgente, todo sin internet.
3. «Lista» en la tablet → «LISTO» en el D8 → «Servido».
4. **Botón «Probar conexión directa»** en verde.
5. Se vuelve a enchufar internet → el panel tiene las comandas una sola vez y los tiempos de cocina
   bien.
6. Se apaga el router entero → papel por USB en el D8 y pantalla roja en la tablet.
7. El D8 cobra durante toda la pasada.

## Entregables

- Rama `kds-2-wifi`, commits pequeños en español.
- `docs/blocks/kds-2-wifi-done.md` con:
  - la estructura de siempre;
  - las decisiones tomadas sin preguntar, una a una (sobre todo: cifrar o no, puerto, intervalo de
    sondeo y tiempo máximo de un mensaje);
  - los sabotajes con su rojo;
  - la pasada en el hierro con tiempos.
- Una línea nueva en el guion de implantación: «Probar conexión directa con cocina».
- **El push y el PR los hace Matías**: deja los comandos exactos al final.

## Fuera de alcance

- Que varias cajas se sincronicen entre sí sin internet (descartado).
- El informe de cocina (kds-3).
- Cocina en navegador.
- Impresoras de cocina por la wifi.
