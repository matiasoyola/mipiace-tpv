# Bloque alta-minima · el residente existe aunque falten datos, y el programa no deja de recordarlo

Rama `alta-minima`, worktree `~/Developer/Claude/Projects/mipiacetpv-alta-minima`, desde
`origin/master`. PR contra `master`. Escrito el 23-10-2026 desde el proyecto de Jardín de Gredos, el
día que la primera residencia real (Jardín de Gredos, cliente cero) se encendió en producción y
llegó su listado: 43 residentes con **nombre y tipo de plaza, y nada más**. **Es pequeño y va antes que
historia-1** (ver «Convivir con historia-1»).

Lee antes:
1. `apps/api/src/residencia/residentes-routes.ts` (el alta: `POST /residencia/residentes`, hoy con
   `admissionDate`, `dependencyLevel` y `placeType` obligatorios), `residencia/plan.ts` (la precarga
   del plan por nivel) y `apps/admin/src/pages/residencia/ResidentesPage.tsx` («Nuevo ingreso»).
2. `docs/blocks/residencia-1-done.md` (el modelo `ResidentProfile`, D-49), `residencia-2-done.md` (la
   plantilla por nivel), `residencia-5-done.md` (el panel de dirección) y `residencia-6-done.md` §4 (el
   parte con un residente sin plan: una línea por zona, sin ruido).
3. `docs/code-prompts/bloque-historia-1.md` §5 (el ingreso guiado, `AdmissionChecklist`, D-94).

## Por qué existe

Hoy no se puede dar de alta a un residente sin fecha de ingreso ni nivel de dependencia. Pero la
señora ya vive aquí y ya hay que atenderla: no saber la fecha o el grado no hace que necesite menos
cuidados. Obligar a tener todos los datos antes de crearla significa que **no está en el programa**:
no aparece en la puerta, no se le puede apuntar «algo no va bien» y el relevo no la ve. Lo que hace
falta es lo contrario: que exista desde el primer minuto y que el programa **no deje de recordar** lo
que le falta hasta que esté completa.

¿Y qué?: el centro carga a todos sus residentes en diez minutos con lo que tiene a mano (un listado de
nombres) y desde ese momento el trabajo diario ya funciona. La dirección ve en todo momento cuántas
fichas están incompletas y qué le falta a cada una, sin tener que acordarse.

## Decisiones de producto ya tomadas — no se re-debaten

1. **Para crear un residente basta con el nombre.** `admissionDate`, `dependencyLevel` y `placeType`
   pasan a ser opcionales en la API y en la base (migración aditiva: columnas a NULL, sin tocar las
   filas existentes). Los apellidos y todo lo demás, también opcionales.
2. **Lo que falta es dato, no código.** Una función pura (en `packages/residencia-plan` o un paquete
   hermano) `datosQueFaltan(residente)` devuelve la lista de lo que falta, cada elemento con su
   etiqueta («Fecha de ingreso»), su peso (**imprescindible** / **recomendable**) y el campo de la
   ficha al que lleva. De serie:
   - **Imprescindibles**: apellidos, fecha de ingreso, nivel de dependencia, tipo de plaza, DNI,
     familiar responsable con su teléfono.
   - **Recomendables**: NSS, fecha de nacimiento, grado reconocido (sólo si la plaza es concertada pasa
     a imprescindible: sin grado no se factura a la Junta), cama asignada.
   La lista vive en un sitio; añadir un campo mañana es una línea.
3. **Avisar mucho, en todos los sitios donde mira la dirección** (lo ha pedido Matías: «que demos el
   coñazo»). Sin bloquear nada:
   - **Lista de residentes**: cada fila con una etiqueta ámbar «Faltan 4 datos» (roja si falta algún
     imprescindible); arriba, «12 de 43 fichas incompletas» y un filtro **«Sólo incompletas»** que se
     queda puesto por defecto mientras haya alguna.
   - **Ficha del residente**: una banda arriba «A esta ficha le faltan: fecha de ingreso, DNI,
     familiar responsable». Cada dato es un enlace que lleva al campo y lo enfoca. Se va sola cuando la
     ficha está completa.
   - **Panel de dirección** (pantalla de inicio): una tarjeta fija mientras quede alguna incompleta,
     «12 fichas de residentes incompletas · 31 datos pendientes», con el botón «Completar»: abre la
     primera incompleta y, al guardar, **«Siguiente incompleta»**. Recorrer las 43 no obliga a volver a
     la lista.
   - **Obligaciones del mes** (residencia-5): las fichas incompletas aparecen como obligación viva del
     centro, sin fecha de vencimiento inventada.
4. **La puerta y el relevo no se tocan.** Un residente incompleto se atiende igual. Nada de avisos de
   datos administrativos a una auxiliar en la tablet de la puerta: eso es cosa del despacho.
5. **Sin nivel de dependencia no se precarga plan.** El residente nace sin plan, y el parte ya sabe
   enseñarlo sin ruido (residencia-6 §4). «Como siempre» y «algo no va bien» funcionan sin plan (las
   dimensiones OBS son del centro, no del plan). **Al poner el nivel por primera vez**, la ficha
   ofrece «Cargar el plan de cuidados de «dependiente»», como hoy en el alta. Sin plan es un dato que
   falta más: entra en la lista como imprescindible («Plan de cuidados»).
