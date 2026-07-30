const express = require('express');
const router = express.Router();
const { getDashboardStats } = require('../controllers/dashboardController');
const auth = require('../middleware/auth');

// All routes require authentication
router.use(auth);

// Dashboard route
router.get('/', getDashboardStats);

module.exports = router;