const express = require('express');
const router = express.Router();
const { listerFamilles, creerFamille, creerSousFamille, modifierFamille, modifierSousFamille } = require('../controllers/familleController');
const { requireAuth, requireRole, requireModule } = require('../middleware/auth');

router.get('/', requireAuth, listerFamilles);
router.post('/', requireAuth, requireModule('ARTICLES'), creerFamille);
router.post('/:familleId/sous-familles', requireAuth, requireModule('ARTICLES'), creerSousFamille);
router.put('/:id', requireAuth, requireModule('ARTICLES'), modifierFamille);
router.put('/:familleId/sous-familles/:id', requireAuth, requireModule('ARTICLES'), modifierSousFamille);

module.exports = router;
