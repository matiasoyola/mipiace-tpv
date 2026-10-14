# Bloque clinica-7 · done

Rama `clinica-7-blindaje`, worktree
`~/Developer/Claude/Projects/mipiacetpv-clinica-7`, desde `origin/master` =
`413057d` (el prompt del bloque, que lleva clinica-1…6, enlaces-publicos y
el iva-exento-sanitario).

**Mi Piace es ENCARGADO DEL TRATAMIENTO de datos de salud.** Lo que este
bloque hace verdad son las cinco frases del prompt:

1. Una copia filtrada de la base, un volcado o el volumen de ficheros **no
   enseñan ninguna historia**.
2. Ni Matías ni soporte ven un diagnóstico **con un `SELECT`** en
   producción.
3. **Ningún PDF de salud sale por correo**: sale un enlace con clave.
4. **Nada clínico se escribe sin un contrato de encargado aceptado**, con
   prueba de quién, cuándo y qué texto exacto.
5. Al terminar con una clínica, sus datos **se devuelven y después se
   destruyen de verdad**, también en las copias.

Y la que decide la forma de casi todo lo demás: **nada de esto se le nota a
Sole.** La peluquería, el bar y el spa siguen con sus notas en claro, su
búsqueda por nota y su `SELECT` legible — porque lo que hay que blindar es
el dato de salud, no «no le gusta el secador».

---

## 1 · El paquete: el contrato y el estado, puros

`packages/contrato-encargado/` (27 tests). Dos ficheros y ninguna
dependencia: ni Prisma, ni Fastify, ni React, ni reloj.

| Qué | Dónde |
| --- | ----- |
| El texto de la v1, en nueve apartados, con `textoCanonico()` y `pendienteDeValidar` | `contrato.ts` |
| En qué estado está el módulo clínico de un negocio, y qué permite cada estado | `estado.ts` |

### La huella del texto está FIJADA POR TEST

`7baee64a600f5a9de15038758b7118f99185174acda455df9426b35126bd0d8a`, 6642
caracteres. Cambiar una coma de la v1 pone el test en rojo, y eso es el
punto: una fila de aceptación guarda «versión 1» y su huella; si el texto
se reescribiera en su sitio, la fila seguiría diciendo «aceptó la v1» y la
v1 sería otra cosa.

Cuando llegue el texto del abogado entra como **versión 2**, no
reescribiendo la 1.

Lo que hay cubre los mínimos del art. 28.3 RGPD —las ocho letras a) a h)
más el objeto, la duración, la naturaleza y el fin, el tipo de datos y las
categorías de interesados— escrito en la lengua que Rosario lee.
`pendienteDeValidar: true` pinta el aviso ámbar en la pantalla de
aceptación; la dueña **puede aceptar igual**, porque sin aceptación no se
escribe nada clínico y dejarla sin poder aceptar sería dejar la clínica sin
historia hasta que vuelva el abogado.

### UNA función con cuatro estados, y la usan los tres

```
estadoDelModuloClinico(entrada) →
  APAGADO | SIN_CONTRATO | VIGENTE | SOLO_LECTURA{REVOCADO | VERSION_ANTIGUA}
```

Y encima, los predicados: `permiteLeerHistoria`, `permiteEscribirHistoria`,
`admiteNotasEnCita`, `enseñaBandaDeSoloLectura`, y `negativaDelContrato`,
que devuelve el `code` y el `message` exactos del 423.

La misma función la llaman la API (para decidir el 423), el TPV (para
decidir qué pantalla pinta) y el panel (para pintar el estado). Con un `if`
propio en cada sitio, el día que cambie la regla la pantalla diría «puedes
escribir» sobre algo que el servidor considera revocado — y la podóloga
estaría escribiendo una sesión que se va a rechazar con la paciente
delante.

Un detalle que costó pensarlo: la comparación es `masAlta >= versionVigente`
y no `===`. Con `===`, un rollback del código a una versión anterior
—teniendo filas de la nueva— dejaría a la clínica en SOLO_LECTURA sin que
nadie hubiera revocado nada.

---

## 2 · La base: el motor sostiene lo que la aplicación promete

`packages/db/prisma/migrations/20261014000000_clinica_7_blindaje/` (885
líneas). Cinco partes.

### §1 · `clinical_processor_agreements`, de SOLO INSERCIÓN

La fila es la prueba de que alguien aceptó un texto concreto un día
concreto, así que **ni se edita ni se borra**: un trigger `BEFORE UPDATE OR
DELETE` levanta `CONTRATO_VIOLADO`. Mismo trato que `client_consents` y
`clinical_access_log`, y por lo mismo — una prueba editable no es una
prueba.

**Revocar es INSERTAR**, con `revokes_agreement_id` apuntando a la
aceptación que se retira. Así la tabla cuenta la historia entera: quién
aceptó la v1 en marzo, quién la revocó en octubre y quién volvió a
aceptarla en noviembre.

Y el `device_id` va con `ON DELETE RESTRICT` y no `SET NULL`: si el aparato
desde el que se aceptó se diera de baja, `SET NULL` borraría parte de la
prueba sin que nadie se enterara.

### §2 · `clinical_tenant_keys`: una clave por clínica

`tenant_id` como PK (una y solo una por clínica), `dek_wrapped` con un
CHECK de prefijo `^v[0-9]+:`, `kek_id`, un `canary` cifrado y
`destroyed_at`.

El trigger guardián admite **exactamente dos transiciones**: re-envolver la
DEK sin tocar el canario (eso es rotar la KEK) y la destrucción completa.
Cualquier otro UPDATE —cambiar el canario, resucitar una clave destruida,
mover una clave de tenant— lo rechaza el motor.

