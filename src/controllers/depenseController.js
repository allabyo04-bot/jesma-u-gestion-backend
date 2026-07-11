const prisma = require('../lib/prisma');

function debutJournee(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function finJournee(date = new Date()) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

// GET /api/depenses?categorieId=&dateDebut=&dateFin=&utilisateurId=
// Visibilité par rôle, comme à La Pointure :
//  - CAISSIER : uniquement ses propres dépenses du jour (les filtres de date sont ignorés)
//  - ADMIN (Victoria) : tout, avec filtres libres
async function listerDepenses(req, res) {
  const { categorieId, dateDebut, dateFin, utilisateurId } = req.query;

  let where = {};

  if (req.user.role !== 'ADMIN') {
    where = {
      utilisateurId: req.user.id,
      dateDepense: { gte: debutJournee(), lte: finJournee() },
    };
  } else {
    if (categorieId) where.categorieId = Number(categorieId);
    if (utilisateurId) where.utilisateurId = Number(utilisateurId);
    if (dateDebut || dateFin) {
      where.dateDepense = {};
      if (dateDebut) where.dateDepense.gte = debutJournee(new Date(dateDebut));
      if (dateFin) where.dateDepense.lte = finJournee(new Date(dateFin));
    }
  }

  const depenses = await prisma.depense.findMany({
    where,
    include: { categorie: true, utilisateur: { select: { id: true, nomComplet: true } } },
    orderBy: { dateDepense: 'desc' },
  });
  res.json(depenses);
}

// POST /api/depenses   { categorieId, montant, description?, dateDepense? }
async function creerDepense(req, res) {
  const { categorieId, montant, description, dateDepense } = req.body;
  if (!categorieId || !montant) {
    return res.status(400).json({ error: 'Catégorie et montant sont requis.' });
  }

  const depense = await prisma.depense.create({
    data: {
      categorieId: Number(categorieId),
      montant,
      description: description || null,
      utilisateurId: req.user.id,
      dateDepense: dateDepense ? new Date(dateDepense) : new Date(),
    },
    include: { categorie: true },
  });
  res.status(201).json(depense);
}

// GET /api/depenses/categories
async function listerCategories(req, res) {
  const categories = await prisma.categorieDepense.findMany({ orderBy: { nom: 'asc' } });
  res.json(categories);
}

// GET /api/depenses/budget?dateDebut=&dateFin=   (ADMIN uniquement)
// Synthèse : total par catégorie sur la période, pour le module Budget.
async function syntheseBudget(req, res) {
  const { dateDebut, dateFin } = req.query;

  const where = {};
  if (dateDebut || dateFin) {
    where.dateDepense = {};
    if (dateDebut) where.dateDepense.gte = debutJournee(new Date(dateDebut));
    if (dateFin) where.dateDepense.lte = finJournee(new Date(dateFin));
  }

  const depenses = await prisma.depense.findMany({ where, include: { categorie: true } });

  const parCategorie = {};
  let totalGeneral = 0;

  for (const d of depenses) {
    const nomCategorie = d.categorie.nom;
    const montant = Number(d.montant);
    parCategorie[nomCategorie] = (parCategorie[nomCategorie] || 0) + montant;
    totalGeneral += montant;
  }

  res.json({
    periode: { dateDebut: dateDebut || null, dateFin: dateFin || null },
    parCategorie,
    totalGeneral,
  });
}

module.exports = { listerDepenses, creerDepense, listerCategories, syntheseBudget };
