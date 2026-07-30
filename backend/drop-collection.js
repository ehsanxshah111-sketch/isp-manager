const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

async function dropCollection() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Try to drop the customers collection
    try {
      await mongoose.connection.db.dropCollection('customers');
      console.log('🗑️ Customers collection dropped successfully');
    } catch (err) {
      if (err.message.includes('ns not found')) {
        console.log('⚠️ Collection already dropped or not found');
      } else {
        throw err;
      }
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

dropCollection();