### §3 · Nueve columnas cifradas, cada una con su CHECK

Cada columna nueva lleva
`CHECK (col IS NULL OR col ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$')`: **texto en
claro no cabe** en una columna cifrada. Si un día una ruta nueva escribiera
el valor sin pasar por el cifrado, el motor la rechaza.

### §4 · Los triggers de inmutabilidad, RE-ENSEÑADOS

`clinical_entries` y `clinical_addenda` ya eran inmutables desde clinica-1.
El problema: cifrar lo que ya está escrito ES un UPDATE.

La salida fácil habría sido `ALTER TABLE … DISABLE TRIGGER` durante la
migración. En vez de eso, a cada trigger se le enseñó **cuál es la única
transición legítima** —poner el cifrado y vaciar el claro, y nada más— con

```sql
to_jsonb(NEW) - 'body' - 'body_cifrado' = to_jsonb(OLD) - 'body' - 'body_cifrado'
```

o sea: todo lo demás tiene que ser idéntico. Durante los minutos que dura
el script de cifrado, la historia clínica **no se queda sin garantías**.

### §5 · El código de 6 cifras y la entrega por enlace

`public_links.code_hash CHAR(64)` con su CHECK de 64 hex (el código en
claro NO CABE), `code_failures` con un guardián que solo deja subir el
contador y nunca cambiar la huella, y
`clinical_report_deliveries.pdf_file_name` / `public_link_id` con un CHECK
que exige que o van los dos o no va ninguno.

---

## 3 · El sobre: KEK, DEK y el AAD

Tres piezas, `apps/api/src/clinica/cripto.ts`, `claves.ts` y
`cripto-campos.ts`.

```
CLINICAL_KEK (entorno del VPS, 32 bytes)
   └─ envuelve →  DEK de cada clínica (fila de clinical_tenant_keys)
                     └─ cifra →  cada valor, con AAD = tenant|tabla|columna|fila
```

### Por qué una clave POR CLÍNICA y no una para todo

Porque es lo que hace posible la frase 5. Destruir la DEK de una clínica
deja sus datos ilegibles **en todas las copias que ya existen**, sin tocar
las de nadie más. Con una clave global, «devolver y destruir» sería borrar
filas — y las filas siguen en la copia de anoche.

### El AAD: `tenant|tabla|columna|fila`

Se arma en **un solo sitio** (`aadDe()`), y es lo que hace que un valor
cifrado no se pueda mover. Copiar el cuerpo cifrado de la visita de una
paciente a la fila de otra no da un descifrado equivocado: **da un fallo de
autenticación**. Lo mismo moverlo de columna o de clínica.

### La API NO ARRANCA sin la clave

`clinica/arranque.ts`: si hay **algún** tenant clínico —encendido o
apagado, porque el apagado conserva historias— y falta `CLINICAL_KEK`, o la
KEK no desenvuelve el canario de alguna clínica, el proceso sale con 1 y lo
dice en el log. Arrancar y escribir algo que después no se puede leer es
peor que no arrancar.

### Inventario completo de columnas

**Las nueve que se cifran**, con el nombre lógico que va en el AAD:

| Tabla | Columna (lógica) | Dónde vive cifrada | Por qué |
| ----- | ---------------- | ------------------ | ------- |
| `clinical_entries` | `body` | `body_cifrado` | la sesión entera: actos, marcas del pie, dolor, exploración, respuestas del cuestionario |
| `clinical_addenda` | `body` | `body_cifrado` | la anotación posterior a una visita |
| `clinical_photos` | `zona` | `zona_cifrada` | «pie izq. · dedo gordo» dice dónde tiene la lesión |
| `clinical_photos` | `withdraw_reason` | `withdraw_reason_cifrado` | el motivo de retirar una foto habla de la foto |
| `client_consents` | `revoke_reason` | `revoke_reason_cifrado` | por qué retira un consentimiento es salud |
| `clinical_assessment_corrections` | `correccion` (`question_id` + `value`) | `correccion_cifrada` | «antic = SÍ» es la respuesta corregida: anticoagulación |
| `appointments` | `notes` | `notes_cifradas` | «viene por lo del dedo infectado» |
| `clients` | `notes` | `notes_cifradas` | la nota de la ficha, en una clínica |
| `client_technical_notes` | `body` | `body_cifrado` | la ficha técnica por servicio |

Las **tres últimas son columnas compartidas con todo el producto** y por
eso se cifran **solo en los tenants con la clínica encendida** (decisión
10, `clinica/notas.ts`): en la peluquería de al lado la misma columna lleva
«no le gusta el secador» y cifrarla costaría la búsqueda por nota de
recepción sin comprar nada.

**Los tres ficheros del volumen**, cifrados con cabecera `MPC1` y con la
huella **del claro** (decisión 8): fotos clínicas, PDF de consentimientos
firmados y PDF de informes entregados por enlace.

**Y lo que se queda EN CLARO, con su motivo:**

| Qué | Por qué se queda legible |
| --- | ------------------------ |
| `clinical_access_log` entero (quién, cuándo, qué paciente, qué ruta) | es el registro de accesos: cifrarlo sería esconder la prueba. No dice *qué* pasa al paciente, dice quién lo miró |
| `client_consents.template_id`, `text_sha256`, `signer*` | qué documento se firmó y quién lo firmó, no qué le pasa al paciente |
| `clinical_photos.file_name`, `sha256`, `mime_type` | punteros y huellas; la huella es del claro y por eso sirve para verificar, y un SHA-256 no enseña la foto |
| `clinical_assessments.*` (estado, canal, fechas, validada por) | el flujo del cuestionario. **Las respuestas no están aquí**: están en la `clinical_entry` que cuelga de él, y esa va cifrada |
| `clinical_report_delivery.report`, `recipient`, `recipient_email` | a quién se le entregó qué tipo de documento y cuándo. Es la trazabilidad de la entrega; ver la divergencia declarada en §10 |
| `clients.first_name`, `last_name`, `phone`, `email` | identidad, no salud. Cifrarlos habría roto la búsqueda de clientes de todo el TPV, y el nombre de un paciente no dice qué tiene |

