const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// ===== REGISTER MODELS INSIDE ROUTE FILE =====
let Customer, Payment, Expense;

try {
  Customer = mongoose.model('Customer');
  Payment = mongoose.model('Payment');
  Expense = mongoose.model('Expense');
} catch {
  // If models don't exist, create them
  const CustomerSchema = new mongoose.Schema({
    name: String,
    customerId: String,
    monthlyFee: Number,
    pendingDues: { type: Number, default: 0 },
    connectionDate: String,
    status: { type: String, default: 'Active' },
    paymentStatus: { type: String, default: 'Unpaid' },
    createdAt: { type: Date, default: Date.now }
  });

  const PaymentSchema = new mongoose.Schema({
    customerId: String,
    customerName: String,
    amount: Number,
    month: String,
    year: String,
    method: { type: String, default: 'Cash' },
    status: { type: String, default: 'Paid' },
    date: { type: Date, default: Date.now }
  });

  const ExpenseSchema = new mongoose.Schema({
    description: { type: String, required: true },
    amount: { type: Number, required: true },
    category: { type: String, required: true },
    date: { type: Date, default: Date.now }
  });

  Customer = mongoose.model('Customer', CustomerSchema);
  Payment = mongoose.model('Payment', PaymentSchema);
  Expense = mongoose.model('Expense', ExpenseSchema);
}

// ===== DASHBOARD ROUTE =====
router.get('/', async (req, res) => {
  try {
    const totalCustomers = await Customer.countDocuments();
    const active = await Customer.countDocuments({ status: 'Active' });
    const cutOff = await Customer.countDocuments({ status: 'Inactive' });
    const disable = await Customer.countDocuments({ status: 'Disabled' });
    
    const paid = await Payment.countDocuments({ status: 'Paid' });
    const unpaid = await Payment.countDocuments({ status: 'Unpaid' });
    
    const payments = await Payment.aggregate([
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalRevenue = payments[0]?.total || 0;
    
    const expenses = await Expense.aggregate([
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalExpenses = expenses[0]?.total || 0;
    
    const pendingDues = await Customer.aggregate([
      { $group: { _id: null, total: { $sum: '$pendingDues' } } }
    ]);
    const totalDues = pendingDues[0]?.total || 0;
    
    const collected = await Payment.aggregate([
      { $match: { status: 'Paid' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalCollected = collected[0]?.total || 0;
    
    res.json({
      totalCustomers,
      active,
      cutOff,
      disable,
      paid,
      unpaid,
      totalRevenue,
      totalExpenses,
      totalDues,
      totalCollected,
      pendingCollection: totalRevenue - totalCollected,
      netProfit: totalRevenue - totalExpenses
    });
  } catch (error) {
    console.error('Dashboard Error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;