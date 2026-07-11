const express = require('express');
const router = express.Router();
const { listerClients, creerClient, obtenirClient } = require('../controllers/clientController');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, listerClients);
router.post('/', requireAuth, creerClient);
router.get('/:id', requireAuth, obtenirClient);

module.exports = router;
