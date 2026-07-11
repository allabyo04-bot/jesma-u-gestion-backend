const prisma = require('../lib/prisma');

// GET /api/demandes-remise?statut=EN_ATTENTE
async function listerDemandesRemise(req, res) {
  const { statut } = req.query;
  const where = statut ? { statut } : {};
  const demandes = await prisma.demandeRemise.findMany({
    where,
    include: { vente: true, demandeur: true, approbateur: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(demandes);
}

// POST /api/demandes-remise/:id/approuver
async function approuverDemandeRemise(req, res) {
  const id = Number(req.params.id);
  const demande = await prisma.demandeRemise.update({
    where: { id },
    data: { statut: 'APPROUVEE', approbateurId: req.user.id, resolvedAt: new Date() },
  });
  res.json(demande);
}

// POST /api/demandes-remise/:id/refuser
async function refuserDemandeRemise(req, res) {
  const id = Number(req.params.id);
  const demande = await prisma.demandeRemise.update({
    where: { id },
    data: { statut: 'REFUSEE', approbateurId: req.user.id, resolvedAt: new Date() },
  });
  res.json(demande);
}

module.exports = { listerDemandesRemise, approuverDemandeRemise, refuserDemandeRemise };
