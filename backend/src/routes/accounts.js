const express = require('express');

const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const prisma = require('../db');

router.use(authMiddleware);

// GET /api/accounts - list accounts (contas a pagar/receber) with rich filters
router.get('/', async (req, res) => {
  try {
    const { type, status, category, startDate, endDate, period, patientId, page = 1, limit = 200 } = req.query;
    const where = { professionalId: req.userId };

    if (type) where.type = type;
    if (status) where.status = status;
    if (category) where.category = category;
    if (patientId) where.patientId = patientId;

    // Period shortcuts: this_month, next_month, last_month, open, overdue, ou YYYY-MM
    if (period) {
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth();
      const ymMatch = /^(\d{4})-(\d{1,2})$/.exec(period);
      if (ymMatch) {
        const yy = parseInt(ymMatch[1], 10);
        const mm = parseInt(ymMatch[2], 10) - 1;
        where.dueDate = { gte: new Date(yy, mm, 1), lte: new Date(yy, mm + 1, 0, 23, 59, 59) };
      } else if (period === 'this_month') {
        where.dueDate = { gte: new Date(y, m, 1), lte: new Date(y, m + 1, 0, 23, 59, 59) };
      } else if (period === 'next_month') {
        where.dueDate = { gte: new Date(y, m + 1, 1), lte: new Date(y, m + 2, 0, 23, 59, 59) };
      } else if (period === 'last_month') {
        where.dueDate = { gte: new Date(y, m - 1, 1), lte: new Date(y, m, 0, 23, 59, 59) };
      } else if (period === 'open') {
        where.status = { in: ['pending', 'overdue'] };
      } else if (period === 'overdue') {
        where.status = 'overdue';
        where.dueDate = { lt: new Date() };
      }
    } else if (startDate || endDate) {
      where.dueDate = {};
      if (startDate) where.dueDate.gte = new Date(startDate);
      if (endDate) where.dueDate.lte = new Date(endDate);
    }

    const [data, total] = await Promise.all([
      prisma.account.findMany({
        where,
        orderBy: { dueDate: 'asc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
        include: { patient: { select: { id: true, name: true, sessionValue: true, billingMode: true } } }
      }),
      prisma.account.count({ where })
    ]);

    res.json({ data, total });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar contas', details: err.message });
  }
});

// GET /api/accounts/summary - financial summary
router.get('/summary', async (req, res) => {
  try {
    const { month } = req.query;
    const now = new Date();
    const year = month ? parseInt(month.split('-')[0]) : now.getFullYear();
    const mon = month ? parseInt(month.split('-')[1]) - 1 : now.getMonth();
    const start = new Date(year, mon, 1);
    const end = new Date(year, mon + 1, 0);

    const accounts = await prisma.account.findMany({
      where: {
        professionalId: req.userId,
        dueDate: { gte: start, lte: end }
      }
    });

    const receivable = accounts.filter(a => a.type === 'receivable');
    const payable = accounts.filter(a => a.type === 'payable');

    const totalReceivable = receivable.reduce((s, a) => s + Number(a.value), 0);
    const totalPayable = payable.reduce((s, a) => s + Number(a.value), 0);
    const receivedAmount = receivable.filter(a => a.status === 'paid').reduce((s, a) => s + Number(a.value), 0);
    const paidAmount = payable.filter(a => a.status === 'paid').reduce((s, a) => s + Number(a.value), 0);
    const pendingReceivable = receivable.filter(a => a.status === 'pending').reduce((s, a) => s + Number(a.value), 0);
    const pendingPayable = payable.filter(a => a.status === 'pending').reduce((s, a) => s + Number(a.value), 0);
    const overdueReceivable = receivable.filter(a => a.status === 'overdue').reduce((s, a) => s + Number(a.value), 0);

    res.json({
      totalReceivable,
      totalPayable,
      receivedAmount,
      paidAmount,
      pendingReceivable,
      pendingPayable,
      overdueReceivable,
      cashFlow: receivedAmount - paidAmount,
      balance: totalReceivable - totalPayable
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter resumo financeiro', details: err.message });
  }
});

// GET /api/accounts/tab-summary - counts and totals for dashboard tabs
router.get('/tab-summary', async (req, res) => {
  try {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();

    const periods = {
      this_month: { gte: new Date(y, m, 1), lte: new Date(y, m + 1, 0, 23, 59, 59) },
      next_month: { gte: new Date(y, m + 1, 1), lte: new Date(y, m + 2, 0, 23, 59, 59) },
      last_month: { gte: new Date(y, m - 1, 1), lte: new Date(y, m, 0, 23, 59, 59) },
    };

    const results = {};

    // For each period
    for (const [key, range] of Object.entries(periods)) {
      const summary = await prisma.account.aggregate({
        where: {
          professionalId: req.userId,
          type: 'receivable',
          dueDate: range
        },
        _count: { id: true },
        _sum: { value: true }
      });
      results[key] = { count: summary._count.id, total: Number(summary._sum.value || 0) };
    }

    // For 'open' (pending + overdue)
    const openSummary = await prisma.account.aggregate({
      where: {
        professionalId: req.userId,
        type: 'receivable',
        status: { in: ['pending', 'overdue'] }
      },
      _count: { id: true },
      _sum: { value: true }
    });
    results['open'] = { count: openSummary._count.id, total: Number(openSummary._sum.value || 0) };

    // For 'overdue'
    const overdueSummary = await prisma.account.aggregate({
      where: {
        professionalId: req.userId,
        type: 'receivable',
        status: 'overdue'
      },
      _count: { id: true },
      _sum: { value: true }
    });
    results['overdue'] = { count: overdueSummary._count.id, total: Number(overdueSummary._sum.value || 0) };

    // For 'all'
    const allSummary = await prisma.account.aggregate({
      where: {
        professionalId: req.userId,
        type: 'receivable'
      },
      _count: { id: true },
      _sum: { value: true }
    });
    results['all'] = { count: allSummary._count.id, total: Number(allSummary._sum.value || 0) };

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao calcular resumo das abas', details: err.message });
  }
});

// GET /api/accounts/patient/:patientId/financial - patient financial view
// Returns sessions attended + payments + balance (acumulado)
router.get('/patient/:patientId/financial', async (req, res) => {
  try {
    const { patientId } = req.params;

    const patient = await prisma.patient.findFirst({
      where: { id: patientId, professionalId: req.userId },
      select: {
        id: true, name: true,
        sessionValue: true, monthlyValue: true, billingMode: true,
      }
    });
    if (!patient) return res.status(404).json({ error: 'Paciente não encontrado' });

    // All attended sessions
    const sessions = await prisma.appointment.findMany({
      where: {
        professionalId: req.userId,
        patientId,
        attended: true,
      },
      orderBy: { date: 'desc' },
      select: { id: true, date: true, time: true, duration: true, value: true, type: true, status: true }
    });

    // All accounts (receivable) for this patient
    const accounts = await prisma.account.findMany({
      where: {
        professionalId: req.userId,
        patientId,
        type: 'receivable',
      },
      orderBy: { dueDate: 'desc' },
    });

    const sessionValueDefault = patient.sessionValue ? Number(patient.sessionValue) : 0;

    // Compute totals
    const totalSessions = sessions.length;
    const totalChargedSessions = sessions.reduce((sum, s) => {
      const val = s.value ? Number(s.value) : sessionValueDefault;
      return sum + val;
    }, 0);

    const totalCharged = accounts.reduce((s, a) => s + Number(a.value), 0);
    const totalPaid = accounts.filter(a => a.status === 'paid').reduce((s, a) => s + Number(a.value), 0);
    const totalPending = accounts.filter(a => a.status === 'pending').reduce((s, a) => s + Number(a.value), 0);
    const totalOverdue = accounts.filter(a => a.status === 'overdue').reduce((s, a) => s + Number(a.value), 0);

    // Identify which sessions are already in an invoice (account.notes has session_ids:)
    const billedSessionIds = new Set();
    accounts.forEach(a => {
      if (a.notes) {
        const m = a.notes.match(/session_ids:([a-f0-9,\-]+)/);
        if (m) m[1].split(',').forEach(id => billedSessionIds.add(id));
      }
    });

    const sessionsWithBilling = sessions.map(s => ({
      ...s,
      value: s.value ? Number(s.value) : sessionValueDefault,
      billed: billedSessionIds.has(s.id),
    }));

    const unbilledTotal = sessionsWithBilling.filter(s => !s.billed)
      .reduce((sum, s) => sum + Number(s.value || 0), 0);

    res.json({
      patient: {
        id: patient.id, name: patient.name,
        sessionValue: sessionValueDefault,
        monthlyValue: patient.monthlyValue ? Number(patient.monthlyValue) : null,
        billingMode: patient.billingMode,
      },
      stats: {
        totalSessions,
        totalChargedSessions,
        totalCharged,
        totalPaid,
        totalPending,
        totalOverdue,
        unbilledTotal,
        unbilledCount: sessionsWithBilling.filter(s => !s.billed).length,
        balance: totalPending + totalOverdue, // saldo a pagar
      },
      sessions: sessionsWithBilling,
      accounts: accounts.map(a => ({
        id: a.id,
        description: a.description,
        value: Number(a.value),
        dueDate: a.dueDate,
        paidAt: a.paidAt,
        status: a.status,
        paymentMethod: a.paymentMethod,
        notes: a.notes,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar financeiro do paciente', details: err.message });
  }
});

// POST /api/accounts/bulk-pay - mark multiple accounts as paid
router.post('/bulk-pay', async (req, res) => {
  try {
    const { ids, paymentMethod, paidAt } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: 'IDs são obrigatórios' });
    }
    const date = paidAt ? new Date(paidAt) : new Date();
    const result = await prisma.account.updateMany({
      where: { id: { in: ids }, professionalId: req.userId },
      data: { status: 'paid', paidAt: date, ...(paymentMethod ? { paymentMethod } : {}) }
    });
    res.json({ message: 'Pagamentos registrados', count: result.count });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao dar baixa nos pagamentos', details: err.message });
  }
});

// POST /api/accounts/bulk-charge - generate consolidated charge from multiple accounts
router.post('/bulk-charge', async (req, res) => {
  try {
    const { ids, dueDate, description } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: 'IDs são obrigatórios' });
    }

    const accounts = await prisma.account.findMany({
      where: { id: { in: ids }, professionalId: req.userId, type: 'receivable' },
      include: { patient: { select: { id: true, name: true, phone: true, email: true } } }
    });
    if (!accounts.length) return res.status(404).json({ error: 'Contas não encontradas' });

    // Group by patient
    const byPatient = {};
    accounts.forEach(a => {
      const pid = a.patientId || 'no-patient';
      if (!byPatient[pid]) byPatient[pid] = { patient: a.patient, items: [], total: 0 };
      byPatient[pid].items.push({
        id: a.id,
        description: a.description,
        value: Number(a.value),
        dueDate: a.dueDate,
      });
      byPatient[pid].total += Number(a.value);
    });

    const charges = Object.values(byPatient).map(group => ({
      patient: group.patient,
      items: group.items,
      total: group.total,
      dueDate: dueDate || new Date(),
      description: description || `Cobrança consolidada - ${group.items.length} item(s)`,
    }));

    res.json({ charges, totalAmount: charges.reduce((s, c) => s + c.total, 0) });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao gerar cobrança consolidada', details: err.message });
  }
});

// POST /api/accounts
router.post('/', async (req, res) => {
  try {
    const { type, description, value, dueDate, category, patientId, paymentMethod, notes, recurrence } = req.body;
    if (!type || !description || !value || !dueDate) {
      return res.status(400).json({ error: 'Tipo, descrição, valor e vencimento são obrigatórios' });
    }

    const account = await prisma.account.create({
      data: {
        professionalId: req.userId,
        type,
        description,
        value: parseFloat(value),
        dueDate: new Date(dueDate),
        category,
        patientId,
        paymentMethod,
        notes,
        recurrence
      },
      include: { patient: { select: { id: true, name: true } } }
    });

    res.status(201).json(account);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar conta', details: err.message });
  }
});

// PUT /api/accounts/:id
router.put('/:id', async (req, res) => {
  try {
    const existing = await prisma.account.findFirst({
      where: { id: req.params.id, professionalId: req.userId }
    });
    if (!existing) return res.status(404).json({ error: 'Conta não encontrada' });

    const data = {};
    const { description, value, dueDate, status, category, paymentMethod, notes, paidAt } = req.body;
    if (description !== undefined) data.description = description;
    if (value !== undefined) data.value = parseFloat(value);
    if (dueDate !== undefined) data.dueDate = new Date(dueDate);
    if (status !== undefined) data.status = status;
    if (category !== undefined) data.category = category;
    if (paymentMethod !== undefined) data.paymentMethod = paymentMethod;
    if (notes !== undefined) data.notes = notes;
    if (paidAt !== undefined) data.paidAt = paidAt ? new Date(paidAt) : null;
    if (status === 'paid' && !data.paidAt) data.paidAt = new Date();

    const account = await prisma.account.update({
      where: { id: req.params.id },
      data,
      include: { patient: { select: { id: true, name: true } } }
    });

    res.json(account);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar conta', details: err.message });
  }
});

// DELETE /api/accounts/:id
router.delete('/:id', async (req, res) => {
  try {
    await prisma.account.deleteMany({
      where: { id: req.params.id, professionalId: req.userId }
    });
    res.json({ message: 'Conta removida' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover conta' });
  }
});

module.exports = router;
