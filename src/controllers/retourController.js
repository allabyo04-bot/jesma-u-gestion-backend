const prisma = require('../lib/prisma');
const { appliquerMouvementStock } = require('../lib/stock');

function genererReferenceAvoir() {
  const maintenant = new Date();
  return `AV-${maintenant.getTime()}`;
}

// GET /api/retours/ventes?numero=&clientId=&telephone=
// Recherche la vente d'origine du client, avant de créer un retour.
async function rechercherVenteOrigine(req, res) {
  const { numero, clientId, telephone } = req.query;

  if (!numero && !clientId && !telephone) {
    return res.status(400).json({ error: 'Indiquez un numéro de vente, un client ou un téléphone.' });
  }

  const where = { statut: 'VALIDEE' };
  if (numero) where.numero = { contains: numero, mode: 'insensitive' };
  if (clientId) where.clientId = Number(clientId);
  if (telephone) where.client = { telephone: { contains: telephone } };

  const ventes = await prisma.vente.findMany({
    where,
    include: { lignes: { include: { article: true } }, client: true, lieu: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  res.json(ventes);
}

// POST /api/retours   body: { venteOrigineId, lieuId, lignes: [{articleId, quantite, prixUnitaire}] }
// Crée l'avoir correspondant à la valeur des articles retournés, et réintègre le stock.
async function creerRetour(req, res) {
  const { venteOrigineId, lieuId, lignes } = req.body;
  const utilisateurId = req.user.id;

  if (!venteOrigineId || !lieuId || !Array.isArray(lignes) || lignes.length === 0) {
    return res.status(400).json({ error: "Vente d'origine, lieu et au moins un article sont requis." });
  }

  try {
    const resultat = await prisma.$transaction(async (tx) => {
      const venteOrigine = await tx.vente.findUnique({ where: { id: Number(venteOrigineId) } });
      if (!venteOrigine) throw new Error("Vente d'origine introuvable.");

      const montant = lignes.reduce((s, l) => s + Number(l.prixUnitaire) * Number(l.quantite), 0);

      const avoir = await tx.avoir.create({
        data: {
          reference: genererReferenceAvoir(),
          venteOrigineId: Number(venteOrigineId),
          montant,
          utilisateurId,
          lignes: {
            create: lignes.map((l) => ({
              articleId: Number(l.articleId),
              quantite: Number(l.quantite),
              prixUnitaire: l.prixUnitaire,
            })),
          },
        },
        include: { lignes: true },
      });

      for (const ligne of avoir.lignes) {
        await appliquerMouvementStock(tx, {
          articleId: ligne.articleId,
          lieuId: Number(lieuId),
          delta: ligne.quantite,
          type: 'RETOUR_CLIENT',
          utilisateurId,
          notes: `Retour - avoir ${avoir.reference}`,
        });
      }

      return avoir;
    }, { maxWait: 10000, timeout: 20000 });

    res.status(201).json(resultat);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// GET /api/avoirs?statut=ACTIF|UTILISE
async function listerAvoirs(req, res) {
  const { statut } = req.query;
  const where = {};
  if (statut) where.statut = statut;

  const avoirs = await prisma.avoir.findMany({
    where,
    include: {
      lignes: { include: { article: true } },
      venteOrigine: { include: { client: true } },
      utilisateur: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(avoirs);
}

module.exports = { rechercherVenteOrigine, creerRetour, listerAvoirs };