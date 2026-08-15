const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { enregistrerActivite } = require('../lib/journal');

function hacherCode(code) {
  return crypto.createHash('sha256').update(String(code).trim()).digest('hex');
}

function genererCode6Chiffres() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// GET /api/remises/parametre — lisible par tout le module VENTES (le caissier
// doit savoir a partir de quel montant un code sera exige).
async function obtenirSeuilRemise(req, res) {
  const parametre = await prisma.parametreRemise.findUnique({ where: { id: 1 } });
  res.json({ seuil: parametre ? parametre.seuil : null });
}

// PUT /api/remises/parametre   { seuil: number | null }  — ADMIN uniquement
async function definirSeuilRemise(req, res) {
  const { seuil } = req.body;
  const valeur = seuil === null || seuil === undefined || seuil === '' ? null : Number(seuil);
  if (valeur !== null && (Number.isNaN(valeur) || valeur < 0)) {
    return res.status(400).json({ error: 'Seuil invalide.' });
  }

  const parametre = await prisma.parametreRemise.upsert({
    where: { id: 1 },
    create: { id: 1, seuil: valeur },
    update: { seuil: valeur },
  });

  await enregistrerActivite(prisma, {
    type: 'SEUIL_REMISE_MODIFIE',
    description: valeur === null
      ? 'Exigence de code de déblocage pour les remises désactivée.'
      : `Seuil de remise sans code de déblocage fixé à ${valeur.toLocaleString('fr-FR')} F.`,
    utilisateurId: req.user.id,
  });

  res.json({ seuil: parametre.seuil });
}

// POST /api/remises/demande-code   { montant }  — n'importe quel utilisateur du
// module VENTES (une caissiere bloquee par le seuil, sans code disponible).
async function signalerDemandeCode(req, res) {
  const { montant } = req.body;
  const valeur = Number(montant);
  if (Number.isNaN(valeur) || valeur <= 0) {
    return res.status(400).json({ error: 'Montant invalide.' });
  }

  await prisma.demandeCodeDeblocage.create({
    data: { demandeurId: req.user.id, montantRemise: valeur },
  });

  res.status(201).json({ ok: true });
}

// GET /api/remises/demandes-code — ADMIN uniquement. Nombre + liste des
// demandes en attente, pour le tableau de bord.
async function listerDemandesCode(req, res) {
  const demandes = await prisma.demandeCodeDeblocage.findMany({
    where: { statut: 'EN_ATTENTE' },
    include: { demandeur: { select: { nomComplet: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(demandes.map((d) => ({
    id: d.id,
    demandeur: d.demandeur?.nomComplet,
    montantRemise: d.montantRemise,
    createdAt: d.createdAt,
  })));
}

// POST /api/remises/codes-deblocage — ADMIN uniquement. Genere un code a usage
// unique et le renvoie EN CLAIR une seule fois (jamais plus recuperable ensuite,
// seule son empreinte est conservee). Resout au passage toutes les demandes de
// code encore en attente.
async function genererCodeDeblocage(req, res) {
  const code = genererCode6Chiffres();

  await prisma.codeDeblocageRemise.create({
    data: { codeHache: hacherCode(code), creeParId: req.user.id },
  });

  await prisma.demandeCodeDeblocage.updateMany({
    where: { statut: 'EN_ATTENTE' },
    data: { statut: 'TRAITEE', traiteeAt: new Date() },
  });

  await enregistrerActivite(prisma, {
    type: 'CODE_DEBLOCAGE_REMISE_GENERE',
    description: `Nouveau code de déblocage remise généré par ${req.user.nomUtilisateur || 'un administrateur'}.`,
    utilisateurId: req.user.id,
  });

  res.status(201).json({ code });
}

// GET /api/remises/codes-deblocage — ADMIN uniquement. Historique (sans jamais
// exposer le code lui-meme) pour audit : qui a genere quoi, utilise ou non.
async function listerCodesDeblocage(req, res) {
  const codes = await prisma.codeDeblocageRemise.findMany({
    include: { creePar: { select: { nomComplet: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json(codes.map((c) => ({
    id: c.id,
    utilise: c.utilise,
    creePar: c.creePar?.nomComplet,
    createdAt: c.createdAt,
    utiliseAt: c.utiliseAt,
    venteId: c.venteId,
  })));
}

module.exports = {
  obtenirSeuilRemise, definirSeuilRemise, genererCodeDeblocage, listerCodesDeblocage, hacherCode,
  signalerDemandeCode, listerDemandesCode,
};
