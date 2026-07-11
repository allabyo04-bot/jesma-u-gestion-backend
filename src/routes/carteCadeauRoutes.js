const express = require('express');
const router = express.Router();
const {
  listerDenominations, creerDenomination, obtenirCarteCadeau, activerCarteCadeau, listerCartesCadeaux,
} = require('../controllers/carteCadeauController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/denominations', requireAuth, listerDenominations);
router.post('/denominations', requireAuth, requireRole('ADMIN'), creerDenomination);
router.get('/', requireAuth, listerCartesCadeaux);
router.get('/:codeBarre', requireAuth, obtenirCarteCadeau);
router.post('/activer', requireAuth, activerCarteCadeau);

module.exports = router;
