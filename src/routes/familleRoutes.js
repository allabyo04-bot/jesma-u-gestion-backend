const express = require('express');
const router = express.Router();
const { listerFamilles, creerFamille, creerSousFamille } = require('../controllers/familleController');
const { requireAuth, requireRole, requireModule } = require('../middleware/auth');

router.get('/', requireAuth, listerFamilles);
router.post('/', requireAuth, requireModule('ARTICLES'), creerFamille);
router.post('/:familleId/sous-familles', requireAuth, requireModule('ARTICLES'), creerSousFamille);

module.exports = router;
