# Bucle visual · iva-exento-sanitario · el servicio sanitario sale exento

Capturas del **07-10-2026**, contra la stack de verdad (API + Postgres + el
panel + la PWA del TPV) y sobre la clínica del banco
(`apps/e2e-ui/seed/clinica-demo.ts`). **No son maquetas**: los dos tickets
salen del `POST /tickets/:id/print/escpos` y del `GET /tickets/:slug/pdf`
de la API, sobre dos ventas que se cobraron tecleando en el TPV.

La base y el Redis son propios de este worktree
(`mipiacetpv_ivaexento_banco_e2e`, Redis en 6381, API en 3102, panel en
5273, TPV en 5274): con varias sesiones abiertas, una API de dev
compartida se come los jobs de la de al lado.

## Lo que se mira

### El editor de catálogo

| Fichero | Qué se mira |
| ------- | ----------- |
| `con-clinica-ficha-exenta-1024.png` | La ficha de la **Quiropodia** con la historia clínica encendida: los cuatro tramos (21/10/4/0), la vía de escape «Otro…» y el **chip ancho «Exento · sanitario  art. 20.Uno.3º»** marcado. Debajo, el aviso verde del mockup. Y el campo de precio se llama **«Precio»**, no «Precio con IVA». |
| `con-clinica-ficha-exenta-390.png` | Lo mismo a 390 px: los chips se reparten en dos filas y el ancho se queda entero. |
| `con-clinica-lista-1024.png` | La lista: los servicios sanitarios dicen **«Exento · sanitario · art. 20.Uno.3º»** y la crema dice **«IVA 21%»**. |
| `sin-clinica-alta-1024.png` | **El mismo formulario en la peluquería del banco** (sin clínica): cuatro chips y «Otro…», y **ni rastro del chip de exención**. El rótulo vuelve a ser «Precio con IVA». Es la decisión 5 del bloque: un bar no ve esa opción. |

### Las dos ventas del mockup, cobradas de verdad

| Fichero | Qué se mira |
| ------- | ----------- |
| `solo-sesion-02-cobro.png` | El cobro de la quiropodia: `Subtotal 35,00 € · IVA 0,00 € · TOTAL 35,00 €`. |
| `solo-sesion-03-post-cobro.png` | «Ticket emitido · #000001». |
| `sesion-crema-02-cobro.png` | El cobro mixto: `Subtotal 44,92 € · IVA 2,08 € · TOTAL 47,00 €`. **Los números del mockup, al céntimo.** |
| `sesion-crema-03-post-cobro.png` | «Ticket emitido · #000002». |

### El papel, por los tres caminos

| Fichero | Qué se mira |
| ------- | ----------- |
| `ticket-solo-sesion.txt` | Los **bytes ESC/POS de verdad** que salen de `POST /tickets/:id/print/escpos`, descifrados de PC850. `Exento 35,00 €`, `IVA 0,00 €`, **ningún «Subtotal»**, y la leyenda en recuadro. |
| `ticket-sesion-crema.txt` | Los mismos bytes del ticket mixto: `Exento 35,00 €`, `Base 21 % 9,92 €`, `IVA 21 % 2,08 €` y la leyenda **precedida del nombre**: «Quiropodia: operación exenta de IVA». |
| `ticket-solo-sesion.pdf` / `.png` | El **ticket digital** (el del email y el del QR), tal cual lo sirve `GET /tickets/:slug/pdf`. El `.png` es ese PDF rasterizado a 3× para poder mirarlo. |
| `ticket-sesion-crema.pdf` / `.png` | Lo mismo, el mixto. |
| `historico-solo-sesion-1024.png` | El **tercer camino**: la ficha del histórico del TPV, con la fila «Exento 35,00 €» y la misma leyenda en recuadro. Es la pantalla desde la que se reimprime. |
| `historico-sesion-crema-1024.png` | La del mixto, con «Quiropodia: operación exenta de IVA». |
| `historico-lista-1024.png` | Los dos tickets en la lista. |

