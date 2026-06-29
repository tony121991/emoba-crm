const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 10000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:' + PORT;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined });

const capabilityLabels = {
  view_dashboard: 'Ver panel interno',
  create_orders: 'Crear pedidos',
  track_orders: 'Rastrear pedidos',
  manage_orders: 'Editar pedidos',
  manage_users: 'Administrar usuarios',
  view_history: 'Ver historial'
};

function json(res, status, data) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
function parseCookies(req) { return Object.fromEntries(String(req.headers.cookie || '').split(';').filter(Boolean).map((part) => { const index = part.indexOf('='); return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))]; })); }
async function readBody(req) { let body = ''; for await (const chunk of req) body += chunk; return body ? JSON.parse(body) : {}; }
function b64url(input) { return Buffer.from(input).toString('base64url'); }
function sign(value) { return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url'); }
function makeSession(user) { const payload = b64url(JSON.stringify({ userId: user.id, exp: Date.now() + 8 * 60 * 60 * 1000 })); return payload + '.' + sign(payload); }
function readSession(req) { const token = parseCookies(req).emoba_session; if (!token || !token.includes('.')) return null; const [payload, sig] = token.split('.'); if (sign(payload) !== sig) return null; try { const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); return data.exp > Date.now() ? data : null; } catch { return null; } }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) { const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex'); return salt + ':' + hash; }
function verifyPassword(password, stored) { const [salt, hash] = String(stored || '').split(':'); if (!salt || !hash) return false; const candidate = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex'); return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex')); }
function sanitizeUser(user) { if (!user) return null; const safe = { ...user }; delete safe.passwordHash; delete safe.password_hash; return safe; }
function userFromRow(row) { if (!row) return null; return { id: row.id, name: row.name, email: row.email, passwordHash: row.password_hash, role: row.role, customerName: row.customer_name || '', active: row.active, capabilities: row.capabilities || [], createdAt: row.created_at }; }
function orderFromRow(row) { if (!row) return null; return { id: row.id, customer: row.customer, contact: row.contact || '', product: row.product || '', quantity: row.quantity || '', destination: row.destination || '', requestedDate: row.requested_date || '', loadType: row.load_type || '', details: row.details || '', status: row.status, owner: row.owner || '', tank1: row.tank1 || '', note: row.note || '', createdBy: row.created_by || '', createdAt: row.created_at, deliveredAt: row.delivered_at || '', evidence: row.evidence || [] }; }
function has(user, capability) { return Boolean(user && user.capabilities && user.capabilities.includes(capability)); }
function canSeeOrder(user, order) { if (has(user, 'manage_orders') || has(user, 'view_dashboard')) return true; return order.createdBy === user.id || (user.customerName && order.customer === user.customerName); }
function csvEscape(value) { const text = String(value == null ? '' : value); return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text; }
function ordersToCsv(orders) { const headers = ['Carta Porte','Cliente','Contacto','Producto','Cantidad','Destino','Fecha solicitada','Servicio','Estatus','Unidad','Tanque 1','Nota','Creado','Entregado']; const rows = orders.map((o) => [o.id,o.customer,o.contact,o.product,o.quantity,o.destination,o.requestedDate,o.loadType,o.status,o.owner,o.tank1,o.note,o.createdAt,o.deliveredAt].map(csvEscape).join(',')); return [headers.join(','), ...rows].join('\n'); }

async function initDb() {
  const schema = await fs.readFile(path.join(ROOT, 'schema.sql'), 'utf8');
  await pool.query(schema);
  const count = Number((await pool.query('SELECT COUNT(*) AS total FROM users')).rows[0].total);
  if (!count) {
    await pool.query('INSERT INTO users (id,name,email,password_hash,role,customer_name,active,capabilities,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())', ['u-admin', 'Administrador EMOBA', process.env.ADMIN_EMAIL || 'admin@emoba.mx', hashPassword(process.env.ADMIN_PASSWORD || 'Admin123!'), 'admin', '', true, JSON.stringify(['view_dashboard','create_orders','track_orders','manage_orders','manage_users','view_history'])]);
  }
}

