const cloudinary = require('../../config/cloudinary');
const prisma = require('../lib/prisma');
const { genererCodeBarreInterne } = require('../utils/barcode');
const { genererSvgEAN13 } = require('../utils/ean13');

// GET /api/articles?familleId=&sousFamilleId=&enStock=true
async function listerArticles(req, res) {
  const { familleId, sousFamilleId, enStock } = req.query;

  const where = { actif: true };
  if (familleId) where.familleId = Number(familleId);
  if (sousFamilleId) where.sousFamilleId = Number(sousFamilleId);
  if (enStock === 'true') where.stockActuel = { gt: 0 };

  const articles = await prisma.article.findMany({
    where,
    include: { famille: true, sousFamille: true },
    orderBy: { designation: 'asc' },
  });
  res.json(articles);
}

// GET /api/articles/recherche?q=...&lieuId=...
async function rechercherArticle(req, res) {
  const q = (req.query.q || '').trim();
  const lieuId = req.query.lieuId ? Number(req.query.lieuId) : null;
  if (!q) return res.status(400).json({ error: 'Paramètre de recherche "q" requis.' });

  async function ajouterStockLieu(articles) {
    if (!lieuId) return articles;
    const ids = articles.map((a) => a.id);
    const stocks = await prisma.stockEmplacement.findMany({
      where: { lieuId, articleId: { in: ids } },
    });
    const parArticle = Object.fromEntries(stocks.map((s) => [s.articleId, s.quantite]));
    return articles.map((a) => ({ ...a, stockLieu: parArticle[a.id] ?? 0 }));
  }

  let article = await prisma.article.findFirst({ where: { codeBarre: q, actif: true } });
  if (!article) {
    article = await prisma.article.findFirst({ where: { codeInterne: q, actif: true } });
  }
  if (article) {
    const [resultat] = await ajouterStockLieu([article]);
    return res.json({ mode: 'exact', resultats: [resultat] });
  }

  const resultats = await prisma.article.findMany({
    where: { actif: true, designation: { contains: q, mode: 'insensitive' } },
    take: 20,
    orderBy: { designation: 'asc' },
  });
  const resultatsAvecStock = await ajouterStockLieu(resultats);
  res.json({ mode: 'recherche', resultats: resultatsAvecStock });
}

// POST /api/articles
async function creerArticle(req, res) {
  const {
    reference, codeBarre, codeInterne, designation,
    familleId, sousFamilleId, prixAchat, prixVente, seuilAlerte,
  } = req.body;

  if (!reference || !designation || prixVente === undefined) {
    return res.status(400).json({ error: 'Référence, désignation et prix de vente sont requis.' });
  }

  const article = await prisma.article.create({
    data: {
      reference,
      codeBarre: codeBarre || null,
      codeInterne: codeInterne || null,
      designation,
      familleId: familleId ? Number(familleId) : null,
      sousFamilleId: sousFamilleId ? Number(sousFamilleId) : null,
      prixAchat: prixAchat || 0,
      prixVente,
      seuilAlerte: seuilAlerte ?? 5,
    },
  });

  res.status(201).json(article);
}

// PUT /api/articles/:id
// Modifie un article existant. Le code-barre et le code interne ne se changent pas ici
// (ils passent par la génération dédiée) pour éviter d'écraser par erreur un scan existant.
async function modifierArticle(req, res) {
  const id = Number(req.params.id);
  const {
    reference, designation, familleId, sousFamilleId,
    prixAchat, prixVente, seuilAlerte, actif,
  } = req.body;

  const article = await prisma.article.findUnique({ where: { id } });
  if (!article) return res.status(404).json({ error: 'Article introuvable.' });

  if (!reference || !designation || prixVente === undefined) {
    return res.status(400).json({ error: 'Référence, désignation et prix de vente sont requis.' });
  }

  const misAJour = await prisma.article.update({
    where: { id },
    data: {
      reference,
      designation,
      familleId: familleId ? Number(familleId) : null,
      sousFamilleId: sousFamilleId ? Number(sousFamilleId) : null,
      prixAchat: prixAchat !== undefined ? prixAchat : article.prixAchat,
      prixVente,
      seuilAlerte: seuilAlerte ?? article.seuilAlerte,
      actif: actif !== undefined ? actif : article.actif,
    },
  });

  res.json(misAJour);
}

// POST /api/articles/:id/generer-code-barre
// Utilisé quand le lecteur ne trouve rien à scanner sur un article existant : on génère
// un code interne EAN-13 et on le marque pour impression d'étiquette.
async function genererCodeBarre(req, res) {
  const id = Number(req.params.id);
  const article = await prisma.article.findUnique({ where: { id } });
  if (!article) return res.status(404).json({ error: 'Article introuvable.' });
  if (article.codeBarre) {
    return res.status(400).json({ error: 'Cet article a déjà un code-barres.' });
  }

  const codeBarre = genererCodeBarreInterne(article.id);
  const misAJour = await prisma.article.update({
    where: { id },
    data: { codeBarre, codeBarreGenere: true },
  });

  res.json(misAJour);
}

// GET /api/articles/a-imprimer  -> file d'attente des étiquettes à imprimer
async function listerCodesAImprimer(req, res) {
  const articles = await