const XLSX = require('xlsx');
const prisma = require('../lib/prisma');
const { appliquerMouvementStock } = require('../lib/stock');

// GET /api/inventaire/export?lieuId=&familleId=&sousFamilleId=
// Génère la feuille de comptage à imprimer/remplir. La quantité théorique en stock
// n'apparaît JAMAIS dans ce fichier (demande explicite de Victoria) : la colonne
// "Quantité comptée" doit être remplie à la main après un vrai comptage physique,
// pas recopiée depuis une fiche de stock.
async function exporterFeuilleComptage(req, res) {
  const { lieuId, familleId, sousFamilleId } = req.query;
  if (!lieuId) return res.status(400).json({ error: 'Boutique/entrepôt requis.' });

  const whereArticle = { actif: true };
  if (familleId) whereArticle.familleId = Number(familleId);
  if (sousFamilleId) whereArticle.sousFamilleId = Number(sousFamilleId);

  const articles = await prisma.article.findMany({
    where: whereArticle,
    orderBy: { designation: 'asc' },
  });

  const lignes = articles.map((a) => ({
    Référence: a.reference,
    Désignation: a.designation,
    'Quantité comptée': null,
  }));

  const feuille = XLSX.utils.json_to_sheet(lignes);
  feuille['!cols'] = [{ wch: 14 }, { wch: 40 }, { wch: 18 }];
  const classeur = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(classeur, feuille, 'Inventaire');
  const buffer = XLSX.write(classeur, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="feuille-inventaire.xlsx"');
  res.send(buffer);
}

// POST /api/inventaire/apercu   (multipart, champ "fichier")   body: { lieuId }
// Ne modifie rien en base : lit la feuille remplie, retrouve chaque article par
// référence, et calcule l'écart avec la quantité théorique ACTUELLE (recalculée ici,
// jamais transmise par le fichier) pour affichage/validation avant confirmation.
async function previsualiserInventaire(req, res) {
  const { lieuId } = req.body;
  if (!req.file) return res.status(400).json({ error: 'Fichier Excel requis (champ "fichier").' });
  if (!lieuId) return res.status(400).json({ error: 'Boutique/entrepôt requis.' });

  try {
    const classeur = XLSX.read(req.file.buffer, { type: 'buffer' });
    const feuille = classeur.Sheets[classeur.SheetNames[0]];
    const lignesBrutes = XLSX.utils.sheet_to_json(feuille, { defval: null });

    const apercu = [];
    for (const ligne of lignesBrutes) {
      const reference = String(ligne['Référence'] || ligne['Reference'] || '').trim();
      const quantiteCompteeBrute = ligne['Quantité comptée'] ?? ligne['Quantite comptee'];

      if (!reference) continue;
      if (quantiteCompteeBrute === null || quantiteCompteeBrute === undefined || quantiteCompteeBrute === '') {
        apercu.push({ reference, statut: 'NON_COMPTE', erreur: 'Quantité comptée non renseignée.' });
        continue;
      }

      const quantiteComptee = Number(quantiteCompteeBrute);
      if (!Number.isFinite(quantiteComptee) || quantiteComptee < 0) {
        apercu.push({ reference, statut: 'ERREUR', erreur: 'Quantité comptée invalide.' });
        continue;
      }

      const article = await prisma.article.findUnique({ where: { reference } });
      if (!article) {
        apercu.push({ reference, statut: 'INTROUVABLE', erreur: 'Article introuvable pour cette référence.' });
        continue;
      }

      const stockEmplacement = await prisma.stockEmplacement.findUnique({
        where: { articleId_lieuId: { articleId: article.id, lieuId: Number(lieuId) } },
      });
      const quantiteTheorique = stockEmplacement ? stockEmplacement.quantite : 0;
      const ecart = quantiteComptee - quantiteTheorique;

      apercu.push({
        reference,
        designation: article.designation,
        articleId: article.id,
        quantiteTheorique,
        quantiteComptee,
        ecart,
        statut: ecart === 0 ? 'CONFORME' : 'ECART',
      });
    }

    res.json(apercu);
  } catch (err) {
    res.status(400).json({ error: "Impossible de lire ce fichier. Vérifiez qu'il s'agit bien de la feuille exportée." });
  }
}

// POST /api/inventaire/confirmer   body: { lieuId, lignes: [{ articleId, quantiteComptee }] }
// N'applique que les lignes avec un écart réel — recalcule la quantité théorique au
// moment de la confirmation (pas celle de l'aperçu, potentiellement obsolète) pour
// éviter d'écraser un mouvement de stock survenu entre-temps.
async function confirmerInventaire(req, res) {
  const { lieuId, lignes } = req.body;
  const utilisateurId = req.user.id;

  if (!lieuId || !Array.isArray(lignes) || lignes.length === 0) {
    return res.status(400).json({ error: 'Boutique/entrepôt et au moins une ligne sont requis.' });
  }

  try {
    const resultat = await prisma.$transaction(async (tx) => {
      const corrections = [];
      for (const ligne of lignes) {
        const articleId = Number(ligne.articleId);
        const quantiteComptee = Number(ligne.quantiteComptee);

        const stockEmplacement = await tx.stockEmplacement.upsert({
          where: { articleId_lieuId: { articleId, lieuId: Number(lieuId) } },
          create: { articleId, lieuId: Number(lieuId), quantite: 0 },
          update: {},
        });

        const delta = quantiteComptee - stockEmplacement.quantite;
        if (delta === 0) continue;

        await appliquerMouvementStock(tx, {
          articleId,
          lieuId: Number(lieuId),
          delta,
          type: 'CORRECTION_INVENTAIRE',
          utilisateurId,
          notes: 'Correction suite à inventaire (import Excel)',
        });
        corrections.push({ articleId, delta });
      }
      return corrections;
    }, { maxWait: 15000, timeout: 30000 });

    res.json({ corrigees: resultat.length, corrections: resultat });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

module.exports = { exporterFeuilleComptage, previsualiserInventaire, confirmerInventaire };
