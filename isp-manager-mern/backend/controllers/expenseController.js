const Expense = require('../models/Expense');
const ActivityLog = require('../models/ActivityLog');

// @desc    Get all expenses
// @route   GET /api/expenses
// @access  Private
exports.getExpenses = async (req, res) => {
  try {
    const { category, startDate, endDate, limit = 100 } = req.query;
    
    let query = {};
    if (category) query.category = category;
    if (startDate && endDate) {
      query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    const expenses = await Expense.find(query)
      .populate('createdBy', 'username')
      .sort({ date: -1 })
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: expenses,
      count: expenses.length
    });
  } catch (error) {
    console.error('Get expenses error:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create expense
// @route   POST /api/expenses
// @access  Private
exports.createExpense = async (req, res) => {
  try {
    const expense = new Expense({
      ...req.body,
      createdBy: req.userId
    });
    await expense.save();

    await ActivityLog.create({
      user: req.userId,
      action: 'Expense Added',
      details: `Expense: ${expense.title} - PKR ${expense.amount}`,
      module: 'Expenses'
    });

    res.status(201).json({
      success: true,
      message: 'Expense added successfully',
      data: expense
    });
  } catch (error) {
    console.error('Create expense error:', error);
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete expense
// @route   DELETE /api/expenses/:id
// @access  Private
exports.deleteExpense = async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id);
    if (!expense) {
      return res.status(404).json({ message: 'Expense not found' });
    }

    await expense.deleteOne();

    await ActivityLog.create({
      user: req.userId,
      action: 'Expense Deleted',
      details: `Deleted expense: ${expense.title} - PKR ${expense.amount}`,
      module: 'Expenses'
    });

    res.json({
      success: true,
      message: 'Expense deleted successfully'
    });
  } catch (error) {
    console.error('Delete expense error:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get expense summary
// @route   GET /api/expenses/summary
// @access  Private
exports.getExpenseSummary = async (req, res) => {
  try {
    const expenses = await Expense.find();
    
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    
    const today = new Date();
    const thisMonth = expenses.filter(e => {
      const d = new Date(e.date);
      return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    });
    const monthlyExpenses = thisMonth.reduce((sum, e) => sum + e.amount, 0);

    // Category breakdown
    const categories = {};
    expenses.forEach(e => {
      categories[e.category] = (categories[e.category] || 0) + e.amount;
    });

    res.json({
      success: true,
      data: {
        totalExpenses,
        monthlyExpenses,
        categories,
        totalTransactions: expenses.length
      }
    });
  } catch (error) {
    console.error('Get expense summary error:', error);
    res.status(500).json({ message: error.message });
  }
};