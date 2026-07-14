const express = require('express');
const router = express.Router();
const { margeParProduit, recapBoutique, meilleurVendeur, exporterMargeCsv } = require('../controllers/etatController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/marge-produits', requireAuth, requireRole('ADMIN'), margeParProduit);
router.get('/marge-produits/export.csv', requireAuth, requireRole('ADMIN'), exporterMargeCsv);
router.get('/recap-boutique', requireAuth, requireRole('ADMIN'), recapBoutique);
router.get('/meilleur-vendeur', requireAuth, requireRole('ADMIN'), meilleurVendeur);

module.exports = router;