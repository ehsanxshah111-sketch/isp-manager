const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const Customer = require('./models/Customer');

async function clearCustomers() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    const result = await Customer.deleteMany({});
    console.log(`🗑️ Deleted ${result.deletedCount} customers`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

clearCustomers();
