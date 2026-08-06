const prisma = require('../lib/prisma');
const jeko = require('../lib/jeko');

// POST /api/webhooks/jeko
// req.body est ici un Buffer BRUT (voir server.js — express.raw sur cette route,
// avant express.json global), nécessaire pour que la vérification de signature
// HMAC porte sur les octets exacts envoyés par JEKO.
async function recevoirWebhookJeko(req, res) {
  const signature = req.headers['jeko-signature'];
  console.log(`Webhook JEKO reçu — signature présente : ${!!signature}, taille du corps : ${req.body?.length || 0} octets`);

  if (!jeko.verifierSignatureWebhook(req.body, signature)) {
    console.error('Webhook JEKO : signature invalide ou secret manquant — vérifier JEKO_WEBHOOK_SECRET.');
    return res.status(401).json({ error: 'Signature invalide.' });
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch {
    console.error('Webhook JEKO : corps de requête non JSON.');
    return res.status(400).json({ error: 'Corps de requête invalide.' });
  }

  // Réponse immédiate — JEKO attend un 200 sous 5 secondes.
  res.status(200).json({ received: true });

  try {
    const data = payload.data || payload;
    console.log(`Webhook JEKO : transactionType=${data.transactionType}, status=${data.status}, paymentLinkId=${data.transactionDetails?.paymentLinkId}`);
    if (data.transactionType === 'payment' && data.status === 'success') {
      const paymentLinkId = data.transactionDetails?.paymentLinkId;
      if (paymentLinkId) {
        // Ne confirme QUE les offres encore en attente de vérification et payées en JEKO —
        // ne touche jamais une offre carte cadeau ou déclarative (Espèces, Wave déclaré...).
        const resultat = await prisma.listeCadeauCarteUtilisee.updateMany({
          where: { jekoPaymentLinkId: paymentLinkId, modePaiement: 'JEKO', statutConfirmation: 'EN_ATTENTE_VERIFICATION' },
          data: { statutConfirmation: 'CONFIRME', dateValidation: new Date() },
        });
        console.log(`Webhook JEKO : ${resultat.count} offre(s) marquée(s) confirmée(s) pour paymentLinkId=${paymentLinkId}`);
      }
    }
  } catch (err) {
    console.error('Erreur traitement webhook JEKO :', err);
  }
}

module.exports = { recevoirWebhookJeko };
