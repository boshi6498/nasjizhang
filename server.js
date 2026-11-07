import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import express from 'express';

const root = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3001);
const secret = process.env.APP_SECRET;
const legacyPassword = process.env.APP_PASSWORD;
const databasePath = process.env.DB_PATH || path.join(root, 'data', 'ledger.sqlite');
const dataDirectory = path.dirname(databasePath);
const receiptDirectory = path.join(dataDirectory, 'receipts');
const cookieName = 'ledger_session';
const sessionDuration = 12 * 60 * 60 * 1000;
const scrypt = promisify(crypto.scrypt);
const defaultCategories = {
  expense: ['日常开支', '交通', '人情支出', '进货', '房租水电', '工资支出', '其他支出'],
  income: ['日常收入', '人情收入', '出货', '其他收入'],
};

if (!secret) throw new Error('APP_SECRET must be configured.');

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    category TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    date TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions(date DESC, id DESC);
  CREATE TABLE IF NOT EXISTS app_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    title TEXT NOT NULL DEFAULT '小账本'
  );
  CREATE TABLE IF NOT EXISTS receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    transaction_id INTEGER NOT NULL,
    file_name TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL DEFAULT '',
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);
const receiptColumns = db.pragma('table_info(receipts)');
if (!receiptColumns.some((column) => column.name === 'original_name')) {
  db.exec("ALTER TABLE receipts ADD COLUMN original_name TEXT NOT NULL DEFAULT ''");
}
if (!receiptColumns.some((column) => column.name === 'content_type')) {
  db.exec("ALTER TABLE receipts ADD COLUMN content_type TEXT NOT NULL DEFAULT 'application/octet-stream'");
}
const transactionColumns = db.pragma('table_info(transactions)');
if (!transactionColumns.some((column) => column.name === 'user_id')) {
  db.exec('ALTER TABLE transactions ADD COLUMN user_id INTEGER REFERENCES users(id)');
}
const categoriesExist = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'categories'").get();
if (!categoriesExist) {
  db.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE (user_id, type, name)
    )
  `);
} else if (!db.pragma('table_info(categories)').some((column) => column.name === 'user_id')) {
  if (!db.pragma('table_info(categories)').some((column) => column.name === 'sort_order')) {
    db.exec('ALTER TABLE categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
  }
  db.transaction(() => {
    db.exec(`
      CREATE TABLE categories_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id),
        type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        UNIQUE (user_id, type, name)
      );
      INSERT INTO categories_migrated (id, type, name, sort_order)
        SELECT id, type, name, sort_order FROM categories;
      DROP TABLE categories;
      ALTER TABLE categories_migrated RENAME TO categories;
    `);
  })();
} else if (!db.pragma('table_info(categories)').some((column) => column.name === 'sort_order')) {
  db.exec('ALTER TABLE categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
}
db.exec(`
  CREATE INDEX IF NOT EXISTS transactions_user_date_idx ON transactions(user_id, date DESC, id DESC);
  CREATE INDEX IF NOT EXISTS categories_user_order_idx ON categories(user_id, type, sort_order, id);
  CREATE INDEX IF NOT EXISTS receipts_transaction_idx ON receipts(user_id, transaction_id, id);
`);

function needsLegacyClaim() {
  const users = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (users !== 0) return false;
  const transactions = db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE user_id IS NULL').get().count;
  const categories = db.prepare('SELECT COUNT(*) AS count FROM categories WHERE user_id IS NULL').get().count;
  return transactions > 0 || categories > 0;
}

if (needsLegacyClaim() && !legacyPassword) {
  throw new Error('APP_PASSWORD must remain configured until the first account claims existing ledger data.');
}

app.use(express.json({ limit: '16kb' }));

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function signature(value) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function setSessionCookie(res, userId) {
  const token = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + sessionDuration })).toString('base64url');
  res.cookie(cookieName, `${token}.${signature(token)}`, {
    httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true',
    maxAge: sessionDuration, path: '/',
  });
}

function authenticatedUserId(req) {
  const cookie = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`));
  if (!cookie) return null;
  const [token, providedSignature] = cookie.slice(cookieName.length + 1).split('.');
  if (!token || !providedSignature) return null;
  const expected = Buffer.from(signature(token));
  const actual = Buffer.from(providedSignature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  try {
    const session = JSON.parse(Buffer.from(token, 'base64url').toString());
    if (Number.isSafeInteger(session.uid) && session.uid > 0 && session.exp > Date.now()
      && db.prepare('SELECT 1 FROM users WHERE id = ?').get(session.uid)) return session.uid;
  } catch { return null; }
  return null;
}