async function currentUser(req) { const session = readSession(req); if (!session) return null; const result = await pool.query('SELECT * FROM users WHERE id=$1 AND active=true', [session.userId]); return userFromRow(result.rows[0]); }
async function requireUser(req, res) { const user = await currentUser(req); if (!user) { json(res, 401, { error: 'Sesion requerida' }); return null; } return user; }
async function audit(user, action, entity, entityId, details = {}) { await pool.query('INSERT INTO audit_log (user_id,user_name,action,entity,entity_id,details) VALUES ($1,$2,$3,$4,$5,$6)', [user && user.id, user && user.name, action, entity, entityId, JSON.stringify(details)]); }
async function nextOrderId() { const result = await pool.query('SELECT id FROM orders'); const max = result.rows.reduce((highest, row) => { const number = Number(String(row.id).replace('EM-', '')); return Number.isFinite(number) ? Math.max(highest, number) : highest; }, 1023); return 'EM-' + (max + 1); }
async function listOrdersForUser(user) { const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC'); return result.rows.map(orderFromRow).filter((order) => canSeeOrder(user, order)); }

async function uploadEvidence(orderId, files) {
  const evidence = [];
  for (const file of files || []) {
    if (!file || !file.data) continue;
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_BUCKET) {
      const base64 = String(file.data).split(',')[1] || '';
      const bytes = Buffer.from(base64, 'base64');
      const safeName = String(file.name || 'archivo').replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = orderId + '/' + Date.now() + '-' + safeName;
      const uploadUrl = process.env.SUPABASE_URL.replace(/\/$/, '') + '/storage/v1/object/' + process.env.SUPABASE_BUCKET + '/' + storagePath;
      const response = await fetch(uploadUrl, { method: 'POST', headers: { authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, 'content-type': file.type || 'application/octet-stream', 'x-upsert': 'true' }, body: bytes });
      if (!response.ok) throw new Error('No se pudo subir evidencia a storage');
      evidence.push({ name: file.name, type: file.type, size: file.size, storagePath, url: '/api/evidence/' + encodeURIComponent(storagePath) + '/download', uploadedAt: new Date().toISOString() });
    } else {
      evidence.push(file);
    }
  }
  return evidence;
}