Los tres caminos dicen **la misma frase**, y no por disciplina: la redacta
una sola función (`leyendaExencion`, en `@mipiacetpv/ticket-model`).

## El registro de facturación de esas dos ventas

Leído de `fiscal_records.payload` después de cobrarlas (no construido para
el informe):

```
C1/000001 · ALTA
  DetalleDesglose: [
    { Impuesto: "01", ClaveRegimen: "01",
      OperacionExenta: "E1", BaseImponibleOimporteNoSujeto: "35.00" }
  ]

C1/000002 · ALTA
  DetalleDesglose: [
    { Impuesto: "01", ClaveRegimen: "01",
      OperacionExenta: "E1", BaseImponibleOimporteNoSujeto: "35.00" },
    { Impuesto: "01", ClaveRegimen: "01",
      CalificacionOperacion: "S1", TipoImpositivo: "21.00",
      BaseImponibleOimporteNoSujeto: "9.92", CuotaRepercutida: "2.08" }
  ]
```

El tramo exento **no lleva** `CalificacionOperacion`, ni `TipoImpositivo`,
ni `CuotaRepercutida` — y no están «a `undefined`»: no están. Es el
`<choice>` del XSD y la validación §15.5.

## Lo que el bucle encontró, y que ningún test veía

**El recuadro de la leyenda del PDF estaba mal puesto.**

La primera versión dibujaba el borde con un alto FIJO de dos renglones en
una posición relativa al cursor. En la primera captura del ticket mixto se
ve lo que eso daba: **el borde de arriba pisaba el separador de los pagos y
el de abajo cortaba por la mitad la línea del precepto**
(`art. 20.Uno.3º Ley 37/1992`).

Ningún test lo veía, y no por descuido: los tres bancos del PDF leen el
TEXTO con `pdf-parse`, y el texto estaba entero. Lo que estaba mal era
dónde se pintaba la caja — y eso sólo se ve mirando.

El arreglo calcula el rectángulo **de los renglones que va a contener** (en
pdf-lib `y` es la BASE del rectángulo, así que se parte del último renglón
y se sube), y `computeLineCount` reserva el alto con el MISMO `wrapText`
que el render usa. Queda un test que cubre la mitad que un test puede
cubrir: que el alto reservado crece cuando el título se parte en dos
(`iva-exento-pdf.test.ts`, «el recuadro crece con el TÍTULO»).

## Cómo se repite

```bash
docker start mipiacetpv-postgres
docker start mipiacetpv-redis-ivaexento   # o: docker run -d --name … -p 6381:6379 redis:7-alpine
docker exec mipiacetpv-postgres psql -U mipiacetpv -c "CREATE DATABASE mipiacetpv_ivaexento_banco_e2e;"

# apps/api/.env de este worktree: puerto 3102, esa base, Redis 6381.
DATABASE_URL=postgresql://…/mipiacetpv_ivaexento_banco_e2e \
  pnpm --filter @mipiacetpv/db exec prisma migrate deploy
DATABASE_URL=… pnpm --filter @mipiacetpv/e2e-ui run seed      # peluquería (el tenant SIN clínica)
# y la clínica, con `sembrarClinica` de apps/e2e-ui/seed/clinica-demo.ts

PORT=3102 pnpm --filter @mipiacetpv/api start
MIPIACETPV_API_PROXY=http://127.0.0.1:3102 pnpm --filter @mipiacetpv/admin exec vite --port 5273
MIPIACETPV_API_PROXY=http://127.0.0.1:3102 pnpm --filter @mipiacetpv/tpv-web exec vite --port 5274
```

Y en el TPV: token de dispositivo `banco-clinica-dispositivo-0001`,
`lucia@clinicademo.local` con PIN `2468`. El panel, con la misma cuenta y
contraseña `BancoClinica2026!`; la peluquería sin clínica, con
`direccion@peluqueriademo.local` y `BancoAgenda2026!`.
