# Bloque residencia-1b · lo que es de un residente, cifrado en reposo

Rama `residencia-1b`, worktree `~/Developer/Claude/Projects/mipiacetpv-residencia-1b`, desde
`origin/master` (ya trae residencia-1, residencia-2 y clinica-7). PR contra `master`.
Escrito el 15-10-2026 desde el proyecto de Jardín de Gredos.

Lee antes, en este orden:
1. `docs/blocks/clinica-7-done.md` **entero**, y sobre todo §3 (el sobre: KEK, DEK y AAD), §2 §3-§4
   (columnas cifradas con CHECK y triggers re-enseñados) y **§18** (residencia después del merge:
   el inventario de lo que residencia dejó en claro y por qué no se cifró allí).
2. `apps/api/src/clinica/cripto.ts` y `cripto-campos.ts`: aquí no se inventa cifrado, **se usa ese**.
3. `docs/residencia/00-decisiones.md` (D-51, D-62 y D-63) y `docs/blocks/residencia-1-done.md` §
   ficha del residente (dónde se leen y escriben DNI y NSS) y su §«cifrado a nivel de campo».

## Por qué existe

D-62: **antes del piloto con residentes reales, lo que identifica a un residente y lo que se escribe
de él a mano no puede estar en claro en la base.** clinica-7 ya construyó la maquinaria —una DEK por
tenant envuelta por la KEK, AAD `tenant|tabla|columna|fila`, CHECK de formato en el motor, la API que
no arranca sin la clave— y cifró nueve columnas, todas de la clínica. Las de residencia-1 y
residencia-2 se quedaron fuera porque no existían cuando se hizo el inventario (§18.3).

Y hay una promesa firmada: un centro de residencia **ha aceptado** el contrato de encargado (no puede
encender el módulo sin la clínica), y la letra c) promete medidas técnicas. Hoy esa promesa la
cumplen las columnas clínicas y no las de residencia. Este bloque cierra esa deuda **para lo que ya
existe**; el registro de cuidados (residencia-3) nacerá cifrado por su cuenta.

¿Y qué?: el día que entren los 48 residentes de verdad, una copia de la base robada o un acceso
indebido al Postgres no da ni un DNI, ni un NSS, ni «úlcera sacra grado II», ni «fallecimiento». Y
destruir la DEK del centro al terminar el contrato deja ilegible todo eso también en las copias.

## Decisiones de producto ya tomadas — no se re-debaten

1. **Se reutiliza clinica-7 tal cual**: `cifrarValor` / `descifrarValor`, los `sitio*` en
   `cripto-campos.ts` (uno por columna, nombre de tabla y nombre lógico de la columna en claro),
   uuid generado en la aplicación cuando el AAD lo necesite, y el **hueco marcado** cuando algo no se
   descifra (no una excepción). Nada de un segundo esquema de cifrado.
2. **Qué se cifra (D-63)**:

   | Tabla | Columna | Por qué |
   |---|---|---|
   | `resident_profiles` | `dni` | identificador; D-62 |
   | `resident_profiles` | `nss` | identificador, el que abre la historia en el SESCAM; D-62 |
   | `resident_profiles` | `discharge_reason` | texto libre: «fallecimiento», «traslado por ictus» |
   | `care_plan_items` | `reason` | texto libre: «úlcera sacra grado II» |
   | `care_plan_items` | `close_reason` | texto libre: «se le retiró la sonda» |
   | `bed_assignments` | `reason` | texto libre: «aislamiento por GEA», «se cae de la cama» |

3. **Qué se queda en claro, y se declara en el done con su motivo** (§18.4 de clinica-7):
   - `care_plan_items.control_code` y la frecuencia: sostienen `care_plan_items_one_live_key`
     (una línea viva por residente y control) y el cifrado es no determinista. Renunciar a esa
     garantía o montar un cifrado determinista para esto **no se hace de pasada**.
   - `resident_profiles.dependency_level` y `dependency_grade`: los usan las plantillas del plan y
     la lista de residentes (decisión 1 de `residentes-routes.ts`).
   - Fechas de ingreso y alta, tipo de plaza, familiar responsable: identidad y estancia, no salud,
     igual que `clients.first_name` en la clínica.
   - Nombres de plantas, habitaciones y camas: son del centro, no de nadie.
