const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();

// ===== MIDDLEWARE =====
app.use(cors({
  origin: [
    'https://isp-frontend-eight.vercel.app',
    'https://isp-frontend-git-main-shah-a25a.vercel.app',
    'https://isp-frontend-522nenhzr-shah-a25a.vercel.app',
    process.env.CLIENT_URL || '*'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== DATABASE CONNECTION =====
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
})
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => console.log('❌ MongoDB Error:', err));

// ===== MODELS =====
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);

// ===== HEALTH CHECK =====
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server running on Vercel!' });
});

// ===== TEST MONGODB CONNECTION =====
app.get('/api/test-db', async (req, res) => {
  try {
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

// ===== LOGIN ROUTE =====
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log('Login attempt:', username);
    
    const user = await User.findOne({ username });
    
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    const bcrypt = require('bcryptjs');
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid password' });
    }
    
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      { id: user._id, username: user.username },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '30d' }
    );
    
    res.json({ 
      token, 
      user: { 
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

// ===== GET CURRENT USER =====
app.get('/api/auth/me', async (req, res) => {
  try {
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

// ===== 404 HANDLER =====
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// ===== EXPORT FOR VERCEL =====
module.exports = app;