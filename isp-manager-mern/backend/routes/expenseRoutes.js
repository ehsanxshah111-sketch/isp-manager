const express = require('express');
const router = express.Router();
const {
  getExpenses,
  createExpense,
  deleteExpense,
  getExpenseSummary
} = require('../controllers/expenseController');
const auth = require('../middleware/auth');

// All routes require authentication
router.use(auth);

// Expense routes
router.get('/', getExpenses);
router.get('/summary', getExpenseSummary);
router.post('/', createExpense);
router.delete('/:id', deleteExpense);

module.exports = router;