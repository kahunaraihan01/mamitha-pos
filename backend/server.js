const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));

// Serve uploaded images
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// DB helpers
const DB_PATH = path.join(__dirname, 'data/db.json');
const getDB = () => JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
const saveDB = (db) => fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

// Multer – image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ── MENU ROUTES ──────────────────────────────────────────────────────────────

// GET all menu items
app.get('/api/menu', (req, res) => {
  res.json(getDB().menu);
});

// POST add new menu item
app.post('/api/menu', upload.single('image'), (req, res) => {
  const db = getDB();
  const item = {
    id: uuidv4(),
    name: req.body.name,
    price: parseInt(req.body.price),
    category: req.body.category || 'Lainnya',
    description: req.body.description || '',
    emoji: req.body.emoji || '🍞',
    image: req.file ? `/uploads/${req.file.filename}` : ''
  };
  db.menu.push(item);
  saveDB(db);
  io.emit('menu_updated', db.menu);
  res.json(item);
});

// PUT update menu item
app.put('/api/menu/:id', upload.single('image'), (req, res) => {
  const db = getDB();
  const idx = db.menu.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Item not found' });
  db.menu[idx] = {
    ...db.menu[idx],
    name: req.body.name ?? db.menu[idx].name,
    price: req.body.price ? parseInt(req.body.price) : db.menu[idx].price,
    category: req.body.category ?? db.menu[idx].category,
    description: req.body.description ?? db.menu[idx].description,
    emoji: req.body.emoji ?? db.menu[idx].emoji,
    image: req.file ? `/uploads/${req.file.filename}` : db.menu[idx].image
  };
  saveDB(db);
  io.emit('menu_updated', db.menu);
  res.json(db.menu[idx]);
});

// DELETE menu item
app.delete('/api/menu/:id', (req, res) => {
  const db = getDB();
  db.menu = db.menu.filter(i => i.id !== req.params.id);
  saveDB(db);
  io.emit('menu_updated', db.menu);
  res.json({ success: true });
});

// ── ORDER ROUTES ─────────────────────────────────────────────────────────────

// POST place a new order → triggers kitchen alert
app.post('/api/orders', (req, res) => {
  const db = getDB();
  const order = {
    id: uuidv4(),
    orderNumber: db.orders.length + 1,
    customerName: req.body.customerName || 'Pelanggan',
    items: req.body.items,
    subtotal: req.body.subtotal,
    tax: req.body.tax,
    total: req.body.total,
    paymentMethod: req.body.paymentMethod,
    amountPaid: req.body.amountPaid,
    change: req.body.change,
    note: req.body.note || '',
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  db.orders.push(order);
  saveDB(db);
  // 🔔 Emit real-time alert to ALL connected kitchen displays
  io.emit('new_order', order);
  res.json(order);
});

// GET order history
app.get('/api/orders', (req, res) => {
  const db = getDB();
  res.json([...db.orders].reverse());
});

// PATCH update order status (done / cancelled)
app.patch('/api/orders/:id', (req, res) => {
  const db = getDB();
  const idx = db.orders.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Order not found' });
  db.orders[idx].status = req.body.status;
  db.orders[idx].updatedAt = new Date().toISOString();
  saveDB(db);
  io.emit('order_updated', db.orders[idx]);
  res.json(db.orders[idx]);
});

// ── SOCKET.IO ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`✅ Client connected: ${socket.id}`);
  socket.on('disconnect', () => console.log(`❌ Client disconnected: ${socket.id}`));
});

// ── STATS ROUTE ──────────────────────────────────────────────────────────────

app.get('/api/stats', (req, res) => {
  const db = getDB();
  const today = new Date().toDateString();
  const todayOrders = db.orders.filter(o => new Date(o.createdAt).toDateString() === today);
  const todayRevenue = todayOrders.reduce((sum, o) => sum + o.total, 0);
  res.json({
    totalMenuItems: db.menu.length,
    totalOrders: db.orders.length,
    todayOrders: todayOrders.length,
    todayRevenue,
    pendingOrders: db.orders.filter(o => o.status === 'pending').length
  });
});

// ── START SERVER ─────────────────────────────────────────────────────────────

const PORT = 3000;
server.listen(PORT, () => {
  console.log('');
  console.log('🥐 ═══════════════════════════════════════════');
  console.log('   MAMITHA BAKERY POS SYSTEM');
  console.log('═══════════════════════════════════════════');
  console.log(`   Server  : http://localhost:${PORT}`);
  console.log(`   Kasir   : http://localhost:${PORT}/cashier.html`);
  console.log(`   Dapur   : http://localhost:${PORT}/kitchen.html`);
  console.log(`   Admin   : http://localhost:${PORT}/admin.html`);
  console.log('═══════════════════════════════════════════');
  console.log('');
});