4. **Sólo en tenants con residencia.** Estas tablas sólo tienen filas con la residencia encendida, y
   la residencia exige la clínica (`tenants_residencia_exige_clinica`), así que la DEK del tenant
   existe siempre que haya algo que cifrar. Si en algún camino no existiera, **no se escribe en
   claro**: se falla, como en la clínica.
5. **El motor lo sostiene**: columna cifrada con CHECK de formato (el claro no cabe), y los CHECK de
   residencia que miran estas columnas se re-enseñan a aceptar «en claro **o** cifrado» o se
   reescriben sobre la cifrada (`resident_profiles_alta_coherente`, el de DNI/NSS no en blanco y los
   que haya en `care_plan_items`). Ninguna ruta nueva podrá escribir el valor sin cifrar.
6. **Datos existentes**: no hay ningún centro con residencia encendida en producción. Aun así, la
   migración o un script idempotente cifra lo que haya (como hizo clinica-7) y deja el claro vacío;
   y se dice en el done qué hacer en un entorno que ya tenga filas.
7. **Nada de salud en logs**, tampoco el DNI: ni en claro ni el ciphertext.

## Alcance

- Columnas cifradas, CHECK, `sitio*` nuevos y su test de «ni una llamada a `aadDe` fuera de
  `cripto-campos.ts`» cubriendo los nuevos.
- Rutas de residentes, plan y camas: escriben cifrado, leen descifrando; la API y las pantallas
  devuelven lo mismo que hoy. **Las pantallas del admin no cambian** salvo el hueco marcado si algo
  no se descifra.
- Si alguna búsqueda o filtro usa estas columnas en SQL, se dice en el done y se resuelve en
  memoria sobre el tenant (son 48 residentes, no 48.000); nada de índices ciegos sin preguntar.
- Fakes de tests: `contratoFake` / `llaveroFake` / `kekDePrueba()` de `clinica-7-claves-fake.ts`,
  igual que §18.1.
- Actualiza la tabla del inventario en `docs/blocks/clinica-7-done.md` §18.3 con una línea que
  remita a este bloque, y añade a `docs/residencia/01-modelo-datos.md` qué columnas van cifradas.

## Respeta

- Tenants sin residencia (y sin clínica) no notan nada: la peluquería sigue igual.
- Suite, `e2e` y `pnpm e2e:agenda` como estaban (el capítulo 12 ya fallaba antes por clinica-4).
- El registro de accesos (`clinical_access_log`) sigue en claro: es la prueba de quién miró.

## Fuera de alcance (declarado)

- `CareRecord` y todo lo que traiga residencia-3: nacerá cifrado en su bloque.
- Cifrar `control_code` o la frecuencia del plan (índice único; ver decisión 3).
- Rotación de la KEK o de la DEK: ya la tiene clinica-7.

## Cómo se cierra

- Migración con su `down`, aplicada sobre una copia con datos sembrados de residencia-1 y -2.
- Tests: cada columna se escribe cifrada y se lee igual que antes; el CHECK rechaza el claro en la
  columna cifrada; un valor movido a otra fila / columna / tenant no se descifra (falla el AAD);
  un valor que no se descifra sale como hueco marcado y la ficha se sigue sirviendo; el alta sigue
  exigiendo motivo coherente con la fecha.
- **Tabla de sabotajes**: escribir el DNI en claro por SQL · copiar el `reason` cifrado de una línea
  del plan a otra · quitar la DEK del tenant y pedir la ficha · borrar el CHECK. Qué rompes, qué test
  se pone rojo y con qué mensaje.
- Un `SELECT` en crudo sobre las tres tablas en el done, enseñando que no se lee nada.
- CI verde (`ci`, `smoke`, `e2e`).
- `docs/blocks/residencia-1b-done.md` con la estructura de la metodología: qué se cifró, qué se
  quedó en claro y por qué, decisiones tomadas sin preguntar, dudas abiertas y **qué hay que hacer al
  desplegar** (orden respecto a §14 de clinica-7). Dice si la rama está pusheada y si hay PR.
- Commits pequeños en español, push y **PR contra `master`**. Ni merges ni despliegues.
