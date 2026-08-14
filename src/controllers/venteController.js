const prisma = require('../lib/prisma');
const { appliquerMouvementStock } = require('../lib/stock');
const { enregistrerActivite } = require('../lib/journal');
const { hacherCode } = require('./remiseParametreController');

const SEUIL_FIDELITE_MONTANT = 20000;
const SEUIL_FIDELITE_ACHATS = 10;

function genererNumeroVente() {
  const maintenant = new Date();
  return `V-${maintenant.getTime()}`;
}

async function mettreAJourFidelite(tx, clientId, totalNet) {
  const client = await tx.client.findUnique({ where: { id: clientId } });
  if (!client || client.estComptoir) return;

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
async function creerVente(req, res) {
  const {
    clientId, vendeurId, lieuId, remiseMontant, motifRemise,
    carteCadeauCode, avoirCode, proFormaId, typeVente, lignes, paiements,
    codeDeblocageRemise,
  } = req.body;
  const utilisateurId = req.user.id;

  const type = typeVente === 'CREDIT' ? 'CREDIT' : 'COMPTANT';

  if (!lieuId || !Array.isArray(lignes) || lignes.length === 0) {
    return res.status(400).json({ error: 'Lieu de vente et au moins une ligne sont requis.' });
  }
  if (!vendeurId) {
    return res.status(400).json({ error: 'Le vendeur est obligatoire.' });
  }

  // Une vente est toujours associée à un client, quitte à retomber sur "Client Comptoir"
  // si le frontend n'en a envoyé aucun (garde-fou côté serveur, en plus de celui du front).
  let clientIdFinal = clientId ? Number(clientId) : null;
  if (!clientIdFinal) {
    const comptoir = await prisma.client.findFirst({ where: { estComptoir: true } });
    if (!comptoir) {
      return res.status(400).json({ error: 'Aucun client sélectionné, et "Client Comptoir" n\'existe pas encore.' });
    }
    clientIdFinal = comptoir.id;
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

      let codeDeblocageValide = null;
      if (remise > 0) {
        const parametreRemise = await tx.parametreRemise.findUnique({ where: { id: 1 } });
        const seuilRemise = parametreRemise?.seuil != null ? Number(parametreRemise.seuil) : null;
        if (seuilRemise !== null && remise > seuilRemise) {
          if (!codeDeblocageRemise || !String(codeDeblocageRemise).trim()) {
            throw new Error(`Un code de déblocage administrateur est requis pour une remise supérieure à ${seuilRemise.toLocaleString('fr-FR')} F.`);
          }
          codeDeblocageValide = await tx.codeDeblocageRemise.findFirst({
            where: { codeHache: hacherCode(codeDeblocageRemise), utilise: false },
          });
          if (!codeDeblocageValide) {
            throw new Error("Code de déblocage invalide, déjà utilisé, ou expiré. Demandez-en un nouveau à l'administrateur.");
          }
        }
      }

      let avoir = null;
      let contributionAvoir = 0;
      if (avoirCode) {
        avoir = await tx.avoir.findUnique({ where: { reference: avoirCode } });
        if (!avoir) throw new Error('Avoir introuvable.');
        if (avoir.statut !== 'ACTIF') throw new Error("Cet avoir n'est pas actif (déjà utilisé).");
        contributionAvoir = Math.min(Number(avoir.montant), totalNet);
      }

      let carteCadeau = null;
      if (carteCadeauCode) {
        carteCadeau = await tx.carteCadeau.findUnique({ where: { codeBarre: carteCadeauCode } });
        if (!carteCadeau) throw new Error('Carte cadeau introuvable.');
        if (carteCadeau.statut !== 'ACTIVE') throw new Error("Cette carte cadeau n'est pas active.");
      }
      const contributionCarteCadeau = carteCadeau
        ? Math.min(Number(carteCadeau.denomination), totalNet - contributionAvoir)
        : 0;

      const totalPaiements = listePaiements.reduce((s, p) => s + Number(p.montant), 0);
      const totalCouvert = totalPaiements + contributionAvoir + contributionCarteCadeau;
      const resteApresPaiements = totalNet - totalCouvert;

      // Un excédent (le client donne plus que le total, la caissière lui rend la
      // monnaie) est normal et ne doit jamais bloquer la vente — seul un montant
      // insuffisant est refusé.
      if (type === 'COMPTANT' && resteApresPaiements > 1) {
        throw new Error(`Il manque ${resteApresPaiements.toFixed(2)} F pour couvrir le total.`);
      }
      if (type === 'COMPTANT' && listePaiements.length === 0 && contributionAvoir === 0 && contributionCarteCadeau === 0) {
        throw new Error('Ajoutez au moins un mode de paiement.');
      }

      const modePaiementResume =
        listePaiements.map((p) => p.mode).join(', ') +
        (avoir ? (listePaiements.length ? ', Avoir' : 'Avoir') : '') ||
        (type === 'CREDIT' ? 'Crédit' : '');

      const vente = await tx.vente.create({
        data: {
          numero: genererNumeroVente(),
          clientId: clientIdFinal,
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

      if (codeDeblocageValide) {
        await tx.codeDeblocageRemise.update({
          where: { id: codeDeblocageValide.id },
          data: { utilise: true, utiliseAt: new Date(), venteId: vente.id },
        });
      }

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

      if (proFormaId) {
        const proForma = await tx.factureProForma.findUnique({ where: { id: Number(proFormaId) } });
        if (!proForma) throw new Error('Facture pro forma introuvable.');
        if (proForma.statut !== 'EN_ATTENTE') throw new Error('Cette facture pro forma a déjà été utilisée ou annulée.');
        await tx.factureProForma.update({
          where: { id: proForma.id },
          data: { statut: 'UTILISEE', venteIssueId: vente.id },
        });
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

      await mettreAJourFidelite(tx, clientIdFinal, totalNet);

      return vente;
    }, { maxWait: 10000, timeout: 20000 });

    res.status(201).json(resultat);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// POST /api/ventes/:id/demander-annulation   { motif }
async function demanderAnnulation(req, res) {
  const id = Number(req.params.id);
  const { motif } = req.body;
  const utilisateurId = req.user.id;

  const vente = await prisma.vente.findUnique({ where: { id } });
  if (!vente) return res.status(404).json({ error: 'Vente introuvable.' });
  if (vente.statut === 'ANNULEE') return res.status(400).json({ error: 'Cette vente est déjà annulée.' });
  if (vente.demandeAnnulationEnCours) return res.status(400).json({ error: 'Une demande est déjà en attente pour cette vente.' });

  const misAJour = await prisma.vente.update({
    where: { id },
    data: {
      demandeAnnulationEnCours: true,
      motifDemandeAnnulation: motif || null,
      demandeurAnnulationId: utilisateurId,
      dateDemandeAnnulation: new Date(),
    },
  });

  res.json(misAJour);
}

// GET /api/ventes/demandes-annulation   (ADMIN uniquement)
async function listerDemandesAnnulation(req, res) {
  const ventes = await prisma.vente.findMany({
    where: { demandeAnnulationEnCours: true },
    include: {
      lignes: { include: { article: true } },
      client: true,
      vendeur: true,
      lieu: true,
      demandeurAnnulation: true,
    },
    orderBy: { dateDemandeAnnulation: 'desc' },
  });
  res.json(ventes);
}

// POST /api/ventes/:id/rejeter-annulation   (ADMIN uniquement)
async function rejeterAnnulation(req, res) {
  const id = Number(req.params.id);
  const vente = await prisma.vente.findUnique({ where: { id } });
  if (!vente) return res.status(404).json({ error: 'Vente introuvable.' });

  const misAJour = await prisma.vente.update({
    where: { id },
    data: {
      demandeAnnulationEnCours: false,
      motifDemandeAnnulation: null,
      demandeurAnnulationId: null,
      dateDemandeAnnulation: null,
    },
  });

  res.json(misAJour);
}

// POST /api/ventes/:id/annuler   body: { motif }   (ADMIN uniquement)
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

      await enregistrerActivite(tx, {
        type: 'ANNULATION_VENTE',
        description: `Vente ${vente.numero} annulée (${Number(vente.totalNet).toLocaleString('fr-FR')} F)${motif ? ' — motif : ' + motif : ''}`,
        utilisateurId,
      });

      return tx.vente.update({
        where: { id },
        data: {
          statut: 'ANNULEE',
          dateAnnulation: new Date(),
          motifAnnulation: motif || vente.motifDemandeAnnulation || null,
          demandeAnnulationEnCours: false,
          motifDemandeAnnulation: null,
          demandeurAnnulationId: null,
          dateDemandeAnnulation: null,
        },
      });
    }, { maxWait: 10000, timeout: 20000 });

    res.json(resultat);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// GET /api/ventes?statut=&lieuId=&clientId=
// Un caissier (non-ADMIN) ne voit jamais que les ventes du jour en cours, quels que
// soient les paramètres envoyés — c'est imposé ici côté serveur, pas juste caché
// côté écran, pour qu'il n'y ait aucun moyen de contourner cette limite.
async function listerVentes(req, res) {
  const { statut, lieuId, clientId } = req.query;
  const where = {};
  if (statut) where.statut = statut;
  if (lieuId) where.lieuId = Number(lieuId);
  if (clientId) where.clientId = Number(clientId);

  if (req.user.role !== 'ADMIN') {
    const debut = new Date();
    debut.setHours(0, 0, 0, 0);
    const fin = new Date();
    fin.setHours(23, 59, 59, 999);
    where.createdAt = { gte: debut, lte: fin };
  }

  const ventes = await prisma.vente.findMany({
    where,
    include: {
      lignes: { include: { article: true } },
      paiements: true,
      client: true,
      vendeur: true,
      utilisateur: true,
      lieu: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(ventes);
}

// GET /api/ventes/en-attente
// Visible depuis n'importe quel poste — une vente mise en attente par une caissière
// doit pouvoir être reprise par une autre, sur un autre ordinateur.
async function listerVentesEnAttente(req, res) {
  const ventes = await prisma.venteEnAttente.findMany({
    include: { utilisateur: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(ventes);
}

// POST /api/ventes/en-attente
async function creerVenteEnAttente(req, res) {
  const { lieuId, vendeurId, clientId, typeVente, remiseMontant, motifRemise, panier } = req.body;
  const utilisateurId = req.user.id;

  if (!Array.isArray(panier) || panier.length === 0) {
    return res.status(400).json({ error: 'Le panier est vide, rien à mettre en attente.' });
  }

  const venteEnAttente = await prisma.venteEnAttente.create({
    data: {
      utilisateurId,
      lieuId: lieuId ? Number(lieuId) : null,
      vendeurId: vendeurId ? Number(vendeurId) : null,
      clientId: clientId ? Number(clientId) : null,
      typeVente: typeVente || null,
      remiseMontant: remiseMontant ? Number(remiseMontant) : null,
      motifRemise: motifRemise || null,
      panier,
    },
  });
  res.status(201).json(venteEnAttente);
}

// DELETE /api/ventes/en-attente/:id
// Utilisée aussi bien pour "reprendre" (le frontend supprime après avoir repris le
// panier) que pour un abandon volontaire de la vente en attente.
async function supprimerVenteEnAttente(req, res) {
  const id = Number(req.params.id);
  try {
    await prisma.venteEnAttente.delete({ where: { id } });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: 'Vente en attente introuvable.' });
  }
}

module.exports = {
  creerVente, annulerVente, listerVentes,
  demanderAnnulation, listerDemandesAnnulation, rejeterAnnulation,
  listerVentesEnAttente, creerVenteEnAttente, supprimerVenteEnAttente,
};
