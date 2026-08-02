const express = require('express');
const router = express.Router();
const {
  listerDepenses, creerDepense, listerCategories, creerCategorie, modifierCategorie, supprimerCategorie, syntheseBudget,
} = require('../controllers/depenseController');
const { requireAuth, requireRole, requireModule } = require('../middleware/auth');

router.get('/categories', requireAuth, listerCategories);
router.post('/categories', requireAuth, requireRole('ADMIN'), creerCategorie);
router.put('/categories/:id', requireAuth, requireRole('ADMIN'), modifierCategorie);
router.delete('/categories/:id', requireAuth, requireRole('ADMIN'), supprimerCategorie);
router.get('/budget', requireAuth, requireModule('DEPENSES'), syntheseBudget);
router.get('/', requireAuth, listerDepenses);
router.post('/', requireAuth, creerDepense);

module.exports = router;