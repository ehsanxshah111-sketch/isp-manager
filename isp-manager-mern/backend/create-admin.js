const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const User = require('./models/User');

async function createAdmin() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const user = new User({
      username: 'admin',
      email: 'admin@isp.com',
      password: 'admin123',
      role: 'admin'
    });
    await user.save();
    console.log('✅ Admin created with hashed password!');
    console.log('📝 Username: admin');
    console.log('📝 Password: admin123');
    process.exit();
  } catch (err) {
    console.log('❌ Error:', err.message);
    process.exit();
  }
}

createAdmin();
