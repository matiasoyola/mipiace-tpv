# clinica-4 · el mockup recorrido en el producto real

`docs/mockups/clinica-4-fotos-consentimientos-informe.html` recorrido entero
en la pantalla de verdad, a **1366, 1024 y 390**, entrando con el PIN de la
podóloga y **desde la cita del día** — que es donde la sesión existe y donde
la segunda puerta se ve.

El paciente es Carmen, con la historia **mezclada v1 + v2** de clinica-6
(valoración validada con sus tres alertas, una sesión v1, una exploración y
dos v2) y, encima, lo de este bloque:

| Qué | De dónde sale |
| --- | ------------- |
| La cita de hoy es de **Cirugía** | el servicio «Cura», de la categoría `cirugia` |
| …y ese servicio **pide dos consentimientos** | `service_scheduling.consentimientos = {cirugia-ungueal, anestesia-local}`, que es lo que la dueña marca en el Catálogo de agenda |
| El de **fotos** no lo pide nadie | no se ata a ningún servicio: lo pide la primera foto |

**La semilla se rehace antes de cada ancho.** Firmar es una escritura que no
se deshace (la tabla es de solo inserción), así que sin rehacerla la captura
de «falta el consentimiento de hoy» sólo existiría a 1366.

## Las capturas

| # | Qué enseña |
| - | ---------- |
| `01-sesion-falta-consentimiento` | la segunda puerta: la banda ámbar con los DOS que faltan y «Firmar ahora». No es un error rojo |
| `02-consentimiento-por-firmar` | «Firmar ahora» abre directamente el que falta: el texto, el aviso de que es de ejemplo y la caja de firma |
| `03-consentimientos-lista` | los tres, con el que pide la cita marcado y «lo pide la primera foto» en el de fotos |
| `04-consentimiento-con-firma` | el trazo del dedo dentro de la caja, y «Firmar» ya encendido |
| `05-consentimiento-firmado` | el acuse: quién firmó, cuándo y delante de quién, con su nº de colegiado |
| `06-sesion-sin-banda` | con los dos firmados, la banda desaparece y la sesión se puede cerrar |
| `07-fotos-sin-consentimiento` | las fotos antes de firmar: no hay cámara, hay un camino |
| `08-consentimiento-de-fotos` | el de fotos, abierto desde ahí |
| `09-camara-sin-zona` | la cámara abierta y el disparador **apagado**: falta elegir la zona |
| `10-camara-con-zona` | la zona elegida y el disparador encendido |
| `11-una-sola-foto` | con una, no se compara: lo dice en vez de enseñarla dos veces |
| `12-comparador-antes-y-ultima` | antes y última, con su fecha, y la rejilla de todas |
| `13-historia-zona-con-fotos` | el hueco que clinica-6 dejó escrito, lleno: el comparador en el pie vivo |
| `14-documentos` | la valoración, los tres consentimientos con su PDF y lo que se haya entregado |
| `15-informe-resumen` | el papel tal como sale impreso: centro, colegiado, fecha, alertas, lo encontrado, visitas y la gráfica del dolor |
| `16-informe-derivacion` | con el motivo que escribe la sanitaria |
| `17-informe-historia-completa` | el del derecho de acceso: la valoración entera, la exploración y los consentimientos |

## Las medidas

`medidas-de-clinica-4.json`, tomadas **sobre la página** y acotadas a la
pantalla que se mide (detrás del overlay siguen montadas la agenda y la
venta, con sus botones de 32 px).

| Ancho | Consentimientos | Firma | Cámara | Fotos | Informe | Scroll horizontal |
| ----- | --------------- | ----- | ------ | ----- | ------- | ----------------- |
| 1366 | 72 px | **48 px** | **48 px** | **48 px** | **48 px** | no |
| 1024 | 72 px | **48 px** | **48 px** | **48 px** | **48 px** | no |
| 390 | 72 px | **48 px** | **48 px** | **48 px** | **48 px** | no |

(El número es el lado menor del objetivo táctil más pequeño de cada
pantalla. El prompt pide ≥ 44 px; el mínimo de la casa es 48.)

Y lo que una captura no dice, preguntado a la página:

