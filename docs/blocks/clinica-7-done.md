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
| 49 | la excepción de «no pude comprobar» vuelve a salir del arranque | `arranque.ts` | 🔴 1 |

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

## 11bis · Lo que encontró el primer CI, y el portátil no

Dos rojos en la primera pasada, los dos **invisibles en local por el mismo
motivo**: este Mac tiene un `.env` en la raíz del repo y CI no.

1. **`smoke` · el contenedor no llegaba a servir `/health`.** El smoke
   arranca la imagen contra una base **sin migrar**, y
   `prisma.clinicalTenantKey.count()` lanza `P2021: la tabla no existe`.
   Esa excepción salía de `exigirArranqueClinico` y mataba el proceso: el
   log decía «la tabla no existe» y el job, «la API se paró antes de
   servir».

   **«No pude comprobar» no es «comprobado y está mal»**, y solo lo segundo
   justifica no arrancar: una base sin tablas no tiene ninguna historia
   clínica que proteger, y en un despliegue de verdad las tablas están. La
   revisión devuelve ahora `noSePudoComprobar`, se escribe como `warn` —
   para que nadie lea «arrancó» como «la KEK está bien»— y la API sigue.
   Es la regla de la casa que este bloque casi rompe: **nada del arranque
   puede lanzar**.
2. **`e2e` · seis 500 en `clinica-sesion-cobro.e2e.ts`.** Cerrar una sesión
   escribe una entrada cifrada, y `asegurarDek` no puede envolver nada sin
   `CLINICAL_KEK`. El único fichero que la ponía era `clinica-7.e2e.ts`, y
   en local corría antes —dejándola en el `process.env` del worker— además
   de que el `.env` de la raíz ya la traía. En CI no hay `.env` y el orden
   de vitest puso el del cobro primero.

   La KEK pasa a `e2e-env.ts`, el módulo que importan todos los ficheros de
   la suite, **fija y no aleatoria**: los ficheros comparten base, y uno que
   envolviera una DEK con una KEK distinta de la del siguiente dejaría un
   canario que no cuadra.

Reproducido en local apartando los dos `.env`: **los mismos seis fallos
antes, 617 verdes después**. La lección, para el siguiente bloque: lo que
el portátil no ve no es que no exista, es que el `.env` lo tapa.

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
631921e docs(clinica-7): el done del bloque
cd8716a fix(clinica-7): el arranque no tumba la API si no puede comprobar, y el e2e trae su KEK
9039272 docs(clinica-7): lo que enseñó el primer CI, y el verde del segundo
```

Y después del merge en `master` (`9d1b3a2`), lo de §18:

```
e3e7950 test(residencia): los fakes de residencia traen el contrato y el llavero
<este>  docs(clinica-7): residencia después del merge — el inventario en claro y el orden de las migraciones
```

---

## 17 · La rama

`master` se movió mientras el bloque estaba en vuelo: de `413057d` a
`d3613cf`, un commit de documentación de residencia-2.
`git diff --name-only 413057d origin/master` devuelve **tres ficheros**
(`docs/code-prompts/bloque-residencia-2.md`, `docs/residencia/00-decisiones.md`
y `docs/residencia/09-hoja-de-ruta.md`), ninguno de los cuales toca este
bloque. Sin conflictos.

**Pusheada**, y el PR contra `master` es el
[**#23**](https://github.com/matiasoyola/mipiace-tpv/pull/23).

**CI VERDE sobre `cd8716a`**, los tres jobs:
[run 38708244746](https://github.com/matiasoyola/mipiace-tpv/actions/runs/38708244746)
— `ci: pass` (4m10s) · `e2e: pass` (1m42s) · `smoke: pass` (4m0s).
`publish` se salta, como toca fuera de master.

La primera pasada, sobre `631921e`, salió con `e2e` y `smoke` en rojo: los
dos fallos y sus arreglos están en §11bis, y son la parte del bloque que el
portátil no podía ver.

**Push y PR: autorizados. Ni merge ni despliegue — eso es de Dirección.**

Y al desplegar hay mucho de lo que acordarse: §14, en ese orden, empezando
por generar las dos claves y guardarlas fuera del VPS.

---

## 18 · Residencia, después del merge

Esta sección no es del bloque: es lo que el bloque **le hace a lo que ya
estaba**. `clinica-7` se mergeó en `master` (`9d1b3a2`) cuando
`residencia-1` y `residencia-2` ya estaban dentro, y la puerta del contrato
de encargado no distingue: `conHistoria` es EL punto por el que pasa toda
ruta clínica, y la ficha de un residente y su plan de cuidados pasan por
ahí.

### 18.1 · Lo que se rompió, y era de los fakes

El CI del merge cayó en `Tests` con catorce rojos y un solo síntoma:

```
{"statusCode":500,"error":"Internal Server Error",
 "message":"Cannot read properties of undefined (reading 'findMany')"}
