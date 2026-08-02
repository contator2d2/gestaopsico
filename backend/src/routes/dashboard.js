const express = require('express');

const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const prisma = require('../db');

router.use(authMiddleware);

// GET /api/dashboard/summary
router.get('/summary', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const [totalPatients, todayAppointments, todaySchedule, paidSum, pendingSum] = await Promise.all([
      prisma.patient.count({ where: { professionalId: req.userId, status: 'active' } }),
      prisma.appointment.count({
        where: { professionalId: req.userId, date: { gte: today, lt: tomorrow }, status: 'scheduled' }
      }),
      prisma.appointment.findMany({
        where: { professionalId: req.userId, date: { gte: today, lt: tomorrow }, status: 'scheduled' },
        orderBy: { date: 'asc' },
        include: { patient: { select: { name: true } } }
      }),
      prisma.payment.aggregate({
        where: {
          appointment: { professionalId: req.userId },
          createdAt: { gte: monthStart },
          status: 'paid'
        },
        _sum: { value: true }
      }),
      prisma.payment.aggregate({
        where: {
          appointment: { professionalId: req.userId },
          status: 'pending'
        },
        _sum: { value: true }
      })
    ]);

    res.json({
      total_patients: totalPatients,
      today_appointments: todayAppointments,
      monthly_revenue: Number(paidSum._sum.value || 0),
      pending_payments: Number(pendingSum._sum.value || 0),
      today_schedule: todaySchedule.map(a => ({
        time: a.time || '',
        patient: a.patient,
        type: a.type || 'individual',
        status: a.status
      }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao gerar resumo', details: err.message });
  }
});

// GET /api/dashboard/financial-health
router.get('/financial-health', async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);
    const in30 = new Date(todayStart);
    in30.setDate(in30.getDate() + 30);

    const base = { professionalId: req.userId };

    const [todayRec, futureRec, futureRec30, overdueRec, futurePay, futurePay30, paidLast30] = await Promise.all([
      prisma.account.aggregate({
        where: { ...base, type: 'receivable', status: { in: ['pending', 'overdue'] }, dueDate: { gte: todayStart, lt: todayEnd } },
        _sum: { value: true }, _count: true
      }),
      prisma.account.aggregate({
        where: { ...base, type: 'receivable', status: 'pending', dueDate: { gte: todayEnd } },
        _sum: { value: true }, _count: true
      }),
      prisma.account.aggregate({
        where: { ...base, type: 'receivable', status: 'pending', dueDate: { gte: todayEnd, lt: in30 } },
        _sum: { value: true }
      }),
      prisma.account.aggregate({
        where: { ...base, type: 'receivable', status: { in: ['pending', 'overdue'] }, dueDate: { lt: todayStart } },
        _sum: { value: true }, _count: true
      }),
      prisma.account.aggregate({
        where: { ...base, type: 'payable', status: { in: ['pending', 'overdue'] }, dueDate: { gte: todayStart } },
        _sum: { value: true }, _count: true
      }),
      prisma.account.aggregate({
        where: { ...base, type: 'payable', status: { in: ['pending', 'overdue'] }, dueDate: { gte: todayStart, lt: in30 } },
        _sum: { value: true }
      }),
      prisma.account.aggregate({
        where: { ...base, type: 'receivable', status: 'paid', paidAt: { gte: new Date(todayStart.getTime() - 30 * 86400000) } },
        _sum: { value: true }
      })
    ]);

    const n = (v) => Number(v || 0);
    const todayValue = n(todayRec._sum.value);
    const futureValue = n(futureRec._sum.value);
    const future30 = n(futureRec30._sum.value);
    const overdueValue = n(overdueRec._sum.value);
    const payableValue = n(futurePay._sum.value);
    const payable30 = n(futurePay30._sum.value);
    const received30 = n(paidLast30._sum.value);

    // Health score (0-100)
    const projected30 = future30 + todayValue;
    const coverage = payable30 > 0 ? projected30 / payable30 : (projected30 > 0 ? 2 : 1);
    const totalOpen = overdueValue + todayValue + futureValue;
    const defaultRate = totalOpen > 0 ? overdueValue / totalOpen : 0;

    let score = 0;
    score += Math.min(coverage / 1.5, 1) * 55; // capacidade de cobrir despesas
    score += (1 - Math.min(defaultRate / 0.4, 1)) * 30; // inadimplência
    score += Math.min(received30 / Math.max(payable30, 1), 1) * 15; // caixa recente
    score = Math.round(Math.max(0, Math.min(100, score)));

    const level = score >= 75 ? 'saudavel' : score >= 50 ? 'atencao' : 'critico';

    res.json({
      today: { value: todayValue, count: todayRec._count || 0 },
      future: { value: futureValue, count: futureRec._count || 0, next30: future30 },
      overdue: { value: overdueValue, count: overdueRec._count || 0 },
      payable: { value: payableValue, count: futurePay._count || 0, next30: payable30 },
      received_last_30: received30,
      health: {
        score,
        level,
        coverage_ratio: Number(coverage.toFixed(2)),
        default_rate: Number((defaultRate * 100).toFixed(1)),
        projected_balance_30: Number((projected30 - payable30).toFixed(2))
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao calcular saúde financeira', details: err.message });
  }
});

module.exports = router;

