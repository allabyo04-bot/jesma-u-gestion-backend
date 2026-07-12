const prisma = require('../lib/prisma');

// GET /api/vendeurs
async function listerVendeurs(req, res) {
  const vendeurs = await prisma.vendeur.findMany({
    where: { actif: true },
    orderBy: { nomComplet: 'asc' },
  });
  res.json(vendeurs);
}

// POST /api/vendeurs   { nomComplet, telephone? }
async function creerVendeur(req, res) {
  const { nomComplet, telephone } = req.body;
  if (!nomComplet) return res.status(400).json({ error: 'Nom complet requis.' });
  const vendeur = await prisma.vendeur.create({
    data: { nomComplet, telephone: telephone || null },
  });
  res.status(201).json(vendeur);
}

module.exports = { listerVendeurs, creerVendeur };