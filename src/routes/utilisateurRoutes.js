const express = require('express');
const router = express.Router();
const {
  listerUtilisateurs, creerUtilisateur, modifierUtilisateur, reinitialiserPin,
} = require('../controllers/utilisateurController');
const { requireAuth, requireRole, requireModule } = require('../middleware/auth');

router.get('/', requireAuth, requireModule('UTILISATEURS'), listerUtilisateurs);
router.post('/', requireAuth, requireModule('UTILISATEURS'), creerUtilisateur);
router.put('/:id', requireAuth, requireModule('UTILISATEURS'), modifierUtilisateur);
router.post('/:id/reinitialiser-pin', requireAuth, requireModule('UTILISATEURS'), reinitialiserPin);

module.exports = router;