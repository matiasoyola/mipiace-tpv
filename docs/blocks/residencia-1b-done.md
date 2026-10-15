# Bloque residencia-1b · done

Rama `residencia-1b`, worktree
`~/Developer/Claude/Projects/mipiacetpv-residencia-1b`, desde
`origin/master` = `ee2c7f9` y rebasada al final sobre `e4e9339` (el hotfix
de infra que mete la `CLINICAL_KEK` en el `environment` del compose de
producción). PR contra `master`.

**El día que entren los 48 residentes de verdad, una copia de la base
robada o un `SELECT` indebido sobre el Postgres no da ni un DNI, ni un
NSS, ni «úlcera sacra grado II», ni «fallecimiento».** Y destruir la DEK
del centro al terminar el contrato deja ilegible todo eso también en las
copias que ya existen.

Eso es el bloque entero. Lo demás es cómo.

---

## 1 · Lo que se cifró, y dónde vive

Seis columnas (D-63). **Con la maquinaria de `clinica-7` tal cual**: los
mismos `cifrarValor` / `descifrarValor`, el mismo `cripto-campos.ts`, el
mismo prefijo `c1:`, el mismo AAD `tenant|tabla|columna|fila`, la misma
DEK por tenant envuelta por la `CLINICAL_KEK`. Ni una línea de un segundo
esquema de cifrado.

| Tabla | Columna (lógica) | Dónde vive cifrada | `sitio*` |
| --- | --- | --- | --- |
| `resident_profiles` | `dni` | `dni_cifrado` | `sitioDniDeResidente` |
| `resident_profiles` | `nss` | `nss_cifrado` | `sitioNssDeResidente` |
| `resident_profiles` | `discharge_reason` | `discharge_reason_cifrado` | `sitioMotivoDeAlta` |
| `care_plan_items` | `reason` | `reason_cifrado` | `sitioMotivoDeLinea` |
| `care_plan_items` | `close_reason` | `close_reason_cifrado` | `sitioMotivoDeCierreDeLinea` |
| `bed_assignments` | `reason` | `reason_cifrado` | `sitioMotivoDeOcupacion` |

Nueve de clinica-7 más estas seis: **quince columnas cifradas** en la
casa. Y el inventario está fijado por dos tests que se miran desde lados
distintos —uno cuenta los CHECK en el esquema real
(`clinica-7.e2e.ts`), otro los cuenta sobre el SQL de las migraciones y
los compara con los `sitio*` (`residencia-1b-cifrado.test.ts`)—, así que
una columna cifrada sin su sitio, o un sitio sin su CHECK, se ve.

### Dos detalles del AAD que no son adorno

**Las tres de `resident_profiles` llevan el `clientId` como id de fila.**
Esa tabla no tiene columna `id`: su primaria ES el cliente. Por eso son
las únicas de la casa que no necesitan `nuevoIdDeFila()` — el id se sabe
antes de insertar porque es el del residente.

**El motivo de apertura y el de cierre de una línea del plan son dos
columnas lógicas distintas** (`reason` y `close_reason`). Con el mismo
nombre lógico, el motivo del cierre se podría copiar al de la apertura y
descifraría: «se le retiró la sonda» pasaría a ser por qué se le puso.

---

## 2 · Lo que se queda EN CLARO, y por qué

Esto es la mitad que hay que leer. Cifrar seis columnas y no decir qué
queda fuera sería dar por cerrado lo que no está.

| Qué | Por qué se queda legible |
| --- | --- |
| `care_plan_items.control_code` y las siete columnas de frecuencia (`frequency_kind`, `every_n_hours`, `every_n_days`, `weekdays`, `month_day`, `shift_codes`, `moment_codes`) | sostienen `care_plan_items_one_live_key` —`UNIQUE (client_id, control_code) WHERE to_at IS NULL`, «una línea viva por residente y control»— y hay otro índice más en `(client_id, control_code)`. El cifrado de clinica-7 es **no determinista** (el nonce va dentro del ciphertext, decisión 15), así que una columna cifrada **no puede sostener un índice único**. Renunciar a esa garantía o montar un cifrado determinista para esto **no se hace de pasada** |
| `resident_profiles.dependency_level` y `dependency_grade` | los usan las plantillas del plan (`lineasDeLaPlantilla`) y la lista de residentes, que sirve el nivel sin dejar línea en el registro a propósito (decisión 1 de `residentes-routes.ts`: es el cuadrante del office) |
| `admission_date`, `discharge_date`, `place_type`, `responsible_name` / `_phone` / `_relation` | identidad y estancia, no salud. Igual que `clients.first_name` en la clínica |
| `floors.name`, `rooms.name`, `beds.label` | son del centro, no de nadie. Una DEK por tenant atada a una fila no los cubriría |
| `clinical_access_log` entero | es la prueba de quién miró. Cifrarlo sería esconder la prueba |