6. **Alta rápida de varios**: en la lista de residentes, «Añadir varios». Un cuadro donde se pegan
   nombres, uno por línea (tal como salen de copiar una columna de Excel), y un tipo de plaza opcional
   por línea separado por tabulador. Vista previa con los que se van a crear y los que **ya existen**
   (mismo nombre normalizado: sin tildes, mayúsculas ni dobles espacios), que se saltan. «Crear 43
   residentes». Así se cargó el listado de Jardín de Gredos y así llegará el de cualquier residencia.
7. **Los nombres en mayúsculas se guardan como vienen** y se enseñan en formato de nombre («ABEL RAMOS
   DOBLADO» → «Abel Ramos Doblado»). Separar nombre y apellidos de una línea no es fiable: en el alta
   rápida todo va a `firstName` y «apellidos» queda como dato que falta, para que la dirección lo
   corrija una vez.
8. **Todo lo cifrado sigue cifrado** (DNI, NSS: residencia-1b). Contar lo que falta de un campo cifrado
   no exige descifrarlo: basta con saber si es NULL.

## Convivir con historia-1

historia-1 está en marcha en su propia rama y construye el **ingreso guiado** (`AdmissionChecklist`,
D-94), que es la versión completa de esto (contrato firmado, consentimientos, alergias, dieta…). Este
bloque es la parte mínima que hace falta **ya**. Para que no se pisen:
- `datosQueFaltan` es la pieza que historia-1 absorberá en su checklist: déjala como función pura con
  sus tests, con un nombre y una forma que se puedan extender, y dilo en el done.
- La migración de este bloque sólo cambia nulabilidad; no añade tablas.
- Si historia-1 ya ha tocado `ResidentesPage.tsx` en master cuando abras la rama, rebasa y adapta.

## Alcance

- Migración: `admission_date`, `dependency_level`, `place_type` a NULL, con su `down` (que falla con un
  mensaje claro si ya hay filas con NULL). Revisa todo lo que lee esas columnas (`plan.ts`,
  `exportacion.ts`, `semilla.ts`, indicadores, panel) y que un NULL no rompa nada ni salga como
  «Invalid Date».
- API: alta con sólo el nombre; `POST /residencia/residentes/varios` (alta rápida, idempotente por
  nombre normalizado dentro del tenant); `datosQueFaltan` en la vista del residente y un resumen del
  centro para la lista y el panel.
- Admin: el formulario de «Nuevo ingreso» con sólo el nombre obligatorio y lo demás marcado como «puedes
  completarlo después»; la etiqueta y el filtro de la lista; la banda de la ficha con enlaces a cada
  campo; la tarjeta del panel con «Completar» y «Siguiente incompleta»; «Añadir varios».

## Respeta

- `negativaClinica`: sin contrato vigente no se crea nadie, tampoco en lote.
- Nada de datos de salud ni nombres en logs.
- Sistema visual y metodología de front de Mi Piace; filtro «¿y qué?» en cada aviso: el aviso tiene que
  llevar a completar el dato con un toque, no sólo decir que falta.

## Fuera de alcance (declarado)

El ingreso guiado completo (historia-1). Importar desde un Excel con columnas (fechas, DNI…): el
pegado de nombres cubre el caso de hoy; el importador con columnas se valora cuando llegue el segundo
centro.

## Cómo se cierra

- Tests de tabla de `datosQueFaltan`: ficha vacía, ficha completa, concertada sin grado (imprescindible)
  frente a privada sin grado (recomendable), sin plan, con DNI cifrado presente.
- Alta con sólo nombre → 201; alta rápida de 43 con 3 repetidos → crea 40 y lista los 3 saltados;
  repetir el mismo lote → 0 creados; sin contrato → el 423 de siempre.
- Un residente sin nivel ni fecha: aparece en la puerta, se le registra «como siempre» y «algo no va
  bien», sale en el parte sin ruido, en el panel cuenta como incompleto, y la exportación del art.
  28.3.g no se rompe.
- **Sabotajes**: mandar `dependencyLevel` inválido · pegar 2.000 líneas (límite y mensaje) · pegar
  líneas vacías y con tabuladores sueltos · quitar el nombre (sigue siendo obligatorio).
- **Medido**: cuánto se tarda en cargar 43 nombres pegados, y cuántos toques cuesta completar una
  ficha desde la tarjeta del panel con «Siguiente incompleta».
- Capturas de la lista con incompletas, la ficha con la banda, el panel con la tarjeta y «Añadir
  varios» (vista previa con repetidos), a 390 y en escritorio, en `docs/qa/`.
- CI verde (`ci`, `smoke`, `e2e`).
- `docs/blocks/alta-minima-done.md` con la estructura de la metodología: qué se hizo punto a punto,
  decisiones tomadas sin preguntar, dudas abiertas y qué hay que hacer al desplegar. Dice si la rama
  está pusheada y si hay PR.
- Commits pequeños en español, push y **PR contra `master`**. Ni merges ni despliegues.
