# holded-desconectar · el ensayo general

Lo que se corre sobre la copia de producción **antes** de tocar producción, y lo que se corre
sobre producción el día del despliegue. El guion completo está en
[`../holded-desconectar-done.md`](../holded-desconectar-done.md) §9.

| Fichero | Para qué |
|---|---|
| `precondicion-verifactu.sql` | La comprobación que hay que hacer **antes** de lanzar la migración de verifactu-1: si devuelve filas, la migración aborta a propósito. En la copia del 24-09 devuelve dos (Sirope 5 terminales, Cachitos 3) |
| `foto.sql` | Las doce consultas de la foto de un comercio: catálogo por origen, SKU duplicados, tickets, abonos, subidas, turnos, contactos, fiado, citas, registros fiscales y un **md5 del catálogo por comercio** para comparar al byte |

Las dos son de sólo lectura y todo lo que devuelven es agregado por comercio: ningún dato
personal.

```bash
# Sobre la copia (o sobre producción el día D).
psql "$DATABASE_URL" -f precondicion-verifactu.sql
psql "$DATABASE_URL" -f foto.sql > antes.txt
#   … el corte …
psql "$DATABASE_URL" -f foto.sql > despues.txt
diff antes.txt despues.txt
```

El diff tiene que tocar **sólo** al comercio del corte. Si el md5 del catálogo de cualquier otro
cambia, se para.