**Y una consecuencia que conviene no esconder:** con `control_code` en
claro, un `SELECT` sobre `care_plan_items` sigue diciendo QUÉ se le
controla a un residente —`GLUCEMIA`, `UPP_*`, `CONTENCION`— y con qué
intensidad. Lo que este bloque cifró de esa tabla es **el texto que una
persona escribió a mano**, que es donde cabe el diagnóstico con todas las
letras. Cerrar lo otro es cambiar el esquema de cifrado para esa columna
o renunciar al índice, y eso es un bloque con su propia decisión.

Lo mismo, por abajo: un `floor_id` cuya planta se llame «Unidad de
Alzhéimer» es un diagnóstico para todos los que duermen en ella. El
nombre de la planta no es dato de nadie en concreto y por eso no entra
aquí; si algún día importa, se arregla no llamando a la planta así.

---

## 3 · El motor lo sostiene

### Los CHECK de formato · el claro NO CABE

`packages/db/prisma/migrations/20261015010000_residencia_1b_cifrado/`
(193 líneas). Cada columna nueva lleva

```sql
CHECK (col IS NULL OR col ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$')
```

Si mañana una ruta nueva escribiera el DNI sin pasar por `cifrarTexto`,
**lo rechaza el motor**. No hace falta que nadie se acuerde.

### Los dos CHECK de residencia, RE-ENSEÑADOS

Es lo que §18.4 de `clinica-7-done.md` decía que había que hacer, y es la
misma lección que `clinical_photos_retirada_completa` en clinica-7 §2 §3:
un CHECK escrito contra la columna clara se vuelve mentira en cuanto el
dato se muda a la cifrada.

**`resident_profiles_alta_coherente`** exigía «motivo ⇒ fecha de alta».
Con el claro vaciado, el motivo vive en la cifrada y el CHECK habría
pasado de largo: una ficha podría decir que alguien se fue sin decir
cuándo. Ahora mira **las dos**:

```sql
CHECK (
    (("discharge_reason" IS NULL AND "discharge_reason_cifrado" IS NULL)
        OR "discharge_date" IS NOT NULL)
    AND ("discharge_date" IS NULL OR "discharge_date" >= "admission_date")
)
```

Las cuatro comparaciones son `IS NULL` / `IS NOT NULL` y la de fechas
viene con su `IS NULL` delante. **Un CHECK que da NULL pasa**, y ésa es la
forma en la que esto se habría roto sin que se viera.

**`resident_profiles_identificacion_not_blank`** («lo que no se sabe va
NULL, no en blanco») se extiende a las cifradas: un `dni_cifrado` en
blanco haría que «tiene DNI» mintiera.

**Y los que NO hacía falta tocar, repasados uno por uno:**
`care_plan_items_frecuencia_coherente`, `_origen_coherente`,
`_vigencia_ordenada`, `_cierre_con_autor` y `bed_assignments_vigencia`.
Ninguno mira una columna de texto — `cierre_con_autor` mira `to_at` y
`closed_by_user_id`, no el motivo del cierre.

### El `down`

Va comentado en la cabecera de la migración, como en clinica-7.
Reversible del todo **mientras no haya corrido el script con `--vaciar`**.
Después no: las columnas claras estarían vacías y el `down` sería la
pérdida del dato que la migración existe para proteger.

Aplicada sobre base limpia (las 80 en orden) y sobre una copia con datos
sembrados de residencia-1 y -2. Ver §7.

---

## 4 · Las rutas: escriben cifrado, leen descifrando

