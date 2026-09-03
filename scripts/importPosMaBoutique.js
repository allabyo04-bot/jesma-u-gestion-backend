// Import initial du catalogue Jesma U depuis l'export corrigé de POS Ma Boutique.
//
// Ne s'exécute QUE si la variable d'environnement IMPORT_POS_MABOUTIQUE=true est
// définie sur Railway (variable à ajouter avant un déploiement, puis à retirer
// juste après, pour que ça ne se relance jamais tout seul). Sans elle, ce script
// ne fait rien et se termine immédiatement — donc aucun risque à le laisser dans
// le dépôt en permanence.
//
// Purge : Articles, Familles, Sous-familles, Stock (mouvements/emplacements),
// Listes cadeaux, Cartes cadeaux, Ventes (+lignes/paiements), Clients, Factures
// pro forma (dépendent des Articles/Clients qu'on purge).
// Conservé : Utilisateurs, Rôles, Paramètres (seuil de remise, dénominations,
// catégories de dépenses), Lieux, Vendeurs existants.
//
// Import : 14 familles -> 109 sous-familles (préfixes générés, uniques) -> 778
// articles (désignations en MAJUSCULES, ancienne référence conservée dans
// codeInterne, nouvelle référence générée selon la convention Jesma U) -> tout
// le stock sur le lieu "Boutique Jesma U" (l'Entrepôt reste à 0) -> 185 ventes
// historiques (avec leurs vraies dates, vendeurs, paiements, remises, annulations)
// -> 21 clients (avec leur vraie date de création).

const path = require('path');
const prisma = require('../src/lib/prisma');
const { appliquerMouvementStock } = require('../src/lib/stock');

const EXPORT_PATH = path.join(__dirname, 'pos_maboutique_export.json');

function normaliserNomFamille(nom) {
  return nom.trim().replace(/\s+/g, ' ');
}

// Génère un préfixe de 3-5 lettres majuscules à partir d'un nom, en garantissant
// l'unicité globale (codePrefixe est unique sur toute la table SousFamille).
function genererPrefixeUnique(nomFamille, nomSousFamille, prefixesDejaUtilises) {
  const nettoyer = (s) => s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // retire les accents
    .toUpperCase().replace(/[^A-Z]/g, '');

  const baseFamille = nettoyer(nomFamille).slice(0, 3) || 'XXX';
  const baseSousFamille = nettoyer(nomSousFamille).slice(0, 3) || 'YYY';
  let candidat = `${baseFamille}${baseSousFamille}`.slice(0, 6);
  if (!candidat) candidat = 'SFAM';

  let final = candidat;
  let suffixe = 1;
  while (prefixesDejaUtilises.has(final)) {
    final = `${candidat}${suffixe}`;
    suffixe += 1;
  }
  prefixesDejaUtilises.add(final);
  return final;
}

// Convertit "Espèces:50 000|Wave:4 000" ou "Wave" en tableau [{mode, montant}].
function parserPaiements(modePaiementBrut, totalNet) {
  if (!modePaiementBrut) return [{ mode: 'Espèces', montant: totalNet }];
  if (modePaiementBrut.includes('|') || modePaiementBrut.includes(':')) {
    return modePaiementBrut.split('|').map((part) => {
      const [mode, montantStr] = part.split(':');
      const montant = montantStr != null ? Number(montantStr.replace(/\s/g, '')) : totalNet;
      return { mode: mode.trim(), montant };
    });
  }
  return [{ mode: modePaiementBrut.trim(), montant: totalNet }];
}

