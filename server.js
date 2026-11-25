// server.js - Real-Time Multi-Branch Central Server for Tonang Farma
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORTS = process.env.PORT ? [parseInt(process.env.PORT, 10)] : [8080, 5173, 3000];
const PUBLIC_DIR = __dirname;
const DATA_DIR = path.join(PUBLIC_DIR, 'data');
const STATE_FILE = path.join(DATA_DIR, 'server_state.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory embedded downloads (loaded without blocking server start)
let embeddedDownloads = {};
try {
  embeddedDownloads = require('./embedded_downloads');
} catch (e) {
  console.log('[DOWNLOADS] Note:', e.message);
}

// In-memory server state
let serverState = {
  version: 1,
  lastUpdated: Date.now(),
  medicines: [],
  deletedMedicineCodes: [],
  branches: [],
  batches: [],
  sales: [],
  transfers: [],
  expenses: [],
  users: [],
  suppliers: [],
  purchases: []
};

// Load existing state if present
if (fs.existsSync(STATE_FILE)) {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    serverState = JSON.parse(raw);
    serverState.deletedMedicineCodes = serverState.deletedMedicineCodes || [];
    console.log(`[STATE] Loaded server state v${serverState.version} with ${serverState.medicines?.length || 0} medicines, ${serverState.deletedMedicineCodes.length} deleted.`);
  } catch (err) {
    console.error('[STATE] Error reading state file:', err.message);
  }
}

function persistState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(serverState, null, 2), 'utf8');
  } catch (err) {
    console.error('[STATE] Failed to save state to disk:', err.message);
  }
}

// SSE Clients for real-time broadcasts
const sseClients = [];

function broadcastSSE(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (let i = sseClients.length - 1; i >= 0; i--) {
    const client = sseClients[i];
    try {
      client.write(payload);
    } catch (e) {
      sseClients.splice(i, 1);
    }
  }
}

// Heartbeat ping every 15s to keep connections alive through proxies / tunnels
setInterval(() => {
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try {
      sseClients[i].write(': ping\n\n');
    } catch (e) {
      sseClients.splice(i, 1);
    }
  }
}, 15000);

// Merge collections helper (preserves existing, updates matches, appends new)
function mergeArrayById(targetArr, sourceArr, idKey = 'id') {
  if (!Array.isArray(targetArr)) targetArr = [];
  if (!Array.isArray(sourceArr)) return targetArr;

  const map = new Map();
  targetArr.forEach(item => {
    const key = item[idKey] || item.code || JSON.stringify(item);
    map.set(key, item);
  });

  sourceArr.forEach(item => {
    const key = item[idKey] || item.code || JSON.stringify(item);
    if (map.has(key)) {
      // Merge properties
      map.set(key, Object.assign({}, map.get(key), item));
    } else {
      map.set(key, item);
    }
  });

  return Array.from(map.values());
}

// Ensure no duplicate medicine code, barcode, or name exists in server state
function deduplicateMedicines(medicines) {
  if (!Array.isArray(medicines)) return [];
  const seenCodes = new Set();
  const seenBarcodes = new Set();
  const seenNames = new Set();
  const result = [];
  
  for (const med of medicines) {
    if (!med) continue;
    const code = (med.code || '').trim().toUpperCase();
    const barcode = (med.barcode || '').trim();
    const name = (med.name || '').trim().toLowerCase();
    if (code && seenCodes.has(code)) continue;
    if (barcode && seenBarcodes.has(barcode)) continue;
    if (name && seenNames.has(name)) continue;
    if (code) seenCodes.add(code);
    if (barcode) seenBarcodes.add(barcode);
    if (name) seenNames.add(name);
    result.push(med);
  }
  return result;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.apk': 'application/vnd.android.package-archive',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
  '.bat': 'application/x-bat'
};