---

## 4 · Las rutas: el 423, y Mi Piace no abre historias

### El 423 cubre LEER y ESCRIBIR

`clinica/registro.ts`. Después de escribir la línea de acceso —siempre, con
`outcome: "DENIED"`— `conHistoria` consulta el estado del contrato y
contesta 423 con el código y el mensaje del paquete.

Que cubra la **lectura** no estaba en la primera versión y es la decisión 4
leída entera: «no se puede ni leer ni escribir nada clínico». Un
`CODIGO_CONTRATO_SIN_ACEPTAR` distinto del `CODIGO_CONTRATO_NO_VIGENTE`,
porque la pantalla hace cosas distintas con cada uno.

El estado se cachea 30 s. Aceptar y revocar vacían la caché del tenant en
el acto; el TTL es para el resto.

### Frente G · Mi Piace NO abre historias

Era un agujero real, y se vio mirándolo: `signImpersonationToken({ sub:
owner.id })` + `role: "OWNER"` significa que **la impersonación ES la
dueña**, y la dueña de una clínica es sanitaria. Un superadmin podía leer
cualquier historia, y la línea del registro llevaría el nombre de Rosario.

Cerrado en tres sitios, los tres con la **404 de ruta inexistente** —la
misma que ve un negocio sin el módulo (clinica-1 §1)—:

- el gate clínico (`clinica/gate.ts`),
- `conHistoria` (todas las rutas de historia),
- y las dos escrituras del contrato (aceptar y revocar).

El soporte sigue pudiendo lo suyo: ver que el módulo está encendido,
desbloquear una cuenta, mirar el registro de accesos. Lo que no puede es
abrir la historia de nadie.

Y una cosa más, del guard de cuentas bloqueadas: `GET /clinica/contrato` y
su PDF quedan **exentos** del bloqueo comercial. Una clínica con una
factura sin pagar sigue teniendo que poder descargar el contrato del art.
28 que aceptó — es su prueba de cumplimiento. Los dos POST no están
exentos, y ese guard lo pone la propia ruta.

---

## 5 · El informe sale por enlace, con clave, y sin adjunto

`apps/api/src/clinica/informe-*.ts` + `apps/api/src/enlaces/`.

El correo del informe **ya no lleva `attachments`**. Lleva un enlace, y hay
un test guardián que recorre los envíos clínicos y falla si alguno vuelve a
pasar un adjunto.

El enlace es el segundo `purpose` de `enlaces-publicos`, y **no se volvió a
escribir ni una línea de seguridad**: el formato del token, la huella, la
caducidad (7 días), las tres aperturas, la revocación, los dos límites de
peticiones, las tres cabeceras y la 404 común los decide la puerta con
`REGLAS_INFORME`. Lo nuevo del `purpose` es `pideCodigo: true`.

### La clave de 6 cifras

Se enseña **una sola vez**, en pantalla, a quien lo envía; se da en mano o
por teléfono. En la base solo está su SHA-256, y el CHECK del motor impide
guardar el código en claro.

Seis cifras es un millón de combinaciones, que sería poco **si se pudiera
probar**: **cinco fallos anulan el enlace**. Un atacante que ya tenga la
URL dispone de cinco intentos sobre un millón, 1 entre 200.000, y después
el enlace está muerto y hay que llamar a la clínica.

La comparación es en tiempo constante sobre las huellas, y no lleva KDF
lento a propósito: lo que un KDF encarecería es la apertura legítima, y el
ataque que frenaría (diccionario sobre la base filtrada) no abre nada sin
el token, que son 256 bits.

El código se comprueba **el último**, después de la caducidad y las
aperturas: así un enlace ya vencido no gasta intentos.

Y el `GET` público contesta lo mínimo para pintar el formulario —el nombre
de la clínica y «hace falta una clave»— **sin el tipo de informe ni el
nombre del paciente**, y sin gastar ni una apertura ni un intento. Si la
URL se filtra sin el código, lo que se filtra es el nombre de una clínica.

Cada apertura deja su línea en el registro de accesos, con el actor
«paciente por enlace» y `action = EXPORT`. Es lo que un adjunto no puede
decir nunca: quién lo abrió y cuándo.

---

## 6 · La devolución (art. 28.3.g) y la destrucción

`clinica/exportacion.ts` + `lib/zip.ts`.

«Descargar todas las historias» del panel da un ZIP con, por paciente: el
PDF de la historia completa (el mismo informe del derecho de acceso de
clinica-4), sus fotos **descifradas**, sus consentimientos firmados
descifrados, y en la raíz un `centro.json` con todo en estructura.

El PDF **y** el JSON porque contestan a dos personas: el PDF lo lee
Rosario, su abogado y el paciente que pide su historia; el JSON lo lee el
programa de la clínica siguiente (art. 20, portabilidad).

**Funciona con el contrato REVOCADO**, y es lo que hace que sirva de algo:
se revoca porque se termina la relación, y es justo entonces cuando hay que
devolver los datos. Técnicamente sale gratis — la ruta es `EXPORT` y el
guard del 423 mira `WRITE`.

