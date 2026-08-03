const Customer = require('../models/Customer');
const ActivityLog = require('../models/ActivityLog');
const Payment = require('../models/Payment');

// @desc    Get all customers sorted by day number (1 to 31)
// @route   GET /api/customers
// @access  Private
exports.getCustomers = async (req, res) => {
  try {
    const { status, paymentStatus, search, limit = 1000, page = 1 } = req.query;
    
    let query = {};
    if (status) query.status = status;
    if (paymentStatus) query.paymentStatus = paymentStatus;
    if (search) {
      query.$text = { $search: search };
    }

    const skip = (page - 1) * limit;

    // ===== SORT BY DAY NUMBER (1, 2, 3, ...) =====
    const customers = await Customer.find(query)
      .populate('createdBy', 'username')
      .sort({ dayNumber: 1 })  // 1 = ascending (1, 2, 3, ...)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Customer.countDocuments(query);

    res.json({
      success: true,
      data: customers,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get single customer
// @route   GET /api/customers/:id
// @access  Private
exports.getCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id)
      .populate('createdBy', 'username');
    
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    res.json({ success: true, data: customer });
  } catch (error) {
    console.error('Get customer error:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get customer by customerId
// @route   GET /api/customers/id/:customerId
// @access  Private
exports.getCustomerById = async (req, res) => {
  try {
    const customer = await Customer.findOne({ customerId: req.params.customerId })
      .populate('createdBy', 'username');
    
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    res.json({ success: true, data: customer });
  } catch (error) {
    console.error('Get customer by ID error:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create customer
// @route   POST /api/customers
// @access  Private
exports.createCustomer = async (req, res) => {
  try {
    const { customerId } = req.body;

    const existingCustomer = await Customer.findOne({ customerId });
    if (existingCustomer) {
      return res.status(400).json({ message: 'Customer ID already exists' });
    }

    const customer = new Customer({
      ...req.body,
      createdBy: req.userId
    });
    await customer.save();

    await ActivityLog.create({
      user: req.userId,
      action: 'Customer Added',
      details: `Added customer: ${customer.name} (${customer.customerId})`,
      module: 'Customers'
    });

    res.status(201).json({
      success: true,
      message: 'Customer created successfully',
      data: customer
    });
  } catch (error) {
    console.error('Create customer error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update customer
// @route   PUT /api/customers/:id
// @access  Private
exports.updateCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    if (req.body.customerId && req.body.customerId !== customer.customerId) {
      const existing = await Customer.findOne({ customerId: req.body.customerId });
      if (existing) {
        return res.status(400).json({ message: 'Customer ID already exists' });
      }
    }

    // If pendingDues is being LOWERED, that difference is money the customer
    // just paid off - record it as a real Payment so it counts toward
    // collected revenue, instead of just disappearing from the dues total.
    // Never triggers when dues go UP, and only ever for the amount actually
    // cleared.
    const oldPendingDues = customer.pendingDues || 0;
    let duesClearedAmount = 0;
    if ('pendingDues' in req.body) {
      const newPendingDues = parseFloat(req.body.pendingDues) || 0;
      if (newPendingDues < oldPendingDues) {
        duesClearedAmount = oldPendingDues - newPendingDues;
      }
    }

    const updatedCustomer = await Customer.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );

    await ActivityLog.create({
      user: req.userId,
      action: 'Customer Updated',
      details: `Updated customer: ${updatedCustomer.name} (${updatedCustomer.customerId})`,
      module: 'Customers'
    });

    let duesPayment = null;
    if (duesClearedAmount > 0) {
      const receiptNumber = `RCPT-DUES-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      duesPayment = await Payment.create({
        receiptNumber,
        customerId: updatedCustomer.customerId,
        customerName: updatedCustomer.name,
        amount: duesClearedAmount,
        billingMonth: 'Pending Dues Cleared',
        method: req.body.duesPaymentMethod || 'Cash',
        notes: `Auto-recorded: pending dues reduced from PKR ${oldPendingDues} to PKR ${updatedCustomer.pendingDues || 0}`
      });

      await ActivityLog.create({
        user: req.userId,
        action: 'Pending Dues Cleared',
        details: `PKR ${duesClearedAmount} of pending dues cleared for ${updatedCustomer.name} (${updatedCustomer.customerId}) - added to collected amount, removed from pending dues`,
        module: 'Customers'
      });
    }

    res.json({
      success: true,
      message: 'Customer updated successfully',
      data: updatedCustomer,
      duesPayment
    });
  } catch (error) {
    console.error('Update customer error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete customer
// @route   DELETE /api/customers/:id
// @access  Private
exports.deleteCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    await customer.deleteOne();

    await ActivityLog.create({
      user: req.userId,
      action: 'Customer Deleted',
      details: `Deleted customer: ${customer.name} (${customer.customerId})`,
      module: 'Customers'
    });

    res.json({
      success: true,
      message: 'Customer deleted successfully'
    });
  } catch (error) {
    console.error('Delete customer error:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Bulk import customers
// @route   POST /api/customers/bulk
// @access  Private
exports.bulkImportCustomers = async (req, res) => {
  try {
    const customers = req.body.map(c => ({
      ...c,
      createdBy: req.userId
    }));
    
    const result = await Customer.insertMany(customers, { ordered: false });
    
    await ActivityLog.create({
      user: req.userId,
      action: 'Bulk Import',
      details: `Imported ${result.length} customers`,
      module: 'Customers'
    });

    res.status(201).json({
      success: true,
      message: `Imported ${result.length} customers`,
      count: result.length
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
      imported: error.insertedDocs?.length || 0
    });
  }
};

// @desc    Update customer status
// @route   PATCH /api/customers/:id/status
// @access  Private
exports.updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    const oldStatus = customer.status;
    customer.status = status;
    await customer.save();

    await ActivityLog.create({
      user: req.userId,
      action: 'Status Updated',
      details: `Changed status for ${customer.name}: ${oldStatus} → ${status}`,
      module: 'Customers'
    });

    res.json({
      success: true,
      message: 'Status updated successfully',
      data: customer
    });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update payment status
// @route   PATCH /api/customers/:id/payment-status
// @access  Private
exports.updatePaymentStatus = async (req, res) => {
  try {
    const { paymentStatus } = req.body;
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    const oldStatus = customer.paymentStatus;
    customer.paymentStatus = paymentStatus;
    await customer.save();

    await ActivityLog.create({
      user: req.userId,
      action: 'Payment Status Updated',
      details: `Changed payment status for ${customer.name}: ${oldStatus} → ${paymentStatus}`,
      module: 'Customers'
    });

    res.json({
      success: true,
      message: 'Payment status updated successfully',
      data: customer
    });
  } catch (error) {
    console.error('Update payment status error:', error);
    res.status(500).json({ message: error.message });
  }
};