function requireAuth(req, res, next) {
  const userId = authenticatedUserId(req);
  if (!userId) return res.status(401).json({ error: '请先登录' });
  req.userId = userId;
  next();
}

async function hashPassword(password, salt) {
  return scrypt(password, salt, 64);
}

function normalizeUsername(value) {
  if (typeof value !== 'string') return null;
  const username = value.trim().normalize('NFC').toLowerCase();
  return /^[\p{L}\p{N}_-]{2,32}$/u.test(username) ? username : null;
}

function normalizeTransaction(body, userId) {
  const { type, category, amount, date, note = '' } = body || {};
  const amountCents = Math.round(Number(amount) * 100);
  if (!['income', 'expense'].includes(type) || typeof category !== 'string'
    || !db.prepare('SELECT 1 FROM categories WHERE user_id = ? AND type = ? AND name = ?').get(userId, type, category)) return null;
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > 99999999999) return null;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (typeof note !== 'string' || note.length > 200) return null;
  return { type, category, amountCents, date, note: note.trim() };
}

function serialize(row) {
  return {
    id: row.id, type: row.type, category: row.category, amount: row.amount_cents / 100,
    date: row.date, note: row.note, receiptCount: row.receipt_count || 0,
  };
}

function getOwnedTransaction(userId, transactionId) {
  if (!Number.isSafeInteger(transactionId) || transactionId <= 0) return null;
  return db.prepare('SELECT id FROM transactions WHERE id = ? AND user_id = ?').get(transactionId, userId);
}

function receiptPath(fileName) {
  if (!/^[\da-f-]{36}(?:\.jpg)?$/.test(fileName)) throw new Error('Invalid receipt file name in database.');
  return path.join(receiptDirectory, fileName);
}

