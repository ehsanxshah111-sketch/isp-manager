const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Register models if not already registered
let Customer, Payment, Expense;
try {
  Customer = mongoose.model('Customer');
  Payment = mongoose.model('Payment');
  Expense = mongoose.model('Expense');
} catch {
  const CustomerSchema = new mongoose.Schema({ name: String, status: String });
  const PaymentSchema = new mongoose.Schema({ amount: Number });
  const ExpenseSchema = new mongoose.Schema({ amount: Number });
  Customer = mongoose.model('Customer', CustomerSchema);
  Payment = mongoose.model('Payment', PaymentSchema);
  Expense = mongoose.model('Expense', ExpenseSchema);
}

router.get('/', async (req, res) => {
  try {
    const totalCustomers = await Customer.countDocuments();
    const active = await Customer.countDocuments({ status: 'Active' });
    const payments = await Payment.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]);
    const expenses = await Expense.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]);
    res.json({
      totalCustomers,
      active,
      totalRevenue: payments[0]?.total || 0,
      totalExpenses: expenses[0]?.total || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;