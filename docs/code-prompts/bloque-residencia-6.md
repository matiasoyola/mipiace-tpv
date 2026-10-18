# Bloque residencia-6 · antes del piloto

Rama `residencia-6`, worktree `~/Developer/Claude/Projects/mipiacetpv-residencia-6`, desde
`origin/master`. PR contra `master`. Escrito el 18-10-2026 desde el proyecto de Jardín de Gredos.

Lee antes:
1. `docs/blocks/residencia-5-done.md` **§19 «Qué falta para el piloto»**: este bloque cierra los puntos
   11, 13, 14, 15, 18 y 20. El 12 queda decidido por D-69 (no se toca).
2. `docs/residencia/00-decisiones.md`: D-31, D-51, D-63, **D-68 y D-69** (nuevas).
3. `docs/blocks/residencia-3-done.md` §2 (por qué el PIN de puerta tiene dos columnas, la huella
   derivada de la DEK y el rate-limit por puerta), §7 (sin red) y §15.2-15.5.
4. `docs/blocks/clinica-7-done.md` y `residencia-1b-done.md` §12.1: qué es `configurarAvisoDeIlegible`
   y por qué nadie lo ha cableado.
5. `docs/blocks/residencia-4-done.md` y `residencia-5-done.md`: el PIN de guardia y el de la sala.

## Por qué existe

La v1 está completa, pero el piloto mete datos reales de residentes y personas reales delante de las
tablets. Hay cinco cosas que con datos de prueba no se notan y con datos reales sí: un PIN que se puede
sacar de una tablet robada, un dato cifrado que desaparece sin dejar rastro, una puerta sin red que hace
repetir trabajo a la auxiliar, un parte de relevo lleno de ruido y ficheros que se acumulan sin dueño.

¿Y qué?: el primer día del piloto no puede ser el día en que se descubre cualquiera de esas cinco.

## Decisiones de producto ya tomadas — no se re-debaten

1. **PIN por alcance (D-68)**: 4 cifras para quien sólo tiene roles de alcance por zona; **6 cifras**
   para quien tiene algún rol de alcance total (DUE, médico, calidad, dirección). Aplica a puerta, sala
   y móvil de guardia.
   - Se valida **al dar o cambiar el PIN** en el admin: si la persona tiene un rol de alcance total, un
     PIN de 4 se rechaza con una frase clara. Si a alguien con PIN de 4 se le asigna después un rol de
     alcance total, su PIN queda **por renovar**: la puerta, la sala y la guardia le dicen «Tu PIN tiene
     que ser de 6 cifras: pídelo en dirección» y no le dejan entrar con el viejo. El panel de dirección
     lo lista.
   - **La auxiliar no gana ni un toque**: el teclado sigue entrando solo al cuarto dígito. Para el PIN
     de 6, un botón discreto «PIN de 6» en el teclado cambia a seis casillas. Decide tú la forma exacta y
     explícala.
   - **No se guarda nada derivado de los cuatro primeros dígitos de un PIN de 6** (ni huella de
     prefijo ni nada parecido): eso reduciría el ataque a 10 000 + 100 combinaciones y anularía la
     decisión. Si para algo lo necesitaras, para y dilo en el done.
   - El rate-limit de la puerta (residencia-3 §2) se mantiene igual para los dos largos.
2. **Lo que no se descifra deja rastro** (deuda de clinica-7, residencia-1b §12.1 y residencia-3
   §15.4): se cablea `configurarAvisoDeIlegible` para que cada valor cifrado que no se pueda descifrar
   escriba una línea de log con **tenant, tabla, columna, id de fila, sitio y motivo**, y **nunca** el
   valor, ni el ciphertext, ni nada que permita reconstruirlo. Sin duplicar: el mismo valor ilegible
   leído cien veces deja una línea por intervalo razonable, no cien. Un test recorre las veinticuatro
   columnas cifradas y comprueba que cada una deja su línea y ninguna filtra nada.
3. **La puerta sin red recuerda lo suyo** (residencia-3 §15.3): lo que la propia tablet acaba de
   registrar (aunque no haya subido) se pinta como hecho en «lo que toca», con su marca de «en la
   tablet». Lo registrado desde otra tablet sin red sigue sin poder saberse, y se dice.
4. **El parte de un turno sin plan no se llena de ruido** (residencia-5 §16.4): un residente sin plan
   de cuidados vigente no genera líneas de «no hecho»; el parte dice una sola vez «N residentes sin
   plan de cuidados» con sus nombres, y el panel de dirección lo muestra como algo que hay que arreglar.
5. **Barrido de ficheros huérfanos** (residencia-3 §15.5, residencia-5 §16.5): un script
   (`pnpm --filter api barrer-huerfanos`) que lista los ficheros del volumen clínico que ya no
   referencia ninguna fila. Por defecto **sólo lista**; con `--borrar` borra, y nunca toca un fichero
   referenciado ni uno más reciente que un margen (para no pisar una subida en curso). Deja una línea
   de resumen en el log, sin rutas que revelen nada del residente.
6. **El enlace «Declaración responsable» del pie del admin** pasa a medir ≥ 44 px de alto táctil.

## Respeta

- Tenants sin residencia no notan nada; el PIN del TPV no cambia (es otro, residencia-3 §2).
- `UserRole` no gana valores. Nada de salud en logs, tampoco en las líneas nuevas del punto 2.
- Suite, `e2e` y `pnpm e2e:agenda` como estaban; la CI sin Redis.
- Sistema visual y metodología de front de Mi Piace.
- `.ficheros-clinicos/` está en `.gitignore` desde el 18-10: el sembrador no debe dejar nada versionado.

## Fuera de alcance (declarado)

Lo que sólo se puede comprobar en la residencia (§19 A y B del done de residencia-5: timbre del Android,
batería, wifi, tablet de sala, turno observado), que va en `docs/residencia/visita-piloto.md`. Los
puntos 16, 17, 19 y 21 del §19, que esperan a más centros o más datos. `control_code` (D-69).

## Cómo se cierra

- Migración (si hace falta para «PIN por renovar») con su `down`, sobre una copia con datos de
  residencia-1 a -5.
- Tests de tabla del PIN: auxiliar con 4 entra · DUE con 6 entra · DUE con 4 rechazado al darlo · a una
  auxiliar se le asigna rol de DUE → su PIN de 4 queda por renovar y no entra en puerta, sala ni
  guardia · el botón «PIN de 6» funciona sin red · el rate-limit cuenta igual.
- Test del rastro de lo ilegible sobre las veinticuatro columnas, con la aserción de que el log no
  contiene el valor ni el ciphertext.
- E2e sin red de la puerta: registra, recarga «lo que toca» sin red y lo ve hecho «en la tablet».
- Test del parte con un residente sin plan.
- Test del barrido: lista sin borrar, borra con `--borrar`, respeta el margen y lo referenciado.
- Tabla de sabotajes: un PIN de 4 a una DUE por SQL (¿lo para algo, o sólo la ruta? dilo) · forzar un
  descifrado fallido y buscar el valor en el log · `--borrar` con un fichero referenciado.
- Capturas del teclado con «PIN de 6», del aviso de PIN por renovar y del parte con residentes sin plan.
- CI verde; `docs/blocks/residencia-6-done.md` con la estructura de la metodología y el §19 del done de
  residencia-5 **actualizado** (qué se cerró aquí y qué sigue abierto).
- Commits pequeños en español, push y **PR contra `master`**. Ni merges ni despliegues.
