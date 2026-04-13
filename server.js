const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
app.use(express.json());

const CLIENTE = process.env.CLIENTE || 'thalia';
const cfgPath = path.join(__dirname, 'clientes', CLIENTE, 'config.json');
if (!fs.existsSync(cfgPath)) { console.error('ERROR: config no encontrado para', CLIENTE); process.exit(1); }
const CFG = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const API_KEY = CFG.holded.api_key;
const HOLDED = 'https://api.holded.com/api/invoicing/v1';
console.log('TPV arrancado para:', CFG.negocio.nombre);

async function holded(endpoint, opts = {}) {
  const r = await fetch(HOLDED + endpoint, { ...opts, headers: { key: API_KEY, 'Content-Type': 'application/json', ...(opts.headers||{}) } });
  if (!r.ok) throw new Error('Holded ' + r.status);
  return r.json();
}

app.get('/', (req, res) => {
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const pub = { negocio: CFG.negocio, iva: CFG.iva, pagos: CFG.pagos, print: CFG.print, caja: CFG.caja, clientes: CFG.clientes, holded: { serie: CFG.holded.serie } };
  html = html.replace('__CONFIG__', JSON.stringify(pub));
  res.send(html);
});

app.get('/api/productos', async (req, res) => {
  try {
    const data = await holded('/products');
    const raw = data.data || data;
    const prods = raw
      .filter(p => p.forSale !== 0)
      .map(p => ({
        id: p.id,
        name: p.name,
        ean: p.barcode || p.sku || p.id,
        precio: parseFloat(p.price) || 0,
        cat: (p.attributes && p.attributes[0] && p.attributes[0].value) || p.kind || 'General',
        stock: parseInt(p.stock) || 0,
        img: p.imageURL || ''
      }));
    res.json(prods);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/contactos', async (req, res) => {
  try {
    const q = req.query.q || '';
    const data = await holded('/contacts?name=' + encodeURIComponent(q));
    res.json((data.data || data).slice(0,15).map(c => ({ id: c.id, name: c.name, email: c.email || '' })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ventas', async (req, res) => {
  try {
    const { contactId, date, notes, items, paymentMethod, numSerie } = req.body;
    const payload = { date: date || Math.floor(Date.now()/1000), notes: notes || '', numSerie: numSerie || CFG.holded.serie, items: items.map(i => ({ name: i.name, units: i.units, price: i.price, tax: i.tax || 4, discount: 0 })) };
    if (contactId) payload.contactId = contactId;
    const result = await holded('/documents/salesreceipt', { method: 'POST', body: JSON.stringify(payload) });
    console.log('Venta creada:', result.id);
    res.json({ ok: true, id: result.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Servidor en puerto', PORT));