**Las pantallas del admin no cambian.** La API devuelve los mismos campos
con los mismos nombres; lo único nuevo que puede llegar es el texto del
hueco marcado. No se ha tocado ni un fichero de `apps/admin`.

| Ruta | Qué cifra | Qué descifra |
| --- | --- | --- |
| `GET /residencia/residentes` | — | el motivo del alta (de los que ya se fueron). **Sin DNI ni NSS**: la lista se ve desde el despacho |
| `POST /residencia/residentes` | DNI, NSS, el motivo de la ocupación de cama y el motivo de cada línea del plan precargado | lo que devuelve |
| `GET /residencia/residentes/:id` | — | DNI, NSS, motivo del alta y el motivo de **cada** ocupación del histórico |
| `PATCH /residencia/residentes/:id` | DNI y NSS | lo que devuelve |
| `POST …/:id/alta` | el motivo del alta, el de la ocupación que cierra y el de cada línea del plan que cierra | lo que devuelve |
| `POST …/:id/cama` | el motivo del cierre de la fila vieja **y** el de la nueva | lo que devuelve |
| `GET …/:id/plan` | — | el motivo y el motivo de cierre de cada línea, vivas e histórico |
| `POST …/:id/plan` | el motivo de cierre de la que se cambia y el de la nueva | — |
| `DELETE …/:id/plan/:itemId` | el motivo del cierre | — |

`asegurarDek` en las escrituras, **dentro de la transacción que
escribe**: si se deshace, la clave no queda huérfana. `dekONada` en las
lecturas, que no crean claves — un centro que no haya escrito nada
cifrado se lee de las columnas claras, que es lo que hay.

**Y si la clave no se pudiera obtener, la escritura LEVANTA.** Nada se
guarda en claro porque falte la clave (decisión 4 del prompt). En la
práctica no puede faltar: `tenants_residencia_exige_clinica` no deja
encender la residencia sin la clínica, y la API no arranca sin KEK si hay
alguna clínica (`clinica/arranque.ts`).

### Tres cosas del camino que no eran obvias

**1 · Los `create` generan su uuid en la aplicación.** El AAD ata el valor
a su fila y el id de una fila que todavía no existe no se puede leer, así
que no vale el `@default(uuid())` de Prisma. Afecta a
`bed_assignments` y a `care_plan_items`, incluido el `createMany` de la
plantilla: sigue siendo **una** sentencia, y cada fila lleva su uuid y su
ciphertext.

**2 · `cerrarPlanPorAlta` era un `updateMany` y no puede seguir
siéndolo.** El mismo motivo en ocho líneas son ocho ciphertexts distintos
—el AAD lleva el id de la fila— y un `updateMany` sólo sabe escribir uno.
Se leen las vivas y se cierran una por una, en la misma transacción. Igual
el cierre de la ocupación de cama al dar de alta: ahí es una fila como
mucho (lo garantiza `bed_assignments_one_live_per_client_key`) y el bucle
está porque la garantía es del motor y no del handler.

**3 · El PATCH pone el claro a NULL además de escribir la cifrada.** Es la
mitad que importa y la que deja rastro si se olvida: editar el DNI de una
ficha que todavía tenía el claro de antes del cifrado dejaría el **DNI
VIEJO** legible en la base para siempre. `leerTexto` serviría el nuevo
(manda la cifrada) y nadie se enteraría del que se quedó atrás. Tiene su
caso en el e2e y su sabotaje en §6.

### El hueco marcado

Cuando un valor no se descifra, `leerTexto` devuelve
`"(este dato no se puede leer)"` y **la ficha se sigue sirviendo**. Es la
decisión de clinica-7 leída igual: una línea ilegible no puede dejar a un
residente sin su ficha ni sin su plan, y esconderla sería borrar la única
pista. Lo que se apunta en el aviso es la tabla, la columna y el id —
**nunca el ciphertext ni la clave**.

### Ninguna búsqueda usa estas columnas en SQL

Se repasó: ni una `WHERE`, ni un `orderBy`, ni un `contains` sobre las
seis, ni en `apps/api/src` ni en las pantallas del admin (la de Residentes
no tiene buscador). **No hay nada que resolver en memoria y no se ha
tocado ningún índice.** El único filtro de `resident_profiles` es
`dischargeDate`, que se queda en claro.

