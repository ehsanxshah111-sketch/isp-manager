const Payment = require('../models/Payment');
const Customer = require('../models/Customer');
const ActivityLog = require('../models/ActivityLog');

// @desc    Get all payments
// @route   GET /api/payments
// @access  Private
exports.getPayments = async (req, res) => {
  try {
    const { customerId, startDate, endDate, limit = 100 } = req.query;
    
    let query = {};
    if (customerId) query.customerId = customerId;
    if (startDate && endDate) {
      query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    const payments = await Payment.find(query)
      .populate('receivedBy', 'username')
      .sort({ date: -1 })
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: payments,
      count: payments.length
    });
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create payment
// @route   POST /api/payments
// @access  Private
exports.createPayment = async (req, res) => {
  try {
    const { customerId, amount, billingMonth, billingYear, method, notes } = req.body;

    // Find customer
    const customer = await Customer.findOne({ customerId });
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    // Generate receipt number
    const count = await Payment.countDocuments();
    const receiptNumber = `RCP-${String(count + 1).padStart(5, '0')}`;

    const payment = new Payment({
      receiptNumber,
      date: new Date(),
      customerId: customer.customerId,
      customerName: customer.name,
      amount,
      billingMonth,
      billingYear: billingYear || new Date().getFullYear(),
      method,
      receivedBy: req.userId,
      notes
    });
    await payment.save();

    // Update customer payment status
    if (customer.paymentStatus === 'Unpaid' || customer.paymentStatus === 'FREE') {
      customer.paymentStatus = 'Paid';
    }

    // Add to payment history
    if (!customer.paymentHistory) customer.paymentHistory = [];
    customer.paymentHistory.push({
      month: billingMonth,
      amount: amount,
      paidDate: new Date(),
      method: method,
      receiptNo: receiptNumber
    });

    await customer.save();

    await ActivityLog.create({
      user: req.userId,
      action: 'Payment Received',
      details: `Payment of PKR ${amount} from ${customer.name} (${customer.customerId}) - Receipt: ${receiptNumber}`,
      module: 'Payments'
    });

    res.status(201).json({
      success: true,
      message: 'Payment recorded successfully',
      data: payment
    });
  } catch (error) {
    console.error('Create payment error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get payment summary
// @route   GET /api/payments/summary
// @access  Private
exports.getPaymentSummary = async (req, res) => {
  try {
    const payments = await Payment.find();
    const customers = await Customer.find();

    const totalCollected = payments.reduce((sum, p) => sum + p.amount, 0);
    
    const today = new Date();
    const thisMonth = payments.filter(p => {
      const d = new Date(p.date);
      return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    });
    const monthlyCollection = thisMonth.reduce((sum, p) => sum + p.amount, 0);

    const thisYear = payments.filter(p => {
      const d = new Date(p.date);
      return d.getFullYear() === today.getFullYear();
    });
    const yearlyCollection = thisYear.reduce((sum, p) => sum + p.amount, 0);

    const pendingCollection = customers
      .filter(c => c.paymentStatus === 'Unpaid')
      .reduce((sum, c) => sum + c.monthlyFee, 0);

    res.json({
      success: true,
      data: {
        totalCollected,
        monthlyCollection,
        yearlyCollection,
        pendingCollection,
        totalTransactions: payments.length,
        monthlyTransactions: thisMonth.length
      }
    });
  } catch (error) {
    console.error('Get payment summary error:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update payment
// @route   PUT /api/payments/:id
// @access  Private
exports.updatePayment = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    const oldAmount = payment.amount;
    const oldMonth = payment.billingMonth;

    const updatedPayment = await Payment.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );

    // If amount or month changed, update customer's payment history
    if (req.body.amount && req.body.amount !== oldAmount) {
      const customer = await Customer.findOne({ customerId: payment.customerId });
      if (customer && customer.paymentHistory) {
        const historyEntry = customer.paymentHistory.find(h => 
          h.month === payment.billingMonth && h.amount === oldAmount
        );
        if (historyEntry) {
          historyEntry.amount = req.body.amount;
          await customer.save();
        }
      }
    }

    await ActivityLog.create({
      user: req.userId,
      action: 'Payment Updated',
      details: `Updated payment ${payment.receiptNumber} - Old: PKR ${oldAmount}, New: PKR ${req.body.amount || oldAmount}`,
      module: 'Payments'
    });

    res.json({
      success: true,
      message: 'Payment updated successfully',
      data: updatedPayment
    });
  } catch (error) {
    console.error('Update payment error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete payment
// @route   DELETE /api/payments/:id
// @access  Private
exports.deletePayment = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    // Remove from customer's payment history
    const customer = await Customer.findOne({ customerId: payment.customerId });
    if (customer && customer.paymentHistory) {
      customer.paymentHistory = customer.paymentHistory.filter(h => 
        !(h.month === payment.billingMonth && h.amount === payment.amount && h.receiptNo === payment.receiptNumber)
      );
      await customer.save();
    }

    await payment.deleteOne();

    await ActivityLog.create({
      user: req.userId,
      action: 'Payment Deleted',
      details: `Deleted payment ${payment.receiptNumber} - PKR ${payment.amount} from ${payment.customerName}`,
      module: 'Payments'
    });

    res.json({
      success: true,
      message: 'Payment deleted successfully'
    });
  } catch (error) {
    console.error('Delete payment error:', error);
    res.status(500).json({ message: error.message });
  }
};