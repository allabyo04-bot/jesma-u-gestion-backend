const prisma = require('../lib/prisma');

// GET /api/clients?q=recherche
async function listerClients(req, res) {
  const { q } = req.query;
  const where = q
    ? { OR: [{ nomComplet: { contains: q, mode: 'insensitive' } }, { telephone: { contains: q } }] }
    : {};
  const clients = await prisma.client.findMany({ where, orderBy: { nomComplet: 'asc' } });
  res.json(clients);
}

// POST /api/clients   { nomComplet, telephone, email? }
async function creerClient(req, res) {
  const { nomComplet, telephone, email } = req.body;
  if (!nomComplet) return res.status(400).json({ error: 'Nom complet requis.' });
  if (!telephone || !telephone.trim()) return res.status(400).json({ error: 'Le téléphone est requis.' });

  const client = await prisma.client.create({
    data: { nomComplet, telephone: telephone.trim(), email: email || null },
  });
  res.status(201).json(client);
}

// GET /api/clients/:id
async function obtenirClient(req, res) {
  const client = await prisma.client.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      recompensesFidelite: true,
      ventes: {
        where: { statut: 'VALIDEE' },
        include: { lignes: { include: { article: true } }, lieu: true, vendeur: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!client) return res.status(404).json({ error: 'Client introuvable.' });
  res.json(client);
}

// PUT /api/clients/:id   { nomComplet?, telephone?, email? }
async function modifierClient(req, res) {
  const id = Number(req.params.id);
  const { nomComplet, telephone, email } = req.body;

  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return res.status(404).json({ error: 'Client introuvable.' });

  if (telephone !== undefined && !telephone.trim()) {
    return res.status(400).json({ error: 'Le téléphone est requis.' });
  }

  const misAJour = await prisma.client.update({
    where: { id },
    data: {
      nomComplet: nomComplet ?? client.nomComplet,
      telephone: telephone !== undefined ? telephone.trim() : client.telephone,
      email: email !== undefined ? (email || null) : client.email,
    },
  });
  res.json(misAJour);
}

module.exports = { listerClients, creerClient, obtenirClient, modifierClient };
