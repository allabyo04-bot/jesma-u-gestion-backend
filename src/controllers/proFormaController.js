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
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; margin: 0; color: #2E1A0D; background: #FBF3DD; }
  .cadre { margin: 14mm; border: 1px solid #D9A144; border-radius: 10px; padding: 14mm; min-height: 260mm; }
  .entete { display: flex; align-items: center; gap: 16px; padding-bottom: 16px; border-bottom: 2px solid #D9A144; margin-bottom: 20px; }
  .logo { height: 56px; }
  .entete h1 { font-size: 20px; margin: 0; }
  .coordonnees { font-size: 11px; color: #7A5C3E; margin-top: 2px; }
  .infos-facture { display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { padding: 8px; border-bottom: 1px solid #E5D9C3; font-size: 13px; }
  th { text-align: left; background: #F7EFDD; }
  .total { text-align: right; font-size: 17px; font-weight: bold; margin-top: 14px; }
  .mention { margin-top: 28px; padding: 12px 14px; background: #FFF3D6; border-radius: 8px; font-size: 11px; color: #8A6300; }
  .pied { margin-top: 40px; text-align: center; font-size: 10px; color: #A88968; }
</style>
</head>
<body>
  <div class="cadre">
    <div class="entete">
      <img class="logo" src="https://jesma-u-gestion-frontend-production.up.railway.app/logo-jesma-u.png" alt="Jesma U" />
      <div>
        <h1>Jesma U — Facture pro forma</h1>
        <div class="coordonnees">Grand-Bassam, carrefour rosier 5 — WhatsApp +225 07 69 535 786</div>
      </div>
    </div>

    <div class="infos-facture">
      <div><strong>N° :</strong> ${proForma.numero}<br><strong>Date :</strong> ${new Date(proForma.createdAt).toLocaleDateString('fr-FR')}</div>
      <div style="text-align:right"><strong>Client :</strong> ${proForma.client.nomComplet}${proForma.client.telephone ? '<br>' + proForma.client.telephone : ''}</div>
    </div>

    <table>
      <thead>
        <tr><th>Article</th><th style="text-align:center">Qté</th><th style="text-align:right">PU</th><th style="text-align:right">Total</th></tr>
      </thead>
      <tbody>${lignesHtml}</tbody>
    </table>
    <div class="total">Total : ${Number(proForma.totalHT).toLocaleString('fr-FR')} F</div>

    <div class="mention">
      Cette facture pro forma est valable dans la limite du stock disponible au moment de l'achat.
      Elle ne constitue pas une facture définitive et peut être présentée en boutique pour finaliser l'achat.
    </div>

    <div class="pied">Gestion Commerciale et CRM by Phil</div>
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
