const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');

// POST /api/auth/login  { nomUtilisateur, pin }
async function login(req, res) {
  const { nomUtilisateur, pin } = req.body;

  if (!nomUtilisateur || !pin) {
    return res.status(400).json({ error: "Nom d'utilisateur et PIN requis." });
  }

  const utilisateur = await prisma.utilisateur.findUnique({
    where: { nomUtilisateur },
  });

  if (!utilisateur || !utilisateur.actif) {
    return res.status(401).json({ error: 'Identifiants invalides.' });
  }

  const pinValide = await bcrypt.compare(pin, utilisateur.pin);
  if (!pinValide) {
    return res.status(401).json({ error: 'Identifiants invalides.' });
  }

  const token = jwt.sign(
    { id: utilisateur.id, nomUtilisateur: utilisateur.nomUtilisateur, role: utilisateur.role },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );

  return res.json({
    token,
    utilisateur: {
      id: utilisateur.id,
      nomUtilisateur: utilisateur.nomUtilisateur,
      nomComplet: utilisateur.nomComplet,
      role: utilisateur.role,
    },
  });
}

// GET /api/auth/me
async function me(req, res) {
  const utilisateur = await prisma.utilisateur.findUnique({
    where: { id: req.user.id },
    select: { id: true, nomUtilisateur: true, nomComplet: true, role: true, actif: true },
  });
  return res.json(utilisateur);
}

module.exports = { login, me };
