// Met en minuscule tous les identifiants de connexion déjà enregistrés, pour
// rester cohérent avec la connexion désormais insensible à la casse. Sans
// danger à relancer à chaque démarrage : une fois tout en minuscule, cette
// requête ne change plus rien (WHERE ... != LOWER(...) ne matche alors aucune ligne).
const prisma = require('../src/lib/prisma');

async function main() {
  const resultat = await prisma.$executeRawUnsafe(
    `UPDATE "Utilisateur" SET "nomUtilisateur" = LOWER("nomUtilisateur") WHERE "nomUtilisateur" <> LOWER("nomUtilisateur");`
  );
  if (resultat > 0) {
    console.log(`[normalisation] ${resultat} identifiant(s) de connexion mis en minuscule.`);
  }
}

main()
  .catch((e) => { console.error('[normalisation] ERREUR:', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
