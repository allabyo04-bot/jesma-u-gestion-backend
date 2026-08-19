const express = require('express');
const router = express.Router();
const {
  listerArticles, rechercherArticle, creerArticle, modifierArticle, genererCodeBarre,
  listerCodesAImprimer, imprimerEtiquettes, uploaderPhoto, supprimerPhoto, definirPhotoPrincipale, deplacerGroupe,
  corrigerStockArticle, stockParLieu,
} = require('../controllers/articleController');
const { requireAuth, requireRole, requireModule } = require('../middleware/auth');
const upload = require('../middleware/upload');

router.get('/', requireAuth, listerArticles);
router.get('/recherche', requireAuth, rechercherArticle);
router.get('/a-imprimer', requireAuth, requireModule('ARTICLES'), listerCodesAImprimer);
router.post('/a-imprimer/etiquettes', requireAuth, requireModule('ARTICLES'), imprimerEtiquettes);
router.post('/', requireAuth, requireModule('ARTICLES'), creerArticle);
router.put('/deplacer-groupe', requireAuth, requireModule('ARTICLES'), deplacerGroupe);
router.put('/:id', requireAuth, requireModule('ARTICLES'), modifierArticle);
router.post('/:id/generer-code-barre', requireAuth, requireModule('ARTICLES'), genererCodeBarre);
router.post('/:id/photo', requireAuth, requireModule('ARTICLES'), upload.single('photo'), uploaderPhoto);
router.delete('/:id/photos/:photoId', requireAuth, requireModule('ARTICLES'), supprimerPhoto);
router.put('/:id/photos/:photoId/principale', requireAuth, requireModule('ARTICLES'), definirPhotoPrincipale);
router.post('/:id/corriger-stock', requireAuth, requireModule('STOCK'), corrigerStockArticle);
router.get('/:id/stock-par-lieu', requireAuth, requireModule('STOCK'), stockParLieu);

module.exports = router;
