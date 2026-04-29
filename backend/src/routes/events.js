const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();
const prisma = require('../db');

router.use(authMiddleware);

// GET /api/events
router.get('/', async (req, res) => {
  try {
    const events = await prisma.event.findMany({
      where: { professionalId: req.userId },
      orderBy: { date: 'desc' },
      include: {
        _count: { select: { participations: true } }
      }
    });
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar eventos' });
  }
});

// POST /api/events
router.post('/', async (req, res) => {
  try {
    const { title, description, date, type, url } = req.body;
    const event = await prisma.event.create({
      data: {
        professionalId: req.userId,
        title,
        description,
        date: new Date(date),
        type,
        url
      }
    });
    res.status(201).json(event);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar evento', details: err.message });
  }
});

// GET /api/events/:id
router.get('/:id', async (req, res) => {
  try {
    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: {
        participations: {
          include: { patient: true }
        }
      }
    });
    if (!event) return res.status(404).json({ error: 'Evento não encontrado' });
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar evento' });
  }
});

// POST /api/events/:id/participation
router.post('/:id/participation', async (req, res) => {
  try {
    const { patientId, status } = req.body;
    const participation = await prisma.eventParticipation.upsert({
      where: {
        eventId_patientId: {
          eventId: req.params.id,
          patientId
        }
      },
      create: {
        eventId: req.params.id,
        patientId,
        status: status || 'confirmed'
      },
      update: {
        status: status || 'confirmed'
      }
    });
    res.json(participation);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao registrar participação', details: err.message });
  }
});

module.exports = router;
