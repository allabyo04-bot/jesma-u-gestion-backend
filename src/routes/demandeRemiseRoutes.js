const express = require('express');
const router = express.Router();
const {
  listerDemandesRemise, approuverDemandeRemise, refuserDemandeRemise,
} = require('../controllers/demandeRemiseController');
const { requireAuth, requireRole, requireModule } = require('../middleware/auth');

router.get('/', requireAuth, requireModule('VENTES'), listerDemandesRemise);
router.post('/:id/approuver', requireAuth, requireModule('VENTES'), approuverDemandeRemise);
router.post('/:id/refuser', requireAuth, requireModule('VENTES'), refuserDemandeRemise);

module.exports = router;
