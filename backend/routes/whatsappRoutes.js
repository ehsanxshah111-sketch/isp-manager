const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { sendWhatsAppReminder, sendBulkWhatsApp } = require('../controllers/whatsappController');

router.post('/send', auth, sendWhatsAppReminder);
router.post('/bulk', auth, sendBulkWhatsApp);

router.get('/:phone', (req, res) => {
  try {
    const { phone } = req.params;
    res.json({ whatsappUrl: `https://wa.me/${phone}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
