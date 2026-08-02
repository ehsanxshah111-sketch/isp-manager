const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

dotenv.config();
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '5mb' }));

// =====================================================
// MODELS (kept in this single file on purpose - this is
// the file Vercel actually runs, per backend/vercel.json)
// =====================================================
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, default: '' },
  fullName: { type: String, default: '' },
  profilePicture: { type: String, default: '' },
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

// Single shared document (key: 'global') holding app-wide settings, e.g. the
// sliding text shown in the header. Lives on the server (not localStorage) so
// every admin/device sees the same banner.
const AppSettingSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true },
  bannerText: { type: String, default: 'Welcome AT Muhammad Shah Panel' }
}, { timestamps: true });

// Reuse existing models on hot-reload / repeated invocation instead of
// throwing "Cannot overwrite model once compiled".
const User = mongoose.models.User || mongoose.model('User', UserSchema);
const Customer = mongoose.models.Customer || mongoose.model('Customer', CustomerSchema);
const Payment = mongoose.models.Payment || mongoose.model('Payment', PaymentSchema);
const Expense = mongoose.models.Expense || mongoose.model('Expense', ExpenseSchema);
const AppSetting = mongoose.models.AppSetting || mongoose.model('AppSetting', AppSettingSchema);

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

// Shared WhatsApp reminder text for both the single-send and bulk-send
// routes, so the wording never drifts between the two. Pending dues are
// only mentioned when there actually are some, to avoid a confusing
// "Pending dues: PKR 0" line on a fully caught-up customer.
const buildReminderMessage = (c) => {
  const duesLine = c.pendingDues > 0 ? ` You also have pending dues of PKR ${c.pendingDues}.` : '';
  return `Dear ${c.name}, this is a reminder that your internet bill of PKR ${c.monthlyFee} is due.${duesLine} Please clear it at your earliest convenience. Thank you.`;
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

// Used by the "Edit Profile" popup (click your name, top-right) to update
// display name (fullName) and email. Separate from change-username above.
app.put('/api/auth/update', auth, async (req, res) => {
  try {
    const { fullName, email } = req.body;
    if (!fullName || fullName.trim() === '') {
      return res.status(400).json({ success: false, message: 'Name cannot be empty' });
    }

    const user = await User.findByIdAndUpdate(
      req.userId,
      { fullName: fullName.trim(), email: (email || '').trim() },
      { new: true }
    ).select('-password');

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Profile picture is stored on the User document (as a base64 data URL) so
// it follows the account across devices/browsers, instead of only living
// in one browser's localStorage.
app.put('/api/auth/profile-picture', auth, async (req, res) => {
  try {
    const { profilePicture } = req.body;
    if (!profilePicture || !profilePicture.startsWith('data:image/')) {
      return res.status(400).json({ success: false, message: 'Invalid image data' });
    }
    // Roughly enforce the same 2MB limit the frontend already checks client-side.
    const approxBytes = profilePicture.length * 0.75;
    if (approxBytes > 2 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: 'Image must be less than 2MB' });
    }

    const user = await User.findByIdAndUpdate(
      req.userId,
      { profilePicture },
      { new: true }
    ).select('-password');

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/auth/profile-picture', auth, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.userId,
      { profilePicture: '' },
      { new: true }
    ).select('-password');

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
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
    let customers = await Customer.find();

    // connectionDate is stored as a string ("1.0", "27.0", etc.), so a normal
    // Mongo/string sort would put "10.0" before "2.0". Sort numerically by
    // day instead, so Day 1 customers come first, then Day 2, and so on.
    customers.sort((a, b) => {
      const dayA = parseFloat(a.connectionDate);
      const dayB = parseFloat(b.connectionDate);
      const safeA = isNaN(dayA) ? 999 : dayA;
      const safeB = isNaN(dayB) ? 999 : dayB;
      if (safeA !== safeB) return safeA - safeB;
      return (a.name || '').localeCompare(b.name || '');
    });

    if (limit) customers = customers.slice(0, limit);
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
// APP SETTINGS (header banner text, etc.)
// One shared document for the whole app - not per-user - so
// every admin/device sees the same header banner.
// =====================================================
app.get('/api/settings', auth, async (req, res) => {
  try {
    let setting = await AppSetting.findOne({ key: 'global' });
    if (!setting) {
      setting = await AppSetting.create({ key: 'global' });
    }
    res.json({ success: true, data: setting });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/settings', auth, async (req, res) => {
  try {
    const { bannerText } = req.body;
    if (typeof bannerText !== 'string' || !bannerText.trim()) {
      return res.status(400).json({ success: false, message: 'Banner text cannot be empty' });
    }
    const setting = await AppSetting.findOneAndUpdate(
      { key: 'global' },
      { bannerText: bannerText.trim() },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, data: setting });
  } catch (error) {
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
    const message = buildReminderMessage(customer);
    const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

    res.json({ success: true, data: { whatsappUrl } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/whatsapp/bulk', auth, async (req, res) => {
  try {
    // By default this targets every Unpaid customer with a phone number.
    // If the person picked specific customers in the "Bulk WhatsApp" modal,
    // customerIds narrows it down to just that selection (still only ever
    // customers who are actually Unpaid, as a safety net).
    const { customerIds } = req.body || {};
    const query = { paymentStatus: 'Unpaid', phone: { $ne: '' } };
    if (Array.isArray(customerIds) && customerIds.length > 0) {
      query.customerId = { $in: customerIds };
    }

    const unpaidCustomers = await Customer.find(query);

    const links = unpaidCustomers
      .filter(c => c.phone)
      .map(c => {
        const phone = formatPhoneForWhatsApp(c.phone);
        const message = buildReminderMessage(c);
        return {
          customerId: c.customerId,
          name: c.name,
          phone: c.phone,
          monthlyFee: c.monthlyFee,
          pendingDues: c.pendingDues || 0,
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
