const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Customer = mongoose.model('Customer');
const Payment = mongoose.model('Payment');
const Expense = mongoose.model('Expense');

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