---

## 5 · El script del «migrar»

**Hoy no hay ningún centro con la residencia encendida en producción**, así
que en la práctica no hay nada que pasar. La maquinaria está igual, porque
un entorno de desarrollo o de ensayo sí tiene filas sembradas de
residencia-1 y -2.

`src/scripts/residencia-cifrar.ts` (469 líneas) y no dentro de
`cifrar-lo-existente.ts`, por dos razones:

- el e2e **importa** los tres pasos para probar las dos pasadas, y
  `cifrar-lo-existente.ts` llama a `main()` en el cuerpo del módulo —
  importarlo lo ejecutaría, con el rojo peor de todos (lo vigila
  `scripts-no-corren-al-importarlos.test.ts`, y por eso el fichero nuevo
  lleva su guardia de ejecución directa);
- `--vaciar` entra como **parámetro** y no como constante de
  `process.argv`, que es lo que hace posible probar cifrar y vaciar por
  separado.

Se llama desde `cifrar-lo-existente.ts` dentro de su recorrido por tenant
—un centro de residencia tiene la clínica encendida por obligación, así
que ya está en esa lista con su DEK— y tiene **entrada propia** para el
caso de este bloque: un entorno donde lo clínico ya se cifró en el
despliegue de clinica-7 y lo único pendiente son las tres tablas.

`cifrado-comun.ts` saca la tanda, la cuenta y el `verificar` a un sitio:
dos `verificar` copiados pueden dejar de verificar lo mismo.

### Cifran y vacían en PASADAS SEPARADAS

Es la lección de `vaciarNotas()` en clinica-7, escrita en el código. Las
funciones de allí cifraban y vaciaban en el **mismo** `update`
condicionado a `--vaciar`, y eso dejaba fuera el camino que el despliegue
hace de verdad: cifrar, mirar el resultado, y vaciar después. En esa
segunda pasada el `WHERE … IS NULL` ya no encuentra nada y el claro se
quedaba para siempre. Lo cazó la prueba sobre una copia con datos, y aquí
el bucle de vaciado tiene su propio `WHERE` (cifrado puesto **y** claro
todavía ahí): funciona igual en una pasada que en dos.

Y verifica **dos veces**: al cifrar y otra vez antes de borrar el claro.
Con el claro vaciado, un ciphertext que no abre es un dato perdido.

---

## 6 · Tabla de sabotajes

Las ocho, con el commit ya hecho antes de tocar nada y `git checkout --`
para volver.

| # | Sabotaje | Qué tiene que pasar | Qué pasó |
| - | --- | --- | --- |
| 1 | Borrar el CHECK `resident_profiles_dni_cifrado_formato` de la migración | el motor acepta el DNI en claro en la columna cifrada, y se ve en tres sitios | **3 rojos**. `residencia-1b.e2e.ts`: `Error: El motor ACEPTÓ lo que no debía: UPDATE resident_profiles SET dni_cifrado = '11223344Z'`. `clinica-7.e2e.ts`: `expected [ …(14) ] to deeply equal [ …(15) ]`. Y el guardián del inventario en unidad: `expected 15 to be 16` |
| 2 | La ruta del alta escribe el DNI **en claro** (`dni: body.dni`, `dniCifrado: null`) | el DNI aparece en la base y el canario sale en el volcado | **5 rojos**. `expected 'CANARIO-DNI-11223344Z' to be null`, y el recorrido por todas las tablas del esquema: `+ "resident_profiles ← CANARIO-DNI-11223344Z"` |
| 3 | Cifrar cada línea del plan con el sitio de OTRA fila (`sitioMotivoDeLinea(tenantId, nuevoIdDeFila())`) | el valor no se descifra en la fila donde acaba | **2 rojos**. `Error: valor clínico que no se descifra en care_plan_items.reason (9dcb93ae-…): la clave o el sitio no son los suyos`, y el plan sirviendo huecos: `expected '(este dato no se puede leer)' to be 'ingreso'` |
| 4 | `leerTexto` se cae a la columna EN CLARO cuando la cifrada no descifra | un «la clave no es la buena» pasaría a parecer que funciona | **2 rojos**. `expected null to be '(este dato no se puede leer)'` y `expected '87654321X' to be '(este dato no se puede leer)'` |
| 5 | Devolver `cerrarPlanPorAlta` a un `updateMany` con un solo ciphertext | las líneas se cierran con un motivo que no es el suyo | **1 rojo**: `Error: valor clínico que no se descifra en care_plan_items.close_reason (b9c9004e-…): la clave o el sitio no son los suyos` |
| 6 | Armar el AAD a mano en `residentes-routes.ts` (una segunda `aadDe`) | el guardián del «un solo sitio» lo caza | **2 rojos**: `expected [ 'residencia/residentes-routes.ts' ] to deeply equal []`, los dos — el de `aadDe` y el de construir un `SitioDelValor` a mano |
| 7 | El PATCH no pone el claro a NULL al escribir la cifrada | el DNI VIEJO se queda legible en la base para siempre | **1 rojo**: `expected 'VIEJO-00000000X' to be null` |
| 8 | Re-enseñar `resident_profiles_alta_coherente` a mirar sólo la columna CLARA | con el claro vaciado, un motivo de alta sin fecha pasaría | **1 rojo**: `Error: El motor ACEPTÓ lo que no debía: UPDATE resident_profiles SET discharge_reason_cifrado = 'c1:ZC0+…'` |

