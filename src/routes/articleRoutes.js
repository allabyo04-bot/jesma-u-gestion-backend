const express = require('express');
const router = express.Router();
const {
  listerArticles, rechercherArticle, creerArticle, genererCodeBarre,
  listerCodesAImprimer, imprimerEtiquettes,
} = require('../controllers/articleController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/', requireAuth, listerArticles);
router.get('/recherche', requireAuth, rechercherArticle);
router.get('/a-imprimer', requireAuth, requireRole('ADMIN'), listerCodesAImprimer);
router.get('/a-imprimer/etiquettes', requireAuth, requireRole('ADMIN'), imprimerEtiquettes);
router.post('/', requireAuth, requireRole('ADMIN'), creerArticle);
router.post('/:id/generer-code-barre', requireAuth, requireRole('ADMIN'), genererCodeBarre);

module.exports = router;
