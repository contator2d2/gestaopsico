const express = require('express');

const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const prisma = require('../db');

router.use(authMiddleware);

// GET /api/tasks?patientId=...
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

    const tasks = await prisma.task.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' }
    });
    res.json(tasks);
  } catch (err) {
    console.error('Error fetching tasks:', err);
    res.status(500).json({ error: 'Erro ao listar tarefas', details: err.message });
  }
});

// POST /api/tasks
router.post('/', async (req, res) => {
  try {
    const { patientId, title, description, dueDate } = req.body;
    const task = await prisma.task.create({
      data: {
        patientId,
        title,
        description,
        status: 'pending',
        dueDate: dueDate ? new Date(dueDate) : null,
      }
    });
    res.status(201).json(task);
  } catch (err) {
    console.error('Error creating task:', err);
    res.status(500).json({ error: 'Erro ao criar tarefa', details: err.message });
  }
});

// PUT /api/tasks/:id
router.put('/:id', async (req, res) => {
  try {
    const { title, description, status, dueDate, completedAt } = req.body;
    const updateData = {
      title,
      description,
      status,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      completedAt: completedAt ? new Date(completedAt) : (status === 'completed' ? new Date() : undefined),
    };

    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: updateData
    });
    res.json(task);
  } catch (err) {
    console.error('Error updating task:', err);
    res.status(500).json({ error: 'Erro ao atualizar tarefa', details: err.message });
  }
});

// POST /api/tasks/:id/check-in
router.post('/:id/check-in', async (req, res) => {
  try {
    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: {
        status: 'completed',
        completedAt: new Date()
      }
    });
    res.json(task);
  } catch (err) {
    console.error('Error check-in task:', err);
    res.status(500).json({ error: 'Erro ao registrar execução', details: err.message });
  }
});

// DELETE /api/tasks/:id
router.delete('/:id', async (req, res) => {
  try {
    await prisma.task.delete({
      where: { id: req.params.id }
    });
    res.json({ message: 'Tarefa excluída' });
  } catch (err) {
    console.error('Error deleting task:', err);
    res.status(500).json({ error: 'Erro ao excluir tarefa', details: err.message });
  }
});

module.exports = router;
