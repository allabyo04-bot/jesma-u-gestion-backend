// Règles de fidélité partagées (ventes, annulations, script de recalcul).
const SEUIL_FIDELITE_MONTANT = 20000;
const SEUIL_FIDELITE_ACHATS = 10;

// Comptes génériques qui ne sont pas de vrais clients : aucune fidélité, jamais
// de récompense. (On ne peut pas les marquer « Client Comptoir » : le logiciel
// prendrait alors l'un d'eux comme client par défaut des ventes.)
// Noms comparés sans tenir compte des majuscules.
const NOMS_SANS_FIDELITE = ['livraison'];

function estClientSansFidelite(client) {
  if (!client) return true;
  if (client.estComptoir) return true;
  return NOMS_SANS_FIDELITE.includes(String(client.nomComplet || '').trim().toLowerCase());
}

module.exports = { SEUIL_FIDELITE_MONTANT, SEUIL_FIDELITE_ACHATS, NOMS_SANS_FIDELITE, estClientSansFidelite };
