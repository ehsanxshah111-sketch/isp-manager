const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  customerId: {
    type: String,
    required: true,
    unique: true
  },
  vLanId: {
    type: Number,
    default: 1841
  },
  package: {
    type: String,
    default: ''
  },
  monthlyFee: {
    type: Number,
    required: true
  },
  connectionDate: {
    type: String,
    required: true
  },
  // ===== DAY NUMBER FOR SORTING =====
  dayNumber: {
    type: Number,
    default: 0
  },
  pendingDues: {
    type: Number,
    default: 0
  },
  phone: {
    type: String,
    default: ''
  },
  address: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['Active', 'Cut Off', 'Disable'],
    default: 'Active'
  },
  paymentStatus: {
    type: String,
    enum: ['Unpaid', 'Paid', '1 YEAR ADVANCED', 'FREE'],
    default: 'Unpaid'
  },
  paymentHistory: [{
    month: String,
    amount: Number,
    paidDate: Date,
    method: String,
    receiptNo: String
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Text index required for the $text search used in getCustomers (name/customerId/phone search)
CustomerSchema.index({ name: 'text', customerId: 'text', phone: 'text', address: 'text' });

// ===== AUTO-CALCULATE DAY NUMBER BEFORE SAVING =====
CustomerSchema.pre('save', function(next) {
  if (this.connectionDate) {
    const num = parseFloat(this.connectionDate);
    this.dayNumber = isNaN(num) ? 0 : num;
  }
  next();
});

module.exports = mongoose.model('Customer', CustomerSchema);