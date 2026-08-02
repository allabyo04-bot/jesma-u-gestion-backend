const express = require('express');
const router = express.Router();
const {
  creerProForma, listerProFormas, obtenirProForma, annulerProForma, imprimerProForma,
} = require('../controllers/proFormaController');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, listerProFormas);
router.post('/', requireAuth, creerProForma);
router.get('/:numero', requireAuth, obtenirProForma);
router.get('/:numero/imprimer', requireAuth, imprimerProForma);
router.post('/:id/annuler', requireAuth, annulerProForma);

module.exports = router;
