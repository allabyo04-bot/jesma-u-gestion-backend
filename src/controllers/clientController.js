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

// POST /api/clients   { nomComplet, telephone?, email? }
async function creerClient(req, res) {
  const { nomComplet, telephone, email } = req.body;
  if (!nomComplet) return res.status(400).json({ error: 'Nom complet requis.' });

  const client = await prisma.client.create({
    data: { nomComplet, telephone: telephone || null, email: email || null },
  });
  res.status(201).json(client);
}

// GET /api/clients/:id
async function obtenirClient(req, res) {
  const client = await prisma.client.findUnique({
    where: { id: Number(req.params.id) },
    include: { recompensesFidelite: true },
  });
  if (!client) return res.status(404).json({ error: 'Client introuvable.' });
  res.json(client);
}

module.exports = { listerClients, creerClient, obtenirClient };
