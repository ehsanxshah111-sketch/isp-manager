const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Register model if not already registered
let Customer;
try {
  Customer = mongoose.model('Customer');
} catch {
  const CustomerSchema = new mongoose.Schema({
    name: String,
    customerId: String,
    monthlyFee: Number,
    pendingDues: Number,
    connectionDate: String,
    status: String,
    paymentStatus: String
  });
  Customer = mongoose.model('Customer', CustomerSchema);
}

// GET all customers
router.get('/', async (req, res) => {
  try {
    const customers = await Customer.find().sort({ createdAt: -1 });
    res.json(customers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST new customer
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