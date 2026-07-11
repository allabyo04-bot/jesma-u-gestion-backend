const crypto = require('crypto');
const prisma = require('../lib/prisma');

function genererCodeAcces() {
  return crypto.randomBytes(6).toString('hex'); // ex: "a1b2c3d4e5f6"
}

// POST /api/listes-cadeaux   (interne, en boutique)
// body: { clientId, titre?, lignes: [{ articleId, quantiteSouhaitee }] }
async function creerListeCadeau(req, res) {
  const { clientId, titre, lignes } = req.body;
  if (!clientId || !Array.isArray(lignes) || lignes.length === 0) {
    return res.status(400).json({ error: 'Client et au moins un article sont requis.' });
  }

  const liste = await prisma.listeCadeau.create({
    data: {
      clientId: Number(clientId),
      titre: titre || null,
      codeAcces: genererCodeAcces(),
      lignes: {
        create: lignes.map((l) => ({
          articleId: Number(l.articleId),
          quantiteSouhaitee: Number(l.quantiteSouhaitee),
        })),
      },
    },
    include: { lignes: { include: { article: true } }, client: true },
  });

  res.status(201).json(liste);
}

// GET /api/listes-cadeaux  (interne)
async function listerListesCadeaux(req, res) {
  const listes = await prisma.listeCadeau.findMany({
    include: { client: true, lignes: { include: { article: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(listes);
}

// GET /api/listes-cadeaux/publique/:codeAcces  (PUBLIC, sans authentification)
// Consultation par un proche qui a reçu le lien.
async function consulterListePublique(req, res) {
  const liste = await prisma.listeCadeau.findUnique({
    where: { codeAcces: req.params.codeAcces },
    include: { lignes: { include: { article: true } }, client: true },
  });
  if (!liste || !liste.actif) return res.status(404).json({ error: 'Liste cadeau introuvable.' });

  // On ne renvoie que le nécessaire publiquement (pas le téléphone du client par ex.)
  res.json({
    titre: liste.titre,
    client: { nomComplet: liste.client.nomComplet },
    lignes: liste.lignes.map((l) => ({
      id: l.id,
      article: { id: l.article.id, designation: l.article.designation, prixVente: l.article.prixVente },
      quantiteSouhaitee: l.quantiteSouhaitee,
      quantiteOfferte: l.quantiteOfferte,
      quantiteRestante: l.quantiteSouhaitee - l.quantiteOfferte,
    })),
  });
}

// Logique commune : offrir des articles d'une liste en payant avec une carte cadeau.
// NOTE : ceci valide et consomme la carte cadeau, et marque les quantités comme "offertes"
// sur la liste. Le décompte de stock réel se fait lors de la préparation/remise du cadeau
// en boutique, via une vente classique (POST /api/ventes) rattachée à ce client.
async function offrirSurListe({ codeAcces, carteCadeauCode, offrePar, canal, lignesChoisies }) {
  return prisma.$transaction(async (tx) => {
    const liste = await tx.listeCadeau.findUnique({
      where: { codeAcces },
      include: { lignes: true },
    });
    if (!liste || !liste.actif) throw new Error('Liste cadeau introuvable.');

    const carte = await tx.carteCadeau.findUnique({ where: { codeBarre: carteCadeauCode } });
    if (!carte) throw new Error('Carte cadeau introuvable.');
    if (carte.statut !== 'ACTIVE') throw new Error("Cette carte cadeau n'est pas active.");

    for (const choix of lignesChoisies) {
      const ligne = liste.lignes.find((l) => l.id === Number(choix.ligneId));
      if (!ligne) throw new Error(`Ligne ${choix.ligneId} absente de cette liste.`);
      const restant = ligne.quantiteSouhaitee - ligne.quantiteOfferte;
      if (Number(choix.quantite) > restant) {
        throw new Error(`Quantité demandée supérieure à ce qu'il reste pour cet article.`);
      }
      await tx.ligneListeCadeau.update({
        where: { id: ligne.id },
        data: { quantiteOfferte: { increment: Number(choix.quantite) } },
      });
    }

    await tx.carteCadeau.update({ where: { id: carte.id }, data: { statut: 'UTILISEE' } });
    const cycleOuvert = await tx.carteCadeauCycle.findFirst({
      where: { carteCadeauId: carte.id, dateUtilisation: null },
      orderBy: { dateActivation: 'desc' },
    });
    if (cycleOuvert) {
      await tx.carteCadeauCycle.update({ where: { id: cycleOuvert.id }, data: { dateUtilisation: new Date() } });
    }

    return tx.listeCadeauCarteUtilisee.create({
      data: {
        listeCadeauId: liste.id,
        carteCadeauId: carte.id,
        offrePar: offrePar || null,
        canal,
        montantUtilise: carte.denomination,
      },
    });
  }, { maxWait: 10000, timeout: 20000 });
}

// POST /api/listes-cadeaux/publique/:codeAcces/offrir  (PUBLIC)
// body: { carteCadeauCode, offrePar?, lignes: [{ ligneId, quantite }] }
async function offrirDepuisWeb(req, res) {
  const { carteCadeauCode, offrePar, lignes } = req.body;
  if (!carteCadeauCode || !Array.isArray(lignes) || lignes.length === 0) {
    return res.status(400).json({ error: 'Carte cadeau et au moins un article choisi sont requis.' });
  }
  try {
    const resultat = await offrirSurListe({
      codeAcces: req.params.codeAcces, carteCadeauCode, offrePar, canal: 'web', lignesChoisies: lignes,
    });
    res.status(201).json(resultat);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// POST /api/listes-cadeaux/:codeAcces/offrir-telephone  (interne, saisi par la vendeuse)
async function offrirParTelephone(req, res) {
  const { carteCadeauCode, offrePar, lignes } = req.body;
  if (!carteCadeauCode || !Array.isArray(lignes) || lignes.length === 0) {
    return res.status(400).json({ error: 'Carte cadeau et au moins un article choisi sont requis.' });
  }
  try {
    const resultat = await offrirSurListe({
      codeAcces: req.params.codeAcces, carteCadeauCode, offrePar, canal: 'telephone', lignesChoisies: lignes,
    });
    res.status(201).json(resultat);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

module.exports = {
  creerListeCadeau, listerListesCadeaux, consulterListePublique, offrirDepuisWeb, offrirParTelephone,
};
