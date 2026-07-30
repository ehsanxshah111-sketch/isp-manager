const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

async function removeIndex() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    const db = mongoose.connection.db;
    const collection = db.collection('customers');
    
    // List all indexes
    const indexes = await collection.indexes();
    console.log('📋 Current indexes:', indexes.map(i => i.name));
    
    // Drop the customerId_1 index
    try {
      await collection.dropIndex('customerId_1');
      console.log('🗑️ Dropped customerId_1 index');
    } catch (err) {
      console.log('⚠️ Error dropping index:', err.message);
    }
    
    // Delete ALL documents
    const result = await collection.deleteMany({});
    console.log(`🗑️ Deleted ${result.deletedCount} documents`);
    
    // Drop and recreate the collection
    try {
      await collection.drop();
      console.log('🗑️ Dropped collection');
    } catch (err) {
      console.log('⚠️ Drop collection error:', err.message);
    }
    
    console.log('✅ Database completely cleared!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

removeIndex();