El 1 y el 8 son del motor; el 2, el 3, el 5 y el 7 son de la aplicación; el
4 es de la pieza que decide qué se enseña cuando algo falla; el 6 es del
guardián que impide que el AAD se arme dos veces.

El **6** merece una nota: la cabecera de `cripto-campos.ts` dice desde
clinica-7 que «no hay ni una llamada a `aadDe` fuera de aquí. Un test lo
vigila». **No lo vigilaba ninguno** — ese test no existía. Ahora sí, y
cubre los seis sitios nuevos, que es lo que el prompt pedía.

---

## 7 · El `SELECT` en crudo

Sobre la base del e2e, después de dar de alta a doña Carmen con DNI, NSS y
cama, cambiarla de habitación, añadirle una línea al plan y darle el alta
de salida. Los textos que se teclearon llevan la palabra `CANARIO` para
poder buscarlos.

```
resident_profiles.dni        | claro: null | cifrado: c1:SWUlcnd+m4csezSsmfb8emN1mkDVkDnqqOxq4xLUBhSCYBvCmuWLeEsDj0/s5XijAA==
resident_profiles.nss        | claro: null | cifrado: c1:l/1ufCkR7AvUyeWnp2uAvaKk7vgMT1Kk/J6UIHbuW8YIgQJBuhqghvFpUMEGp4aG0oaPZA==
bed_assignments.reason       | claro: null | cifrado: c1:i6kKGtHUO2ETlJFer4o6QXI5vKyv6On9Z0p5/aQBjwxEwf8=
care_plan_items.reason       | claro: null | cifrado: c1:6FB2NyrW+ssx6A1I0WOytdPky/ePtpAOkFaAAJ7B6KDaddc=
care_plan_items.reason       | claro: null | cifrado: c1:ZBoNl8U43ZpMWDi1tXNLLihewRFety+HDakeSst7/LsDnqk=
care_plan_items.reason       | claro: null | cifrado: c1:/2PY541ybG+0DugmgRHww/6lUwaAsgEeF/PvQj4EfLZ5pIE=
care_plan_items.reason       | claro: null | cifrado: c1:cTNoOXsjppruZIYW1evZsNYBMSRFfFh0oh9+zGeEOvQkqgc=
care_plan_items.reason       | claro: null | cifrado: c1:w3ZzxdjopKM65EyJ5ckhmD27RRFFX4ui8pDLKtOvM1MhNgA=
…  (24 líneas del plan precargado, todas «ingreso», todas distintas)
```

Y la fila de la ficha entera:

```json
{
  "dni": null,
  "nss": null,
  "dni_cifrado": "c1:SWUlcnd+m4csezSsmfb8emN1mkDVkDnqqOxq4xLUBhSCYBvCmuWLeEsDj0/s5XijAA==",
  "nss_cifrado": "c1:l/1ufCkR7AvUyeWnp2uAvaKk7vgMT1Kk/J6UIHbuW8YIgQJBuhqghvFpUMEGp4aG0oaPZA==",
  "discharge_reason": null,
  "discharge_reason_cifrado": null,
  "dependency_level": "DEPENDIENTE",
  "admission_date": "2026-10-01T00:00:00.000Z"
}
```

