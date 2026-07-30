const Customer = require('../models/Customer');
const Expense = require('../models/Expense');
const Payment = require('../models/Payment');

exports.getDashboardStats = async (req, res) => {
  try {
    const customers = await Customer.find();
    const expenses = await Expense.find();
    const payments = await Payment.find();

    // ===== CUSTOMER STATS =====
    const totalCustomers = customers.length;
    const active = customers.filter(c => c.status === 'Active').length;
    const cutOff = customers.filter(c => c.status === 'Cut Off').length;
    const disable = customers.filter(c => c.status === 'Disable').length;

    // ===== PAYMENT STATS =====
    const paid = customers.filter(c => c.paymentStatus === 'Paid' || c.paymentStatus === '1 YEAR ADVANCED').length;
    const unpaid = customers.filter(c => c.paymentStatus === 'Unpaid').length;
    const free = customers.filter(c => c.paymentStatus === 'FREE').length;

    // ===== REVENUE STATS =====
    const totalRevenue = customers.reduce((sum, c) => sum + c.monthlyFee, 0);
    const totalDues = customers.reduce((sum, c) => sum + (c.pendingDues || 0), 0);
    const collected = customers
      .filter(c => c.paymentStatus === 'Paid' || c.paymentStatus === '1 YEAR ADVANCED')
      .reduce((sum, c) => sum + c.monthlyFee, 0);
    const pendingCollection = customers
      .filter(c => c.paymentStatus === 'Unpaid')
      .reduce((sum, c) => sum + c.monthlyFee, 0);

    // ===== EXPENSE STATS =====
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const netProfit = totalRevenue - totalExpenses;
    const totalCollected = payments.reduce((sum, p) => sum + p.amount, 0);

    // ===== DAILY DATA FOR CHARTS (Group by Day Number) =====
    const days = Array.from({ length: 31 }, (_, i) => i + 1);
    
    const dailyData = days.map(day => {
      const dayCustomers = customers.filter(c => {
        if (!c.connectionDate) return false;
        const dayNum = parseFloat(c.connectionDate);
        return dayNum === day;
      });
      
      return {
        day: day,
        count: dayCustomers.length,
        revenue: dayCustomers.reduce((sum, c) => sum + c.monthlyFee, 0)
      };
    });

    // ===== RECENT CUSTOMERS =====
    const recentCustomers = customers
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10);

    res.json({
      success: true,
      data: {
        stats: {
          totalCustomers,
          active,
          cutOff,
          disable,
          paid,
          unpaid,
          free,
          totalRevenue,
          totalDues,
          collected,
          pendingCollection,
          totalExpenses,
          netProfit,
          totalCollected
        },
        dailyData: dailyData,
        recentCustomers
      }
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ message: error.message });
  }
};