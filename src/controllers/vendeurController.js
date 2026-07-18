const prisma = require('../lib/prisma');

// GET /api/vendeurs   (actifs uniquement — utilisé par la Caisse)
async function listerVendeurs(req, res) {
  const vendeurs = await prisma.vendeur.findMany({
    where: { actif: true },
    orderBy: { nomComplet: 'asc' },
  });
  res.json(vendeurs);
}

// GET /api/vendeurs/tous   (ADMIN — actifs + désactivés, pour l'écran de gestion)
async function listerTousVendeurs(req, res) {
  const vendeurs = await prisma.vendeur.findMany({
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

// PUT /api/vendeurs/:id   { nomComplet?, telephone?, actif? }
async function modifierVendeur(req, res) {
  const id = Number(req.params.id);
  const { nomComplet, telephone, actif } = req.body;

  const donnees = {};
  if (nomComplet !== undefined) donnees.nomComplet = nomComplet;
  if (telephone !== undefined) donnees.telephone = telephone || null;
  if (actif !== undefined) donnees.actif = actif;

  const vendeur = await prisma.vendeur.update({
    where: { id },
    data: donnees,
  });
  res.json(vendeur);
}

module.exports = { listerVendeurs, listerTousVendeurs, creerVendeur, modifierVendeur };