async function main() {
  if (process.env.IMPORT_POS_MABOUTIQUE !== 'true') {
    console.log('[import] IMPORT_POS_MABOUTIQUE non activé — script ignoré.');
    return;
  }

  // Garde-fou : si des articles existent déjà (import précédent déjà fait, ou
  // Victoria a commencé à travailler dans l'app), on refuse de purger quoi que
  // ce soit. Empêche qu'un oubli de retirer la variable sur Railway ne relance
  // silencieusement une purge à chaque déploiement suivant.
  const nbArticlesExistants = await prisma.article.count();
  if (nbArticlesExistants > 0) {
    console.log(`[import] ${nbArticlesExistants} article(s) déjà présent(s) en base — import déjà effectué (ou données réelles en cours). Script ignoré par sécurité.`);
    return;
  }

  console.log('[import] Démarrage de l\'import catalogue Jesma U...');
  const data = require(EXPORT_PATH);

  const lieuBoutique = await prisma.lieu.findFirst({ where: { nom: { contains: 'Boutique' } } });
  if (!lieuBoutique) throw new Error('Lieu "Boutique Jesma U" introuvable — importer annulé.');

  const admin = await prisma.utilisateur.findFirst({ where: { nomUtilisateur: 'victoria' } });
  if (!admin) throw new Error('Utilisateur "victoria" introuvable — import annulé.');

  // ------------------------------------------------------------------
  // 1. PURGE
  // ------------------------------------------------------------------
  console.log('[import] Purge des données existantes...');
  await prisma.detailOffreListeCadeau.deleteMany({});
  await prisma.listeCadeauCarteUtilisee.deleteMany({});
  await prisma.ligneListeCadeau.deleteMany({});
  await prisma.listeCadeau.deleteMany({});
  await prisma.carteCadeauCycle.deleteMany({});
  await prisma.carteCadeau.deleteMany({});
  await prisma.paiementVente.deleteMany({});
  await prisma.reglementCredit.deleteMany({});
  await prisma.ligneAvoirRetour.deleteMany({});
  await prisma.avoir.deleteMany({});
  await prisma.demandeRemise.deleteMany({});
  await prisma.ligneFactureProForma.deleteMany({});
  await prisma.factureProForma.deleteMany({});
  await prisma.mouvementStock.deleteMany({});
  await prisma.ligneVente.deleteMany({});
  await prisma.vente.deleteMany({});
  await prisma.venteEnAttente.deleteMany({});
  await prisma.recompenseFidelite.deleteMany({});
  await prisma.client.deleteMany({});
  await prisma.ligneReception.deleteMany({});
  await prisma.reception.deleteMany({});
  await prisma.ligneTransfertStock.deleteMany({});
  await prisma.transfertStock.deleteMany({});
  await prisma.stockEmplacement.deleteMany({});
  await prisma.photoArticle.deleteMany({});
  await prisma.article.deleteMany({});
  await prisma.sousFamille.deleteMany({});
  await prisma.famille.deleteMany({});
  console.log('[import] Purge terminée.');

  // ------------------------------------------------------------------
  // 2. FAMILLES
  // ------------------------------------------------------------------
  const familleParAncienId = new Map();
  for (const cat of data.categories) {
    const nom = normaliserNomFamille(cat.nom_categorie);
    const famille = await prisma.famille.create({ data: { nom } });
    familleParAncienId.set(cat.id_categorie, famille.id);
  }
  console.log(`[import] ${familleParAncienId.size} familles créées.`);

  // ------------------------------------------------------------------
  // 3. SOUS-FAMILLES
  // ------------------------------------------------------------------
  const prefixesUtilises = new Set();
  const sousFamilleParAncienId = new Map();
  const catByAncienId = new Map(data.categories.map((c) => [c.id_categorie, c]));
  for (const sc of data.sousCategories) {
    const cat = catByAncienId.get(sc.id_categorie);
    const familleId = familleParAncienId.get(sc.id_categorie);
    if (!familleId) continue;
    const nom = normaliserNomFamille(sc.nom_sous_categorie);
    const codePrefixe = genererPrefixeUnique(cat.nom_categorie, sc.nom_sous_categorie, prefixesUtilises);
    const sousFamille = await prisma.sousFamille.create({
      data: { nom, codePrefixe, familleId },
    });
    sousFamilleParAncienId.set(sc.id_sous_categorie, sousFamille);
  }
  console.log(`[import] ${sousFamilleParAncienId.size} sous-familles créées.`);

  // ------------------------------------------------------------------
  // 4. ARTICLES + STOCK
  // ------------------------------------------------------------------
  const articleParAncienId = new Map();
  let compteur = 0;
  for (const p of data.produits) {
    const familleId = familleParAncienId.get(p.id_categorie) || null;
    const sousFamille = p.id_sous_categorie ? sousFamilleParAncienId.get(p.id_sous_categorie) : null;

    let reference;
    if (sousFamille) {
      const nouveauNumero = sousFamille.dernierNumero + 1;
      reference = `${sousFamille.codePrefixe}${String(nouveauNumero).padStart(2, '0')}`;
      sousFamille.dernierNumero = nouveauNumero;
      await prisma.sousFamille.update({ where: { id: sousFamille.id }, data: { dernierNumero: nouveauNumero } });
    } else {
      compteur += 1;
      reference = `DIV${String(compteur).padStart(4, '0')}`;
    }

    // codeBarre : uniquement conservé s'il ressemble a un vrai EAN (8 ou 13
    // chiffres) ; sinon laissé vide, le systeme en génèrera un propre a la demande.
    const codeBarreValide = /^\d{8}$|^\d{13}$/.test(p.code_barre || '') ? p.code_barre : null;

    const article = await prisma.article.create({
      data: {
        reference,
        codeBarre: codeBarreValide,
        codeInterne: p.reference || null,
        designation: p.nom_produit.toUpperCase(),
        familleId,
        sousFamilleId: sousFamille ? sousFamille.id : null,
        prixAchat: p.prix_achat,
        prixVente: p.prix_vente,
        actif: !!p.actif,
        seuilAlerte: p.seuil_alerte || 5,
      },
    });
    articleParAncienId.set(p.id_produit, article);

    const quantite = Math.max(0, p.quantite_stock || 0);
    if (quantite > 0) {
      await appliquerMouvementStock(prisma, {
        articleId: article.id, lieuId: lieuBoutique.id, delta: quantite,
        type: 'ENTREE_RECEPTION', utilisateurId: admin.id,
        notes: 'Import initial du catalogue (POS Ma Boutique)',
      });
    } else {
      await prisma.stockEmplacement.upsert({
        where: { articleId_lieuId: { articleId: article.id, lieuId: lieuBoutique.id } },
        create: { articleId: article.id, lieuId: lieuBoutique.id, quantite: 0 },
        update: {},
      });
    }
  }
  console.log(`[import] ${articleParAncienId.size} articles créés, stock affecté à ${lieuBoutique.nom}.`);

  // ------------------------------------------------------------------
  // 5. VENDEURS (Victoria / Anissa / Oriane)
  // ------------------------------------------------------------------
  const vendeurParAncienId = new Map();
  for (const u of data.utilisateurs) {
    const nomComplet = `${u.prenom} ${u.nom}`.trim();
    let vendeur = await prisma.vendeur.findFirst({ where: { nomComplet } });
    if (!vendeur) {
      vendeur = await prisma.vendeur.create({ data: { nomComplet, lieuId: lieuBoutique.id } });
    }
    vendeurParAncienId.set(u.id_utilisateur, vendeur);
  }
  console.log(`[import] ${vendeurParAncienId.size} vendeurs prêts (Victoria, Anissa, Oriane).`);

  // ------------------------------------------------------------------
  // 6. CLIENTS
  // ------------------------------------------------------------------
  const clientParAncienId = new Map();
  for (const c of data.clients) {
    const nomComplet = `${c.prenom || ''} ${c.nom}`.trim();
    const client = await prisma.client.create({
      data: {
        nomComplet,
        telephone: c.telephone || null,
        email: c.email || null,
        createdAt: new Date(c.date_creation),
      },
    });
    clientParAncienId.set(c.id_client, client.id);
  }
  console.log(`[import] ${clientParAncienId.size} clients créés.`);

  // ------------------------------------------------------------------
  // 7. VENTES + LIGNES + PAIEMENTS
  // ------------------------------------------------------------------
  const lignesParVente = new Map();
  for (const d of data.details) {
    if (!lignesParVente.has(d.id_vente)) lignesParVente.set(d.id_vente, []);
    lignesParVente.get(d.id_vente).push(d);
  }

  let venteCreees = 0;
  let venteIgnorees = 0;
  const numerosUtilises = new Set();
  for (const v of data.ventes) {
    const lignesSource = lignesParVente.get(v.id_vente) || [];
    if (lignesSource.length === 0) { venteIgnorees += 1; continue; }

    // Toutes les lignes doivent référencer un article importé, sinon on saute
    // cette vente (ne devrait pas arriver, sécurité).
    const lignesValides = lignesSource.filter((l) => articleParAncienId.has(l.id_produit));
    if (lignesValides.length === 0) { venteIgnorees += 1; continue; }

    let numero = v.numero_vente || `IMPORT-${v.id_vente}`;
    if (numerosUtilises.has(numero)) numero = `${numero}-${v.id_vente}`;
    numerosUtilises.add(numero);

    const vendeur = vendeurParAncienId.get(v.id_utilisateur);
    const clientId = v.id_client ? clientParAncienId.get(v.id_client) || null : null;
    const totalNet = Number(v.montant_total);
    const paiements = v.statut === 'Annulée' ? [] : parserPaiements(v.mode_paiement, totalNet);

    const vente = await prisma.vente.create({
      data: {
        numero,
        clientId,
        utilisateurId: admin.id,
        vendeurId: vendeur ? vendeur.id : null,
        lieuId: lieuBoutique.id,
        statut: v.statut === 'Annulée' ? 'ANNULEE' : 'VALIDEE',
        totalHT: totalNet + Number(v.reduction || 0),
        remiseMontant: Number(v.reduction || 0),
        totalNet,
        modePaiement: v.mode_paiement || null,
        createdAt: new Date(v.date_vente),
        lignes: {
          create: lignesValides.map((l) => ({
            articleId: articleParAncienId.get(l.id_produit).id,
            quantite: l.quantite,
            prixUnitaire: l.prix_unitaire,
          })),
        },
        paiements: { create: paiements.map((p) => ({ mode: p.mode, montant: p.montant })) },
      },
    });
    venteCreees += 1;
    if (venteCreees % 50 === 0) console.log(`[import] ${venteCreees} ventes importées...`);
  }
  console.log(`[import] ${venteCreees} ventes importées, ${venteIgnorees} ignorées (sans ligne exploitable).`);

  console.log('[import] Terminé avec succès.');
}

main()
  .catch((e) => { console.error('[import] ERREUR:', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
