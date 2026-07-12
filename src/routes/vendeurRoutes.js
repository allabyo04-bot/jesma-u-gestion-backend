const express = require('express');
const router = express.Router();
const { listerVendeurs, creerVendeur } = require('../controllers/vendeurController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/', requireAuth, listerVendeurs);
router.post('/', requireAuth, requireRole('ADMIN'), creerVendeur);

module.exports = router;