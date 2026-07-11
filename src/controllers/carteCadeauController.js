const prisma = require('../lib/prisma');

// GET /api/cartes-cadeaux/denominations
async function listerDenominations(req, res) {
  const denominations = await prisma.denominationCarteCadeau.findMany({
    where: { actif: true },
    orderBy: { montant: 'asc' },
  });
  res.json(denominations);
}

// POST /api/cartes-cadeaux/denominations   { montant }
async function creerDenomination(req, res) {
  const { montant } = req.body;
  if (!montant) return res.status(400).json({ error: 'Montant requis.' });
  const denomination = await prisma.denominationCarteCadeau.create({ data: { montant } });
  res.status(201).json(denomination);
}

// GET /api/cartes-cadeaux/:codeBarre
async function obtenirCarteCadeau(req, res) {
  const carte = await prisma.carteCadeau.findUnique({
    where: { codeBarre: req.params.codeBarre },
    include: { cycles: { orderBy: { dateActivation: 'desc' } } },
  });
  if (!carte) return res.status(404).json({ error: 'Carte cadeau introuvable.' });
  res.json(carte);
}

// POST /api/cartes-cadeaux/activer   { codeBarre, denomination }
// Active (ou réactive) une carte cadeau physique avec une dénomination fixe. Si la carte
// n'existe pas encore en base (première vente de cette carte physique), elle est créée.
async function activerCarteCadeau(req, res) {
  const { codeBarre, denomination } = req.body;
  const utilisateurId = req.user.id;

  if (!codeBarre || !denomination) {
    return res.status(400).json({ error: 'Code-barres et dénomination requis.' });
  }

  const denominationValide = await prisma.denominationCarteCadeau.findUnique({
    where: { montant: denomination },
  });
  if (!denominationValide || !denominationValide.actif) {
    return res.status(400).json({ error: "Cette dénomination n'est pas dans la liste autorisée." });
  }

  try {
    const resultat = await prisma.$transaction(async (tx) => {
      let carte = await tx.carteCadeau.findUnique({ where: { codeBarre } });

      if (!carte) {
        carte = await tx.carteCadeau.create({
          data: { codeBarre, denomination, statut: 'ACTIVE' },
        });
      } else {
        if (carte.statut === 'ACTIVE') {
          throw new Error('Cette carte est déjà active.');
        }
        carte = await tx.carteCadeau.update({
          where: { id: carte.id },
          data: { denomination, statut: 'ACTIVE' },
        });
      }

      await tx.carteCadeauCycle.create({
        data: { carteCadeauId: carte.id, denomination, utilisateurId },
      });

      return carte;
    }, { maxWait: 10000, timeout: 20000 });

    res.json(resultat);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// GET /api/cartes-cadeaux
async function listerCartesCadeaux(req, res) {
  const { statut } = req.query;
  const where = statut ? { statut } : {};
  const cartes = await prisma.carteCadeau.findMany({ where, orderBy: { createdAt: 'desc' } });
  res.json(cartes);
}

module.exports = {
  listerDenominations, creerDenomination, obtenirCarteCadeau, activerCarteCadeau, listerCartesCadeaux,
};
