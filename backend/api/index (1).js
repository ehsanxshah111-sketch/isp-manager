const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

dotenv.config();
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

// =====================================================
// MODELS (kept in this single file on purpose - this is
// the file Vercel actually runs, per backend/vercel.json)
// =====================================================
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, default: '' },
  password: { type: String, required: true },
  role: { type: String, default: 'admin' }
});

const CustomerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  customerId: { type: String, required: true, unique: true },
  package: { type: String, default: '' },
  monthlyFee: { type: Number, required: true },
  connectionDate: { type: String, default: '' },
  pendingDues: { type: Number, default: 0 },
  phone: { type: String, default: '' },
  address: { type: String, default: '' },
  status: { type: String, enum: ['Active', 'Cut Off', 'Disable'], default: 'Active' },
  paymentStatus: { type: String, enum: ['Unpaid', 'Paid', '1 YEAR ADVANCED', 'FREE'], default: 'Unpaid' }
}, { timestamps: true });

const PaymentSchema = new mongoose.Schema({
  receiptNumber: { type: String, required: true, unique: true },
  date: { type: Date, default: Date.now },
  customerId: { type: String, required: true },
  customerName: { type: String, default: '' },
  amount: { type: Number, required: true },
  billingMonth: { type: String, default: '' },
  billingYear: { type: Number, default: () => new Date().getFullYear() },
  method: { type: String, enum: ['Cash', 'Bank Transfer', 'Easypaisa', 'JazzCash', 'Other'], default: 'Cash' },
  notes: { type: String, default: '' }
}, { timestamps: true });

const ExpenseSchema = new mongoose.Schema({
  title: { type: String, required: true },
  amount: { type: Number, required: true },
  category: {
    type: String,
    enum: ['Utilities', 'Salaries', 'Equipment', 'Maintenance', 'Marketing', 'Office', 'Internet', 'Other'],
    default: 'Other'
  },
  date: { type: Date, default: Date.now },
  description: { type: String, default: '' }
}, { timestamps: true });

// Reuse existing models on hot-reload / repeated invocation instead of
// throwing "Cannot overwrite model once compiled".
const User = mongoose.models.User || mongoose.model('User', UserSchema);
const Customer = mongoose.models.Customer || mongoose.model('Customer', CustomerSchema);
const Payment = mongoose.models.Payment || mongoose.model('Payment', PaymentSchema);
const Expense = mongoose.models.Expense || mongoose.model('Expense', ExpenseSchema);

// =====================================================
// DATABASE (cached connection so it survives warm
// serverless invocations on Vercel)
// =====================================================
let cached = global.mongoose;
if (!cached) cached = global.mongoose = { conn: null, promise: null };

async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGODB_URI, {
      bufferCommands: false
    }).then(m => {
      console.log('MongoDB Connected');
      return m;
    });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

// Make sure every request has a DB connection before hitting a route
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error('DB connection error:', error.message);
    res.status(500).json({ success: false, message: 'Database connection failed' });
  }
});

// =====================================================
// AUTH MIDDLEWARE
// =====================================================
const JWT_SECRET = process.env.JWT_SECRET || 'secret';

const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ success: false, message: 'No token provided. Access denied.' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token. Please login again.' });
  }
};

// =====================================================
// HELPERS
// =====================================================
const formatPhoneForWhatsApp = (phone) => {
  let digits = (phone || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = '92' + digits.slice(1);
  return digits;
};

const startOfThisMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
};

// =====================================================
// HEALTH
// =====================================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server running on Vercel!' });
});

// =====================================================
// AUTH ROUTES
// =====================================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ success: false, message: 'User not found' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid password' });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      user: { id: user._id, username: user.username, email: user.email, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/auth/logout', auth, (req, res) => {
  res.json({ success: true, message: 'Logged out' });
});

