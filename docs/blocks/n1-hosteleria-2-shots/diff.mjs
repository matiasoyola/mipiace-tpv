import { readFileSync } from "node:fs";
import { PNG } from "pngjs";

function leer(p) { return PNG.sync.read(readFileSync(p)); }

for (const nombre of ["AP11-mapa", "AP11-venta", "D8-mapa", "D8-venta"]) {
  const a = leer(`shots/antes-${nombre}.png`);
  const b = leer(`shots/despues-${nombre}.png`);
  if (a.width !== b.width || a.height !== b.height) {
    console.log(`${nombre}: TAMANOS DISTINTOS ${a.width}x${a.height} vs ${b.width}x${b.height}`);
    continue;
  }
  let distintos = 0;
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (a.width * y + x) << 2;
      if (a.data[i] !== b.data[i] || a.data[i+1] !== b.data[i+1] || a.data[i+2] !== b.data[i+2]) {
        distintos++;
        if (x < minX) minX = x; if (y < minY) minY = y;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
    }
  }
  const total = a.width * a.height;
  const pct = ((distintos / total) * 100).toFixed(4);
  const caja = distintos ? `caja de cambio x ${minX}..${maxX} · y ${minY}..${maxY} (${maxX-minX+1}x${maxY-minY+1})` : "ninguna";
  console.log(`${nombre.padEnd(12)} ${String(distintos).padStart(8)} px distintos de ${total} (${pct} %) · ${caja}`);
}
