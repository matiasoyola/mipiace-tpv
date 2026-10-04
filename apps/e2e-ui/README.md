# Banco de pruebas de la agenda (`@mipiacetpv/e2e-ui`)

Recorre la agenda **completa por la interfaz real** contra la stack real —
API + Postgres + admin + TPV — y además de pulsar **comprueba el estado**: en
pantalla y en la base de datos.

**No entra en la CI.** Se lanza a mano:

```bash
pnpm e2e:agenda
```

Eso levanta Postgres y Redis, crea la base `mipiacetpv_agenda_banco_e2e` si
falta, aplica las migraciones reales, siembra «Peluquería Demo» y arranca (o
reusa) la API, el admin y el TPV. Si Docker no responde, lo dice y explica qué
hacer.

| Comando | Qué hace |
|---|---|
| `pnpm e2e:agenda` | el banco entero |
| `pnpm e2e:agenda:seed` | sólo volver a sembrar |
| `pnpm --filter @mipiacetpv/e2e-ui run video` | lo mismo, grabando y a ritmo humano |
| `pnpm --filter @mipiacetpv/e2e-ui run e2e:solo -- specs/06-*` | un capítulo suelto, sin sembrar |
| `video/montar.sh` | monta los MP4 (un capítulo por fichero + uno completo) |

## La base es de usar y tirar

El seed **vacía la base entera** (`TRUNCATE` de todas las tablas menos las
migraciones) y la vuelve a montar con ids fijos. Por eso se niega a correr si
el nombre de la base no contiene `banco`, `e2e` o `test` — el mismo
guardarraíl que `apps/api/test-e2e/e2e-env.ts`.

La conexión sale de `DATABASE_URL` o, si no está, de `apps/api/.env`: el banco
tiene que mirar **la misma base que la API local**, o no prueba nada.

## Cómo está montado

```
seed/escenario.ts        los datos del escenario (lo leen el seed Y los specs)
seed/peluqueria-demo.ts  el seed idempotente
seed/stack.ts            contenedores + base + migraciones + seed
lib/entrar.ts            cómo se entra al admin y al TPV (y qué no se puede sembrar)
lib/agenda-ui.ts         la geometría de la rejilla y los gestos de la agenda
lib/bd.ts                la mirada a la BD (las columnas tstzrange, por SQL crudo)
lib/rotulo.ts            los rótulos del vídeo, como overlay inyectado
lib/pantallas.ts         los tamaños: AP11, panel, móvil
specs/NN-*.spec.ts       un capítulo por fichero, en orden
video/montar.sh          el montaje con ffmpeg
```

**Un solo worker y sin reintentos**: los capítulos son los del vídeo y el
estado se arrastra (el 6 reserva sobre el equipo que dio de alta el 3).

El escenario vive en un solo sitio porque lo leen dos cosas que tienen que
decir lo mismo: el seed, que lo mete en la base, y los specs, que lo teclean
en la pantalla y lo comprueban.

## El vídeo

`BANCO_VIDEO=1` enciende tres cosas: la grabación, el `slowMo` y las pausas
entre pasos. Los rótulos se pintan **siempre** (cuestan nada y hacen legible
la captura de un fallo); lo que sólo pasa grabando son las esperas.

Los rótulos son un overlay que inyecta el propio spec: **no se toca la app**.

Los vídeos **no entran en git**: `video/montar.sh` los deja en
`~/Developer/Claude/Projects/mipiacetpv-media/agenda/`.

## Lo que este banco no puede probar

Impresora, teclado del hierro, lector, dedo, WebView real y red del local:
`docs/qa/agenda-banco-manual.md`.
