// Recalcule le compteur de fidélité de chaque client à partir de ses ventes
// réelles, pour rattraper les compteurs remis à 0 à tort par l'ancienne règle
// (un achat sous 20 000 F remettait le compteur à 0).
//
// Calcul pour chaque client (hors Client Comptoir) :
//   compteur = (ventes validées d'au moins 20 000 F depuis le lancement)
//              - 10 x (récompenses déjà créées pour ce client)
//
// Deux commandes, à lancer dans la console Railway du backend :
//   node scripts/recalculerFidelite.js            -> APERÇU seulement, ne modifie rien
//   node scripts/recalculerFidelite.js appliquer  -> applique, en tout ou rien
//
// Sans danger à relancer : le résultat du calcul est toujours le même.
// Les comptes génériques (ex. « Livraison ») sont ignorés.
// Si un client dépasse 10 après recalcul, il a mérité une récompense qu'il n'a
// pas reçue : le script ne la crée pas, il le signale, et la récompense sera
// créée automatiquement à son prochain achat d'au moins 20 000 F.
const prisma = require('../src/lib/prisma');

const { SEUIL_FIDELITE_MONTANT, SEUIL_FIDELITE_ACHATS, estClientSansFidelite } = require('../src/lib/fidelite');
// Date de mise en service du logiciel : les ventes importées de l'ancien
// logiciel (antérieures) ne comptent pas.
const DATE_LANCEMENT = new Date('2026-08-14T00:00:00');

async function main() {
  const appliquer = process.argv[2] === 'appliquer';

  const tousLesClients = await prisma.client.findMany({
    where: { estComptoir: false },
    orderBy: { nomComplet: 'asc' },
  });
  // Comptes génériques (ex. « Livraison ») : pas de fidélité, ignorés ici.
  const clients = tousLesClients.filter((c) => !estClientSansFidelite(c));
  const ignores = tousLesClients.filter((c) => estClientSansFidelite(c)).map((c) => c.nomComplet);

  const ventes = await prisma.vente.findMany({
    where: {
      statut: 'VALIDEE',
      clientId: { not: null },
      totalNet: { gte: SEUIL_FIDELITE_MONTANT },
      createdAt: { gte: DATE_LANCEMENT },
    },
    select: { clientId: true, totalNet: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  const recompenses = await prisma.recompenseFidelite.groupBy({
    by: ['clientId'],
    _count: { _all: true },
  });
  const nbRecompenses = Object.fromEntries(recompenses.map((r) => [r.clientId, r._count._all]));

  const ventesParClient = {};
  for (const v of ventes) {
    (ventesParClient[v.clientId] = ventesParClient[v.clientId] || []).push(v);
  }

  const modifications = [];
  const adExaminer = [];
  let nbDejaCorrects = 0;

  for (const c of clients) {
    const qualifiantes = ventesParClient[c.id] || [];
    const consommees = (nbRecompenses[c.id] || 0) * SEUIL_FIDELITE_ACHATS;
    const nouveau = Math.max(0, qualifiantes.length - consommees);
    // Montant cumulé = somme des achats encore comptés (les plus récents).
    const nouveauCumul = qualifiantes.slice(0, nouveau).reduce((s, v) => s + Number(v.totalNet), 0);

    if (nouveau >= SEUIL_FIDELITE_ACHATS) adExaminer.push({ nom: c.nomComplet, compteur: nouveau });

    if (nouveau === c.achatsConsecutifs && Math.round(nouveauCumul) === Math.round(Number(c.montantCumuleConsecutif))) {
      nbDejaCorrects += 1;
      continue;
    }
    modifications.push({ id: c.id, nom: c.nomComplet, ancien: c.achatsConsecutifs, nouveau, nouveauCumul });
  }

  console.log(`[fidelite] ${clients.length} client(s) examiné(s), ${nbDejaCorrects} déjà correct(s), ${modifications.length} à corriger.`);
  if (ignores.length > 0) console.log(`[fidelite] Comptes génériques ignorés : ${ignores.join(', ')}`);
  for (const m of modifications) {
    console.log(`  - ${m.nom} : ${m.ancien} -> ${m.nouveau}`);
  }
  if (adExaminer.length > 0) {
    console.log('[fidelite] À examiner (10 achats atteints ou dépassés, récompense non créée) :');
    for (const a of adExaminer) console.log(`  - ${a.nom} : ${a.compteur}`);
  }

  if (!appliquer) {
    console.log('[fidelite] APERÇU seulement, rien n\'a été modifié.');
    console.log('[fidelite] Pour appliquer : node scripts/recalculerFidelite.js appliquer');
    return;
  }

  await prisma.$transaction(
    modifications.map((m) => prisma.client.update({
      where: { id: m.id },
      data: { achatsConsecutifs: m.nouveau, montantCumuleConsecutif: m.nouveauCumul },
    })),
  );
  console.log(`[fidelite] ${modifications.length} compteur(s) corrigé(s).`);
}

main()
  .catch((e) => { console.error('[fidelite] ERREUR:', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