| Qué se midió | 1366 | 1024 | 390 |
| ------------ | ---- | ---- | --- |
| «Firmar» apagado sin trazo | sí | sí | sí |
| …y encendido al dibujar | sí | sí | sí |
| La banda desaparece al firmar los dos | sí | sí | sí |
| Disparador apagado sin zona | sí | sí | sí |
| …y encendido al elegirla | sí | sí | sí |
| **Antes y última EN LA MISMA FILA** | sí | sí | no (apiladas) |
| **El papel y los tipos, en dos columnas** | sí | sí | no (apilados) |
| Un € en el papel | **no** | **no** | **no** |

**A 390 el comparador se apila, y es la misma decisión que los dos pies de
clinica-6**: lado a lado serían 163 px por foto, y lo que se mira en un
comparador de uñas es el detalle. Apiladas van a 332 px.

## Lo que encontró el bucle y no la suite

Cinco, y las cinco están arregladas con su test:

1. **La sesión se caía entera contra el ErrorBoundary**: `Cannot read
   properties of undefined (reading 'puede')`. `serializarVista` es un
   allowlist campo a campo y el campo nuevo no estaba en la lista, así que
   la respuesta REAL no llevaba `consentimientos`. Los tests de pantalla
   mockean la respuesta y los de la vista miran el objeto, no el
   serializado: lo vio abrir la sesión. Test nuevo sobre el JSON que sale.
2. **El aviso de la cámara tapaba el disparador.** Con el texto a
   `bottom-5` y el botón a `bottom-4`, Playwright se negó a pulsarlo
   («element would receive the click») — y en la tablet la podóloga habría
   tocado el disparador sin que pasara nada. Ahora va encima y con
   `pointer-events-none`.
3. **Las 22 zonas ocupaban cinco filas y dejaban el visor bajo el
   pliegue** a 390. Y es el caso normal del primer día, cuando al paciente
   no se le ha marcado nada. Una sola fila que se desliza.
4. **«Col. Col. 45-0312»** en la pestaña de Documentos: el nº de colegiado
   es texto libre y la mitad del personal escribirá el «Col.» dentro, pero
   todo lo que lo imprime le pone su propio rótulo. Se normaliza una vez,
   en el borde de la API.
5. **El RESTRICT rompía el seed del banco.** `borrarClinica` borra el
   tenant, y con un consentimiento firmado dentro eso ya no se puede
   (`client_consents_tenant_id_fkey`). Es la garantía de S3 funcionando:
   lo que había que arreglar era el seed, no la garantía. Lo cazó rehacer
   la semilla entre dos anchos.

Y una del propio mockup, de redacción: la banda repetía «se lee con el
paciente y se firma aquí» dos veces seguidas (una en el mensaje del
servidor y otra en la línea de abajo). La segunda dice ahora sólo lo que la
primera no dice.

## Dos detalles del banco, para quien lo repita

- **El «Cancelar» del panel de la cita se come el de la tarjeta.** Detrás
  del overlay sigue montado el detalle de la cita, con su «Cancelar» rojo
  (el de anular la cita) antes en el DOM. Hay que acotar al contenedor.
  Es la misma lección que clinica-6 dejó escrita y volvió a costar una
  vuelta.
- **Al volver de la sesión el panel de la cita sigue abierto**, y a 390
  tapa la rejilla entera: el clic sobre la tarjeta de detrás agota el
  tiempo sin decir por qué. Si el botón ya está, se usa.
- Y la **cámara de pega** de Chromium (`--use-fake-device-for-media-stream`)
  es lo que hace que estas capturas enseñen un visor y no «No se pudo abrir
  la cámara». El verde es el vídeo sintético del navegador.

## Un detalle de la semilla, que no es del producto

Las visitas antiguas de la semilla se escriben **sin cita** (`appointment_id`
NULL), así que `ultimaSesion` —que excluye la cita de hoy con un `not`— no
las ve y la cámara ofrece las 22 zonas en vez de las marcadas. En producción
toda sesión cuelga de una cita (clinica-3) y la cámara ofrece primero lo que
el paciente ya tiene marcado. Se deja dicho para que nadie lea la captura
como un fallo de la pantalla.
