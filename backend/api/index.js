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

// ============================================================
// MODELS (defined inside index.js so they always exist)
// ============================================================
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' },
  createdAt: { type: Date, default: Date.now }
});

const CustomerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  customerId: { type: String, unique: true },
  monthlyFee: Number,
  pendingDues: { type: Number, default: 0 },
  connectionDate: String,
  status: { type: String, default: 'Active' },
  paymentStatus: { type: String, default: 'Unpaid' },
  createdAt: { type: Date, default: Date.now }
});

const PaymentSchema = new mongoose.Schema({
  customerId: String,
  customerName: String,
  amount: Number,
  month: String,
  year: String,
  method: { type: String, default: 'Cash' },
  status: { type: String, default: 'Paid' },
  date: { type: Date, default: Date.now }
});

const ExpenseSchema = new mongoose.Schema({
  description: { type: String, required: true },
  amount: { type: Number, required: true },
  category: { type: String, required: true },
  date: { type: Date, default: Date.now }
});

// Register models
const User = mongoose.model('User', UserSchema);
const Customer = mongoose.model('Customer', CustomerSchema);
const Payment = mongoose.model('Payment', PaymentSchema);
const Expense = mongoose.model('Expense', ExpenseSchema);

// ============================================================
// DATABASE CONNECTION
// ============================================================
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
// ROUTES
// ============================================================

// Health
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server running on Vercel!' });
});

// ===== AUTH =====
app.post('/api/auth/login', async (req, res) => {
  try {
    await connectDB();
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ message: 'User not found' });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: 'Invalid password' });
    const token = jwt.sign(
      { id: user._id, username: user.username },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '30d' }
    );
    res.json({ token, user: { id: user._id, username: user.username, email: user.email, role: user.role } });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ===== CUSTOMERS =====
app.get('/api/customers', async (req, res) => {
  try {
    await connectDB();
    const customers = await Customer.find().sort({ createdAt: -1 });
    res.json(customers);
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

// ===== PAYMENTS =====
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

// ===== EXPENSES =====
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

// ===== DASHBOARD =====
app.get('/api/dashboard', async (req, res) => {
  try {
    await connectDB();
    const totalCustomers = await Customer.countDocuments();
    const active = await Customer.countDocuments({ status: 'Active' });
    const cutOff = await Customer.countDocuments({ status: 'Inactive' });
    const disable = await Customer.countDocuments({ status: 'Disabled' });
    
    const paid = await Payment.countDocuments({ status: 'Paid' });
    const unpaid = await Payment.countDocuments({ status: 'Unpaid' });
    
    const payments = await Payment.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]);
    const totalRevenue = payments[0]?.total || 0;
    
    const expenses = await Expense.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]);
    const totalExpenses = expenses[0]?.total || 0;
    
    const pendingDues = await Customer.aggregate([{ $group: { _id: null, total: { $sum: '$pendingDues' } } }]);
    const totalDues = pendingDues[0]?.total || 0;
    
    const collected = await Payment.aggregate([
      { $match: { status: 'Paid' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalCollected = collected[0]?.total || 0;
    
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
      totalCollected,
      pendingCollection: totalRevenue - totalCollected,
      netProfit: totalRevenue - totalExpenses
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== 404 =====
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

module.exports = app;