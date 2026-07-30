const mongoose = require('mongoose');

const ActivityLogSchema = new mongoose.Schema({
  user: {
    type: String,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  action: {
    type: String,
    required: true
  },
  details: {
    type: String,
    default: ''
  },
  module: {
    type: String,
    enum: ['Auth', 'Customers', 'Payments', 'Expenses', 'Reports', 'System'],
    default: 'System'
  },
  ip: {
    type: String
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('ActivityLog', ActivityLogSchema);