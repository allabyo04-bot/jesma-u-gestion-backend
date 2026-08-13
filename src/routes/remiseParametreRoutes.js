const express = require('express');
const router = express.Router();
const {
  obtenirSeuilRemise, definirSeuilRemise, genererCodeDeblocage, listerCodesDeblocage,
} = require('../controllers/remiseParametreController');
const { requireAuth, requireRole, requireModule } = require('../middleware/auth');

router.get('/parametre', requireAuth, requireModule('VENTES'), obtenirSeuilRemise);
router.put('/parametre', requireAuth, requireRole('ADMIN'), definirSeuilRemise);
router.post('/codes-deblocage', requireAuth, requireRole('ADMIN'), genererCodeDeblocage);
router.get('/codes-deblocage', requireAuth, requireRole('ADMIN'), listerCodesDeblocage);

module.exports = router;
