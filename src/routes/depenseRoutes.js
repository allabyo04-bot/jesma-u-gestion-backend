const express = require('express');
const router = express.Router();
const {
  listerDepenses, creerDepense, listerCategories, syntheseBudget,
} = require('../controllers/depenseController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/categories', requireAuth, listerCategories);
router.get('/budget', requireAuth, requireRole('ADMIN'), syntheseBudget);
router.get('/', requireAuth, listerDepenses);
router.post('/', requireAuth, creerDepense);

module.exports = router;
