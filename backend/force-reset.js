const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
dotenv.config();

const User = require('./models/User');

async function forceReset() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Delete all users
    await User.deleteMany({});
    console.log('🗑️ Deleted all users');

    // Create new admin
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('admin123', salt);

    const user = new User({
      username: 'admin',
      email: 'admin@isp.com',
      password: hashedPassword,
      role: 'admin',
      fullName: 'Admin'
    });
    await user.save();

    console.log('✅ Admin created!');
    console.log('📝 Username: admin');
    console.log('📝 Password: admin123');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

forceReset();