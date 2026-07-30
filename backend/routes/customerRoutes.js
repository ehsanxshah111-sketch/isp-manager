const express = require('express');
const router = express.Router();
const {
  getCustomers,
  getCustomer,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  bulkImportCustomers,
  updateStatus,
  updatePaymentStatus
} = require('../controllers/customerController');
const auth = require('../middleware/auth');

// All routes require authentication
router.use(auth);

// Customer routes
router.get('/', getCustomers);
router.get('/id/:customerId', getCustomerById);
router.get('/:id', getCustomer);
router.post('/', createCustomer);
router.post('/bulk', bulkImportCustomers);
router.put('/:id', updateCustomer);
router.patch('/:id/status', updateStatus);
router.patch('/:id/payment-status', updatePaymentStatus);
router.delete('/:id', deleteCustomer);

module.exports = router;
