const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const errorHandler = require('../middleware/errorHandler');

dotenv.config();

const app = express();

// ============================================================
// CORS
// ============================================================
const allowedOrigins = (process.env.CLIENT_URL || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================
// DATABASE CONNECTION (cached for serverless)
// ============================================================
let isConnected = false;
const connectDB = async () => {
  if (isConnected) return;
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    isConnected = true;
    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB Error:', error.message);
    throw error;
  }
};

app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    res.status(500).json({ success: false, message: 'Database connection failed' });
  }
});

// ============================================================
// MODELS
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
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
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
mongoose.model('User', UserSchema);
mongoose.model('Customer', CustomerSchema);
mongoose.model('Payment', PaymentSchema);
mongoose.model('Expense', ExpenseSchema);

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server running on Vercel!' });
});

// ============================================================
// ROUTES
// ============================================================
app.use('/api/auth', require('../routes/authRoutes'));
app.use('/api/customers', require('../routes/customerRoutes'));
app.use('/api/payments', require('../routes/paymentRoutes'));
app.use('/api/expenses', require('../routes/expenseRoutes'));
app.use('/api/dashboard', require('../routes/dashboardRoutes'));
app.use('/api/whatsapp', require('../routes/whatsappRoutes'));

// ============================================================
// ERROR HANDLER
// ============================================================
app.use(errorHandler);

// ============================================================
// EXPORT FOR VERCEL
// ============================================================
module.exports = app;

// ============================================================
// LOCAL DEVELOPMENT
// ============================================================
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 API: http://localhost:${PORT}/api`);
  });
}