Y deja **una línea de registro por paciente exportado**, no una línea «se
exportó el centro»: la pregunta que alguien hará es «¿quién se llevó la
historia de mi madre?».

El ZIP se escribe a mano (STORE, sin comprimir, en streaming) para no meter
una dependencia nueva. Los nombres de carpeta se transliteran
(`Rodríguez → Rodriguez`) porque el `unzip` de macOS no lee la marca UTF-8 y
el archivo era válido pero inextraíble; el nombre exacto, con sus tildes,
va dentro del JSON y de los PDF.

La **destrucción** es `destruirDek()`: borrar la clave de una clínica deja
sus datos ilegibles en la base y en todas las copias que ya existen. La
función está construida y probada; **la pantalla que la lanza no**, y es
deliberado (decisión 14): es una operación de superadmin con doble
confirmación y queda para su bloque.

---

## 7 · Las copias, cifradas con una clave que el VPS no tiene

`infra/backup-postgres.sh` cifra las dos mitades —el dump y el tar de
ficheros clínicos— con `age` **a una clave pública**. La privada no está en
el VPS: el servidor tiene que poder hacer copias y **no poder abrirlas**.
Si falta `MIPIACETPV_BACKUP_AGE_RECIPIENT`, el script no hace la copia: una
copia en claro de historias clínicas es justo lo que este bloque existe
para que no ocurra.

`infra/simulacro-de-restauracion.sh` contesta la pregunta entera —«¿puedo
volver a abrir la historia de una paciente a partir de esto?»— en cinco
pasos, y borra la base de prueba al terminar.

### El simulacro, ejecutado

```
══ SIMULACRO DE RESTAURACIÓN · 2026-10-14 15:43:12 +0200
── 1 · descifrar las dos mitades con la privada de age
   ✔ las dos se descifran y descomprimen
── 2 · restaurar en mipiacetpv_simulacro
   ✔ 80 tablas restauradas
── 3 · desempaquetar los ficheros clínicos
   ✔ 430 fichero(s) clínico(s)
── 4 · descifrar el canario de cada clínica y un fichero
   ✔ 1220ea0a…: el canario descifra
   ✔ 6a099506…: el canario descifra
   ✔ 6c3a70c7…: el canario descifra
   ✔ c66bc27d…: el canario descifra
   ✔ fa794b73…: el canario descifra
   ✔ 1220ea0a…: una foto se descifra y su huella cuadra (3003 bytes, estaba cifrada)
   ✔ 6a099506…: una foto se descifra y su huella cuadra (300003 bytes, estaba cifrada)
   ✔ 6c3a70c7…: una foto se descifra y su huella cuadra (300003 bytes, estaba cifrada)
   ✔ c66bc27d…: una foto se descifra y su huella cuadra (300003 bytes, estaba cifrada)
   ✔ fa794b73…: una foto se descifra y su huella cuadra (300003 bytes, estaba cifrada)
   ✔ 1220ea0a…: una entrada de historia se descifra y tiene 4 campos
   ✔ 6a099506…: una entrada de historia se descifra y tiene 11 campos
   ✔ 6c3a70c7…: una entrada de historia se descifra y tiene 11 campos
   ✔ c66bc27d…: una entrada de historia se descifra y tiene 11 campos
   ✔ fa794b73…: una entrada de historia se descifra y tiene 11 campos
   10 comprobación(es) de contenido, todas verdes.
── 5 · borrar la base de prueba

══ SIMULACRO SUPERADO · 2026-10-14 15:43:17 +0200
```

Sobre una copia de la base de desarrollo con cinco clínicas sembradas y 430
ficheros clínicos.

Un detalle que costó una vuelta: en macOS `gzip -t` devuelve 2 sobre un
`.tar.gz` perfectamente bueno (los bloques de ceros del final del tar), y
abortaba el simulacro sobre una copia sana. Tanto el script de copia como
el simulacro usan ahora `tar -tzf`, que además comprueba más.

---

## 8 · Las pantallas

| Pantalla | Dónde |
| -------- | ----- |
| La aceptación, con el texto entero y el aviso de «pendiente del abogado» | TPV, `ContratoDeTratamiento.tsx` |
| El aviso al que no es la dueña, sin texto y sin botón | lo mismo |
| La banda de solo lectura sobre las pantallas clínicas | lo mismo |
| La sección del panel: estado, aceptaciones, PDF, revocar, exportar | `admin/pages/ContratoTratamientoPage.tsx` |
| La tarjeta de la clave, una sola vez, al enviar el informe | TPV, `Informe.tsx` |
| La pantalla pública del informe: clave de 6 cifras y PDF | TPV, `InformePublico.tsx` |

Dos decisiones de pantalla que no son cosméticas:

- **La guarda falla ABIERTA.** Sin un estado de contrato legible se pinta
  lo de dentro. La autorización está en `conHistoria` (423) y en el gate
  (404); esta guarda es la mitad que AYUDA — enseña la pantalla de
  aceptación en vez de un 423 crudo. Fallar cerrada dejaría a la podóloga
  sin pantalla por una petición que no respondió, con la paciente delante.
- **El campo de la clave es `tel`, no `number`.** Con `number`, `042318` se
  convierte en `42318` y la persona no entiende por qué falla.

Y el PDF del contrato (`packages/ticket-pdf/src/contrato-encargado.ts`) se
arma desde el mismo texto del paquete: el papel que se descarga es, palabra
por palabra, el que se aceptó.

---

## 9 · Decisiones tomadas sin preguntar

1. **El 423 también en las lecturas**, con un código distinto del de
   revocado. El prompt dice «ni leer ni escribir»; la primera versión solo
   miraba escrituras.
