const express = require('express');

const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const prisma = require('../db');

router.use(authMiddleware);

// GET /api/goals?patientId=...
router.get('/', async (req, res) => {
  try {
    let { patientId } = req.query;
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });

    // Se patientId for 'me', resolve para o patientId do usuário logado
    if (patientId === 'me') {
      const user = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { patientId: true }
      });
      if (!user?.patientId) {
        return res.status(403).json({ error: 'Este usuário não possui um perfil de paciente associado' });
      }
      patientId = user.patientId;
    }

    const goals = await prisma.goal.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' }
    });
    res.json(goals);
  } catch (err) {
    console.error('Error fetching goals:', err);
    res.status(500).json({ error: 'Erro ao listar objetivos', details: err.message });
  }
});

// POST /api/goals
router.post('/', async (req, res) => {
  try {
    let { patientId, title, description, status, progress, targetDate } = req.body;

    // Se patientId for 'me', resolve para o patientId do usuário logado
    if (patientId === 'me') {
      const user = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { patientId: true }
      });
      if (!user?.patientId) {
        return res.status(403).json({ error: 'Este usuário não possui um perfil de paciente associado' });
      }
      patientId = user.patientId;
    }

    const goal = await prisma.goal.create({
      data: {
        patientId,
        title,
        description,
        status: status || 'pending',
        progress: progress || 0,
        targetDate: targetDate ? new Date(targetDate) : null,
      }
    });
    res.status(201).json(goal);
  } catch (err) {
    console.error('Error creating goal:', err);
    res.status(500).json({ error: 'Erro ao criar objetivo', details: err.message });
  }
});

// PUT /api/goals/:id
router.put('/:id', async (req, res) => {
  try {
    const { title, description, status, progress, targetDate, completedAt } = req.body;
    const updateData = {
      title,
      description,
      status,
      progress,
      targetDate: targetDate ? new Date(targetDate) : undefined,
      completedAt: completedAt ? new Date(completedAt) : (status === 'completed' ? new Date() : undefined),
    };

    const goal = await prisma.goal.update({
      where: { id: req.params.id },
      data: updateData
    });
    res.json(goal);
  } catch (err) {
    console.error('Error updating goal:', err);
    res.status(500).json({ error: 'Erro ao atualizar objetivo', details: err.message });
  }
});

// DELETE /api/goals/:id
router.delete('/:id', async (req, res) => {
  try {
    await prisma.goal.delete({
      where: { id: req.params.id }
    });
    res.json({ message: 'Objetivo excluído' });
  } catch (err) {
    console.error('Error deleting goal:', err);
    res.status(500).json({ error: 'Erro ao excluir objetivo', details: err.message });
  }
});

module.exports = router;
