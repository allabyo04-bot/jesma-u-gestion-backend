const express = require('express');
const router = express.Router();
const { creerVente, annulerVente, listerVentes } = require('../controllers/venteController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/', requireAuth, listerVentes);
router.post('/', requireAuth, creerVente);
router.post('/:id/annuler', requireAuth, requireRole('ADMIN'), annulerVente);

module.exports = router;
