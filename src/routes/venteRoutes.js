const express = require('express');
const router = express.Router();
const {
  creerVente, annulerVente, listerVentes,
  demanderAnnulation, listerDemandesAnnulation, rejeterAnnulation,
  listerVentesEnAttente, creerVenteEnAttente, supprimerVenteEnAttente,
} = require('../controllers/venteController');
const { requireAuth, requireRole, requireModule } = require('../middleware/auth');

router.get('/', requireAuth, listerVentes);
router.get('/demandes-annulation', requireAuth, requireModule('VENTES'), listerDemandesAnnulation);
router.get('/en-attente', requireAuth, listerVentesEnAttente);
router.post('/en-attente', requireAuth, creerVenteEnAttente);
router.delete('/en-attente/:id', requireAuth, supprimerVenteEnAttente);
router.post('/', requireAuth, creerVente);
router.post('/:id/demander-annulation', requireAuth, demanderAnnulation);
router.post('/:id/rejeter-annulation', requireAuth, requireModule('VENTES'), rejeterAnnulation);
router.post('/:id/annuler', requireAuth, requireModule('VENTES'), annulerVente);

module.exports = router;