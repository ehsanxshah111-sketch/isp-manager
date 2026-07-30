const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema({
  receiptNumber: {
    type: String,
    required: true,
    unique: true
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  customerId: {
    type: String,
    required: true
  },
  customerName: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  billingMonth: {
    type: String,
    required: true
  },
  billingYear: {
    type: Number,
    required: true,
    default: new Date().getFullYear()
  },
  method: {
    type: String,
    enum: ['Cash', 'Bank Transfer', 'Easypaisa', 'JazzCash', 'Other'],
    default: 'Cash'
  },
  receivedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Payment', PaymentSchema);