app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/auth/change-username', auth, async (req, res) => {
  try {
    const { newUsername } = req.body;
    if (!newUsername || newUsername.trim().length < 3) {
      return res.status(400).json({ success: false, message: 'Username must be at least 3 characters' });
    }
    const existing = await User.findOne({ username: newUsername.trim(), _id: { $ne: req.userId } });
    if (existing) return res.status(400).json({ success: false, message: 'Username already taken' });

    const user = await User.findByIdAndUpdate(
      req.userId,
      { username: newUsername.trim() },
      { new: true }
    ).select('-password');

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/auth/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Current password is incorrect' });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// =====================================================
// CUSTOMER ROUTES
// =====================================================
app.get('/api/customers', auth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 0;
    let query = Customer.find().sort({ createdAt: -1 });
    if (limit) query = query.limit(limit);
    const customers = await query;
    res.json({ success: true, data: customers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/customers', auth, async (req, res) => {
  try {
    const customer = new Customer(req.body);
    await customer.save();
    res.status(201).json({ success: true, data: customer });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/customers/:id', auth, async (req, res) => {
  try {
    const customer = await Customer.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    res.json({ success: true, data: customer });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/customers/:id', auth, async (req, res) => {
  try {
    const customer = await Customer.findByIdAndDelete(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    res.json({ success: true, message: 'Customer deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// =====================================================
// PAYMENT ROUTES
// =====================================================
app.get('/api/payments', auth, async (req, res) => {
  try {
    const payments = await Payment.find().sort({ date: -1 });
    res.json({ success: true, data: payments });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/payments/summary', auth, async (req, res) => {
  try {
    const monthStart = startOfThisMonth();
    const [allAgg, monthAgg, totalTransactions, monthlyTransactions] = await Promise.all([
      Payment.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]),
      Payment.aggregate([
        { $match: { date: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      Payment.countDocuments(),
      Payment.countDocuments({ date: { $gte: monthStart } })
    ]);

    res.json({
      success: true,
      data: {
        totalCollected: allAgg[0]?.total || 0,
        monthlyCollection: monthAgg[0]?.total || 0,
        totalTransactions,
        monthlyTransactions
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/payments', auth, async (req, res) => {
  try {
    const { customerId, amount, billingMonth, method, notes } = req.body;
    const customer = await Customer.findOne({ customerId });
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const receiptNumber = `RCPT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const payment = new Payment({
      receiptNumber,
      customerId,
      customerName: customer.name,
      amount,
      billingMonth,
      method,
      notes
    });
    await payment.save();

    res.status(201).json({ success: true, data: payment });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/payments/:id', auth, async (req, res) => {
  try {
    const { amount, billingMonth, method, notes } = req.body;
    const payment = await Payment.findByIdAndUpdate(
      req.params.id,
      { amount, billingMonth, method, notes },
      { new: true }
    );
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    res.json({ success: true, data: payment });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/payments/:id', auth, async (req, res) => {
  try {
    const payment = await Payment.findByIdAndDelete(req.params.id);
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });
    res.json({ success: true, message: 'Payment deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// =====================================================
// EXPENSE ROUTES
// =====================================================
app.get('/api/expenses', auth, async (req, res) => {
  try {
    const expenses = await Expense.find().sort({ date: -1 });
    res.json({ success: true, data: expenses });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/expenses/summary', auth, async (req, res) => {
  try {
    const monthStart = startOfThisMonth();
    const [allAgg, monthAgg, totalTransactions, categoryAgg] = await Promise.all([
      Expense.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]),
      Expense.aggregate([
        { $match: { date: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      Expense.countDocuments(),
      Expense.aggregate([{ $group: { _id: '$category', total: { $sum: '$amount' } } }])
    ]);

    const categories = {};
    categoryAgg.forEach(c => { categories[c._id] = c.total; });

    res.json({
      success: true,
      data: {
        totalExpenses: allAgg[0]?.total || 0,
        monthlyExpenses: monthAgg[0]?.total || 0,
        totalTransactions,
        categories
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/expenses', auth, async (req, res) => {
  try {
    const expense = new Expense(req.body);
    await expense.save();
    res.status(201).json({ success: true, data: expense });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/expenses/:id', auth, async (req, res) => {
  try {
    const expense = await Expense.findByIdAndDelete(req.params.id);
    if (!expense) return res.status(404).json({ success: false, message: 'Expense not found' });
    res.json({ success: true, message: 'Expense deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// =====================================================
// DASHBOARD ROUTE
// This is the one the screenshot's error came from:
// the frontend reads res.data.data.stats, so the response
// MUST be shaped as { success, data: { stats, dailyData, recentCustomers } }
// =====================================================
app.get('/api/dashboard', auth, async (req, res) => {
  try {
    const customers = await Customer.find();
    const expenses = await Expense.find();

    const totalCustomers = customers.length;
    const active = customers.filter(c => c.status === 'Active').length;
    const cutOff = customers.filter(c => c.status === 'Cut Off').length;
    const disable = customers.filter(c => c.status === 'Disable').length;

    const paid = customers.filter(c => c.paymentStatus === 'Paid' || c.paymentStatus === '1 YEAR ADVANCED').length;
    const unpaid = customers.filter(c => c.paymentStatus === 'Unpaid').length;

    const totalRevenue = customers.reduce((sum, c) => sum + (c.monthlyFee || 0), 0);
    const totalDues = customers.reduce((sum, c) => sum + (c.pendingDues || 0), 0);
    const collected = customers
      .filter(c => c.paymentStatus === 'Paid' || c.paymentStatus === '1 YEAR ADVANCED')
      .reduce((sum, c) => sum + (c.monthlyFee || 0), 0);
    const pendingCollection = customers
      .filter(c => c.paymentStatus === 'Unpaid')
      .reduce((sum, c) => sum + (c.monthlyFee || 0), 0);

    const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const netProfit = totalRevenue - totalExpenses;

    const days = Array.from({ length: 31 }, (_, i) => i + 1);
    const dailyData = days.map(day => {
      const dayCustomers = customers.filter(c => {
        if (!c.connectionDate) return false;
        return parseFloat(c.connectionDate) === day;
      });
      return {
        day,
        count: dayCustomers.length,
        revenue: dayCustomers.reduce((sum, c) => sum + (c.monthlyFee || 0), 0)
      };
    });

    const recentCustomers = customers
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10);

    res.json({
      success: true,
      data: {
        stats: {
          totalCustomers,
          active,
          cutOff,
          disable,
          paid,
          unpaid,
          totalRevenue,
          totalDues,
          collected,
          pendingCollection,
          totalExpenses,
          netProfit
        },
        dailyData,
        recentCustomers
      }
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// =====================================================
// WHATSAPP ROUTES
// =====================================================
app.post('/api/whatsapp/send', auth, async (req, res) => {
  try {
    const { customerId } = req.body;
    const customer = await Customer.findOne({ customerId });
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    if (!customer.phone) return res.status(400).json({ success: false, message: 'No phone number for this customer' });

    const phone = formatPhoneForWhatsApp(customer.phone);
    const message = `Dear ${customer.name}, this is a reminder that your ISP bill of PKR ${customer.monthlyFee} is due. Pending dues: PKR ${customer.pendingDues || 0}. Please clear it at your earliest convenience. Thank you.`;
    const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

    res.json({ success: true, data: { whatsappUrl } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/whatsapp/bulk', auth, async (req, res) => {
  try {
    const unpaidCustomers = await Customer.find({ paymentStatus: 'Unpaid', phone: { $ne: '' } });

    const links = unpaidCustomers
      .filter(c => c.phone)
      .map(c => {
        const phone = formatPhoneForWhatsApp(c.phone);
        const message = `Dear ${c.name}, this is a reminder that your ISP bill of PKR ${c.monthlyFee} is due. Pending dues: PKR ${c.pendingDues || 0}. Please clear it at your earliest convenience. Thank you.`;
        return {
          customerId: c.customerId,
          name: c.name,
          whatsappUrl: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
        };
      });

    res.json({ success: true, data: links });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Local dev support: `node api/index.js` will still boot a server,
// while Vercel just imports `app` as a serverless function.
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
