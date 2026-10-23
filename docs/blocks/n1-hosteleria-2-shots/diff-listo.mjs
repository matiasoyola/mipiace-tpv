import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
for (const n of ["AP11", "D8"]) {
  const a = PNG.sync.read(readFileSync(`shots/listo-antes-${n}.png`));
  const b = PNG.sync.read(readFileSync(`shots/listo-despues-${n}.png`));
  if (a.width !== b.width || a.height !== b.height) {
    console.log(`${n}: TAMANOS DISTINTOS -> la maquetacion cambio`); continue;
  }
  let d = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const i = (a.width * y + x) << 2;
    if (a.data[i] !== b.data[i] || a.data[i+1] !== b.data[i+1] || a.data[i+2] !== b.data[i+2]) {
      d++; if (x<minX) minX=x; if (y<minY) minY=y; if (x>maxX) maxX=x; if (y>maxY) maxY=y;
    }
  }
  console.log(`${n}: recorte ${a.width}x${a.height} IDENTICO de tamano · ${d} px distintos · caja x ${minX}..${maxX} y ${minY}..${maxY} (${maxX-minX+1}x${maxY-minY+1})`);
}
