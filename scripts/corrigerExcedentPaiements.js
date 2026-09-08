// Corrige les ventes déjà enregistrées où la somme des paiements dépasse le
// total réel de la vente — cas classique d'une caissière ayant tapé le montant
// REÇU du client (ex. 10 000 F pour couvrir 7 500 F, afin de calculer la
// monnaie) sans que la monnaie rendue (2 500 F) ne soit déduite avant
// l'enregistrement. Corrigé pour les nouvelles ventes ; ce script rattrape
// les anciennes.
//
// Principe : pour chaque vente concernée, réduit le(s) dernier(s) paiement(s)
// (dans l'ordre d'ajout) du montant en trop, jusqu'à ce que la somme des
// paiements retombe exactement sur le total net de la vente — même logique
// que côté frontend (paiementsNetsPourEnregistrement dans Ventes.jsx).
//
// Sans danger à relancer : une fois une vente corrigée, elle ne réapparaît
// plus dans le lot à traiter (somme des paiements == totalNet).
const prisma = require('../src/lib/prisma');

async function main() {
  const ventes = await prisma.vente.findMany({
    where: { statut: 'VALIDEE' },
    include: { paiements: { orderBy: { id: 'asc' } } },
  });

  let nbCorrigees = 0;
  let totalExcedentCorrige = 0;
  const detail = [];

  for (const vente of ventes) {
    if (vente.paiements.length === 0) continue;
    const sommePaiements = vente.paiements.reduce((s, p) => s + Number(p.montant), 0);
    let excedent = sommePaiements - Number(vente.totalNet);
    if (excedent <= 1) continue; // tolérance d'arrondi

    const excedentInitial = excedent;
    const misesAJour = [];
    for (let i = vente.paiements.length - 1; i >= 0 && excedent > 0; i--) {
      const p = vente.paiements[i];
      const montantActuel = Number(p.montant);
      const retrait = Math.min(excedent, montantActuel);
      if (retrait <= 0) continue;
      const nouveauMontant = montantActuel - retrait;
      misesAJour.push({ id: p.id, mode: p.mode, ancien: montantActuel, nouveau: nouveauMontant });
      excedent -= retrait;
    }

    await prisma.$transaction(
      misesAJour.map((m) => prisma.paiementVente.update({ where: { id: m.id }, data: { montant: m.nouveau } }))
    );

    nbCorrigees += 1;
    totalExcedentCorrige += excedentInitial;
    detail.push({ numero: vente.numero, date: vente.createdAt.toISOString().slice(0, 10), excedent: excedentInitial, misesAJour });
  }

  console.log(`[correction-excedent] ${nbCorrigees} vente(s) corrigée(s), ${totalExcedentCorrige.toLocaleString('fr-FR')} F d'excédent retiré au total.`);
  for (const d of detail) {
    console.log(`  - ${d.numero} (${d.date}) : -${d.excedent} F`, d.misesAJour.map((m) => `${m.mode} ${m.ancien}->${m.nouveau}`).join(', '));
  }
}

main()
  .catch((e) => { console.error('[correction-excedent] ERREUR:', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
