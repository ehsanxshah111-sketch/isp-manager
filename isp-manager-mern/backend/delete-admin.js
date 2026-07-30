const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const User = require('./models/User');

async function deleteAdmin() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    const result = await User.deleteOne({ username: 'admin' });
    console.log('🗑️ Old admin deleted');
    process.exit();
  } catch (err) {
    console.log('❌ Error:', err.message);
    process.exit();
  }
}

deleteAdmin();
