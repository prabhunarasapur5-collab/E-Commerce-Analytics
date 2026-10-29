// ============================================================
// server.js — E-Commerce Sales & Customer Analytics System
// Node.js + Express Backend with TiDB/MySQL & JWT Authentication
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const multer = require('multer');
const path = require('path');
const { z } = require('zod');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'ecom_analytics_jwt_secret_2026';

// ──────────────────────────────────────────────────────────
// MySQL / TiDB Connection Pool
// ──────────────────────────────────────────────────────────
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'ecommerce_analytics',
  waitForConnections: true,
  connectionLimit: 15,
  queueLimit: 0,
});

pool.getConnection()
  .then(conn => {
    console.log('  ✅ MySQL / TiDB connected successfully.');
    conn.release();
  })
  .catch(err => {
    console.error('  ❌ Database connection FAILED:', err.message);
  });

// ──────────────────────────────────────────────────────────
// Multer in-memory storage (max 10 MB)
// ──────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.csv', '.json'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only .csv and .json files are supported.'));
    }
  },
});

// ──────────────────────────────────────────────────────────
// Middleware
// ──────────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Cookie parser helper (lightweight)
app.use((req, _res, next) => {
  const cookieHeader = req.headers.cookie || '';
  req.cookies = {};
  cookieHeader.split(';').forEach(c => {
    const [k, v] = c.trim().split('=');
    if (k) req.cookies[k] = decodeURIComponent(v || '');
  });
  next();
});

// ──────────────────────────────────────────────────────────
// JWT Authentication Guard Middleware
// ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  let token = null;

  // 1. Authorization: Bearer <token>
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  // 2. Cookie fallback
  if (!token && req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Authentication token is required.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, username, email, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token. Please sign in again.' });
  }
}

// ──────────────────────────────────────────────────────────
// Helper: Get Active Dataset for User
// ──────────────────────────────────────────────────────────
async function getActiveDataset(userId) {
  const [rows] = await pool.query(
    'SELECT * FROM datasets WHERE user_id = ? AND is_active = 1 LIMIT 1',
    [userId]
  );
  if (!rows || rows.length === 0) return null;
  const ds = rows[0];
  if (typeof ds.column_mapping === 'string') {
    try { ds.column_mapping = JSON.parse(ds.column_mapping); } catch(e) {}
  }
  return ds;
}

// ──────────────────────────────────────────────────────────
// Normalizers & Parsers
// ──────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'));
  if (lines.length < 2) {
    throw new Error('CSV file must have a header row and at least one data row.');
  }

  function parseLine(line) {
    const result = [];
    let inQuote = false, cur = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    result.push(cur.trim());
    return result;
  }

  const rawHeaders = parseLine(lines[0]).map(h => h.replace(/^["']|["']$/g, '').trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = parseLine(lines[i]).map(v => v.replace(/^["']|["']$/g, '').trim());
    const obj = {};
    rawHeaders.forEach((h, idx) => {
      obj[h] = vals[idx] !== undefined ? vals[idx] : '';
    });
    rows.push(obj);
  }

  return { headers: rawHeaders, rows };
}

function normalizeDate(val) {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const str = String(val).trim();
  const isoMatch = str.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }
  const dmyMatch = str.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
  }
  const dt = new Date(str);
  if (!isNaN(dt.getTime())) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

