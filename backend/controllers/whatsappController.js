const Customer = require('../models/Customer');
const ActivityLog = require('../models/ActivityLog');

// Shared WhatsApp reminder text for both single-send and bulk-send, so the
// wording never drifts between the two. Pending dues are only mentioned
// when there actually are some, to avoid a confusing "Pending dues: PKR 0"
// line on a customer who is already fully caught up.
const buildReminderMessage = (c) => {
  const duesLine = c.pendingDues > 0 ? ` You also have pending dues of PKR ${c.pendingDues}.` : '';
  return `Dear ${c.name}, this is a reminder that your internet bill of PKR ${c.monthlyFee} is due.${duesLine} Please clear it at your earliest convenience. Thank you.`;
};

// @desc    Send WhatsApp reminder to single customer
// @route   POST /api/whatsapp/send
// @access  Private
exports.sendWhatsAppReminder = async (req, res) => {
  try {
    const { customerId, message } = req.body;

    const customer = await Customer.findOne({ customerId });
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    if (!customer.phone || customer.phone.trim() === '') {
      return res.status(400).json({ 
        message: 'No phone number found for this customer' 
      });
    }

    let phone = customer.phone.replace(/[\s\-\(\)]/g, '');
    if (phone.startsWith('0')) {
      phone = '92' + phone.substring(1);
    }
    if (!phone.startsWith('92') && !phone.startsWith('+')) {
      phone = '92' + phone;
    }
    phone = phone.replace(/\D/g, '');

    const finalMessage = message || buildReminderMessage(customer);
    const encodedMessage = encodeURIComponent(finalMessage);
    const whatsappUrl = `https://wa.me/${phone}?text=${encodedMessage}`;

    await ActivityLog.create({
      user: req.userId,
      action: 'WhatsApp Reminder',
      details: `WhatsApp reminder sent to ${customer.name} (${customer.customerId})`,
      module: 'Customers'
    });

    res.json({
      success: true,
      message: 'WhatsApp reminder sent successfully!',
      data: {
        customer: customer.name,
        phone: customer.phone,
        whatsappUrl: whatsappUrl
      }
    });

  } catch (error) {
    console.error('WhatsApp error:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Send bulk WhatsApp reminders to unpaid customers
// @route   POST /api/whatsapp/bulk
// @access  Private
exports.sendBulkWhatsApp = async (req, res) => {
  try {
    // By default this targets every Unpaid customer with a phone number.
    // If specific customers were selected in the "Bulk WhatsApp" modal,
    // customerIds narrows it down (still only ever Unpaid customers, as a
    // safety net).
    const { customerIds } = req.body || {};
    const query = { paymentStatus: 'Unpaid', phone: { $ne: '', $exists: true } };
    if (Array.isArray(customerIds) && customerIds.length > 0) {
      query.customerId = { $in: customerIds };
    }

    const customers = await Customer.find(query);

    if (customers.length === 0) {
      return res.json({
        success: true,
        message: 'No unpaid customers with phone numbers found',
        count: 0
      });
    }

    const results = customers.map(c => {
      let phone = c.phone.replace(/[\s\-\(\)]/g, '');
      if (phone.startsWith('0')) {
        phone = '92' + phone.substring(1);
      }
      if (!phone.startsWith('92') && !phone.startsWith('+')) {
        phone = '92' + phone;
      }
      phone = phone.replace(/\D/g, '');

      const message = buildReminderMessage(c);

      return {
        name: c.name,
        customerId: c.customerId,
        phone: c.phone,
        monthlyFee: c.monthlyFee,
        pendingDues: c.pendingDues || 0,
        whatsappUrl: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
      };
    });

    await ActivityLog.create({
      user: req.userId,
      action: 'Bulk WhatsApp Reminder',
      details: `Bulk WhatsApp reminders sent to ${results.length} customers`,
      module: 'Customers'
    });

    res.json({
      success: true,
      message: `WhatsApp links generated for ${results.length} customers`,
      count: results.length,
      data: results
    });

  } catch (error) {
    console.error('Bulk WhatsApp error:', error);
    res.status(500).json({ message: error.message });
  }
};