2. **La impersonación del superadmin no entra en lo clínico**, con 404 de
   ruta inexistente y no 403. Un 403 confirma que la historia existe.
3. **Las notas compartidas se cifran según el tenant**, no siempre
   (decisión 10 leída al pie de la letra), y la decisión se toma en una
   sola función que devuelve las dos columnas ya escritas.
4. **El `sha256` de los ficheros es el del CLARO.** Es lo que permite
   verificar que lo que sale del sobre es lo que entró; la huella del
   cifrado solo verifica el sobre.
5. **La exportación funciona con el contrato revocado** (es `EXPORT`, no
   `WRITE`).
6. **El export lleva PDF y JSON**, no uno de los dos.
7. **Los nombres del ZIP se transliteran**, y el exacto va dentro.
8. **El código del enlace se comprueba el último**, para que un enlace
   caducado no queme intentos.
9. **La API no arranca sin KEK si hay clínicas**, incluidas las apagadas.
10. **`GET /clinica/contrato` queda exento del bloqueo comercial**, y los
    dos POST no.
11. **El script de cifrado corre con los triggers puestos**, enseñándoles
    la transición legítima en vez de apagarlos.
12. **El banco de la agenda siembra el contrato aceptado.** Sin esa fila la
    clínica del banco no puede ni leer ni escribir — el producto
    funcionando, pero el banco no es el capítulo del contrato.

---

## 10 · El bucle visual, y lo que encontró

`docs/qa/2026-10-14-clinica-7/` · las cinco pantallas a 1366, 1024 y 390,
con los tres estados del contrato movidos **en la base** y 32 s de espera
entre cada uno (la API cachea el estado 30 s). El README de esa carpeta
lleva el detalle; aquí va lo que cambió el código.

**Dos hallazgos, los dos arreglados y con su test visto rojo:**

1. **La pantalla de aceptación no se podía alcanzar.** Sin contrato, la API
   contesta 423 a la historia; `HistoriaViva` salía por su rama de error y
   devolvía el mensaje crudo **antes** de llegar a la guarda. La dueña veía
   un recuadro rojo diciendo que la dueña tiene que aceptar el contrato,
   sin ninguna forma de aceptarlo. La guarda envuelve ahora el componente
   desde fuera, en `HistoriaViva` y en `SesionPodologia`.

   Ninguna suite lo vio porque los tests de pantalla mockean la API y le
   dan a la guarda un estado legible: nunca pasaban por la rama de error.
2. **En solo lectura seguía ofreciéndose escribir.** La banda decía «no se
   puede escribir nada nuevo» y justo debajo seguía «Nueva visita», en
   negro y encendido. La guarda publica el estado por contexto y
   `useSePuedeEscribirHistoria()` lo contesta; las dos puertas desaparecen
   y «Hoy toca» vuelve a decir dónde se empieza.

**Y uno apuntado y no arreglado**, porque el arreglo es del punto de
montaje de clinica-6: la historia abierta **desde la ficha del cliente** se
pinta dentro de la tarjeta de 448 px, no a pantalla completa, y ahí el
informe se queda con el papel cortado. Desde la agenda —que es por donde se
trabaja— es un overlay a pantalla completa y no pasa.

**Las medidas**: las cuatro pantallas del TPV se quedan en **44 px** de
objetivo táctil mínimo a los tres anchos, y ese 44 es la flecha de volver
del overlay de clinica-6; todo lo que añade este bloque está en **48 o 56
px**. Sin scroll horizontal a ningún ancho. El panel se queda en 36 px (28
a 390), que es el tamaño que la casa lleva en el panel desde B1: los tres
botones nuevos siguen a sus vecinos en vez de inventarse una medida.

---

## 11 · Tabla de sabotajes

Cada garantía rota a propósito y **vista en rojo**, corriendo el fichero de
test **entero** (no un `-t`) y restaurando con `git checkout --` después de
cada una. El repo commiteado antes de empezar, que es la lección de
clinica-6.

