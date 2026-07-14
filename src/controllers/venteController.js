const prisma = require('../lib/prisma');
const { appliquerMouvementStock } = require('../lib/stock');

const SEUIL_FIDELITE_MONTANT = 20000;
const SEUIL_FIDELITE_ACHATS = 10;

function genererNumeroVente() {
  const maintenant = new Date();
  return `V-${maintenant.getTime()}`;
}

async function mettreAJourFidelite(tx, clientId, totalNet) {
  const client = await tx.client.findUnique({ where: { id: clientId } });
  if (!client) return;

  if (Number(totalNet) < SEUIL_FIDELITE_MONTANT) {
    await tx.client.update({
      where: { id: clientId },
      data: { achatsConsecutifs: 0, montantCumuleConsecutif: 0 },
    });
    return;
  }

  const nouveauCompteur = client.achatsConsecutifs + 1;
  const nouveauCumul = Number(client.montantCumuleConsecutif) + Number(totalNet);

  if (nouveauCompteur >= SEUIL_FIDELITE_ACHATS) {
    await tx.recompenseFidelite.create({
      data: { clientId, montantCumule: nouveauCumul },
    });
    await tx.client.update({
      where: { id: clientId },
      data: { achatsConsecutifs: 0, montantCumuleConsecutif: 0 },
    });
  } else {
    await tx.client.update({
      where: { id: clientId },
      data: { achatsConsecutifs: nouveauCompteur, montantCumuleConsecutif: nouveauCumul },
    });
  }
}