```

El `findMany` que no existe es `prisma.clinicalProcessorAgreement.findMany`,
el que `estadoDelTenant` llama desde el guard del 423. Los dos ficheros de
tests de residencia que montan rutas con `conHistoria` traían su Prisma en
memoria sin ese modelo:

| Fichero | Rojos | Rutas |
| ------- | ----- | ----- |
| `apps/api/test/residencia-controles.test.ts` | 13 | el plan del residente y la vista «hoy» (`plan-routes.ts`) |
| `apps/api/test/residencia-rutas.test.ts` | 1 | la ficha del residente (`residentes-routes.ts`) |

El arreglo es el mismo que llevan los siete ficheros clínicos, y por eso
`clinica-7-claves-fake.ts` existe: `contratoFake`, `llaveroFake` y
`kekDePrueba()`. **El contrato nace ACEPTADO**, que es el estado normal de
un centro que funciona — y en residencia lo es por construcción:
`tenants_residencia_exige_clinica` no deja encender la residencia sin la
clínica, y una clínica sin contrato no escribe. El 423 se prueba
vaciándolo o revocándolo en el test que va de eso (§18.7), nunca al
contrario.

Y las dos cachés de este bloque se vacían en el `beforeEach`
(`olvidarClaves()`, `olvidarEstado()`): duran 60 s y 30 s, o sea más que el
fichero de tests entero, así que sin eso el primer test decide el estado
del contrato de todos los demás. En `residencia-rutas` importa de verdad:
uno de sus tests apaga la clínica.

**La puerta en producción no se toca.** Lo que estaba mal era el doble, no
el guard: un centro de residencia de verdad tiene el contrato aceptado o no
escribe, y eso es exactamente lo que se quiere.

### 18.2 · Lo que NO sufrió, comprobado y no supuesto

- **El e2e de residencia** (`residencia-1.e2e.ts`, `residencia-2.e2e.ts`)
  no monta Fastify: entra por `$executeRawUnsafe` y por las funciones
  (`cargarCatalogoDeSerie`, `sembrarResidencia`). No cruza `conHistoria`,
  así que no tiene contrato que aceptar. Y la `CLINICAL_KEK` de la suite la
  pone `e2e-env.ts` para todos los ficheros desde §11bis.
- **El `smoke`** arranca la imagen contra un Postgres **sin migrar**. Lo de
  residencia que corre en el arranque es `cargarCatalogoDeSerie()`, y ya
  está envuelto: un `P2021` («la tabla no existe») sale como aviso y la API
  sigue sirviendo. Nada del contrato se consulta en el arranque.
- **El banco de la agenda** no tiene escenario de residencia: `seed/` son
  `peluqueria-demo.ts` y `clinica-demo.ts`, y el de la clínica ya acepta el
  contrato desde `8410164`. No hay centro de residencia que sembrar, así
  que no hay nada que arreglar ahí. El día que lo haya, tendrá que
  sembrar la fila de `clinical_processor_agreements` **y** la de
  `clinical_tenant_keys` — o la primera ficha de residente contestará 423.

### 18.3 · EL INVENTARIO: lo que residencia dejó EN CLARO

> **Cerrado en parte por `residencia-1b`** (D-63, 15-10-2026). Seis de las
> columnas de este inventario ya van cifradas: `resident_profiles.dni`,
> `.nss` y `.discharge_reason`; `care_plan_items.reason` y `.close_reason`;
> `bed_assignments.reason`. Con la maquinaria de este bloque —los mismos
> `sitio*` en `cripto-campos.ts`, el mismo CHECK de formato— y sin un
> segundo esquema de cifrado. Lo que SIGUE en claro, y por qué, está en
> `docs/blocks/residencia-1b-done.md`; lo gordo —el registro de cuidados—
> nace cifrado en `residencia-3`.

Esto es lo que hay que mirar, y no se arregla con un test.

`clinica-7` cifra **nueve columnas** y las nueve son de clinica-1 a
clinica-6. Las tablas que trajeron `residencia-1` y `residencia-2` están
**enteras en claro**, y algunas de sus columnas son datos de salud del
art. 9.1 con todas las letras.

#### `resident_profiles` · residencia-1, una fila por residente

| Columna | Qué dice | ¿Salud? |
| ------- | -------- | ------- |
| `dependency_level` | válido / semiasistido / dependiente | **sí** — es el grado de autonomía de una persona con nombre |
| `dependency_grade` | I, II, III de la Ley 39/2006 | **sí** — grado reconocido por la administración |
| `discharge_reason` | TEXTO LIBRE | **sí, y del peor** — «fallecimiento», «traslado al hospital por ictus» caben enteros · **CIFRADO en residencia-1b** |
| `admission_date` / `discharge_date` | fechas de estancia | por inferencia: dicen que esta persona vive en una residencia |
| `nss` | número de la Seguridad Social | identificador, y el que abre la historia en el SESCAM · **CIFRADO en residencia-1b** |
| `dni` | DNI | identificador; la propia migración ya dice «nunca en logs» · **CIFRADO en residencia-1b** |
| `place_type`, `responsible_*` | plaza y familiar de contacto | no son salud; son personales |

#### `care_plan_items` · residencia-2, EL PLAN DE CUIDADOS de un residente

Es la tabla que más pesa del inventario: cada fila es
`(client_id, control_code, frecuencia)`, o sea **«a Carmen se le controla la
glucemia cada ocho horas y la deposición cada turno»**. Eso es un
diagnóstico dicho con otras palabras.

| Columna | Qué dice |
| ------- | -------- |
| `control_code` | QUÉ se le controla: `GLUCEMIA`, `UPP_*`, `CONTENCION`… |
| `frequency_kind`, `every_n_hours`, `every_n_days`, `weekdays`, `month_day`, `shift_codes`, `moment_codes` | con qué INTENSIDAD, que junto al código dice la gravedad |
| `source`, `source_level` | si sale de la plantilla de su nivel de dependencia, y de cuál |
| `reason`, `close_reason` | TEXTO LIBRE: «úlcera sacra grado II», «se le retiró la sonda» · **LOS DOS CIFRADOS en residencia-1b** |
| `from_at` / `to_at` | la línea de tiempo clínica del residente |

#### `bed_assignments` · residencia-1

`reason` es texto libre y es dónde se escribe por qué cambió de habitación
(**cifrado en residencia-1b**):
«se cae de la cama», «aislamiento por GEA», «conflicto con la compañera».
Y la ubicación en sí habla: un `floor_id` cuya planta se llame «Unidad de
Alzhéimer» es un diagnóstico para todos los que duermen en ella — y
`floors.name`, `rooms.name` y `beds.label` son del centro, no de nadie, así
que no los cubre una DEK por tenant atada a una fila.

#### Lo que NO es dato de nadie, y por eso no entra

`control_types`, `control_type_options`, `center_control_settings`,
`care_plan_template_items`, `center_moments`, `care_roles` y las dos tablas
de asignaciones de personal. Llevan **vocabulario** de salud (la palabra
«glucemia», el rango de referencia de una tensión) y configuración del
centro, pero ni una fila es de un residente concreto. Las de `scope =
STANDARD` no tienen ni `tenant_id`: son el catálogo del producto. Cifrarlas
sería cifrar el diccionario.

### 18.4 · Y por qué no se cifra aquí y ahora

> **La tercera razón se re-decidió.** `residencia-1b` cifró los textos
> libres y los dos identificadores sin esperar a `residencia-3`, porque
> D-62 puso una fecha: antes del piloto con residentes reales. Las dos
> primeras razones siguen en pie tal cual — `control_code` sigue en claro
> por el índice único, y los CHECK se re-enseñaron uno por uno, que es lo
> que esta sección decía que había que hacer.

Tres razones, y la tercera es la que lo decide.

1. **`control_code` está en un índice del motor.**
   `care_plan_items_one_live_key` es `UNIQUE (client_id, control_code)
   WHERE to_at IS NULL` — es la garantía «una línea viva por residente y
   control», y hay otro índice más en `(client_id, control_code)`. El
   cifrado de este bloque es **no determinista** (el AAD y el nonce van
   dentro del ciphertext, decisión 15: dos valores del mismo paciente no
   son intercambiables), así que una columna cifrada **no puede sostener un
   índice único**. Cifrar `control_code` es renunciar a esa garantía del
   motor o cambiar el esquema de cifrado para esa columna. Ninguna de las
   dos cosas se hace de pasada.
2. **Los CHECK habría que re-enseñarlos, uno por uno.** Igual que
   `clinical_photos_retirada_completa` pasó de «lleva motivo» a «lleva
   motivo, en claro **o** cifrado» (§2 §3), cada CHECK de residencia que
   mire una columna de texto hay que afinarlo antes de que quepa el
   cifrado. Y están el `resident_profiles_alta_coherente` y los de
   coherencia de frecuencia de las cuatro tablas de residencia-2.
3. **El dato de salud GORDO todavía no existe.** Lo que hay hoy es el plan
   y la ficha. El REGISTRO —«a las 9:40 se le midió 142 de glucemia»— lo
   trae `residencia-3`, y las constantes y el libro de incidencias
   `residencia-4`. Retrofitar el cifrado sobre dos tablas ahora y volver a
   hacerlo sobre seis en febrero es hacerlo dos veces. **Lo que toca es que
   residencia-3 nazca cifrado**, con su `sitio*` en `cripto-campos.ts` y su
   CHECK de formato en la migración, y que la misma pasada se lleve
   `care_plan_items.reason`, `close_reason` y
   `resident_profiles.discharge_reason` — los tres textos libres, que son
   lo barato de cifrar porque nadie los consulta en SQL.

Lo que **sí** está puesto ya, y conviene decirlo para no pagarlo dos veces:
la ficha y el plan dejan **línea en `clinical_access_log`**, porque pasan
por `conHistoria`. El registro de accesos de residencia no está pendiente;
el cifrado sí. (La LISTA de residentes no deja línea, y es la decisión 1 de
`residentes-routes.ts`: sirve nivel de dependencia sin apuntar nada, a
propósito, porque es el cuadrante del office y no la historia.)

Y hay una consecuencia de contrato que conviene tener escrita: un centro de
residencia **ha aceptado** el contrato de encargado —no puede encender el
módulo sin la clínica, y la clínica pide el contrato—, y la letra c) de ese
texto promete medidas técnicas. Hoy esa promesa la cumplen nueve columnas
clínicas y no la cumplen las de residencia. **No es un incumplimiento del
bloque** (residencia no existía cuando se redactó el inventario), pero es
deuda con fecha: `residencia-3`.

### 18.5 · Las dos migraciones con la misma marca · `20261014000000`

```
20261014000000_clinica_7_blindaje
20261014000000_residencia_1_tipos
```

**No dan problema de orden, y está medido, no supuesto.** Tres cosas:

1. **El orden es determinista.** Prisma ordena por nombre de carpeta
   completo, así que la marca empatada la desempata el resto del nombre:
   `clinica_7_blindaje` < `residencia_1_tipos` porque `c` < `r`. Sobre base
   limpia, `_prisma_migrations` lo confirma:

   ```
   20261014000000_clinica_7_blindaje            10:31:02.702702+00
   20261014000000_residencia_1_tipos            10:31:02.767891+00
   20261014010000_residencia_1_cimientos        10:31:02.781878+00
   20261015000000_residencia_2_catalogo_y_plan  10:31:02.987500+00
   ```

   Y no es el primer empate del repo: `20261008010000` ya lo tienen
   `clinica_4_consentimientos_fotos_informe` y `kds_1_tipos`, y llevan dos
   semanas en producción.

2. **No hay dependencia cruzada.** `residencia_1_tipos` toca `tenants`
   (`residencia_enabled` y el CHECK que exige `clinical_records_enabled`,
   que es de **clinica-1**) y crea cuatro enums más el valor `ROOM`.
   `clinica_7_blindaje` crea dos tablas nuevas y añade columnas a tablas
   clínicas. Ni un objeto en común.

3. **El caso fuera de orden también vale, y es el que importa al
   desplegar.** En `master` —y en producción— las de residencia ya están
   aplicadas y la de clinica-7 llega después, o sea que entra una migración
   **lexicográficamente ANTERIOR** a la última registrada. Se probó con una
   copia del directorio de migraciones en el scratchpad: base nueva, se
   aplican las 77 de `master` sin `clinica_7_blindaje`, se añade la carpeta
   y se vuelve a lanzar `prisma migrate deploy`:

   ```
   Applying migration `20261014000000_clinica_7_blindaje`
   All migrations have been successfully applied.
   ```

   Sin error y sin aviso. Y el esquema resultante es **el mismo**: un
   `pg_dump -s` de las dos bases (la limpia en orden y la fuera de orden)
   difiere en cuatro líneas, y las cuatro son el nonce de `\restrict` de
   `pg_dump` y el `COMMENT ON SCHEMA public` que deja el `DROP SCHEMA` del
   `global-setup` del e2e. Ni una columna, ni un índice, ni un trigger.

Lo que **sí** hay que recordar al desplegar es lo de §14, que no cambia: el
`prisma migrate deploy` de residencia-2 y el de clinica-7 van en el mismo
despliegue, y la `CLINICAL_KEK` tiene que estar en el entorno **antes** de
que arranque el proceso.

### 18.6 · Verde, con el merge dentro

| Suite | Resultado |
| ----- | --------- |
| Unitaria (`pnpm vitest run`, desde la raíz) | **5106 pasan**, 3 saltados, 370 ficheros |
| e2e de la API (`test:e2e`) | **700 pasan**, 36 ficheros |
| `tsc --noEmit` · api · los seis paquetes · `tsc -b` de tpv-web y admin | limpio |

El `tsc` de la API sale limpio **sólo después de `pnpm --filter
@mipiacetpv/db run generate`**: el cliente de Prisma del portátil venía de
antes del merge y no conocía `centerShift`, `careRoleAssignment` ni
`residenciaEnabled`. Son 17 errores que no son de la rama, y el CI no los
ve porque genera el cliente antes de typechequear.

### 18.7 · Los sabotajes de esta sección

Tres pasadas sobre los dos ficheros arreglados, con el commit ya hecho
antes de tocar nada y `git checkout --` para volver.

| # | Sabotaje | Qué tiene que pasar | Qué pasó |
| - | -------- | ------------------- | -------- |
| 1 | Quitar `clinicalProcessorAgreement: contrato.modelo` del `fakePrisma` | rojo, y con el fallo del CI del merge | **13 rojos** en `residencia-controles`, todos `500 Cannot read properties of undefined (reading 'findMany')`. Es, carácter por carácter, lo que cayó en `9d1b3a2` |
| 2 | Dejar el modelo y **vaciar** el contrato (`contrato.vaciar()` en el `beforeEach`) | **423**, en lectura Y en escritura | **16 rojos** (13 + 3): `expected 423 to be 200`, con `error: "CONTRATO_ENCARGADO_SIN_ACEPTAR"` y el mensaje que manda a «Ajustes › Contrato de tratamiento de datos» |
| 3 | **Revocarlo** (`contrato.revocar()`) | 423 a las ESCRITURAS y nada más: la lectura sigue, que es el art. 28.3.g | **8 rojos**, y los ocho de escritura (`expected 423 to be 201`, `to be 409`, `to be 400`). Las lecturas del plan siguen en verde |

La diferencia entre el 2 y el 3 no es un detalle: es `negativaDelContrato`
haciendo lo que §1 dice que hace. **Sin aceptar nunca**, ni leer ni
escribir —una clínica recién encendida no sirve nada—; **revocado**, se
puede leer y no escribir, porque justo cuando se revoca es cuando se pide
la devolución de datos. Vale igual para el plan de cuidados de un
residente que para la historia de una paciente de podología, y sin una
línea de código de residencia: lo hereda de `conHistoria`.

Y el 1 es el que deja dicho **por qué el arreglo es de los fakes y no del
guard**: con el modelo puesto y el contrato aceptado, las setenta pasan.