// Auto-detect common column names
function autoDetectMapping(headers) {
  const synonyms = {
    customer_id: ['customer_id', 'customerid', 'cust_id', 'custid', 'client_id', 'clientid', 'customer id', 'client id', 'buyer_id', 'user_id'],
    customer_name: ['customer_name', 'customername', 'customer', 'name', 'client_name', 'client', 'buyer', 'customer name', 'buyer name', 'full_name'],
    product: ['product', 'product_name', 'productname', 'item', 'item_name', 'itemname', 'title', 'sku', 'product name', 'item name'],
    category: ['category', 'cat', 'department', 'type', 'genre', 'product_category', 'category name', 'category_name'],
    price: ['price', 'unit_price', 'unitprice', 'rate', 'unit_rate', 'amount', 'cost', 'unit price', 'selling_price'],
    quantity: ['quantity', 'qty', 'count', 'units', 'volume', 'qty_sold', 'quantity sold'],
    order_date: ['order_date', 'date', 'orderdate', 'transaction_date', 'created_at', 'timestamp', 'txn_date', 'order date', 'purchase date', 'invoice_date'],
    discount: ['discount', 'discount_pct', 'disc', 'discount_amount', 'discount percent', 'discount %', 'markdown'],
    location: ['location', 'city', 'state', 'country', 'region', 'address', 'shipping_address', 'shipping_city', 'place'],
    payment_type: ['payment_type', 'payment_method', 'payment', 'pay_type', 'mode', 'payment type', 'payment method', 'payment_mode'],
    status: ['status', 'order_status', 'txn_status', 'state', 'condition', 'order status', 'transaction_status'],
  };

  const mapping = {};
  const lowerMap = {};
  headers.forEach(h => {
    lowerMap[h.toLowerCase().trim()] = h;
  });

  for (const [targetField, synList] of Object.entries(synonyms)) {
    mapping[targetField] = null;
    for (const syn of synList) {
      if (lowerMap[syn]) {
        mapping[targetField] = lowerMap[syn];
        break;
      }
    }
  }

  return mapping;
}

// ──────────────────────────────────────────────────────────
// AUTH ROUTES
// ──────────────────────────────────────────────────────────

// POST /api/auth/signup
app.post('/api/auth/signup', async (req, res, next) => {
  try {
    const signupSchema = z.object({
      username: z.string().min(3, 'Username must be at least 3 characters'),
      email: z.string().email('Invalid email address'),
      password: z.string().min(6, 'Password must be at least 6 characters'),
    });

    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const { username, email, password } = parsed.data;

    const [existing] = await pool.query(
      'SELECT id FROM users WHERE email = ? OR username = ?',
      [email.toLowerCase(), username.toLowerCase()]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Username or email is already registered.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, "analyst")',
      [username.trim(), email.toLowerCase().trim(), hash]
    );

    const user = { id: result.insertId, username: username.trim(), email: email.toLowerCase().trim(), role: 'analyst' };
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });

    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 3600 * 1000 });
    return res.status(201).json({ message: 'Account created successfully', user, token });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const loginSchema = z.object({
      email: z.string().email('Invalid email format'),
      password: z.string().min(1, 'Password is required'),
    });

    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const { email, password } = parsed.data;

    const [rows] = await pool.query(
      'SELECT id, username, email, password, role FROM users WHERE email = ?',
      [email.toLowerCase().trim()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const userRow = rows[0];
    const match = await bcrypt.compare(password, userRow.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = {
      id: userRow.id,
      username: userRow.username,
      email: userRow.email,
      role: userRow.role,
    };
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });

    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 3600 * 1000 });
    return res.json({ message: 'Login successful', user, token });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/user
app.get('/api/auth/user', (req, res) => {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }
  if (!token && req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.json({ authenticated: false });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return res.json({ authenticated: true, user: decoded });
  } catch {
    return res.json({ authenticated: false });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('token');
  return res.json({ message: 'Logged out successfully' });
});

// ──────────────────────────────────────────────────────────
// DATASET MANAGEMENT ROUTES (All protected)
// ──────────────────────────────────────────────────────────