// POST /api/ventes
// body: { clientId?, vendeurId?, lieuId, remiseMontant?, motifRemise?,
//         carteCadeauCode?, avoirCode?, typeVente? ('COMPTANT' par défaut ou 'CREDIT'),
//         lignes: [...], paiements: [{ mode, montant }, ...] }
// Un avoir couvre jusqu'à sa valeur le total de la vente ; s'il dépasse le total,
// l'excédent est perdu (avoir toujours consommé en entier). Ce qu'il ne couvre pas
// doit être réglé par les paiements classiques (ou laissé en crédit si typeVente=CREDIT).
async function creerVente(req, res) {
  const {
    clientId, vendeurId, lieuId, remiseMontant, motifRemise,
    carteCadeauCode, avoirCode, typeVente, lignes, paiements,
  } = req.body;
  const utilisateurId = req.user.id;

  const type = typeVente === 'CREDIT' ? 'CREDIT' : 'COMPTANT';

  if (!lieuId || !Array.isArray(lignes) || lignes.length === 0) {
    return res.status(400).json({ error: 'Lieu de vente et au moins une ligne sont requis.' });
  }

  const listePaiements = Array.isArray(paiements) ? paiements : [];

  for (const p of listePaiements) {
    if (!p.mode || !(Number(p.montant) > 0)) {
      return res.status(400).json({ error: 'Chaque paiement doit avoir un mode et un montant positif.' });
    }
  }

  try {
    const resultat = await prisma.$transaction(async (tx) => {
      const totalHT = lignes.reduce(
        (somme, l) => somme + Number(l.prixUnitaire) * Number(l.quantite) - Number(l.remiseLigne || 0),
        0
      );
      const remise = Number(remiseMontant || 0);
      let totalNet = totalHT - remise;

      // Avoir : vérifié et réservé avant tout calcul de reste à payer.
      let avoir = null;
      let contributionAvoir = 0;
      if (avoirCode) {
        avoir = await tx.avoir.findUnique({ where: { reference: avoirCode } });
        if (!avoir) throw new Error('Avoir introuvable.');
        if (avoir.statut !== 'ACTIF') throw new Error("Cet avoir n'est pas actif (déjà utilisé).");
        contributionAvoir = Math.min(Number(avoir.montant), totalNet);
      }

      const totalPaiements = listePaiements.reduce((s, p) => s + Number(p.montant), 0);
      const totalCouvert = totalPaiements + contributionAvoir;
      const resteApresPaiements = totalNet - totalCouvert;

      if (type === 'COMPTANT') {
        if (Math.abs(resteApresPaiements) > 1) {
          throw new Error(
            resteApresPaiements > 0
              ? `Il manque ${resteApresPaiements.toFixed(2)} F pour couvrir le total.`
              : `Le total des paiements dépasse le montant de ${Math.abs(resteApresPaiements).toFixed(2)} F.`
          );
        }
      } else {
        if (resteApresPaiements < -1) {
          throw new Error(`Le total des paiements dépasse le montant de ${Math.abs(resteApresPaiements).toFixed(2)} F.`);
        }
      }
      if (type === 'COMPTANT' && listePaiements.length === 0 && contributionAvoir === 0) {
        throw new Error('Ajoutez au moins un mode de paiement.');
      }

      let carteCadeau = null;
      if (carteCadeauCode) {
        carteCadeau = await tx.carteCadeau.findUnique({ where: { codeBarre: carteCadeauCode } });
        if (!carteCadeau) throw new Error('Carte cadeau introuvable.');
        if (carteCadeau.statut !== 'ACTIVE') throw new Error("Cette carte cadeau n'est pas active.");
      }

      const modePaiementResume =
        listePaiements.map((p) => p.mode).join(', ') +
        (avoir ? (listePaiements.length ? ', Avoir' : 'Avoir') : '') ||
        (type === 'CREDIT' ? 'Crédit' : '');

      const vente = await tx.vente.create({
        data: {
          numero: genererNumeroVente(),
          clientId: clientId ? Number(clientId) : null,
          vendeurId: vendeurId ? Number(vendeurId) : null,
          lieuId: Number(lieuId),
          utilisateurId,
          typeVente: type,
          totalHT,
          remiseMontant: remise,
          totalNet,
          modePaiement: modePaiementResume,
          carteCadeauUtiliseeId: carteCadeau ? carteCadeau.id : null,
          avoirUtiliseId: avoir ? avoir.id : null,
          lignes: {
            create: lignes.map((l) => ({
              articleId: Number(l.articleId),
              quantite: Number(l.quantite),
              prixUnitaire: l.prixUnitaire,
              remiseLigne: l.remiseLigne || 0,
            })),
          },
          paiements: {
            create: listePaiements.map((p) => ({
              mode: p.mode,
              montant: Number(p.montant),
            })),
          },
        },
        include: { lignes: true, paiements: true },
      });

      for (const ligne of vente.lignes) {
        await appliquerMouvementStock(tx, {
          articleId: ligne.articleId,
          lieuId: Number(lieuId),
          delta: -ligne.quantite,
          type: 'SORTIE_VENTE',
          utilisateurId,
          refVenteId: vente.id,
          notes: `Vente ${vente.numero}`,
        });
      }

      if (carteCadeau) {
        await tx.carteCadeau.update({
          where: { id: carteCadeau.id },
          data: { statut: 'UTILISEE' },
        });
        const cycleOuvert = await tx.carteCadeauCycle.findFirst({
          where: { carteCadeauId: carteCadeau.id, dateUtilisation: null },
          orderBy: { dateActivation: 'desc' },
        });
        if (cycleOuvert) {
          await tx.carteCadeauCycle.update({
            where: { id: cycleOuvert.id },
            data: { dateUtilisation: new Date() },
          });
        }
      }

      if (avoir) {
        await tx.avoir.update({
          where: { id: avoir.id },
          data: { statut: 'UTILISE', dateUtilisation: new Date() },
        });
      }

      if (remise > 0) {
        await tx.demandeRemise.create({
          data: {
            venteId: vente.id,
            demandeurId: utilisateurId,
            montantDemande: remise,
            motif: motifRemise || null,
          },
        });
      }

      if (clientId) {
        await mettreAJourFidelite(tx, Number(clientId), totalNet);
      }

      return vente;
    }, { maxWait: 10000, timeout: 20000 });

    res.status(201).json(resultat);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function annulerVente(req, res) {
  const id = Number(req.params.id);
  const { motif } = req.body;
  const utilisateurId = req.user.id;

  try {
    const resultat = await prisma.$transaction(async (tx) => {
      const vente = await tx.vente.findUnique({ where: { id }, include: { lignes: true } });
      if (!vente) throw new Error('Vente introuvable.');
      if (vente.statut === 'ANNULEE') throw new Error('Cette vente est déjà annulée.');

      for (const ligne of vente.lignes) {
        await appliquerMouvementStock(tx, {
          articleId: ligne.articleId,
          lieuId: vente.lieuId,
          delta: ligne.quantite,
          type: 'ANNULATION_VENTE',
          utilisateurId,
          refVenteId: vente.id,
          notes: `Annulation vente ${vente.numero}${motif ? ' - ' + motif : ''}`,
        });
      }

      if (vente.carteCadeauUtiliseeId) {
        await tx.carteCadeau.update({
          where: { id: vente.carteCadeauUtiliseeId },
          data: { statut: 'ACTIVE' },
        });
        const dernierCycle = await tx.carteCadeauCycle.findFirst({
          where: { carteCadeauId: vente.carteCadeauUtiliseeId },
          orderBy: { dateActivation: 'desc' },
        });
        if (dernierCycle) {
          await tx.carteCadeauCycle.update({
            where: { id: dernierCycle.id },
            data: { dateUtilisation: null },
          });
        }
      }

      if (vente.avoirUtiliseId) {
        await tx.avoir.update({
          where: { id: vente.avoirUtiliseId },
          data: { statut: 'ACTIF', dateUtilisation: null },
        });
      }

      return tx.vente.update({
        where: { id },
        data: { statut: 'ANNULEE', dateAnnulation: new Date(), motifAnnulation: motif || null },
      });
    }, { maxWait: 10000, timeout: 20000 });

    res.json(resultat);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function listerVentes(req, res) {
  const { statut, lieuId, clientId } = req.query;
  const where = {};
  if (statut) where.statut = statut;
  if (lieuId) where.lieuId = Number(lieuId);
  if (clientId) where.clientId = Number(clientId);

  const ventes = await prisma.vente.findMany({
    where,
    include: {
      lignes: { include: { article: true } },
      paiements: true,
      client: true,
      vendeur: true,
      utilisateur: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(ventes);
}

module.exports = { creerVente, annulerVente, listerVentes };