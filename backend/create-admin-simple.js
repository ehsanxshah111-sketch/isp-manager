console.log('1. Script started...');

const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

console.log('2. Environment loaded');

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('3. Connected to MongoDB');
    
    const userSchema = new mongoose.Schema({
      username: String,
      email: String,
      password: String,
      role: String
    });
    
    const User = mongoose.model('User', userSchema);
    
    const user = new User({
      username: 'admin',
      email: 'admin@isp.com',
      password: 'admin123',
      role: 'admin'
    });
    
    return user.save();
  })
  .then(() => {
    console.log('4. Admin created successfully!');
    console.log('Username: admin');
    console.log('Password: admin123');
    process.exit();
  })
  .catch(err => {
    console.log('5. Error:', err.message);
    process.exit();
  });