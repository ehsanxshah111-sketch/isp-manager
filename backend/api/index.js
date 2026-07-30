const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

dotenv.config();
const app = express();

// ===== MIDDLEWARE =====
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

// ===== MODELS =====
const UserSchema = new mongoose.Schema({
  username: String,
  email: String,
  password: String,
  role: { type: String, default: 'user' }
});
const CustomerSchema = new mongoose.Schema({
  name: String,
  customerId: { type: String, unique: true },
  monthlyFee: Number,
  pendingDues: Number,
  connectionDate: String,
  status: String,
  paymentStatus: String
});
const PaymentSchema = new mongoose.Schema({
  customerId: String,
  customerName: String,
  amount: Number,
  month: String,
  year: String,
  method: String,
  status: String,
  date: { type: Date, default: Date.now }
});
const ExpenseSchema = new mongoose.Schema({
  description: String,
  amount: Number,
  category: String,
  date: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Customer = mongoose.model('Customer', CustomerSchema);
const Payment = mongoose.model('Payment', PaymentSchema);
const Expense = mongoose.model('Expense', ExpenseSchema);

// ===== DATABASE =====
let cached = global.mongoose;
if (!cached) cached = global.mongoose = { conn: null, promise: null };

async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      bufferCommands: false,
      serverSelectionTimeoutMS: 5000,
    }).then(m => { console.log('✅ MongoDB Connected'); return m; });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server running on Vercel!' });
});

// ============================================================
// AUTH ROUTES
// ============================================================
app.post('/api/auth/login', async (req, res) => {
  try {
    await connectDB();
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ message: 'User not found' });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: 'Invalid password' });
    const expiresIn = process.env.JWT_EXPIRE || '30d';
    const token = jwt.sign(
      { id: user._id, username: user.username },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: expiresIn }
    );
    res.json({ token, user: { id: user._id, username: user.username, email: user.email, role: user.role } });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    await connectDB();
    res.json({ user: { username: 'admin', email: 'admin@isp.com', role: 'admin' } });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============================================================
// CUSTOMER ROUTES (NO AUTH REQUIRED)
// ============================================================
app.get('/api/customers', async (req, res) => {
  try {
    await connectDB();
    const customers = await Customer.find().sort({ createdAt: -1 });
    res.json(customers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/customers/stats', async (req, res) => {
  try {
    await connectDB();
    const total = await Customer.countDocuments();
    const active = await Customer.countDocuments({ status: 'Active' });
    const inactive = await Customer.countDocuments({ status: 'Inactive' });
    const pending = await Customer.countDocuments({ status: 'Pending' });
    res.json({ total, active, inactive, pending });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/customers', async (req, res) => {
  try {
    await connectDB();
    const customer = new Customer(req.body);
    await customer.save();
    res.status(201).json(customer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/customers/:id', async (req, res) => {
  try {
    await connectDB();
    const customer = await Customer.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    res.json(customer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/customers/:id', async (req, res) => {
  try {
    await connectDB();
    const customer = await Customer.findByIdAndDelete(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    res.json({ message: 'Customer deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// PAYMENT ROUTES (NO AUTH REQUIRED)
// ============================================================
app.get('/api/payments', async (req, res) => {
  try {
    await connectDB();
    const payments = await Payment.find().sort({ date: -1 });
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/payments', async (req, res) => {
  try {
    await connectDB();
    const payment = new Payment(req.body);
    await payment.save();
    res.status(201).json(payment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/payments/stats', async (req, res) => {
  try {
    await connectDB();
    const result = await Payment.aggregate([
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalRevenue = result[0]?.total || 0;
    const paid = await Payment.countDocuments({ status: 'Paid' });
    const unpaid = await Payment.countDocuments({ status: 'Unpaid' });
    res.json({ totalRevenue, paid, unpaid });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// EXPENSE ROUTES (NO AUTH REQUIRED)
// ============================================================
app.get('/api/expenses', async (req, res) => {
  try {
    await connectDB();
    const expenses = await Expense.find().sort({ date: -1 });
    res.json(expenses);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/expenses', async (req, res) => {
  try {
    await connectDB();
    const expense = new Expense(req.body);
    await expense.save();
    res.status(201).json(expense);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/expenses/stats', async (req, res) => {
  try {
    await connectDB();
    const result = await Expense.aggregate([
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalExpenses = result[0]?.total || 0;
    res.json({ totalExpenses });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// DASHBOARD ROUTES (NO AUTH REQUIRED)
// ============================================================
app.get('/api/dashboard', async (req, res) => {
  try {
    await connectDB();
    
    const totalCustomers = await Customer.countDocuments();
    const active = await Customer.countDocuments({ status: 'Active' });
    const cutOff = await Customer.countDocuments({ status: 'Inactive' });
    const disable = await Customer.countDocuments({ status: 'Disabled' });
    
    const paid = await Payment.countDocuments({ status: 'Paid' });
    const unpaid = await Payment.countDocuments({ status: 'Unpaid' });
    
    const payments = await Payment.aggregate([
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalRevenue = payments[0]?.total || 0;
    
    const expenses = await Expense.aggregate([
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalExpenses = expenses[0]?.total || 0;
    
    const pendingDues = await Customer.aggregate([
      { $group: { _id: null, total: { $sum: '$pendingDues' } } }
    ]);
    const totalDues = pendingDues[0]?.total || 0;
    
    res.json({
      totalCustomers,
      active,
      cutOff,
      disable,
      paid,
      unpaid,
      totalRevenue,
      totalExpenses,
      totalDues,
      netProfit: totalRevenue - totalExpenses
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// WHATSAPP ROUTE
// ============================================================
app.get('/api/whatsapp/:phone', (req, res) => {
  try {
    const { phone } = req.params;
    res.json({ whatsappUrl: `https://wa.me/${phone}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// 404 HANDLER
// ============================================================
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

module.exports = app;