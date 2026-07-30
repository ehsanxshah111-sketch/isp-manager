const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const User = require('./models/User');

async function checkAdmin() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const user = await User.findOne({ username: 'admin' });
    if (user) {
      console.log('✅ Admin exists!');
      console.log('Username:', user.username);
      console.log('Email:', user.email);
      console.log('Role:', user.role);
      console.log('Password hash:', user.password);
    } else {
      console.log('❌ Admin not found!');
    }
    process.exit();
  } catch (err) {
    console.log('❌ Error:', err.message);
    process.exit();
  }
}

checkAdmin();