function requestHandler(req, res) {
  // Global CORS & Cache control
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlObj = new URL(req.url, 'http://localhost');
  const pathname = urlObj.pathname;

  if (pathname.startsWith('/api/')) {
    console.log(`[API ${req.method}] ${pathname} from ${req.socket.remoteAddress}`);
  }

  // ==========================================
  // API: REAL-TIME SERVER-SENT EVENTS
  // ==========================================
  if (pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(`: connected\n\ndata: ${JSON.stringify({ type: 'CONNECTED', version: serverState.version })}\n\n`);
    sseClients.push(res);

    req.on('close', () => {
      const idx = sseClients.indexOf(res);
      if (idx !== -1) sseClients.splice(idx, 1);
    });
    return;
  }

  // ==========================================
  // API: GET CURRENT STATE VERSION
  // ==========================================
  if (pathname === '/api/version') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
    res.end(JSON.stringify({
      status: 'ok',
      version: serverState.version,
      lastUpdated: serverState.lastUpdated
    }));
    return;
  }

  // ==========================================
  // API: GET FULL CENTRAL STATE
  // ==========================================
  if (pathname === '/api/state' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
    res.end(JSON.stringify({
      status: 'ok',
      version: serverState.version,
      lastUpdated: serverState.lastUpdated,
      data: serverState
    }));
    return;
  }

  // ==========================================
  // API: DELETE MEDICINE PERMANENTLY & BROADCAST
  // ==========================================
  if (pathname === '/api/medicine/delete' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const targetId = payload.id;
        const targetCode = payload.code;

        if (!targetId && !targetCode) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: 'Missing medicine id or code' }));
          return;
        }

        // Remove from medicines array
        serverState.deletedMedicineCodes = [];
        const beforeCount = serverState.medicines.length;
        serverState.medicines = serverState.medicines.filter(m => m.id !== targetId && m.code !== targetCode);
        const removed = beforeCount - serverState.medicines.length;

        serverState.version = (serverState.version || 1) + 1;
        serverState.lastUpdated = Date.now();
        persistState();

        // Broadcast to all clients via SSE
        broadcastSSE({
          type: 'MEDICINE_DELETED',
          version: serverState.version,
          lastUpdated: serverState.lastUpdated,
          targetId,
          targetCode
        });

        console.log(`[DELETE] Medicine ${targetCode || targetId} deleted. Version bumped to v${serverState.version}. Remaining: ${serverState.medicines.length}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          version: serverState.version,
          deleted: { id: targetId, code: targetCode },
          remainingMedicines: serverState.medicines.length
        }));
      } catch (err) {
        console.error('[DELETE] Error deleting medicine:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: err.message }));
      }
    });
    return;
  }

  // ==========================================
  // API: REAL-TIME MEDICINE UPSERT / SAVE (ADD & EDIT)
  // ==========================================
  if (pathname === '/api/medicine/save' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) req.destroy();
    });

    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const med = payload.medicine || payload;
        if (!med || (!med.id && !med.code)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: 'Missing medicine payload' }));
          return;
        }

        const medCode = (med.code || med.id).trim().toUpperCase();
        const medId = (med.id || medCode).trim();

        // 1. Clear any tombstones (allow re-creating or updating any medicine)
        serverState.deletedMedicineCodes = [];

        // 2. Upsert into serverState.medicines
        serverState.medicines = serverState.medicines || [];
        const idx = serverState.medicines.findIndex(m => m.id === medId || (m.code && m.code.toUpperCase() === medCode));
        if (idx !== -1) {
          serverState.medicines[idx] = Object.assign({}, serverState.medicines[idx], med);
        } else {
          serverState.medicines.push(med);
        }

        serverState.version = (serverState.version || 1) + 1;
        serverState.lastUpdated = Date.now();
        persistState();

        // 3. Broadcast real-time SSE to all connected clients (Mac, iPad, Windows, Android)
        broadcastSSE({
          type: 'MEDICINE_SAVED',
          version: serverState.version,
          lastUpdated: serverState.lastUpdated,
          medicine: med
        });

        console.log(`[MEDICINE_SAVED] Medicine "${med.name}" (${medCode}) upserted in real-time. Version bumped to v${serverState.version}. Total: ${serverState.medicines.length}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          version: serverState.version,
          medicine: med,
          totalMedicines: serverState.medicines.length
        }));
      } catch (err) {
        console.error('[MEDICINE_SAVED] Error saving medicine:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: err.message }));
      }
    });
    return;
  }

  // ==========================================
  // API: REAL-TIME POS SALE COMPLETION & STOCK DEDUCTION
  // ==========================================
  if (pathname === '/api/pos/sale' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) req.destroy();
    });

    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const sale = payload.sale;
        const batches = payload.batches;

        if (!sale || !sale.id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: 'Missing sale data' }));
          return;
        }

        serverState.sales = serverState.sales || [];
        const exists = serverState.sales.some(s => s.id === sale.id);
        if (!exists) {
          serverState.sales.unshift(sale);
        } else {
          const idx = serverState.sales.findIndex(s => s.id === sale.id);
          serverState.sales[idx] = sale;
        }

        // Update central batch stocks
        if (Array.isArray(batches)) {
          serverState.batches = mergeArrayById(serverState.batches || [], batches, 'id');
        }

        serverState.version = (serverState.version || 1) + 1;
        serverState.lastUpdated = Date.now();
        persistState();

        // Broadcast real-time SSE event to all connected devices (iPad, Android, Mac, PC)
        broadcastSSE({
          type: 'SALE_COMPLETED',
          version: serverState.version,
          lastUpdated: serverState.lastUpdated,
          sale: sale,
          batches: serverState.batches
        });

        // Also broadcast STATE_UPDATED as universal fallback
        broadcastSSE({
          type: 'STATE_UPDATED',
          version: serverState.version,
          lastUpdated: serverState.lastUpdated
        });

        console.log(`[POS SALE] Sale ${sale.id} (Rp ${sale.total}) synced from client. Version bumped to v${serverState.version}. Total sales: ${serverState.sales.length}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          version: serverState.version,
          sale: sale,
          totalSales: serverState.sales.length
        }));
      } catch (err) {
        console.error('[POS SALE] Error processing sale:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: err.message }));
      }
    });
    return;
  }

  // ==========================================
  // API: SYNC / UPDATE CENTRAL STATE
  // ==========================================
  if ((pathname === '/api/state' || pathname === '/api/sync') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      // Protect from oversized payload (>25MB)
      if (body.length > 25 * 1024 * 1024) {
        res.writeHead(413, { 'Content-Type': 'text/plain' });
        res.end('Payload Too Large');
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const incoming = parsed.data || parsed;

        let hasChanges = false;

        serverState.deletedMedicineCodes = [];
        if (incoming.medicines && Array.isArray(incoming.medicines)) {
          // Merge incoming into server medicines (incoming takes precedence)
          serverState.medicines = deduplicateMedicines(mergeArrayById(serverState.medicines, incoming.medicines, 'code'));
          hasChanges = true;
        }

        if (incoming.sales && Array.isArray(incoming.sales)) {
          serverState.sales = mergeArrayById(serverState.sales || [], incoming.sales, 'id');
          hasChanges = true;
        }

        if (incoming.batches && Array.isArray(incoming.batches)) {
          if (incoming.replaceBatches) {
            serverState.batches = incoming.batches;
          } else {
            serverState.batches = mergeArrayById(serverState.batches || [], incoming.batches, 'id');
          }
          hasChanges = true;
        }

        if (incoming.deletedBatchIds && Array.isArray(incoming.deletedBatchIds)) {
          serverState.batches = (serverState.batches || []).filter(b => !incoming.deletedBatchIds.includes(b.id));
          hasChanges = true;
        }

        if (incoming.transfers && Array.isArray(incoming.transfers)) {
          serverState.transfers = mergeArrayById(serverState.transfers, incoming.transfers, 'id');
          hasChanges = true;
        }

        if (incoming.expenses && Array.isArray(incoming.expenses)) {
          if (incoming.replaceExpenses) {
            serverState.expenses = incoming.expenses;
          } else {
            serverState.expenses = mergeArrayById(serverState.expenses, incoming.expenses, 'id');
          }
          hasChanges = true;
        }

        if (incoming.deletedExpenseIds && Array.isArray(incoming.deletedExpenseIds)) {
          serverState.expenses = (serverState.expenses || []).filter(e => !incoming.deletedExpenseIds.includes(e.id));
          hasChanges = true;
        }

        if (incoming.users && Array.isArray(incoming.users)) {
          serverState.users = mergeArrayById(serverState.users, incoming.users, 'id');
          hasChanges = true;
        }

        if (incoming.branches && Array.isArray(incoming.branches)) {
          serverState.branches = mergeArrayById(serverState.branches, incoming.branches, 'id');
          hasChanges = true;
        }

        if (incoming.suppliers && Array.isArray(incoming.suppliers)) {
          serverState.suppliers = incoming.suppliers;
          hasChanges = true;
        }

        if (incoming.purchases && Array.isArray(incoming.purchases)) {
          serverState.purchases = mergeArrayById(serverState.purchases, incoming.purchases, 'id');
          hasChanges = true;
        }

        if (hasChanges) {
          serverState.version = (serverState.version || 1) + 1;
          serverState.lastUpdated = Date.now();
          persistState();

          // Broadcast real-time update event to all other clients
          broadcastSSE({
            type: 'STATE_UPDATED',
            version: serverState.version,
            lastUpdated: serverState.lastUpdated
          });
          console.log(`[SYNC] State updated to v${serverState.version} by client (${req.socket.remoteAddress}). Medicines: ${serverState.medicines.length}`);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          version: serverState.version,
          lastUpdated: serverState.lastUpdated,
          data: serverState
        }));
      } catch (err) {
        console.error('[SYNC] Error parsing sync payload:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: err.message }));
      }
    });
    return;
  }

  // ==========================================
  // DOWNLOAD ENDPOINTS (GUARANTEED SERVE)
  // ==========================================
  if (pathname.startsWith('/downloads/')) {
    const dlName = path.basename(pathname);
    if (embeddedDownloads && embeddedDownloads[dlName]) {
      const buf = Buffer.from(embeddedDownloads[dlName], 'base64');
      const ext = path.extname(dlName).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Content-Length': buf.length,
        'Content-Disposition': `attachment; filename="${dlName}"`,
        'Cache-Control': 'public, max-age=86400'
      });
      res.end(buf);
      return;
    }
  }

  // ==========================================
  // STATIC FILE SERVING
  // ==========================================
  let safePath = pathname;
  if (safePath === '/' || safePath === '') {
    safePath = '/index.html';
  }

  const filePath = path.join(PUBLIC_DIR, safePath);

  // Security: prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
        return;
      }

      const headers = {
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(content),
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      };
      if (ext === '.apk' || ext === '.zip') {
        headers['Content-Disposition'] = 'attachment; filename="' + path.basename(filePath) + '"';
      }

      res.writeHead(200, headers);
      res.end(content);
    });
  });
}

PORTS.forEach((port) => {
  const s = http.createServer(requestHandler);
  s.on('error', (err) => {
    console.log(`Port ${port} in use or unavailable:`, err.message);
  });
  s.listen(port, '0.0.0.0', () => {
    console.log(`Tonang Farma Server listening on http://localhost:${port} & http://127.0.0.1:${port}`);
  });
});
