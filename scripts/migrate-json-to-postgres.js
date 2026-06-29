const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const root = path.join(__dirname, '..');
const jsonPath = process.env.JSON_BACKUP || path.join(root, '..', 'crm-online-mvp', 'data', 'db.json');

async function main() {
  const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');
  await pool.query(schema);
  const legacy = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  for (const user of legacy.users || []) {
    await pool.query('INSERT INTO users (id,name,email,password_hash,role,customer_name,active,capabilities,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,password_hash=EXCLUDED.password_hash,role=EXCLUDED.role,customer_name=EXCLUDED.customer_name,active=EXCLUDED.active,capabilities=EXCLUDED.capabilities', [user.id, user.name, user.email, user.passwordHash, user.role, user.customerName || '', user.active !== false, JSON.stringify(user.capabilities || []), user.createdAt || new Date().toISOString()]);
  }
  for (const order of legacy.orders || []) {
    await pool.query('INSERT INTO orders (id,customer,contact,product,quantity,destination,requested_date,load_type,details,status,owner,tank1,note,created_by,created_at,delivered_at,evidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT (id) DO UPDATE SET customer=EXCLUDED.customer,contact=EXCLUDED.contact,product=EXCLUDED.product,quantity=EXCLUDED.quantity,destination=EXCLUDED.destination,requested_date=EXCLUDED.requested_date,load_type=EXCLUDED.load_type,details=EXCLUDED.details,status=EXCLUDED.status,owner=EXCLUDED.owner,tank1=EXCLUDED.tank1,note=EXCLUDED.note,evidence=EXCLUDED.evidence', [order.id, order.customer, order.contact || '', order.product || '', order.quantity || '', order.destination || '', order.requestedDate || '', order.loadType || '', order.details || '', order.status || 'Cargando', order.owner || '', order.tank1 || '', order.note || '', order.createdBy || null, order.createdAt || new Date().toISOString(), order.deliveredAt || null, JSON.stringify(order.evidence || [])]);
  }
  const counts = await Promise.all([pool.query('SELECT COUNT(*) AS total FROM users'), pool.query('SELECT COUNT(*) AS total FROM orders')]);
  console.log(JSON.stringify({ users: counts[0].rows[0].total, orders: counts[1].rows[0].total }, null, 2));
  await pool.end();
}

main().catch((error) => { console.error(error); process.exit(1); });