// GET /api/datasets — list all datasets for user
app.get('/api/datasets', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, file_name, file_type, row_count, is_active, uploaded_at 
       FROM datasets 
       WHERE user_id = ? 
       ORDER BY uploaded_at DESC`,
      [req.user.id]
    );
    return res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/datasets/active — get currently active dataset
app.get('/api/datasets/active', requireAuth, async (req, res, next) => {
  try {
    const active = await getActiveDataset(req.user.id);
    return res.json({ activeDataset: active });
  } catch (err) {
    next(err);
  }
});

// POST /api/datasets/select — switch active dataset
app.post('/api/datasets/select', requireAuth, async (req, res, next) => {
  try {
    const schema = z.object({ dataset_id: z.number().int() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid dataset ID provided.' });
    }

    const { dataset_id } = parsed.data;

    // Verify ownership
    const [ds] = await pool.query(
      'SELECT id, file_name FROM datasets WHERE id = ? AND user_id = ?',
      [dataset_id, req.user.id]
    );
    if (ds.length === 0) {
      return res.status(404).json({ error: 'Dataset not found.' });
    }

    await pool.query('UPDATE datasets SET is_active = 0 WHERE user_id = ?', [req.user.id]);
    await pool.query('UPDATE datasets SET is_active = 1 WHERE id = ? AND user_id = ?', [dataset_id, req.user.id]);

    const active = await getActiveDataset(req.user.id);
    return res.json({ message: `Active dataset set to "${ds[0].file_name}"`, activeDataset: active });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/datasets/:id — delete a dataset
app.delete('/api/datasets/:id', requireAuth, async (req, res, next) => {
  try {
    const datasetId = parseInt(req.params.id, 10);
    if (isNaN(datasetId)) {
      return res.status(400).json({ error: 'Invalid dataset ID.' });
    }

    const [ds] = await pool.query(
      'SELECT id, is_active, file_name FROM datasets WHERE id = ? AND user_id = ?',
      [datasetId, req.user.id]
    );
    if (ds.length === 0) {
      return res.status(404).json({ error: 'Dataset not found.' });
    }

    const wasActive = ds[0].is_active === 1;

    // Delete (cascade deletes dataset_rows)
    await pool.query('DELETE FROM datasets WHERE id = ? AND user_id = ?', [datasetId, req.user.id]);

    // If was active, set the most recent remaining dataset active
    if (wasActive) {
      const [remaining] = await pool.query(
        'SELECT id FROM datasets WHERE user_id = ? ORDER BY uploaded_at DESC LIMIT 1',
        [req.user.id]
      );
      if (remaining.length > 0) {
        await pool.query('UPDATE datasets SET is_active = 1 WHERE id = ?', [remaining[0].id]);
      }
    }

    const active = await getActiveDataset(req.user.id);
    return res.json({ message: `Dataset "${ds[0].file_name}" deleted successfully.`, activeDataset: active });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────
// FILE UPLOAD & PREVIEW / MAPPING ROUTES
// ──────────────────────────────────────────────────────────

// POST /api/upload/preview — uploads, parses, and provides column mapping preview
app.post('/api/upload/preview', requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Please select a CSV or JSON file.' });
    }

    const fileName = req.file.originalname;
    const ext = path.extname(fileName).toLowerCase();
    const content = req.file.buffer.toString('utf8').trim();

    if (!content) {
      return res.status(400).json({ error: 'The uploaded file is empty.' });
    }

    let parsedHeaders = [];
    let parsedRows = [];

    if (ext === '.csv') {
      try {
        const result = parseCSV(content);
        parsedHeaders = result.headers;
        parsedRows = result.rows;
      } catch (err) {
        return res.status(422).json({ error: `CSV Parsing error: ${err.message}` });
      }
    } else if (ext === '.json') {
      try {
        let json = JSON.parse(content);
        // Handle array of objects or object containing array (e.g. { transactions: [...] }, { data: [...] })
        if (!Array.isArray(json)) {
          if (typeof json === 'object' && json !== null) {
            const arrKey = Object.keys(json).find(k => Array.isArray(json[k]));
            if (arrKey) {
              json = json[arrKey];
            } else {
              return res.status(422).json({ error: 'JSON file must contain an array of row objects.' });
            }
          } else {
            return res.status(422).json({ error: 'JSON file must contain an array of row objects.' });
          }
        }

        if (json.length === 0) {
          return res.status(400).json({ error: 'JSON array is empty.' });
        }

        // Collect all distinct keys from first 100 rows
        const keySet = new Set();
        json.slice(0, 100).forEach(item => {
          if (typeof item === 'object' && item !== null) {
            Object.keys(item).forEach(k => keySet.add(k));
          }
        });

        parsedHeaders = Array.from(keySet);
        parsedRows = json.map(item => {
          const row = {};
          parsedHeaders.forEach(h => {
            row[h] = item[h] !== undefined && item[h] !== null ? String(item[h]) : '';
          });
          return row;
        });
      } catch (err) {
        return res.status(422).json({ error: `Malformed JSON format: ${err.message}` });
      }
    }

    if (parsedRows.length === 0) {
      return res.status(400).json({ error: 'No data rows found in the uploaded file.' });
    }

    const suggestedMapping = autoDetectMapping(parsedHeaders);
    const previewRows = parsedRows.slice(0, 10);

    return res.json({
      fileName,
      fileType: ext === '.csv' ? 'CSV' : 'JSON',
      totalRows: parsedRows.length,
      headers: parsedHeaders,
      suggestedMapping,
      previewRows,
      allRows: parsedRows, // Pass to client to confirm mapping before saving
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/upload/confirm — saves rows in one DB transaction
app.post('/api/upload/confirm', requireAuth, async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const confirmSchema = z.object({
      fileName: z.string().min(1),
      fileType: z.string().min(1),
      rows: z.array(z.record(z.any())).min(1, 'At least 1 row required'),
      columnMapping: z.record(z.string().nullable().optional()),
    });

    const parsed = confirmSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const { fileName, fileType, rows, columnMapping } = parsed.data;

    await conn.beginTransaction();

    // 1. Deactivate existing user datasets (New upload becomes ONLY active dataset)
    await conn.query('UPDATE datasets SET is_active = 0 WHERE user_id = ?', [req.user.id]);

    // 2. Insert new dataset
    const [dsResult] = await conn.query(
      `INSERT INTO datasets (user_id, file_name, file_type, row_count, column_mapping, is_active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [req.user.id, fileName, fileType, rows.length, JSON.stringify(columnMapping)]
    );
    const datasetId = dsResult.insertId;

    // 3. Batch insert dataset_rows
    const BATCH_SIZE = 500;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const slice = rows.slice(i, i + BATCH_SIZE);
      const values = slice.map((row, idx) => {
        const rowNum = i + idx + 1;
        const getVal = (field) => {
          const col = columnMapping[field];
          if (!col || row[col] === undefined || row[col] === null || String(row[col]).trim() === '') return null;
          return row[col];
        };

        const rawJson = JSON.stringify(row);
        const custId = getVal('customer_id') !== null ? String(getVal('customer_id')).trim() : null;
        const custName = getVal('customer_name') !== null ? String(getVal('customer_name')).trim() : null;
        const prod = getVal('product') !== null ? String(getVal('product')).trim() : null;
        const cat = getVal('category') !== null ? String(getVal('category')).trim() : null;
        const priceRaw = getVal('price');
        const price = (priceRaw !== null && !isNaN(parseFloat(priceRaw))) ? parseFloat(priceRaw) : null;
        const qtyRaw = getVal('quantity');
        const quantity = (qtyRaw !== null && !isNaN(parseInt(qtyRaw, 10))) ? parseInt(qtyRaw, 10) : (price !== null ? 1 : null);
        const dateRaw = getVal('order_date');
        const orderDate = normalizeDate(dateRaw);
        const discRaw = getVal('discount');
        const discount = (discRaw !== null && !isNaN(parseFloat(discRaw))) ? parseFloat(discRaw) : null;
        const loc = getVal('location') !== null ? String(getVal('location')).trim() : null;
        const pay = getVal('payment_type') !== null ? String(getVal('payment_type')).trim() : null;
        const stat = getVal('status') !== null ? String(getVal('status')).trim() : null;

        return [
          datasetId,
          req.user.id,
          rowNum,
          rawJson,
          custId,
          custName,
          prod,
          cat,
          price,
          quantity,
          orderDate,
          discount,
          loc,
          pay,
          stat,
        ];
      });

      await conn.query(
        `INSERT INTO dataset_rows (
          dataset_id, user_id, \`row_number\`, raw_data,
          customer_id, customer_name, product, category, price, quantity, order_date, discount, location, payment_type, status
        ) VALUES ?`,
        [values]
      );
    }

    await conn.commit();

    return res.status(201).json({
      success: true,
      message: `Successfully uploaded "${fileName}" (${rows.length} rows).`,
      dataset_id: datasetId,
      rowCount: rows.length,
    });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// ──────────────────────────────────────────────────────────
