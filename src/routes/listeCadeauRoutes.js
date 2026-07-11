const express = require('express');
const router = express.Router();
const {
  creerListeCadeau, listerListesCadeaux, consulterListePublique, offrirDepuisWeb, offrirParTelephone,
} = require('../controllers/listeCadeauController');
const { requireAuth } = require('../middleware/auth');

// Routes internes (personnel en boutique)
router.get('/', requireAuth, listerListesCadeaux);
router.post('/', requireAuth, creerListeCadeau);
router.post('/:codeAcces/offrir-telephone', requireAuth, offrirParTelephone);

// Routes publiques (accessibles via le lien partagé, sans compte)
router.get('/publique/:codeAcces', consulterListePublique);
router.post('/publique/:codeAcces/offrir', offrirDepuisWeb);

module.exports = router;