| # | Qué se rompe | Dónde | Resultado |
| - | ------------ | ----- | --------- |
| **El paquete: el estado del módulo** |
| 1 | un contrato REVOCADO cuenta como vigente | `estado.ts` | 🔴 4 |
| 2 | una versión ANTERIOR cuenta como vigente | `estado.ts` | 🔴 5 |
| 3 | SIN contrato se puede LEER la historia | `estado.ts` | 🔴 2 |
| 4 | con el contrato revocado se puede ESCRIBIR | `estado.ts` | 🔴 5 |
| 5 | una cita nueva admite notas con el contrato revocado | `estado.ts` | 🔴 1 |
| 6 | el texto canónico deja de llevar los encabezados | `contrato.ts` | 🔴 2 |
| 7 | el contrato pierde un apartado del art. 28.3 | `contrato.ts` | 🔴 2 |
| **El sobre: AAD, canario y ficheros** |
| 8 | el AAD deja de llevar el ID DE LA FILA | `cripto.ts` | 🔴 4 |
| 9 | el AAD deja de llevar el TENANT | `cripto.ts` | 🔴 3 |
| 10 | cifrar NO pone el AAD (pero descifrar sí lo espera) | `cripto.ts` | 🔴 6 |
| 11 | el canario cuadra siempre | `cripto.ts` | 🔴 1 |
| 12 | un JPEG en claro se toma por un fichero cifrado | `cripto.ts` | 🔴 1 |
| 13 | la DEK envuelta no se ata al tenant | `cripto.ts` | 🔴 1 |
| 14 | la huella del fichero se calcula sobre el CIFRADO | `ficheros.ts` | 🔴 1 |
| 15 | el fichero se escribe EN CLARO en el volumen | `ficheros.ts` | 🔴 1 |
| 16 | la huella se comprueba ANTES de descifrar | `ficheros.ts` | 🔴 3 |
| **El llavero** |
| 17 | la carrera del primer día crea DOS claves | `claves.ts` | 🔴 1 |
| 18 | una clave DESTRUIDA se sigue sirviendo | `claves.ts` | 🔴 1 |
| 19 | rotar la KEK NO comprueba el canario antes de re-envolver | `claves.ts` | 🟢 → 🔴 1 |
| 20 | destruir dos veces pisa la fecha del primero | `claves.ts` | 🔴 1 |
| 21 | la API arranca SIN KEK teniendo clínicas | `arranque.ts` | 🔴 2 |
| 22 | el arranque solo mira los tenants ENCENDIDOS | `arranque.ts` | 🔴 1 |
| 23 | el arranque no mira los canarios | `arranque.ts` | 🔴 1 |
| **El contrato, en las rutas** |
| 24 | el guard del 423 solo mira las ESCRITURAS | `registro.ts` | 🔴 1 |
| 25 | el guard del 423 desaparece | `registro.ts` | 🔴 5 |
| 26 | el intento con el contrato revocado se apunta como ALLOWED | `registro.ts` | 🔴 1 |
| 27 | aceptar el contrato NO comprueba el OWNER de la base | `contrato-routes.ts` | 🔴 3 |
| 28 | aceptar el contrato lo puede hacer cualquiera | `contrato.ts` | 🔴 2 |
| 29 | revocar escribe UNA fila y no una por aceptación viva | `contrato.ts` | 🟢 → 🔴 1 |
| **Mi Piace no abre historias** |
| 30 | la IMPERSONACIÓN pasa el gate clínico | `gate.ts` | 🟢 → 🔴 1 |
| 31 | la IMPERSONACIÓN pasa `conHistoria` | `registro.ts` | 🟢 → 🔴 1 |
| 32 | la IMPERSONACIÓN puede ACEPTAR el contrato | `contrato-routes.ts` | 🔴 4 |
| **El enlace del informe** |
| 33 | el enlace del informe NO pide código | `reglas.ts` | 🔴 12 |
| 34 | la puerta no comprueba el código | `puerta.ts` | 🔴 3 |
| 35 | cinco fallos NO anulan el enlace | `puerta.ts` | 🔴 1 |
| 36 | el fallo del código NO se cuenta en la fila | `puerta.ts` | 🔴 2 |
| 37 | un enlace sin código guardado abre sin código | `codigo.ts` | 🟢 → 🔴 1 |
| 38 | el código se guarda EN CLARO en la fila | `puerta.ts` | 🔴 4 |
| 39 | el código VIAJA en el correo | `informe-routes.ts` | 🔴 1 |
| 40 | **VUELVE EL ADJUNTO al correo del informe** | `informe-routes.ts` | 🔴 3 |
| 41 | la apertura del informe NO deja línea en el registro | `reglas.ts` | 🔴 1 |
| 42 | la apertura del informe no gasta ninguna de las tres | `informe-publico.ts` | 🔴 2 |
| 43 | el `GET` del enlace enseña el tipo de informe | `informe-publico.ts` | 🔴 1 |
| **Lo compartido, y la devolución** |
| 44 | las notas se guardan EN CLARO en un tenant clínico | `notas.ts` | 🟢 → 🔴 2 |
| 45 | la exportación del centro NO deja línea por paciente | `exportacion.ts` | 🔴 2 |
| 46 | el ZIP no pone el CRC de cada entrada | `zip.ts` | 🔴 2 |

Y los dos del bucle visual, en `clinica-7-pantallas.test.tsx`:

| # | Qué se rompe | Dónde | Resultado |
| - | ------------ | ----- | --------- |
| 47 | la guarda vuelve a envolver solo el árbol ya cargado | `HistoriaViva.tsx` | 🔴 3 |
| 48 | `useSePuedeEscribirHistoria` deja de mirar el estado | `ContratoDeTratamiento.tsx` | 🔴 1 |

### Los seis que salieron VERDES, que son los que enseñaron algo

- **#19 · rotar la KEK sin comprobar el canario.** El código comprobaba y
  nada lo probaba: la rotación se probaba siempre sobre claves sanas. Un
  test con una fila cuyo canario no cuadra, que ahora exige que esa clínica
  salga en `fallidas` **y que su fila no se haya tocado**.
- **#29 · revocar escribiendo una sola fila.** Con una única aceptación
  viva —el caso normal— escribir «una» y escribir «una por cada» es lo
  mismo. Test con DOS aceptaciones vivas, que es lo que pasa cuando alguien
  acepta desde dos aparatos.
- **#30 y #31 · la impersonación.** Había pruebas de que un superadmin no
  llega a la historia, pero pasaban por los dos filtros a la vez: quitar
  uno dejaba el otro trabajando. Un test por capa, cada uno contra su
  función.
- **#37 · `codigoCuadra` con la huella a `null`.** La rama que impide que
  un enlace sin código guardado se abra sin código no la tocaba nadie.
- **#44 · las tres notas compartidas.** Solo las cubría el e2e, y el e2e no
  entra en esta cuenta. Ahora tienen su test unitario.

Los seis se cerraron con test nuevo y se volvieron a sabotear: los seis
rojos.

---

## 12 · Divergencias declaradas

1. **El PDF del informe se GUARDA**, y clinica-4 §3 decía que el informe se
   arma y se tira. Con entrega por enlace no hay alternativa: el
   destinatario lo abre días después. Se guarda **cifrado**, con su huella
   del claro, y solo para las entregas por enlace — el informe que se
   imprime sigue sin dejar fichero.
