const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const { listerLieux, creerLieu, modifierLieu, stockParLieu } = require('../controllers/lieuController');
const { creerReception, listerReceptions } = require('../controllers/receptionController');
const { creerTransfert, listerTransferts } = require('../controllers/transfertController');
const { previsualiserImport, confirmerImport } = require('../controllers/importStockController');
const { exporterFeuilleComptage, previsualiserInventaire, confirmerInventaire } = require('../controllers/inventaireController');
const { listerMouvements } = require('../controllers/mouvementController');
const { requireAuth, requireRole, requireModule } = require('../middleware/auth');

router.get('/lieux', requireAuth, listerLieux);
router.post('/lieux', requireAuth, requireRole('ADMIN'), creerLieu);
router.put('/lieux/:id', requireAuth, requireRole('ADMIN'), modifierLieu);
router.get('/lieux/:id/stock', requireAuth, stockParLieu);
router.get('/receptions', requireAuth, listerReceptions);
router.post('/receptions', requireAuth, requireModule('STOCK'), creerReception);
router.get('/transferts', requireAuth, listerTransferts);
router.post('/transferts', requireAuth, requireModule('STOCK'), creerTransfert);
router.get('/mouvements', requireAuth, listerMouvements);
router.post('/import/previsualiser', requireAuth, requireModule('STOCK'), upload.single('fichier'), previsualiserImport);
router.post('/import/confirmer', requireAuth, requireModule('STOCK'), confirmerImport);
router.get('/inventaire/export', requireAuth, exporterFeuilleComptage);
router.post('/inventaire/apercu', requireAuth, upload.single('fichier'), previsualiserInventaire);
router.post('/inventaire/confirmer', requireAuth, requireModule('STOCK'), confirmerInventaire);

module.exports = router;