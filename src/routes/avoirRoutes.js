const express = require('express');
const router = express.Router();
const { listerAvoirs } = require('../controllers/retourController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/', requireAuth, requireRole('ADMIN', 'CAISSIER'), listerAvoirs);

module.exports = router;