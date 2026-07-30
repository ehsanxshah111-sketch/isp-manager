const express = require('express');
const router = express.Router();
const { 
  getPayments, 
  createPayment, 
  getPaymentSummary,
  updatePayment,
  deletePayment
} = require('../controllers/paymentController');
const auth = require('../middleware/auth');

router.use(auth);

router.get('/', getPayments);
router.get('/summary', getPaymentSummary);
router.post('/', createPayment);
router.put('/:id', updatePayment);
router.delete('/:id', deletePayment);

module.exports = router;