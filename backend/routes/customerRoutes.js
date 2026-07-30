const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

let Customer;
try {
  Customer = mongoose.model('Customer');
} catch {
  const CustomerSchema = new mongoose.Schema({
    name: String,
    customerId: String,
    monthlyFee: Number,
    pendingDues: { type: Number, default: 0 },
    connectionDate: String,
    status: { type: String, default: 'Active' },
    paymentStatus: { type: String, default: 'Unpaid' }
  });
  Customer = mongoose.model('Customer', CustomerSchema);
}

router.get('/', async (req, res) => {
  try {
    const customers = await Customer.find().sort({ createdAt: -1 });
    res.json(customers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const customer = new Customer(req.body);
    await customer.save();
    res.status(201).json(customer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;