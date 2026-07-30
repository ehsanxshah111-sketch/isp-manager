const express = require('express');
const router = express.Router();
const { sendWhatsAppReminder, sendBulkWhatsApp } = require('../controllers/whatsappController');
const auth = require('../middleware/auth');

router.use(auth);

router.post('/send', sendWhatsAppReminder);
router.post('/bulk', sendBulkWhatsApp);

module.exports = router;