// ANALYTICS ROUTES (Driven STRICTLY by logged-in user & active dataset)
// ──────────────────────────────────────────────────────────

// GET /api/analytics/summary — Executive Summary
app.get('/api/analytics/summary', requireAuth, async (req, res, next) => {
  try {
    const activeDs = await getActiveDataset(req.user.id);
    if (!activeDs) {
      return res.json({ hasDataset: false });
    }

    const mapping = activeDs.column_mapping || {};
    const hasPrice = !!mapping.price;
    const hasDate = !!mapping.order_date;
    const hasCategory = !!mapping.category;
    const hasProduct = !!mapping.product;
    const hasLocation = !!mapping.location;
    const hasPayment = !!mapping.payment_type;
    const hasStatus = !!mapping.status;
    const hasCustomer = !!(mapping.customer_id || mapping.customer_name);

    // Total rows/orders
    const [totalRows] = await pool.query(
      'SELECT COUNT(*) as total_orders FROM dataset_rows WHERE dataset_id = ? AND user_id = ?',
      [activeDs.id, req.user.id]
    );
    const totalOrders = totalRows[0]?.total_orders || 0;

    let grossSales = 0;
    let avgOrderValue = 0;
    let totalDiscounts = 0;
    let returnRate = null;

    if (hasPrice) {
      const [revRows] = await pool.query(
        `SELECT 
          SUM(COALESCE(price, 0) * COALESCE(quantity, 1)) as gross_sales,
          AVG(COALESCE(price, 0) * COALESCE(quantity, 1)) as avg_order_value,
          SUM(COALESCE(discount, 0)) as total_discounts
         FROM dataset_rows 
         WHERE dataset_id = ? AND user_id = ?`,
        [activeDs.id, req.user.id]
      );
      grossSales = parseFloat(revRows[0]?.gross_sales || 0);
      avgOrderValue = parseFloat(revRows[0]?.avg_order_value || 0);
      totalDiscounts = parseFloat(revRows[0]?.total_discounts || 0);
    }

    if (hasStatus) {
      const [statusRows] = await pool.query(
        `SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN LOWER(COALESCE(status, '')) LIKE '%return%' THEN 1 END) as returns
         FROM dataset_rows 
         WHERE dataset_id = ? AND user_id = ?`,
        [activeDs.id, req.user.id]
      );
      const total = statusRows[0]?.total || 0;
      const rets = statusRows[0]?.returns || 0;
      returnRate = total > 0 ? parseFloat(((rets / total) * 100).toFixed(1)) : 0;
    }

    // Monthly trend
    let monthlyTrend = [];
    if (hasDate) {
      const [trendRows] = await pool.query(
        `SELECT 
          DATE_FORMAT(order_date, '%Y-%m') as month,
          COUNT(*) as orders,
          ${hasPrice ? 'SUM(COALESCE(price, 0) * COALESCE(quantity, 1))' : '0'} as revenue
         FROM dataset_rows 
         WHERE dataset_id = ? AND user_id = ? AND order_date IS NOT NULL
         GROUP BY month 
         ORDER BY month ASC LIMIT 24`,
        [activeDs.id, req.user.id]
      );
      monthlyTrend = trendRows.map(r => ({
        month: r.month,
        orders: r.orders,
        revenue: parseFloat(r.revenue || 0),
      }));
    }

    // Category breakdown
    let categoryPerformance = [];
    if (hasCategory) {
      const [catRows] = await pool.query(
        `SELECT 
          category,
          COUNT(*) as orders,
          ${hasPrice ? 'SUM(COALESCE(price, 0) * COALESCE(quantity, 1))' : '0'} as revenue
         FROM dataset_rows 
         WHERE dataset_id = ? AND user_id = ? AND category IS NOT NULL AND category != ''
         GROUP BY category 
         ORDER BY ${hasPrice ? 'revenue' : 'orders'} DESC LIMIT 10`,
        [activeDs.id, req.user.id]
      );
      categoryPerformance = catRows.map(r => ({
        category: r.category,
        orders: r.orders,
        revenue: parseFloat(r.revenue || 0),
      }));
    }

    // Top products
    let topProducts = [];
    if (hasProduct) {
      const [prodRows] = await pool.query(
        `SELECT 
          product,
          ${hasCategory ? 'MAX(category)' : 'NULL'} as category,
          COUNT(*) as orders,
          ${hasPrice ? 'SUM(COALESCE(price, 0) * COALESCE(quantity, 1))' : '0'} as revenue
         FROM dataset_rows 
         WHERE dataset_id = ? AND user_id = ? AND product IS NOT NULL AND product != ''
         GROUP BY product 
         ORDER BY ${hasPrice ? 'revenue' : 'orders'} DESC LIMIT 5`,
        [activeDs.id, req.user.id]
      );
      topProducts = prodRows.map(r => ({
        product: r.product,
        category: r.category || '—',
        orders: r.orders,
        revenue: parseFloat(r.revenue || 0),
      }));
    }

    // Location breakdown
    let locationBreakdown = [];
    if (hasLocation) {
      const [locRows] = await pool.query(
        `SELECT 
          location,
          COUNT(*) as orders,
          ${hasPrice ? 'SUM(COALESCE(price, 0) * COALESCE(quantity, 1))' : '0'} as revenue
         FROM dataset_rows 
         WHERE dataset_id = ? AND user_id = ? AND location IS NOT NULL AND location != ''
         GROUP BY location 
         ORDER BY ${hasPrice ? 'revenue' : 'orders'} DESC LIMIT 8`,
        [activeDs.id, req.user.id]
      );
      locationBreakdown = locRows.map(r => ({
        location: r.location,
        orders: r.orders,
        revenue: parseFloat(r.revenue || 0),
      }));
    }

    // Payment breakdown
    let paymentBreakdown = [];
    if (hasPayment) {
      const [payRows] = await pool.query(
        `SELECT 
          payment_type,
          COUNT(*) as count,
          ${hasPrice ? 'SUM(COALESCE(price, 0) * COALESCE(quantity, 1))' : '0'} as revenue
         FROM dataset_rows 
         WHERE dataset_id = ? AND user_id = ? AND payment_type IS NOT NULL AND payment_type != ''
         GROUP BY payment_type 
         ORDER BY count DESC`,
        [activeDs.id, req.user.id]
      );
      paymentBreakdown = payRows.map(r => ({
        payment_type: r.payment_type,
        count: r.count,
        revenue: parseFloat(r.revenue || 0),
      }));
    }

    return res.json({
      hasDataset: true,
      dataset: activeDs,
      availableFields: {
        hasDate,
        hasPrice,
        hasCategory,
        hasProduct,
        hasLocation,
        hasPayment,
        hasStatus,
        hasCustomer,
      },
      metrics: {
        total_orders: totalOrders,
        gross_sales: grossSales.toFixed(2),
        avg_order_value: avgOrderValue.toFixed(2),
        total_discounts: totalDiscounts.toFixed(2),
        return_rate: returnRate,
      },
      monthlyTrend,
      categoryPerformance,
      topProducts,
      locationBreakdown,
      paymentBreakdown,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/analytics/customers — Customer Segments
app.get('/api/analytics/customers', requireAuth, async (req, res, next) => {
  try {
    const activeDs = await getActiveDataset(req.user.id);
    if (!activeDs) {
      return res.json({ hasDataset: false });
    }

    const mapping = activeDs.column_mapping || {};
    const hasCustId = !!mapping.customer_id;
    const hasCustName = !!mapping.customer_name;

    if (!hasCustId && !hasCustName) {
      return res.json({
        hasDataset: true,
        hasCustomerData: false,
        dataset: activeDs,
        message: 'Customer segmentation requires customer data. Please upload a file containing a Customer ID or Customer Name column.',
      });
    }

    const hasPrice = !!mapping.price;
    const hasDate = !!mapping.order_date;

    const groupField = hasCustId && hasCustName
      ? 'COALESCE(customer_id, customer_name)'
      : (hasCustId ? 'customer_id' : 'customer_name');

    const [rows] = await pool.query(
      `SELECT 
        ${hasCustId ? 'MAX(customer_id)' : 'NULL'} as customer_id,
        ${hasCustName ? 'MAX(customer_name)' : 'NULL'} as customer_name,
        MAX(${groupField}) as display_id,
        COUNT(*) as total_orders,
        ${hasPrice ? 'SUM(COALESCE(price, 0) * COALESCE(quantity, 1))' : '0'} as total_spent,
        ${hasDate ? 'MAX(order_date)' : 'NULL'} as last_order_date,
        ${hasDate ? 'DATEDIFF(CURDATE(), MAX(order_date))' : 'NULL'} as days_since_last_order
       FROM dataset_rows
       WHERE dataset_id = ? AND user_id = ? AND ${groupField} IS NOT NULL AND ${groupField} != ''
       GROUP BY ${groupField}`,
      [activeDs.id, req.user.id]
    );

    if (rows.length === 0) {
      return res.json({
        hasDataset: true,
        hasCustomerData: true,
        dataset: activeDs,
        customers: [],
      });
    }

    // Calculate spend threshold
    const spends = rows.map(r => parseFloat(r.total_spent || 0));
    const avgSpend = spends.reduce((a, b) => a + b, 0) / (spends.length || 1);
    const highSpendThreshold = Math.max(avgSpend * 1.4, 100);

    const customers = rows.map(r => {
      const orders = parseInt(r.total_orders, 10);
      const spent = parseFloat(r.total_spent || 0);
      const recency = r.days_since_last_order !== null ? parseInt(r.days_since_last_order, 10) : null;

      let segment = 'Occasional';
      let justification = '';

      if (hasPrice && spent >= highSpendThreshold && orders >= 3) {
        segment = 'High-Value';
        justification = `Top-tier spending of ₹${spent.toLocaleString('en-IN', { maximumFractionDigits: 0 })} across ${orders} orders`;
      } else if (orders >= 3 && (recency === null || recency <= 120)) {
        segment = 'Frequent';
        justification = `${orders} purchases recorded recently`;
      } else if (recency !== null && recency > 180 && orders >= 1) {
        segment = 'Inactive';
        justification = `No recent purchase for over ${recency} days`;
      } else {
        segment = 'Occasional';
        justification = `${orders} order(s) totaling ₹${spent.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
      }

      // Rank score
      const rankScore = (spent * 0.6) + (orders * 500) + (recency !== null ? Math.max(0, 365 - recency) * 10 : 0);

      return {
        customer_id: r.customer_id,
        customer_name: r.customer_name || r.customer_id,
        total_orders: orders,
        total_spent: spent.toFixed(2),
        last_order_date: r.last_order_date,
        days_since_last_order: recency,
        segment,
        justification,
        rank_score: rankScore,
      };
    });

    customers.sort((a, b) => b.rank_score - a.rank_score);
    customers.forEach((c, idx) => { c.rank = idx + 1; });

    return res.json({
      hasDataset: true,
      hasCustomerData: true,
      dataset: activeDs,
      customers,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/transactions — Data Explorer
app.get('/api/transactions', requireAuth, async (req, res, next) => {
  try {
    const activeDs = await getActiveDataset(req.user.id);
    if (!activeDs) {
      return res.json({ hasDataset: false, rows: [], total: 0 });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(5, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const search = req.query.search ? String(req.query.search).trim() : '';
    const sortField = req.query.sort || 'row_number';
    const sortDir = req.query.dir === 'desc' ? 'DESC' : 'ASC';

    let countSql = 'SELECT COUNT(*) as total FROM dataset_rows WHERE dataset_id = ? AND user_id = ?';
    let dataSql = 'SELECT `row_number`, raw_data FROM dataset_rows WHERE dataset_id = ? AND user_id = ?';
    const params = [activeDs.id, req.user.id];

    if (search) {
      const searchPattern = `%${search}%`;
      countSql += ' AND raw_data LIKE ?';
      dataSql += ' AND raw_data LIKE ?';
      params.push(searchPattern);
    }

    const [totalRows] = await pool.query(countSql, params);
    const total = totalRows[0]?.total || 0;
    const pages = Math.ceil(total / limit) || 1;

    dataSql += ` ORDER BY \`row_number\` ${sortDir} LIMIT ? OFFSET ?`;
    const dataParams = [...params, limit, offset];

    const [rows] = await pool.query(dataSql, dataParams);

    const parsedRows = rows.map(r => {
      let rawObj = {};
      try {
        rawObj = typeof r.raw_data === 'string' ? JSON.parse(r.raw_data) : r.raw_data;
      } catch(e) {}
      return {
        row_number: r.row_number,
        raw_data: rawObj,
      };
    });

    // Determine original headers from first row
    let headers = [];
    if (parsedRows.length > 0) {
      headers = Object.keys(parsedRows[0].raw_data);
    } else {
      const [sample] = await pool.query(
        'SELECT raw_data FROM dataset_rows WHERE dataset_id = ? LIMIT 1',
        [activeDs.id]
      );
      if (sample.length > 0) {
        try { headers = Object.keys(JSON.parse(sample[0].raw_data)); } catch(e) {}
      }
    }

    const hasIdColumn = headers.some(h => /id$/i.test(h) || /^id/i.test(h));

    return res.json({
      hasDataset: true,
      dataset: activeDs,
      total,
      page,
      limit,
      pages,
      headers,
      hasIdColumn,
      rows: parsedRows,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/transactions/export — CSV Export of active dataset
app.get('/api/transactions/export', requireAuth, async (req, res, next) => {
  try {
    const activeDs = await getActiveDataset(req.user.id);
    if (!activeDs) {
      return res.status(404).json({ error: 'No active dataset to export.' });
    }

    const [rows] = await pool.query(
      'SELECT raw_data FROM dataset_rows WHERE dataset_id = ? AND user_id = ? ORDER BY `row_number` ASC',
      [activeDs.id, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Active dataset has no rows.' });
    }

    const parsedList = rows.map(r => {
      try { return typeof r.raw_data === 'string' ? JSON.parse(r.raw_data) : r.raw_data; }
      catch { return {}; }
    });

    const headers = Object.keys(parsedList[0] || {});

    // Build CSV
    const csvLines = [];
    csvLines.push(headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(','));

    parsedList.forEach(item => {
      const line = headers.map(h => {
        const val = item[h] !== undefined && item[h] !== null ? String(item[h]) : '';
        return `"${val.replace(/"/g, '""')}"`;
      }).join(',');
      csvLines.push(line);
    });

    const csvContent = csvLines.join('\n');
    const safeName = activeDs.file_name.replace(/[^a-zA-Z0-9._-]/g, '_');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="export_${safeName}.csv"`);
    return res.send(csvContent);
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────
// Catch-all route -> index.html
// ──────────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ──────────────────────────────────────────────────────────
// Central Error Handler
// ──────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[Error Handler]', err);
  const status = err.status || 500;
  return res.status(status).json({
    error: err.message || 'An unexpected internal server error occurred.',
  });
});

// ──────────────────────────────────────────────────────────
// Start Server
// ──────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n===========================================');
  console.log('  E-Commerce Analytics Server (v2)');
  console.log(`  URL: http://localhost:${PORT}`);
  console.log('===========================================\n');
});