**Las veinticuatro líneas del plan dicen «ingreso» y las veinticuatro
tienen un ciphertext distinto.** Eso es el AAD y el nonce trabajando: no
sólo no se lee el texto, es que no se puede saber que dos filas dicen lo
mismo. Un cifrado determinista habría dado veinticuatro cadenas idénticas
— y el índice único que §2 explica a cambio.

Y lo que de verdad contesta la pregunta, porque mira **más** que un
`pg_dump | grep`: el e2e recorre **todas las tablas del esquema** —también
las que nadie listó— volcando `x::text` de cada fila, y busca los cinco
canarios (DNI, NSS, el motivo del alta, el del plan y el de la cama).
**Cero apariciones.** Con el sabotaje 2 puesto, uno: `resident_profiles ←
CANARIO-DNI-11223344Z`.

---

## 8 · Decisiones tomadas sin preguntar

1. **El uuid de la fila lo genera la aplicación, también en el
   `createMany`.** La alternativa —insertar y después actualizar con el
   cifrado— era peor por lo mismo que en clinica-7: dos escrituras donde
   hay una, y en `care_plan_items` el histórico tiene que poder
   reconstruirse fila a fila.
2. **`cerrarPlanPorAlta` devuelve `vivas.length` y no el `count` de un
   `updateMany`.** Es el mismo número y sigue siendo «cuántas se
   cerraron»; el test de residencia-2 que lo comprueba no cambió.
3. **El PATCH de la ficha pone el claro a NULL.** No estaba pedido con
   esas palabras y es lo que impide que quede un DNI viejo legible. Lleva
   su caso en el e2e y su sabotaje.
4. **`resident_profiles_identificacion_not_blank` se extiende a las
   cifradas** aunque el CHECK de formato ya lo cubriría. Dos CHECK que
   dicen lo mismo cuestan nada y el día que uno se afine, el otro sigue.
5. **El inventario de CHECK de `clinica-7.e2e.ts` pasa de nueve a quince
   en la MISMA lista**, en vez de abrir una lista de residencia aparte.
   Lo que hace falta saber es «¿falta alguna?», no «¿falta alguna de la
   clínica?», y dos listas pueden dejar de cubrirse.
6. **Los tests que afirmaban sobre `closeReason` ahora DESCIFRAN** en vez
   de leer la columna clara. Es la decisión de `cuerpoClaroDe` en
   clinica-7: lo que se afirma pasa a ser lo que de verdad se guardó, no
   lo que la función dijo que iba a guardar.
7. **Dos dobles de Prisma arreglados:** `create` y `createMany` de
   `carePlanItem` se inventaban el `id` (`randomUUID()` después del
   `...data`) en vez de respetar el que les llegaba. Daba igual hasta
   ahora; con el AAD dentro, un doble que lo cambie prueba algo que la
   producción no hace.
8. **El e2e de este bloque MONTA LAS RUTAS**, al revés que
   `residencia-1.e2e.ts` y `residencia-2.e2e.ts`, que entran por
   `$executeRawUnsafe`. Lo que hay que ver aquí es el camino completo —se
   teclea, la base guarda ciphertext, la pantalla vuelve a leer lo
   mismo— y eso no se ve mirando sólo el esquema. Por eso siembra el rol
   de `DIRECCION` y el contrato de encargado: sin el rol de cuidado
   vigente `conHistoria` contesta 403, y sin el contrato 423.

---

## 9 · Lo que se respetó, comprobado

- **Tenants sin residencia (y sin clínica) no notan nada.** Las seis
  columnas están en tres tablas que **sólo tienen filas con la residencia
  encendida**. La peluquería de Sole no tiene ni una. Y no se ha tocado
  ninguna columna compartida con el resto del producto: `clients.notes` y
  `appointments.notes` siguen exactamente como las dejó clinica-7.
- **El registro de accesos sigue en claro.** `clinical_access_log` no se
  tocó: es la prueba de quién miró.
- **Las pantallas del admin no cambian.** Cero ficheros de `apps/admin` en
  el diff.