function safeReceiptPreview(filePath) {
  const header = Buffer.alloc(16);
  const fd = fs.openSync(filePath, 'r');
  let bytesRead;
  try { bytesRead = fs.readSync(fd, header, 0, header.length, 0); }
  finally { fs.closeSync(fd); }
  if (bytesRead >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytesRead >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return 'image/jpeg';
  if (bytesRead >= 6 && ['GIF87a', 'GIF89a'].includes(header.toString('ascii', 0, 6))) return 'image/gif';
  if (bytesRead >= 12 && header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function normalizeReceiptName(value) {
  if (typeof value !== 'string') return '凭证文件';
  let name = value;
  try { name = decodeURIComponent(name); } catch { return '凭证文件'; }
  name = path.basename(name.replaceAll('\\', '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return [...name].slice(0, 180).join('') || '凭证文件';
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.post('/api/register', asyncRoute(async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const { password, claimPassword } = req.body || {};
  if (!username) return res.status(400).json({ error: '用户名需为 2–32 位字母、数字、下划线或连字符' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 128
    || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return res.status(400).json({ error: '密码需至少 8 位，并同时包含字母和数字' });
  }
  if (needsLegacyClaim()) {
    const expected = Buffer.from(legacyPassword);
    const provided = Buffer.from(typeof claimPassword === 'string' ? claimPassword : '');
    if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
      return res.status(403).json({ error: '请输入旧版账本登录密码，以认领现有账目' });
    }
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = (await hashPassword(password, salt)).toString('hex');
  try {
    const user = db.transaction(() => {
      const isFirstUser = db.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0;
      const result = db.prepare('INSERT INTO users (username, password_salt, password_hash) VALUES (?, ?, ?)').run(username, salt, passwordHash);
      const userId = Number(result.lastInsertRowid);
      if (isFirstUser) {
        db.prepare('UPDATE transactions SET user_id = ? WHERE user_id IS NULL').run(userId);
        db.prepare('UPDATE categories SET user_id = ? WHERE user_id IS NULL').run(userId);
      }
      const insertCategory = db.prepare('INSERT INTO categories (user_id, type, name, sort_order) VALUES (?, ?, ?, ?)');
      for (const [type, names] of Object.entries(defaultCategories)) {
        const hasCategories = db.prepare('SELECT 1 FROM categories WHERE user_id = ? AND type = ? LIMIT 1').get(userId, type);
        if (!hasCategories) names.forEach((name, index) => insertCategory.run(userId, type, name, index));
      }
      db.prepare('INSERT INTO app_settings (user_id, title) VALUES (?, ?)').run(userId, '');
      return userId;
    })();
    setSessionCookie(res, user);
    res.status(201).json({ authenticated: true });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: '该用户名已被使用' });
    throw error;
  }
}));
app.post('/api/login', asyncRoute(async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const { password } = req.body || {};
  if (!username || typeof password !== 'string' || password.length > 128) return res.status(401).json({ error: '用户名或密码不正确' });
  const user = db.prepare('SELECT id, password_salt, password_hash FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: '用户名或密码不正确' });
  const providedHash = await hashPassword(password, user.password_salt);
  const expectedHash = Buffer.from(user.password_hash, 'hex');
  if (providedHash.length !== expectedHash.length || !crypto.timingSafeEqual(providedHash, expectedHash)) {
    return res.status(401).json({ error: '用户名或密码不正确' });
  }
  setSessionCookie(res, user.id);
  res.json({ authenticated: true });
}));
app.get('/api/session', (req, res) => {
  const authenticated = Boolean(authenticatedUserId(req));
  res.json({ authenticated, needsLegacyClaim: !authenticated && needsLegacyClaim() });
});
app.get('/api/settings', requireAuth, (req, res) => {
  const settings = db.prepare('SELECT title FROM app_settings WHERE user_id = ?').get(req.userId);
  const businessName = settings?.title === '小账本' ? '' : settings?.title || '';
  res.json({ businessName });
});
app.put('/api/settings', requireAuth, (req, res) => {
  const businessName = typeof req.body?.businessName === 'string' ? req.body.businessName.trim() : '';
  if ([...businessName].length > 40) return res.status(400).json({ error: '个体户名称最多 40 个字符' });
  db.prepare('INSERT INTO app_settings (user_id, title) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET title = excluded.title').run(req.userId, businessName);
  res.json({ businessName });
});
app.get('/api/categories', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT id, type, name FROM categories WHERE user_id = ? ORDER BY type, sort_order, id').all(req.userId);
  res.json({
    expense: rows.filter((row) => row.type === 'expense'),
    income: rows.filter((row) => row.type === 'income'),
  });
});
app.put('/api/categories/order', requireAuth, (req, res) => {
  const { type, ids } = req.body || {};
  if (!['income', 'expense'].includes(type) || !Array.isArray(ids)
    || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)
    || new Set(ids).size !== ids.length) {
    return res.status(400).json({ error: '分类排序数据无效' });
  }
  const existing = db.prepare('SELECT id FROM categories WHERE user_id = ? AND type = ? ORDER BY sort_order, id').all(req.userId, type);
  if (existing.length !== ids.length || existing.some((category) => !ids.includes(category.id))) {
    return res.status(400).json({ error: '分类列表已变化，请刷新后重试' });
  }
  const updateOrder = db.prepare('UPDATE categories SET sort_order = ? WHERE id = ? AND type = ? AND user_id = ?');
  db.transaction(() => ids.forEach((id, index) => updateOrder.run(index, id, type, req.userId)))();
  res.json(db.prepare('SELECT id, type, name FROM categories WHERE user_id = ? AND type = ? ORDER BY sort_order, id').all(req.userId, type));
});
app.post('/api/categories', requireAuth, (req, res) => {
  const { type, name } = req.body || {};
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  if (!['income', 'expense'].includes(type) || !normalizedName || normalizedName.length > 30) {
    return res.status(400).json({ error: '请输入分类名称（最多 30 个字符），并选择收入或支出' });
  }
  try {
    const sortOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM categories WHERE user_id = ? AND type = ?').get(req.userId, type).next_order;
    const result = db.prepare('INSERT INTO categories (user_id, type, name, sort_order) VALUES (?, ?, ?, ?)').run(req.userId, type, normalizedName, sortOrder);
    res.status(201).json({ id: Number(result.lastInsertRowid), type, name: normalizedName });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: '该类型下已存在同名分类' });
    throw error;
  }
});
app.put('/api/categories/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: '分类编号无效' });
  if (!name || name.length > 30) return res.status(400).json({ error: '分类名称不能为空，且最多 30 个字符' });
  const category = db.prepare('SELECT id, type, name FROM categories WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!category) return res.status(404).json({ error: '分类不存在' });
  try {
    db.transaction(() => {
      db.prepare('UPDATE transactions SET category = ? WHERE user_id = ? AND type = ? AND category = ?').run(name, req.userId, category.type, category.name);
      db.prepare('UPDATE categories SET name = ? WHERE id = ? AND user_id = ?').run(name, id, req.userId);
    })();
    res.json({ ...category, name });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: '该类型下已存在同名分类' });
    throw error;
  }
});
app.delete('/api/categories/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: '分类编号无效' });
  const category = db.prepare('SELECT id, type, name FROM categories WHERE id = ? AND user_id = ?').get(id, req.userId);
  if (!category) return res.status(404).json({ error: '分类不存在' });
  const usage = db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE user_id = ? AND type = ? AND category = ?').get(req.userId, category.type, category.name).count;
  if (usage > 0) return res.status(409).json({ error: `「${category.name}」已有 ${usage} 笔账目使用，暂时不能删除` });
  db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(id, req.userId);
  res.status(204).end();
});
app.get('/api/transactions/:id/receipts', requireAuth, (req, res) => {
  const transactionId = Number(req.params.id);
  if (!getOwnedTransaction(req.userId, transactionId)) return res.status(404).json({ error: '账目不存在' });
  const rows = db.prepare('SELECT id, original_name, size_bytes, created_at FROM receipts WHERE user_id = ? AND transaction_id = ? ORDER BY id').all(req.userId, transactionId);
  res.json(rows.map((row) => ({ id: row.id, name: row.original_name, sizeBytes: row.size_bytes, createdAt: row.created_at })));
});
app.post('/api/transactions/:id/receipts', requireAuth, express.raw({ type: () => true, limit: '10mb' }), (req, res) => {
  const transactionId = Number(req.params.id);
  if (!getOwnedTransaction(req.userId, transactionId)) return res.status(404).json({ error: '账目不存在' });
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: '凭证文件不能为空' });
  fs.mkdirSync(receiptDirectory, { recursive: true });
  const fileName = crypto.randomUUID();
  const filePath = receiptPath(fileName);
  fs.writeFileSync(filePath, req.body, { flag: 'wx', mode: 0o600 });
  try {
    const originalName = normalizeReceiptName(req.get('X-Receipt-Name'));
    const result = db.prepare('INSERT INTO receipts (user_id, transaction_id, file_name, original_name, content_type, size_bytes) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.userId, transactionId, fileName, originalName, req.get('Content-Type') || 'application/octet-stream', req.body.length);
    res.status(201).json({ id: Number(result.lastInsertRowid), name: originalName, sizeBytes: req.body.length });
  } catch (error) {
    fs.unlinkSync(filePath);
    throw error;
  }
});
app.patch('/api/transactions/:transactionId/receipts/:receiptId', requireAuth, (req, res) => {
  const transactionId = Number(req.params.transactionId);
  const receiptId = Number(req.params.receiptId);
  if (!getOwnedTransaction(req.userId, transactionId)) return res.status(404).json({ error: '账目不存在' });
  const current = db.prepare('SELECT id FROM receipts WHERE id = ? AND user_id = ? AND transaction_id = ?')
    .get(receiptId, req.userId, transactionId);
  if (!current) return res.status(404).json({ error: '凭证不存在' });
  if (typeof req.body?.name !== 'string' || !req.body.name.trim()) return res.status(400).json({ error: '请输入凭证文件名' });
  const name = normalizeReceiptName(encodeURIComponent(req.body.name));
  if (name === '凭证文件' && req.body.name.trim() !== '凭证文件') return res.status(400).json({ error: '凭证文件名无效' });
  db.prepare('UPDATE receipts SET original_name = ? WHERE id = ? AND user_id = ?').run(name, receiptId, req.userId);
  res.json({ id: receiptId, name });
});
app.get('/api/transactions/:transactionId/receipts/:receiptId', requireAuth, (req, res) => {
  const transactionId = Number(req.params.transactionId);
  const receiptId = Number(req.params.receiptId);
  if (!getOwnedTransaction(req.userId, transactionId)) return res.status(404).json({ error: '账目不存在' });
  const receipt = db.prepare('SELECT file_name, original_name FROM receipts WHERE id = ? AND user_id = ? AND transaction_id = ?')
    .get(receiptId, req.userId, transactionId);
  if (!receipt) return res.status(404).json({ error: '凭证不存在' });
  const filePath = receiptPath(receipt.file_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '凭证文件不存在' });
  const previewType = safeReceiptPreview(filePath);
  const disposition = previewType ? 'inline' : 'attachment';
  const encodedName = encodeURIComponent(receipt.original_name || 'receipt').replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  res.set({
    'Content-Type': previewType || 'application/octet-stream',
    'Content-Disposition': `${disposition}; filename*=UTF-8''${encodedName}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  res.sendFile(filePath);
});
app.delete('/api/transactions/:transactionId/receipts/:receiptId', requireAuth, (req, res) => {
  const transactionId = Number(req.params.transactionId);
  const receiptId = Number(req.params.receiptId);
  if (!getOwnedTransaction(req.userId, transactionId)) return res.status(404).json({ error: '账目不存在' });
  const receipt = db.prepare('SELECT file_name FROM receipts WHERE id = ? AND user_id = ? AND transaction_id = ?')
    .get(receiptId, req.userId, transactionId);
  if (!receipt) return res.status(404).json({ error: '凭证不存在' });
  db.prepare('DELETE FROM receipts WHERE id = ? AND user_id = ?').run(receiptId, req.userId);
  try { fs.unlinkSync(receiptPath(receipt.file_name)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  res.status(204).end();
});
app.post('/api/logout', (_req, res) => {
  res.clearCookie(cookieName, { httpOnly: true, sameSite: 'strict', path: '/' });
  res.json({ authenticated: false });
});

app.get('/api/transactions', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT t.id, t.type, t.category, t.amount_cents, t.date, t.note,
    (SELECT COUNT(*) FROM receipts r WHERE r.user_id = t.user_id AND r.transaction_id = t.id) AS receipt_count
    FROM transactions t WHERE t.user_id = ? ORDER BY t.date DESC, t.id DESC`).all(req.userId);
  res.json(rows.map(serialize));
});
app.get('/api/summary', requireAuth, (req, res) => {
  const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month : new Date().toISOString().slice(0, 7);
  const totals = db.prepare('SELECT type, COALESCE(SUM(amount_cents), 0) AS total_cents FROM transactions WHERE user_id = ? AND date LIKE ? GROUP BY type').all(req.userId, `${month}%`);
  const count = db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE user_id = ? AND date LIKE ?').get(req.userId, `${month}%`).count;
  res.json({ month, income: totals.find((item) => item.type === 'income')?.total_cents / 100 || 0, expense: totals.find((item) => item.type === 'expense')?.total_cents / 100 || 0, count });
});
app.post('/api/transactions', requireAuth, (req, res) => {
  const entry = normalizeTransaction(req.body, req.userId);
  if (!entry) return res.status(400).json({ error: '请检查金额、日期和分类' });
  const result = db.prepare('INSERT INTO transactions (user_id, type, category, amount_cents, date, note) VALUES (@userId, @type, @category, @amountCents, @date, @note)').run({ ...entry, userId: req.userId });
  const row = db.prepare('SELECT id, type, category, amount_cents, date, note FROM transactions WHERE id = ? AND user_id = ?').get(result.lastInsertRowid, req.userId);
  res.status(201).json(serialize(row));
});
app.put('/api/transactions/:id', requireAuth, (req, res) => {
  const entry = normalizeTransaction(req.body, req.userId);
  if (!entry) return res.status(400).json({ error: '请检查金额、日期和分类' });
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: '账目编号无效' });
  const result = db.prepare('UPDATE transactions SET type = @type, category = @category, amount_cents = @amountCents, date = @date, note = @note WHERE id = @id AND user_id = @userId').run({ ...entry, id, userId: req.userId });
  if (!result.changes) return res.status(404).json({ error: '账目不存在' });
  const row = db.prepare('SELECT id, type, category, amount_cents, date, note FROM transactions WHERE id = ? AND user_id = ?').get(id, req.userId);
  res.json(serialize(row));
});
app.delete('/api/transactions/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!getOwnedTransaction(req.userId, id)) return res.status(404).json({ error: '账目不存在' });
  const receipts = db.prepare('SELECT file_name FROM receipts WHERE transaction_id = ? AND user_id = ?').all(id, req.userId);
  db.transaction(() => {
    db.prepare('DELETE FROM receipts WHERE transaction_id = ? AND user_id = ?').run(id, req.userId);
    db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(id, req.userId);
  })();
  for (const receipt of receipts) {
    try { fs.unlinkSync(receiptPath(receipt.file_name)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  res.status(204).end();
});

app.use((error, _req, res, next) => {
  if (error.type === 'entity.too.large') return res.status(413).json({ error: '凭证超过 10MB 限制' });
  next(error);
});

const distPath = path.join(root, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}
app.listen(port, '0.0.0.0', () => console.log(`Ledger server listening on ${port}`));