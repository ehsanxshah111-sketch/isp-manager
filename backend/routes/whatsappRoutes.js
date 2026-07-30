const express = require('express');
const router = express.Router();

router.get('/:phone', (req, res) => {
  try {
    const { phone } = req.params;
    res.json({ whatsappUrl: `https://wa.me/${phone}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;