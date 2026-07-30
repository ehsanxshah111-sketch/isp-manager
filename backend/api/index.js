const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

dotenv.config();

const app = express();

// ===== MIDDLEWARE =====
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());
app.use(express.json());

// ============================================================
// DATABASE CONNECTION (with caching for Vercel)
// ============================================================
let cached = global.mongoose;
if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      bufferCommands: false,
      serverSelectionTimeoutMS: 5000,
    };
    cached.promise = mongoose.connect(process.env.MONGODB_URI, opts).then((mongoose) => {
      console.log('✅ MongoDB Connected');
      return mongoose;
    });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

// ============================================================
// MODELS
// ============================================================

// User Model
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' },
  createdAt: { type: Date, default: Date.now }
});

// Customer Model
const CustomerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  customerId: { type: String, unique: true },
  email: String,
  phone: String,
  address: String,
  package: String,
  monthlyFee: Number,
  pendingDues: { type: Number, default: 0 },
  connectionDate: String,
  status: { type: String, default: 'Active' },
  paymentStatus: { type: String, default: 'Unpaid' },
  createdAt: { type: Date, default: Date.now }
});

// Payment Model
const PaymentSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
  customerName: String,
  amount: Number,
  month: String,
  year: String,
  method: { type: String, default: 'Cash' },
  status: { type: String, default: 'Paid' },
  date: { type: Date, default: Date.now }
});

// Expense Model
const ExpenseSchema = new mongoose.Schema({
  description: { type: String, required: true },
  amount: { type: Number, required: true },
  category: { type: String, required: true },
  date: { type: Date, default: Date.now }
});

// Register Models
const User = mongoose.model('User', UserSchema);
const Customer = mongoose.model('Customer', CustomerSchema);
const Payment = mongoose.model('Payment', PaymentSchema);
const Expense = mongoose.model('Expense', ExpenseSchema);

// ============================================================
// ROUTES
// ============================================================

// HEALTH CHECK
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server running on Vercel!' });
});

// TEST DATABASE
app.get('/api/test-db', async (req, res) => {
  try {
    await connectDB();
    const count = await User.countDocuments();
    res.json({ 
      connected: true, 
      userCount: count,
      message: 'MongoDB is working!'
    });
  } catch (error) {
    res.status(500).json({ 
      connected: false, 
      error: error.message 
    });
  }
});

// ===== AUTH ROUTES =====

// LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    await connectDB();
    const { username, password } = req.body;
    console.log('Login attempt:', username);
    
    const user = await User.findOne({ username });
    
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid password' });
    }
    
    const token = jwt.sign(
      { id: user._id, username: user.username },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '30d' }
    );
    
    res.json({ 
      token, 
      user: { 
        id: user._id,
        username: user.username, 
        email: user.email,
        role: user.role 
      } 
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET CURRENT USER
app.get('/api/auth/me', async (req, res) => {
  try {
    await connectDB();
    // For testing, return dummy user
    // In production, verify token here
    res.json({ 
      user: { 
        username: 'admin', 
        email: 'admin@isp.com',
        role: 'admin' 
      } 
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ===== CUSTOMER ROUTES =====

// GET all customers
app.get('/api/customers', async (req, res) => {
  try {
    await connectDB();
    const customers = await Customer.find().sort({ createdAt: -1 });
    res.json(customers);
  } catch (error) {
    console.error('Customers error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET single customer
app.get('/api/customers/:id', async (req, res) => {
  try {
    await connectDB();
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    res.json(customer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// CREATE customer
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

// UPDATE customer
app.put('/api/customers/:id', async (req, res) => {
  try {
    await connectDB();
    const customer = await Customer.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    res.json(customer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE customer
app.delete('/api/customers/:id', async (req, res) => {
  try {
    await connectDB();
    const customer = await Customer.findByIdAndDelete(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    res.json({ message: 'Customer deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== PAYMENT ROUTES =====

// GET all payments
app.get('/api/payments', async (req, res) => {
  try {
    await connectDB();
    const payments = await Payment.find().sort({ date: -1 });
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// CREATE payment
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

// ===== EXPENSE ROUTES =====

// GET all expenses
app.get('/api/expenses', async (req, res) => {
  try {
    await connectDB();
    const expenses = await Expense.find().sort({ date: -1 });
    res.json(expenses);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// CREATE expense
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

// ===== 404 HANDLER =====
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// ============================================================
// EXPORT FOR VERCEL
// ============================================================
module.exports = app;