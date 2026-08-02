const prisma = require('../lib/prisma');

function genererNumeroProForma() {
  return `PF-${Date.now()}`;
}

// POST /api/proforma   body: { clientId, lignes: [{ articleId, quantite, prixUnitaire }] }
async function creerProForma(req, res) {
  const { clientId, lignes } = req.body;
  const utilisateurId = req.user.id;

  if (!clientId || !Array.isArray(lignes) || lignes.length === 0) {
    return res.status(400).json({ error: 'Client et au moins une ligne sont requis.' });
  }

  try {
    const totalHT = lignes.reduce((s, l) => s + Number(l.prixUnitaire) * Number(l.quantite), 0);

    const proForma = await prisma.factureProForma.create({
      data: {
        numero: genererNumeroProForma(),
        clientId: Number(clientId),
        utilisateurId,
        totalHT,
        lignes: {
          create: lignes.map((l) => ({
            articleId: Number(l.articleId),
            quantite: Number(l.quantite),
            prixUnitaire: l.prixUnitaire,
          })),
        },
      },
      include: { lignes: { include: { article: true } }, client: true },
    });

    res.status(201).json(proForma);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// GET /api/proforma?statut=
async function listerProFormas(req, res) {
  const { statut } = req.query;
  const where = {};
  if (statut) where.statut = statut;

  const factures = await prisma.factureProForma.findMany({
    where,
    include: { client: true, lignes: { include: { article: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(factures);
}

// GET /api/proforma/:numero
// Consultation par numéro — utilisée depuis Ventes pour recharger le panier d'une pro
// forma existante sans ressaisir les articles. Le stock actuel de chaque article est
// renvoyé pour affichage (informatif) ; la vraie vérification a lieu à la validation
// de la vente elle-même, comme pour toute vente normale.
async function obtenirProForma(req, res) {
  const { numero } = req.params;
  const proForma = await prisma.factureProForma.findUnique({
    where: { numero },
    include: {
      client: true,
      lignes: { include: { article: true } },
      venteIssue: true,
    },
  });
  if (!proForma) return res.status(404).json({ error: 'Facture pro forma introuvable.' });
  res.json(proForma);
}

// POST /api/proforma/:id/annuler
async function annulerProForma(req, res) {
  const id = Number(req.params.id);
  const proForma = await prisma.factureProForma.findUnique({ where: { id } });
  if (!proForma) return res.status(404).json({ error: 'Facture pro forma introuvable.' });
  if (proForma.statut !== 'EN_ATTENTE') {
    return res.status(400).json({ error: 'Seule une facture en attente peut être annulée.' });
  }
  const misAJour = await prisma.factureProForma.update({
    where: { id },
    data: { statut: 'ANNULEE' },
  });
  res.json(misAJour);
}

// GET /api/proforma/:numero/imprimer   (HTML imprimable)
async function imprimerProForma(req, res) {
  const { numero } = req.params;
  const proForma = await prisma.factureProForma.findUnique({
    where: { numero },
    include: { client: true, lignes: { include: { article: true } } },
  });
  if (!proForma) return res.status(404).send('Facture pro forma introuvable.');

  const lignesHtml = proForma.lignes.map((l) => `
    <tr>
      <td>${l.article.designation}</td>
      <td style="text-align:center">${l.quantite}</td>
      <td style="text-align:right">${Number(l.prixUnitaire).toLocaleString('fr-FR')} F</td>
      <td style="text-align:right">${(Number(l.prixUnitaire) * l.quantite).toLocaleString('fr-FR')} F</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Facture pro forma ${proForma.numero}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 24px; color: #2E1A0D; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .sous-titre { color: #7A5C3E; margin-top: 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { padding: 8px; border-bottom: 1px solid #E5D9C3; font-size: 13px; }
  th { text-align: left; background: #F7EFDD; }
  .total { text-align: right; font-size: 16px; font-weight: bold; margin-top: 12px; }
  .mention { margin-top: 24px; padding: 12px; background: #FFF3D6; border-radius: 8px; font-size: 12px; color: #8A6300; }
</style>
</head>
<body>
  <h1>Jesma U — Facture pro forma</h1>
  <p class="sous-titre">N° ${proForma.numero} — ${new Date(proForma.createdAt).toLocaleDateString('fr-FR')}</p>
  <p><strong>Client :</strong> ${proForma.client.nomComplet}${proForma.client.telephone ? ' — ' + proForma.client.telephone : ''}</p>
  <table>
    <thead>
      <tr><th>Article</th><th>Qté</th><th>PU</th><th>Total</th></tr>
    </thead>
    <tbody>${lignesHtml}</tbody>
  </table>
  <div class="total">Total : ${Number(proForma.totalHT).toLocaleString('fr-FR')} F</div>
  <div class="mention">
    Cette facture pro forma est valable dans la limite du stock disponible au moment de l'achat.
    Elle ne constitue pas une facture définitive et peut être présentée en boutique pour finaliser l'achat.
  </div>
  <script>window.onload = () => window.print();</script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

module.exports = {
  creerProForma, listerProFormas, obtenirProForma, annulerProForma, imprimerProForma,
};
