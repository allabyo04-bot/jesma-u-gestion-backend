const express = require('express');
const router = express.Router();
const {
  margeParProduit, recapBoutique, meilleurVendeur,
  parDate, parModePaiement, parType, fermetureCaisse,
  exporterMargeCsv,
} = require('../controllers/etatController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/marge-produits', requireAuth, requireRole('ADMIN'), margeParProduit);
router.get('/marge-produits/export.csv', requireAuth, requireRole('ADMIN'), exporterMargeCsv);
router.get('/recap-boutique', requireAuth, requireRole('ADMIN'), recapBoutique);
router.get('/meilleur-vendeur', requireAuth, requireRole('ADMIN'), meilleurVendeur);
router.get('/par-date', requireAuth, requireRole('ADMIN'), parDate);
router.get('/par-mode-paiement', requireAuth, requireRole('ADMIN'), parModePaiement);
router.get('/par-type', requireAuth, requireRole('ADMIN'), parType);
router.get('/fermeture-caisse', requireAuth, requireRole('ADMIN'), fermetureCaisse);

module.exports = router;