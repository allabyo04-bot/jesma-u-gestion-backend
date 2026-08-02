const express = require('express');
const router = express.Router();
const {
  creerVente, annulerVente, listerVentes,
  demanderAnnulation, listerDemandesAnnulation, rejeterAnnulation,
  listerVentesEnAttente, creerVenteEnAttente, supprimerVenteEnAttente,
} = require('../controllers/venteController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/', requireAuth, listerVentes);
router.get('/demandes-annulation', requireAuth, requireRole('ADMIN'), listerDemandesAnnulation);
router.get('/en-attente', requireAuth, listerVentesEnAttente);
router.post('/en-attente', requireAuth, creerVenteEnAttente);
router.delete('/en-attente/:id', requireAuth, supprimerVenteEnAttente);
router.post('/', requireAuth, creerVente);
router.post('/:id/demander-annulation', requireAuth, demanderAnnulation);
router.post('/:id/rejeter-annulation', requireAuth, requireRole('ADMIN'), rejeterAnnulation);
router.post('/:id/annuler', requireAuth, requireRole('ADMIN'), annulerVente);

module.exports = router;