2. **El ZIP no es ZIP64.** Tope de 4 GiB por paquete, con un error claro
   (`ZipDemasiadoGrande`) si se pasa. Una clínica de 500 pacientes con
   fotos está un orden de magnitud por debajo; ZIP64 se hace el día que
   haga falta, no antes.
3. **El tipo de informe entregado queda en claro** en
   `clinical_report_deliveries.report` (`RESUMEN`, `DERIVACION`,
   `COMPLETA`). Es trazabilidad de la entrega y no contenido clínico, pero
   «derivación» insinúa algo. Se deja dicho: si Dirección lo quiere
   cifrado, es una columna más del mismo mecanismo.
4. **El texto del contrato es de ejemplo** (`pendienteDeValidar: true`).
   Entra como versión 2 cuando llegue el del abogado.
5. **La pantalla de crypto-shredding no existe** (decisión 14 del prompt).
   La función sí.

---

## 13 · Rendimiento

El criterio del prompt: **≤ 50 ms de regresión** al abrir la historia de un
paciente grande (mediana de 20 aperturas).

Medido sobre un paciente con **200 visitas y 20 fotos**, cuatro pasadas
antes y después del cifrado:

| Pasada | Antes | Después | Diferencia |
| ------ | ----- | ------- | ---------- |
| 1 | 20,2 ms | 17,7 ms | **−2,5 ms** |
| 2 | 19,0 ms | 19,4 ms | **+0,4 ms** |
| 3 | 19,7 ms | 19,4 ms | **−0,3 ms** |
| 4 | 19,4 ms | 17,6 ms | **−1,8 ms** |

Dentro del ruido, y dos órdenes de magnitud por debajo del criterio.
AES-256-GCM sobre unos kilobytes por fila no se nota al lado de la consulta
que los trae: lo que tarda es Postgres, no el descifrado.

---

## 14 · Al desplegar

**En este orden, y sin saltarse el 1.**

### 1 · Lo que hace una persona, ANTES de tocar el VPS

```
node scripts/generar-claves-clinicas.mjs
```

Imprime dos cosas y no escribe nada en disco:

- **`CLINICAL_KEK`** — va al entorno del VPS. **Si se pierde, se pierden
  todas las historias clínicas.** Guardarla en **dos sitios fuera del VPS**
  (gestor de contraseñas + copia física), y conservarla **al menos cinco
  años**: la Ley 41/2002 obliga a conservar la historia y una historia que
  no se puede descifrar no está conservada.
- **El par de `age`** — la **pública** va al VPS
  (`MIPIACETPV_BACKUP_AGE_RECIPIENT`). **La privada NO va al VPS**, y se
  guarda igual que la KEK, en dos sitios y cinco años. El servidor tiene
  que poder hacer copias y no poder abrirlas; si la privada estuviera en el
  VPS, una copia filtrada vendría con la llave puesta.

Esto lo teclea Matías. Hasta que esté hecho, lo demás no se empieza.

### 2 · Una copia de la base, a mano, antes de migrar

```
infra/backup-postgres.sh
```

La de antes del bloque, la que se restaura si algo sale mal. Esta todavía
irá en claro si `MIPIACETPV_BACKUP_AGE_RECIPIENT` no está puesta — **se
guarda fuera del VPS y se borra en cuanto el paso 5 dé verde**.

### 3 · Las variables nuevas del VPS

| Variable | Qué es | Si falta |
| -------- | ------ | -------- |
| `CLINICAL_KEK` | base64 de 32 bytes, del paso 1 | la API **no arranca** si hay alguna clínica |
| `CLINICAL_KEK_ID` | nombre de la KEK en curso (`kek-1`) | vale el valor por defecto |
| `MIPIACETPV_BACKUP_AGE_RECIPIENT` | la **pública** de `age` | el script de copia **no hace la copia** |

`infra/Dockerfile` ya instala `age` en la imagen.

### 4 · La migración y el cifrado de lo que ya está escrito

```
pnpm --filter @mipiacetpv/db run migrate:deploy
pnpm --filter @mipiacetpv/api exec tsx src/scripts/cifrar-lo-existente.ts
#   ← mirar el resumen: filas cifradas, ficheros cifrados, 0 fallos
pnpm --filter @mipiacetpv/api exec tsx src/scripts/cifrar-lo-existente.ts --vaciar
```

El script es **idempotente** (se puede relanzar y continúa donde iba),
**verifica cada fila** descifrándola antes de seguir, y **no borra nada**
hasta que alguien pasa `--vaciar` — que es una pasada aparte, con la
verificación de la anterior ya mirada. Corre **con los triggers puestos**.

**Y la comprobación de que no queda nada en claro: volver a lanzarlo.** El
script es idempotente y cada paso lleva su `WHERE … IS NULL`, así que una
tercera pasada con `--vaciar` que imprima `+0` en todas las líneas y
`cifrados 0, ya estaban N` en los ficheros es la prueba de que no queda
nada pendiente ni en las filas ni en el volumen.

En el ensayo sobre una copia de desarrollo con 50 pacientes y 2000 visitas
se comprobó además a mano, que es lo que de verdad contesta la frase 1 del
prompt: un `pg_dump` del esquema completo buscando la frase canario de las
visitas (**cero apariciones**, y 50 de la frase de la ficha antes de
`--vaciar`), y un recorrido del volumen buscando cabeceras JPEG y `%PDF`
(**cero ficheros en claro**). Y el e2e hace la misma pregunta en cada pasada, mirando
**más**: en vez de llamar a `pg_dump` vuelca `x::text` de cada fila de
**cada tabla del esquema** —también las que nadie listó— y comprueba que el
canario no está en ninguna.