- **La puerta del contrato de encargado no se tocó.** `conHistoria` sigue
  siendo el punto por el que pasa la ficha y el plan, con su línea en el
  registro y su 423.

---

## 10 · Verde

| Suite | Resultado |
| --- | --- |
| Unitaria (`pnpm vitest run`, desde la raíz) | **5139 pasan**, 3 saltados, 371 ficheros (antes del bloque: 5106 / 370) |
| e2e de la API (`test:e2e`) | **721 pasan**, 37 ficheros (antes del bloque: 700 / 36) |
| `tsc --noEmit` · api | limpio |
| `tsc --noEmit` · los seis paquetes de la CI | limpio |
| `tsc -b` · tpv-web y admin | limpio |

La suite unitaria se corrió **desde la raíz**: los ficheros de `tpv-web`
necesitan su entorno jsdom y desde `apps/api` fallan por el comando, no
por el código.

### Lo que NO se corrió, y por qué

**`pnpm e2e:agenda` (el banco de la agenda).** No entra en la CI y se
lanza a mano, y lanzarlo ahora habría pisado a otra sesión: el banco usa
una base de nombre FIJO (`mipiacetpv_agenda_banco_e2e`) y la **vacía
entera** con un `TRUNCATE`, y levanta la API, el admin y el TPV en puertos
fijos — con el admin (5173) y el TPV (5174) de otro árbol escuchando
ahora mismo.

Y no hay motivo para pensar que le afecte: el banco no tiene escenario de
residencia (`seed/` son `peluqueria-demo.ts` y `clinica-demo.ts`, §18.2 de
clinica-7), y de los dieciséis ficheros del diff los únicos de producción
son tres rutas de residencia, dos scripts y `cripto-campos.ts`, donde el
cambio es **puramente aditivo** (seis funciones nuevas y una cabecera).
Nada de lo que el banco recorre pasa por ahí.

Sobre el **capítulo 12 del banco**: seguía rojo antes de este bloque por
dos colisiones de selector que vienen de clinica-5 (clinica-7-done §15).
Este bloque no lo arregla ni lo empeora.

**El `smoke`.** Lo corre la CI arrancando la imagen real contra un
Postgres **sin migrar**. Este bloque no añade nada al arranque: no hay
seed nuevo, no hay lectura de tabla nueva al levantar el proceso, y
`clinica/arranque.ts` está igual. Se verá verde en la CI del PR.

### Una divergencia que ya estaba

`pnpm -r exec tsc --noEmit` falla en `packages/verifactu` con cinco
errores de `rootDir` sobre `scripts/generar-declaracion-responsable.ts`.
**No es de este bloque** —ni ese paquete ni ese script están en el diff— y
la CI no lo typechequea: su lista son los seis de `packages/db`,
`escpos-builder`, `holded-client`, `ticket-model`, `ticket-pdf` y
`util-validation`, y los seis salen limpios.

---

## 11 · Al desplegar

**Lo de clinica-7 §14 no cambia, y este bloque se cuelga de ahí.** El
orden entero:

### Si clinica-7 TODAVÍA NO está desplegado

Entonces los dos van en el mismo despliegue y el orden es el de §14 tal
cual, con un único añadido en el paso 4:

```
pnpm --filter @mipiacetpv/db run migrate:deploy
pnpm --filter @mipiacetpv/api exec tsx src/scripts/cifrar-lo-existente.ts
#   ← mirar el resumen: filas cifradas, ficheros cifrados, 0 fallos
pnpm --filter @mipiacetpv/api exec tsx src/scripts/cifrar-lo-existente.ts --vaciar
```

Ese script ya pasa las tres tablas de la residencia: no hay un comando
más. Y la `CLINICAL_KEK` tiene que estar en el entorno **antes** de que
arranque el proceso — eso es el paso 1 y el paso 3 de §14, y los teclea
Matías.

### Si clinica-7 YA está desplegado

Sólo falta la migración, y nada más:

```
pnpm --filter @mipiacetpv/db run migrate:deploy
```

**No hay nada que cifrar**: hoy no hay ningún centro con la residencia
encendida en producción, así que las tres tablas están vacías. Si algún
día hubiera filas (un entorno de ensayo, o un centro encendido antes de
desplegar esto):

