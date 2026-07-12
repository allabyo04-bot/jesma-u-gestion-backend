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
// Recherche unique utilisée à la vente : essaie codeBarre exact, puis codeInterne exact,
// puis désignation (contient), pour couvrir scan, saisie manuelle de secours et nom direct.
// Si lieuId est fourni, chaque résultat inclut aussi "stockLieu" : le stock réel disponible
// à cet emplacement précis (distinct de stockActuel, qui est le total tous emplacements
// confondus et ne doit jamais servir à décider si on peut vendre depuis une boutique donnée).
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
  const articles = await prisma.article.findMany({
    where: { codeBarreGenere: true, actif: true },
    orderBy: { designation: 'asc' },
  });
  res.json(articles);
}

// GET /api/articles/a-imprimer/etiquettes  -> page HTML imprimable (Ctrl+P côté navigateur)
async function imprimerEtiquettes(req, res) {
  const articles = await prisma.article.findMany({
    where: { codeBarreGenere: true, actif: true },
    orderBy: { designation: 'asc' },
  });

  const etiquettes = articles.map((a) => `
    <div class="etiquette">
      <div class="designation">${a.designation}</div>
      <div class="prix">${Number(a.prixVente).toLocaleString('fr-FR')} F</div>
      ${genererSvgEAN13(a.codeBarre)}
      <div class="code">${a.codeBarre}</div>
    </div>
  `).join('\n');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Étiquettes à imprimer - Jesma U</title>
<style>
  body { font-family: Arial, sans-serif; margin: 0; }
  .grille { display: flex; flex-wrap: wrap; gap: 10px; padding: 10px; }
  .etiquette {
    width: 220px; border: 1px dashed #999; padding: 8px; text-align: center;
    page-break-inside: avoid;
  }
  .designation { font-size: 12px; font-weight: bold; margin-bottom: 4px; }
  .prix { font-size: 13px; margin-bottom: 4px; }
  .code { font-size: 11px; letter-spacing: 1px; margin-top: 2px; }
  @media print {
    .etiquette { border: 1px solid #000; }
  }
</style>
</head>
<body>
  <div class="grille">${etiquettes || '<p>Aucune étiquette en attente.</p>'}</div>
  <script>window.onload = () => window.print();</script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

// POST /api/articles/:id/photo (multipart/form-data, champ "photo")
async function uploaderPhoto(req, res) {
  const id = Number(req.params.id);
  const article = await prisma.article.findUnique({ where: { id } });
  if (!article) return res.status(404).json({ error: 'Article introuvable.' });

  if (!req.file) {
    return res.status(400).json({ error: 'Aucune image reçue.' });
  }

  try {
    const resultat = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'jesma-u/articles', resource_type: 'image' },
        (error, result) => (error ? reject(error) : resolve(result)),
      );
      stream.end(req.file.buffer);
    });

    const misAJour = await prisma.article.update({
      where: { id },
      data: { photoUrl: resultat.secure_url },
    });

    res.json(misAJour);
  } catch (err) {
    res.status(500).json({ error: "Échec de l'upload de la photo." });
  }
}

module.exports = {
  listerArticles,
  rechercherArticle,
  creerArticle,
  genererCodeBarre,
  listerCodesAImprimer,
  imprimerEtiquettes,
  uploaderPhoto,
};