### 5 · El simulacro, contra la PRIMERA copia nocturna cifrada

A la mañana siguiente, con la primera copia que ya salió cifrada:

```
infra/simulacro-de-restauracion.sh <copia.sql.gz.age> <clinico.tar.gz.age>
```

Tiene que terminar en `SIMULACRO SUPERADO`. **Hasta que ese simulacro dé
verde, la copia en claro del paso 2 no se borra**: es lo único que
demuestra que de la copia cifrada sale una historia legible.

### Lo que NO se despliega con esto

La pantalla de destrucción de claves (no existe), el texto definitivo del
contrato (entra como v2) y el ZIP64.

---

## 15 · Verde

| Suite | Resultado |
| ----- | --------- |
| Unitaria (`pnpm vitest run`) | **4769 pasan**, 3 saltados, 356 ficheros |
| e2e de la API (`test:e2e`) | **617 pasan**, 34 ficheros |
| `tsc --noEmit` · api, tpv-web, admin, e2e-ui | limpio |
| Banco de la agenda · capítulo 11 | **4 de 4** |

Sobre el **capítulo 12 del banco**: queda rojo, y **no es de este bloque**.
Falla en dos colisiones de selector que vienen de clinica-5 —hay dos
botones cuyo nombre empieza por «Uña encarnada» (la lesión y el acto), y
«Quiropodia» ya no es un botón de tratamiento sino un chip de tipo
deshabilitado—. El único cambio de este bloque en esa pantalla es el
envoltorio de la guarda (`git diff` de `SesionPodologia.tsx`: 19 líneas,
todas del envoltorio). Ponerlo verde es reescribir el capítulo contra la
interfaz de clinica-5, y eso es otro bloque.

### Lo nuevo de este bloque

- `packages/contrato-encargado/test/contrato-encargado.test.ts` (27) · la
  huella fijada, los apartados del art. 28.3, los cuatro estados y los
  predicados.
- `apps/api/test/clinica-7-cripto.test.ts` (45) · el AAD, el canario, los
  ficheros, el llavero, la rotación, la destrucción, el arranque y las
  notas compartidas.
- `apps/api/test/clinica-7-contrato-rutas.test.ts` (31) · aceptar, revocar,
  el 423 de lectura y escritura, el OWNER contra la base, y Mi Piace que no
  mira.
- `apps/api/test/clinica-7-informe-enlace.test.ts` (21) · el código, los
  cinco fallos, el correo sin adjunto, las tres aperturas y la 404 común.
- `apps/api/test/clinica-7-zip.test.ts` (7) · el ZIP contra el `unzip` del
  sistema.
- `apps/api/test/clinica-7-exportacion.test.ts` (6) · el paquete del
  centro, con el contrato revocado y con su línea por paciente.
- `apps/tpv-web/test/clinica-7-pantallas.test.tsx` (28) · la guarda, el
  aviso, la banda, la clave de 6 cifras, y los dos hallazgos del bucle.
- `apps/api/test-e2e/clinica-7.e2e.ts` (32) · el camino entero contra
  Postgres de verdad, incluido el volcado del esquema completo, tabla a
  tabla, buscando el canario.

---

## 16 · Commits

```
7045290 feat(clinica-7): el contrato de encargado y el estado del módulo, puros
6427462 feat(clinica-7): el contrato queda escrito, la clave es por clínica y el texto cifrado
0ce3ddd feat(clinica-7): la clave por clínica, el AAD y el texto clínico cifrado
0096264 feat(clinica-7): sin contrato vigente no se escribe nada clínico (423)
6ef48b7 feat(clinica-7): las rutas del contrato, el PDF de cada versión y las tres notas compartidas
34315f9 feat(clinica-7): el informe sale por enlace con código, y ni un adjunto
d5a7d07 feat(clinica-7): la devolución de datos del art. 28.3.g, en un ZIP
5bb8464 feat(clinica-7): las claves, el cifrado de lo ya escrito y las copias con age
d728b58 feat(clinica-7): Mi Piace no abre historias, y el 423 también niega la lectura
6b12e59 test(clinica-7): los sabotajes del enlace, los del motor y el guardián de los adjuntos
564dbef feat(clinica-7): las pantallas — aceptación, banda, la clave y la sección del panel
6fc4075 test(clinica-7): el ZIP contra el unzip del sistema, y la exportación
dc3cc3e test(clinica-7): los seis sabotajes que salieron VERDES
cf639b3 fix(clinica-7): la guarda del contrato envuelve también la rama de error
f5c3a7f fix(clinica-7): en solo lectura la historia no ofrece empezar una visita
b887a2c docs(clinica-7): el bucle visual — capturas, medidas y dos hallazgos
8410164 fix(clinica-7): el banco de la clínica acepta el contrato, y el capítulo 11 mira lo cifrado
<este>  docs(clinica-7): el done del bloque
```

---

## 17 · La rama

`master` se movió mientras el bloque estaba en vuelo: de `413057d` a
`d3613cf`, un commit de documentación de residencia-2.
`git diff --name-only 413057d origin/master` devuelve **tres ficheros**
(`docs/code-prompts/bloque-residencia-2.md`, `docs/residencia/00-decisiones.md`
y `docs/residencia/09-hoja-de-ruta.md`), ninguno de los cuales toca este
bloque. Sin conflictos.

**Push y PR: autorizados. Ni merge ni despliegue — eso es de Dirección.**

Y al desplegar hay mucho de lo que acordarse: §14, en ese orden, empezando
por generar las dos claves y guardarlas fuera del VPS.
