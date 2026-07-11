const prisma = require('../lib/prisma');

// GET /api/lieux
async function listerLieux(req, res) {
  const lieux = await prisma.lieu.findMany({ where: { actif: true }, orderBy: { nom: 'asc' } });
  res.json(lieux);
}

// POST /api/lieux  { nom, type }  -- type: ENTREPOT | BOUTIQUE
async function creerLieu(req, res) {
  const { nom, type } = req.body;
  if (!nom || !type) return res.status(400).json({ error: 'Nom et type du lieu requis.' });
  const lieu = await prisma.lieu.create({ data: { nom, type } });
  res.status(201).json(lieu);
}

// GET /api/lieux/:id/stock  -> stock détaillé par article pour ce lieu
async function stockParLieu(req, res) {
  const lieuId = Number(req.params.id);
  const stocks = await prisma.stockEmplacement.findMany({
    where: { lieuId },
    include: { article: true },
    orderBy: { article: { designation: 'asc' } },
  });
  res.json(stocks);
}

module.exports = { listerLieux, creerLieu, stockParLieu };
