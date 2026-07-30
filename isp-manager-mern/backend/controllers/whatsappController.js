const Customer = require('../models/Customer');
const ActivityLog = require('../models/ActivityLog');

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

    const defaultMessage = `Dear ${customer.name},\n\nYour ISP bill of PKR ${customer.monthlyFee} is due.\nPlease pay at your earliest convenience.\n\nThank you for choosing ISP Muhammad Shah.`;
    
    const finalMessage = message || defaultMessage;
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
    const customers = await Customer.find({
      paymentStatus: 'Unpaid',
      phone: { $ne: '', $exists: true }
    });

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

      const message = `Dear ${c.name},\n\nYour ISP bill of PKR ${c.monthlyFee} is due.\nPlease pay at your earliest convenience.\n\nThank you for choosing ISP Muhammad Shah.`;
      
      return {
        name: c.name,
        customerId: c.customerId,
        phone: c.phone,
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