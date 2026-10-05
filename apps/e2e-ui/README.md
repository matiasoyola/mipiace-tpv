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
| `pnpm --filter @mipiacetpv/e2e-ui run video` | lo mismo, grabando y a ritmo humano (`BANCO_VIDEO=1`) |
| `pnpm --filter @mipiacetpv/e2e-ui run e2e:solo -- specs/06-*` | un capítulo suelto, sin sembrar |
| `video/montar.sh` | monta los MP4 (un capítulo por fichero + uno completo) |

## La base es de usar y tirar

El seed **vacía la base entera** (`TRUNCATE` de todas las tablas menos las
migraciones) y la vuelve a montar con ids fijos. Por eso se niega a correr si
el nombre de la base no **termina** en `_e2e`. No vale que lo contenga: con
varios worktrees abiertos, un `DATABASE_URL` heredado del entorno o un `.env`
copiado de otro árbol es un accidente de un segundo, y detrás hay un TRUNCATE
sin vuelta. La guarda está en el seed **y** en `seed/stack.ts`, antes de crear
la base y de migrarla.

La conexión sale de `DATABASE_URL` o, si no está, de `apps/api/.env`: el banco
tiene que mirar **la misma base que la API local**, o no prueba nada.

## Si hay otra sesión con su stack arriba

Por defecto el banco usa 3001 / 5173 / 5174 y **reutiliza** los servidores que
ya estén escuchando ahí. Con varios worktrees abiertos eso es una trampa: se
acaba probando el código de otro árbol contra la base de otro árbol, y puede
salir verde. Dos redes:

1. **El banco comprueba con quién habla** antes de empezar
   (`seed/comprobar-stack.ts`, como `globalSetup`): entra con la dueña
   sembrada y exige que el tenant que contesta sea el del escenario. Si en ese
   puerto hay otra API, se cae diciendo qué pasa y cómo arreglarlo.
2. **Puertos propios**, y entonces no reutiliza nada:

```bash
BANCO_API_PORT=3101 BANCO_ADMIN_PORT=5273 BANCO_TPV_PORT=5274 \
  DATABASE_URL=postgresql://…/mipiacetpv_agenda_banco_e2e pnpm e2e:agenda
```

Con cualquiera de las tres variables puestas, `reuseExistingServer` pasa a
`false`: el banco levanta los suyos o se cae con el conflicto en la cara. El
proxy `/api` del admin y del TPV sigue a la API del banco por
`MIPIACETPV_API_PROXY`, que la config pone sola — mover la API sin mover el
proxy deja las pantallas hablando con la stack equivocada, que es la misma
trampa por el otro lado.

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

El script `video` existe desde agenda-lista: este README y el done del banco
ya lo citaban, pero no estaba en el `package.json` (había que exportar
`BANCO_VIDEO=1` a mano).

`BANCO_VIDEO=1` enciende tres cosas: la grabación, el `slowMo` y las pausas
entre pasos. Los rótulos se pintan **siempre** (cuestan nada y hacen legible
la captura de un fallo); lo que sólo pasa grabando son las esperas.

Los rótulos son un overlay que inyecta el propio spec: **no se toca la app**.

Los vídeos **no entran en git**: `video/montar.sh` los deja en
`~/Developer/Claude/Projects/mipiacetpv-media/agenda/`.

## Lo que este banco no puede probar

Impresora, teclado del hierro, lector, dedo, WebView real y red del local:
`docs/qa/agenda-banco-manual.md`.
