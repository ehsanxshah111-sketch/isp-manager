const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const errorHandler = require('../middleware/errorHandler');

dotenv.config();

const app = express();

// --- CORS ---
// CLIENT_URL can be a single origin or a comma-separated list
// (e.g. "https://your-frontend.vercel.app,http://localhost:3000")
const allowedOrigins = (process.env.CLIENT_URL || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server, health checks)
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

// --- MongoDB Connection ---
// Serverless functions can be reused between invocations, so we cache the
// connection instead of reconnecting on every request.
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

// --- Health check ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server running on Vercel!' });
});

// --- Routes ---
app.use('/api/auth', require('../routes/authRoutes'));
app.use('/api/customers', require('../routes/customerRoutes'));
app.use('/api/payments', require('../routes/paymentRoutes'));
app.use('/api/expenses', require('../routes/expenseRoutes'));
app.use('/api/dashboard', require('../routes/dashboardRoutes'));
app.use('/api/whatsapp', require('../routes/whatsappRoutes'));

app.use(errorHandler);

// Export for Vercel serverless
module.exports = app;

// Allow running this file directly too (node api/index.js), matching
// package.json's "start" script, so local dev still works.
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 API: http://localhost:${PORT}/api`);
  });
}