```
pnpm --filter @mipiacetpv/api exec tsx src/scripts/residencia-cifrar.ts
#   ← mirar el resumen: cifradas, 0 fallos
pnpm --filter @mipiacetpv/api exec tsx src/scripts/residencia-cifrar.ts --vaciar
#   ← y una TERCERA pasada con --vaciar que imprima +0 en todo:
#     ésa es la prueba de que no queda nada pendiente
```

### Y el orden respecto a la migración

`20261015010000_residencia_1b_cifrado` es **posterior** a las tres de
residencia y a la de clinica-7, así que no hay empate de marca ni entra
fuera de orden (§18.5 de clinica-7 no aplica aquí). Se aplicó sobre base
limpia con las ochenta en orden y con los datos sembrados de residencia-1
y -2 encima.

### Lo que NO se despliega con esto

Nada nuevo en el entorno. **Ni una variable más**: la `CLINICAL_KEK` y la
`CLINICAL_KEK_ID` son las de clinica-7, y desde `e4e9339` llegan al
contenedor por el `environment` del compose de producción.

---

## 12 · Dudas abiertas

1. **`configurarAvisoDeIlegible` no lo llama nadie.** La cabecera de
   `cripto-campos.ts` dice que «lo pone `server.ts` al arrancar»; no lo
   pone. Hoy el aviso por defecto es un no-op, así que **un valor que no
   se descifra sale como hueco en pantalla y no deja rastro en el log**.
   Es deuda de clinica-7, no de este bloque, y por eso no se arregla aquí
   —cablear un logger a esa función es una decisión sobre qué se registra
   y dónde, con «nada de salud en logs» de por medio—, pero el día que
   pase de verdad nadie se va a enterar. Los tests de este bloque sí lo
   configuran, y por eso puede afirmarse qué se avisa.
2. **`control_code` sigue en claro, y dice qué se le controla a un
   residente.** §2 explica por qué y qué costaría cerrarlo. Es la decisión
   con más peso de las que este bloque NO tomó.
3. **El nombre de la planta.** Una planta llamada «Unidad de Alzhéimer» es
   un diagnóstico colectivo y el cifrado por fila no lo cubre. Hoy se
   arregla no llamándola así; si hace falta más, es otro bloque.
4. **La devolución del art. 28.3.g (`clinica/exportacion.ts`) no exporta
   las tablas de residencia.** No está en el alcance de este bloque y no
   lo rompe —lo que exporta sigue exportándose igual—, pero el día que un
   centro de residencia pida sus datos, el ZIP no llevará la ficha del
   residente ni su plan. Es deuda de residencia, y conviene que
   `residencia-3` la mire junto con el registro de cuidados.

---

## 13 · Fuera de alcance, declarado

- `CareRecord` y todo lo que traiga `residencia-3`: **nacerá cifrado en su
  bloque**, con su `sitio*` en `cripto-campos.ts` y su CHECK de formato en
  la migración. El sitio donde ponerlo ya está hecho.
- Cifrar `control_code` o la frecuencia del plan (§2).
- Rotación de la KEK o de la DEK: ya la tiene clinica-7
  (`src/scripts/rotar-kek.ts`), y las seis columnas nuevas la heredan sin
  tocar nada — la DEK es la misma.
- Las pantallas del admin.

---

## 14 · Commits

Seis, en español, sobre `e4e9339`:

```
4be6782  feat(residencia): las seis columnas cifradas, con su CHECK de formato
ae0fc70  feat(residencia): los seis sitio* de la residencia, en cripto-campos
d43cf46  feat(residencia): las rutas escriben cifrado y leen descifrando
3b75725  feat(residencia): el script de cifrado pasa las tres tablas nuevas
3186eb5  test(residencia): el AAD de las quince columnas, y el guardián de aadDe
71cd175  docs(residencia): el inventario de clinica-7 §18 y el modelo de datos
```

Dieciséis ficheros, ~2760 líneas añadidas. De producción son seis:
`cripto-campos.ts`, las tres rutas de residencia y los dos scripts.

## 15 · La rama

Pusheada a `origin/residencia-1b` y con **PR abierto contra `master`**.
Ni merge ni despliegue: eso lo decide Matías.