async function serveEvidence(req, res, user, storagePath) {
  const orders = await listOrdersForUser(user);
  const allowed = orders.some((order) => (order.evidence || []).some((file) => file.storagePath === storagePath));
  if (!allowed) return json(res, 404, { error: 'Evidencia no encontrada' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_BUCKET) return json(res, 404, { error: 'Storage no configurado' });
  const url = process.env.SUPABASE_URL.replace(/\/$/, '') + '/storage/v1/object/' + process.env.SUPABASE_BUCKET + '/' + storagePath;
  const response = await fetch(url, { headers: { authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY } });
  if (!response.ok) return json(res, 404, { error: 'Archivo no encontrado' });
  res.writeHead(200, { 'content-type': response.headers.get('content-type') || 'application/octet-stream' });
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

async function serveStatic(req, res) { const url = new URL(req.url, 'http://' + req.headers.host); const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)); const filePath = path.normalize(path.join(PUBLIC_DIR, requested)); if (!filePath.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'No permitido' }); try { const file = await fs.readFile(filePath); const ext = path.extname(filePath).toLowerCase(); const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' }; res.writeHead(200, { 'content-type': (types[ext] || 'application/octet-stream') + '; charset=utf-8' }); res.end(file); } catch { json(res, 404, { error: 'No encontrado' }); } }

async function handleApi(req, res) {
  const url = new URL(req.url, 'http://' + req.headers.host);
  const method = req.method;
  if (method === 'GET' && url.pathname === '/api/capabilities') return json(res, 200, { capabilities: capabilityLabels });
  if (method === 'POST' && url.pathname === '/api/login') { const body = await readBody(req); const result = await pool.query('SELECT * FROM users WHERE lower(email)=lower($1) AND active=true', [String(body.email || '')]); const user = userFromRow(result.rows[0]); if (!user || !verifyPassword(String(body.password || ''), user.passwordHash)) return json(res, 401, { error: 'Correo o contraseña incorrectos' }); res.setHeader('set-cookie', 'emoba_session=' + makeSession(user) + '; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=28800'); return json(res, 200, { user: sanitizeUser(user) }); }
  if (method === 'POST' && url.pathname === '/api/logout') { res.setHeader('set-cookie', 'emoba_session=; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=0'); return json(res, 200, { ok: true }); }
  const user = await requireUser(req, res); if (!user) return;
  const evidenceMatch = url.pathname.match(/^\/api\/evidence\/(.+)\/download$/); if (evidenceMatch && method === 'GET') return serveEvidence(req, res, user, decodeURIComponent(evidenceMatch[1]));
  if (method === 'GET' && url.pathname === '/api/me') return json(res, 200, { user: sanitizeUser(user), capabilityLabels });
  if (method === 'GET' && url.pathname === '/api/orders') return json(res, 200, { orders: await listOrdersForUser(user) });
  if (method === 'POST' && url.pathname === '/api/orders') { if (!has(user, 'create_orders')) return json(res, 403, { error: 'No tienes permiso para crear pedidos' }); const body = await readBody(req); const orderId = String(body.id || '').trim() || await nextOrderId(); const exists = await pool.query('SELECT id FROM orders WHERE upper(id)=upper($1)', [orderId]); if (exists.rows[0]) return json(res, 409, { error: 'Esa carta porte ya existe' }); const evidence = await uploadEvidence(orderId, body.evidence || []); const order = { id: orderId, customer: user.role === 'cliente' ? (user.customerName || body.customer || user.name) : String(body.customer || '').trim(), contact: String(body.contact || '').trim(), product: String(body.product || 'Regular').trim(), quantity: String(body.quantity || '').trim(), destination: String(body.destination || '').trim(), requestedDate: String(body.requestedDate || '').trim(), loadType: String(body.loadType || 'Pipa programada').trim(), details: String(body.details || '').trim(), status: 'Cargando', owner: 'Sin unidad', tank1: 'Por definir', note: 'Pedido recibido desde portal de cliente.', createdBy: user.id, evidence }; await pool.query('INSERT INTO orders (id,customer,contact,product,quantity,destination,requested_date,load_type,details,status,owner,tank1,note,created_by,evidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)', [order.id,order.customer,order.contact,order.product,order.quantity,order.destination,order.requestedDate,order.loadType,order.details,order.status,order.owner,order.tank1,order.note,order.createdBy,JSON.stringify(order.evidence)]); await audit(user, 'crear_pedido', 'order', order.id, { customer: order.customer, status: order.status }); return json(res, 201, { order: (await pool.query('SELECT * FROM orders WHERE id=$1', [order.id])).rows.map(orderFromRow)[0] }); }
  const orderMatch = url.pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (orderMatch && method === 'DELETE') { if (!has(user, 'manage_orders')) return json(res, 403, { error: 'No tienes permiso para eliminar pedidos' }); const found = await pool.query('DELETE FROM orders WHERE id=$1 RETURNING *', [orderMatch[1]]); if (!found.rows[0]) return json(res, 404, { error: 'Pedido no encontrado' }); const order = orderFromRow(found.rows[0]); await audit(user, 'eliminar_pedido', 'order', order.id, { customer: order.customer, status: order.status }); return json(res, 200, { order }); }
  if (orderMatch && method === 'PATCH') { if (!has(user, 'manage_orders')) return json(res, 403, { error: 'No tienes permiso para editar pedidos' }); const current = await pool.query('SELECT * FROM orders WHERE id=$1', [orderMatch[1]]); if (!current.rows[0]) return json(res, 404, { error: 'Pedido no encontrado' }); const order = orderFromRow(current.rows[0]); const body = await readBody(req); const newEvidence = await uploadEvidence(order.id, body.evidence || []); const evidence = (order.evidence || []).concat(newEvidence); const status = body.status != null ? String(body.status).trim() : order.status; const deliveredAt = status === 'Entregado' ? (order.deliveredAt || new Date().toISOString()) : null; const updated = await pool.query('UPDATE orders SET status=$1, owner=$2, tank1=$3, note=$4, delivered_at=$5, evidence=$6 WHERE id=$7 RETURNING *', [status, body.owner != null ? String(body.owner).trim() : order.owner, body.tank1 != null ? String(body.tank1).trim() : order.tank1, body.note != null ? String(body.note).trim() : order.note, deliveredAt, JSON.stringify(evidence), order.id]); await audit(user, 'actualizar_pedido', 'order', order.id, { status }); return json(res, 200, { order: orderFromRow(updated.rows[0]) }); }
  if (method === 'GET' && url.pathname === '/api/users') { if (!has(user, 'manage_users')) return json(res, 403, { error: 'No tienes permiso para ver usuarios' }); const result = await pool.query('SELECT * FROM users ORDER BY created_at DESC'); return json(res, 200, { users: result.rows.map(userFromRow).map(sanitizeUser) }); }
  if (method === 'POST' && url.pathname === '/api/users') { if (!has(user, 'manage_users')) return json(res, 403, { error: 'No tienes permiso para crear usuarios' }); const body = await readBody(req); const email = String(body.email || '').trim().toLowerCase(); const newUser = { id: crypto.randomUUID(), name: String(body.name || '').trim(), email, passwordHash: hashPassword(String(body.password || 'Emoba123!')), role: String(body.role || 'cliente'), customerName: String(body.customerName || '').trim(), active: body.active !== false, capabilities: Array.isArray(body.capabilities) ? body.capabilities.filter((cap) => capabilityLabels[cap]) : [] }; try { await pool.query('INSERT INTO users (id,name,email,password_hash,role,customer_name,active,capabilities) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [newUser.id,newUser.name,newUser.email,newUser.passwordHash,newUser.role,newUser.customerName,newUser.active,JSON.stringify(newUser.capabilities)]); } catch { return json(res, 409, { error: 'Ese correo ya existe' }); } await audit(user, 'crear_usuario', 'user', newUser.id, { email: newUser.email, role: newUser.role }); return json(res, 201, { user: sanitizeUser(newUser) }); }
  if (method === 'GET' && url.pathname === '/api/ops/health') { if (!has(user, 'manage_users') && !has(user, 'view_dashboard')) return json(res, 403, { error: 'No tienes permiso para ver operación' }); const [orders, delivered, users, auditRows] = await Promise.all([pool.query('SELECT COUNT(*) AS total FROM orders'), pool.query('SELECT COUNT(*) AS total FROM orders WHERE status=$1', ['Entregado']), pool.query('SELECT COUNT(*) AS total FROM users'), pool.query('SELECT COUNT(*) AS total FROM audit_log')]); return json(res, 200, { ok: true, generatedAt: new Date().toISOString(), database: 'PostgreSQL', orders: Number(orders.rows[0].total), delivered: Number(delivered.rows[0].total), activeOrders: Number(orders.rows[0].total) - Number(delivered.rows[0].total), users: Number(users.rows[0].total), auditEntries: Number(auditRows.rows[0].total), backups: 'administrado por proveedor', lastBackup: 'ver panel de base de datos' }); }
  if (method === 'GET' && url.pathname === '/api/ops/audit') { if (!has(user, 'manage_users')) return json(res, 403, { error: 'No tienes permiso para ver bitácora' }); const result = await pool.query('SELECT at,user_id AS "userId",user_name AS "userName",action,entity,entity_id AS "entityId",details FROM audit_log ORDER BY id DESC LIMIT 100'); return json(res, 200, { entries: result.rows }); }
  if (method === 'POST' && url.pathname === '/api/ops/backup') { if (!has(user, 'manage_users')) return json(res, 403, { error: 'Los respaldos se administran desde el proveedor PostgreSQL' }); return json(res, 200, { ok: true }); }
  if (method === 'GET' && url.pathname === '/api/exports/orders.csv') { if (!has(user, 'view_dashboard') && !has(user, 'manage_orders')) return json(res, 403, { error: 'No tienes permiso para exportar' }); res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename=pedidos-emoba.csv' }); return res.end(ordersToCsv(await listOrdersForUser(user))); }
  json(res, 404, { error: 'Ruta no encontrada' });
}

const server = http.createServer(async (req, res) => { try { if (req.url.startsWith('/api/')) return await handleApi(req, res); return await serveStatic(req, res); } catch (error) { console.error(error); json(res, 500, { error: 'Error interno' }); } });
initDb().then(() => server.listen(PORT, () => console.log('CRM EMOBA cloud listo en ' + APP_URL))).catch((error) => { console.error(error); process.exit(1); });
