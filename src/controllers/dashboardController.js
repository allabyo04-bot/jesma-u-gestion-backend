const prisma = require('../lib/prisma');

function debutAujourdhui() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function finAujourdhui() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}
function debutMoisEnCours() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

// GET /api/dashboard
async function obtenirDashboard(req, res) {
  const debutJour = debutAujourdhui();
  const finJour = finAujourdhui();
  const debutMois = debutMoisEnCours();

  const where = {
    statut: 'VALIDEE',
    createdAt: { gte: debutJour, lte: finJour },
  };

  const [ventesDuJour, depensesDuJour, demandesRemiseEnAttente, recompensesEnAttente,
    listesActives, offresEnAttenteListe, offresConfirmees, ventesAvecRemiseMois,
    demandesCodeRemiseEnAttente] =
    await Promise.all([
      prisma.vente.findMany({ where }),
      prisma.depense.findMany({
        where: { dateDepense: { gte: debutJour, lte: finJour } },
      }),
      prisma.demandeRemise.count({ where: { statut: 'EN_ATTENTE' } }),
      prisma.recompenseFidelite.count({ where: { statut: 'EN_ATTENTE' } }),
      prisma.listeCadeau.count({ where: { actif: true } }),
      prisma.listeCadeauCarteUtilisee.count({ where: { statutConfirmation: 'EN_ATTENTE_VERIFICATION' } }),
      prisma.listeCadeauCarteUtilisee.findMany({ where: { statutConfirmation: 'CONFIRME' } }),
      prisma.vente.findMany({
        where: { statut: 'VALIDEE', remiseMontant: { gt: 0 }, createdAt: { gte: debutMois } },
        select: { remiseMontant: true, createdAt: true },
      }),
      prisma.demandeCodeDeblocage.count({ where: { statut: 'EN_ATTENTE' } }),
    ]);

  // Prisma ne compare pas nativement deux colonnes entre elles (stockActuel <= seuilAlerte) ;
  // on filtre donc côté JS pour rester fiable sur toutes les versions.
  const tousArticles = await prisma.article.findMany({ where: { actif: true } });
  const articlesStockBas = tousArticles.filter((a) => a.stockActuel <= a.seuilAlerte);

  const totalVentes = ventesDuJour.reduce((s, v) => s + Number(v.totalNet), 0);
  const totalDepenses = depensesDuJour.reduce((s, d) => s + Number(d.montant), 0);

  const remisesDuJour = ventesAvecRemiseMois.filter((v) => new Date(v.createdAt) >= debutJour);

  // Résultat du mois par boutique (réservé à l'admin côté frontend, mais calculé ici
  // pour toute boutique active — pas les entrepôts) : ventes − coût d'achat des
  // articles vendus − dépenses affectées à cette boutique, comparé à l'objectif fixé.
  const boutiques = await prisma.lieu.findMany({ where: { type: 'BOUTIQUE', actif: true } });

  const parBoutique = await Promise.all(boutiques.map(async (b) => {
    const [lignesVenduesMois, ventesLieuJour, ventesLieuMois] = await Promise.all([
      prisma.ligneVente.findMany({
        where: { vente: { lieuId: b.id, statut: 'VALIDEE', createdAt: { gte: debutMois } } },
        select: { quantite: true, article: { select: { prixAchat: true } } },
      }),
      prisma.vente.findMany({
        where: { lieuId: b.id, statut: 'VALIDEE', createdAt: { gte: debutJour } },
        select: { totalNet: true },
      }),
      prisma.vente.findMany({
        where: { lieuId: b.id, statut: 'VALIDEE', createdAt: { gte: debutMois } },
        select: { totalNet: true },
      }),
    ]);

    // Le modèle Depense de Jesma U n'est pas rattaché à une boutique (contrairement à
    // Archange Bébé) — tant que Jesma U n'a qu'une seule boutique, le total des dépenses
    // du mois (toutes confondues) est une approximation fidèle de la marge de CETTE boutique.
    const depensesMoisToutesBoutiques = await prisma.depense.findMany({
      where: { dateDepense: { gte: debutMois } },
      select: { montant: true },
    });

    const totalVentesLieu = ventesLieuMois.reduce((s, v) => s + Number(v.totalNet), 0);
    const coutMarchandise = lignesVenduesMois.reduce((s, l) => s + l.quantite * Number(l.article.prixAchat), 0);
    const totalDepensesLieu = depensesMoisToutesBoutiques.reduce((s, d) => s + Number(d.montant), 0);
    const objectif = Number(b.objectifMensuel);

    return {
      lieuId: b.id,
      nom: b.nom,
      objectifMensuel: objectif,
      ventesJour: {
        nombre: ventesLieuJour.length,
        total: ventesLieuJour.reduce((s, v) => s + Number(v.totalNet), 0),
      },
      ventesMois: totalVentesLieu,
      pourcentageObjectif: objectif > 0 ? Math.round((totalVentesLieu / objectif) * 1000) / 10 : 0,
      coutMarchandiseMois: coutMarchandise,
      depensesMois: totalDepensesLieu,
      margeMois: totalVentesLieu - coutMarchandise - totalDepensesLieu,
    };
  }));

  res.json({
    date: new Date().toISOString().slice(0, 10),
    ventes: { nombre: ventesDuJour.length, total: totalVentes },
    depenses: { nombre: depensesDuJour.length, total: totalDepenses },
    resultatJour: totalVentes - totalDepenses,
    alertesStock: articlesStockBas.map((a) => ({
      id: a.id, designation: a.designation, stockActuel: a.stockActuel, seuilAlerte: a.seuilAlerte,
    })),
    demandesRemiseEnAttente,
    demandesCodeRemiseEnAttente,
    recompensesFideliteEnAttente: recompensesEnAttente,
    listesCadeaux: {
      listesActives,
      offresEnAttente: offresEnAttenteListe,
      totalOfferConfirme: offresConfirmees.reduce((s, o) => s + Number(o.montantUtilise), 0),
    },
    remises: {
      jour: {
        nombre: remisesDuJour.length,
        total: remisesDuJour.reduce((s, v) => s + Number(v.remiseMontant), 0),
      },
      mois: {
        nombre: ventesAvecRemiseMois.length,
        total: ventesAvecRemiseMois.reduce((s, v) => s + Number(v.remiseMontant), 0),
      },
    },
    parBoutique,
  });
}

module.exports = { obtenirDashboard };
