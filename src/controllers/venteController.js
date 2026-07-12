const prisma = require('../lib/prisma');
const { appliquerMouvementStock } = require('../lib/stock');

const SEUIL_FIDELITE_MONTANT = 20000; // franc CFA, par achat
const SEUIL_FIDELITE_ACHATS = 10; // achats consécutifs

function genererNumeroVente() {
  const maintenant = new Date();
  return `V-${maintenant.getTime()}`;
}

// Met à jour le compteur de fidélité du client après une vente validée.
// Casse la série si l'achat est en dessous du seuil ; déclenche une récompense au 10e.
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
//         carteCadeauCode?, lignes: [{ articleId, quantite, prixUnitaire, remiseLigne? }],
//         paiements: [{ mode, montant }, ...] }
// "paiements" remplace l'ancien "modePaiement" unique : une vente peut être réglée par
// plusieurs modes à la fois (ex: moitié espèces + moitié Wave). La somme des montants
// doit correspondre exactement au total net de la vente.
async function creerVente(req, res) {
  const {
    clientId, vendeurId, lieuId, remiseMontant, motifRemise,
    carteCadeauCode, lignes, paiements,
  } = req.body;
  const utilisateurId = req.user.id;

  if (!lieuId || !Array.isArray(lignes) || lignes.length === 0) {
    return res.status(400).json({ error: 'Lieu de vente et au moins une ligne sont requis.' });
  }
  if (!Array.isArray(paiements) || paiements.length === 0) {
    return res.status(400).json({ error: 'Au moins un mode de paiement est requis.' });
  }
  for (const p of paiements) {
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

      const totalPaiements = paiements.reduce((s, p) => s + Number(p.montant), 0);
      // Tolérance d'arrondi de 1 franc pour éviter les faux positifs liés aux décimales.
      if (Math.abs(totalPaiements - totalNet) > 1) {
        throw new Error(
          `Le total des paiements (${totalPaiements}) ne correspond pas au total de la vente (${totalNet}).`
        );
      }

      // Carte cadeau utilisée en paiement (total ou partiel selon sa dénomination)
      let carteCadeau = null;
      if (carteCadeauCode) {
        carteCadeau = await tx.carteCadeau.findUnique({ where: { codeBarre: carteCadeauCode } });
        if (!carteCadeau) throw new Error('Carte cadeau introuvable.');
        if (carteCadeau.statut !== 'ACTIVE') throw new Error("Cette carte cadeau n'est pas active.");
      }

      // Le champ modePaiement (unique) est conservé pour compat/affichage rapide : on y met
      // la liste des modes utilisés, séparés par virgule (ex: "Espèces, Wave").
      const modePaiementResume = paiements.map((p) => p.mode).join(', ');

      const vente = await tx.vente.create({
        data: {
          numero: genererNumeroVente(),
          clientId: clientId ? Number(clientId) : null,
          vendeurId: vendeurId ? Number(vendeurId) : null,
          lieuId: Number(lieuId),
          utilisateurId,
          totalHT,
          remiseMontant: remise,
          totalNet,
          modePaiement: modePaiementResume,
          carteCadeauUtiliseeId: carteCadeau ? carteCadeau.id : null,
          lignes: {
            create: lignes.map((l) => ({
              articleId: Number(l.articleId),
              quantite: Number(l.quantite),
              prixUnitaire: l.prixUnitaire,
              remiseLigne: l.remiseLigne || 0,
            })),
          },
          paiements: {
            create: paiements.map((p) => ({
              mode: p.mode,
              montant: Number(p.montant),
            })),
          },
        },
        include: { lignes: true, paiements: true },
      });

      // Décompte du stock au lieu de vente
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

      // Clôture du cycle de la carte cadeau utilisée
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

      // Demande de remise à approuver à distance par Victoria (traçabilité, pas bloquant)
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

      // Mise à jour de la fidélité, uniquement si un client est identifié
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

// POST /api/ventes/:id/annuler   body: { motif }
// Réinjecte le stock au lieu d'origine de la vente et réactive une éventuelle carte cadeau utilisée.
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

// GET /api/ventes?statut=&lieuId=&clientId=
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
