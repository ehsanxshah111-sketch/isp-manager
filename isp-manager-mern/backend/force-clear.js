const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

async function forceClear() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Method 1: Try to drop the collection
    try {
      await mongoose.connection.db.dropCollection('customers');
      console.log('🗑️ Collection dropped successfully');
    } catch (err) {
      console.log('⚠️ Drop collection failed:', err.message);
    }
    
    // Method 2: Delete all documents directly
    const db = mongoose.connection.db;
    const collection = db.collection('customers');
    
    // Delete all documents
    const result = await collection.deleteMany({});
    console.log(`🗑️ Deleted ${result.deletedCount} documents`);
    
    // Method 3: Remove the index that's causing the error
    try {
      await collection.dropIndex('customerId_1');
      console.log('✅ Dropped customerId index');
    } catch (err) {
      console.log('⚠️ Index drop failed:', err.message);
    }
    
    console.log('✅ Database cleared successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

forceClear();
