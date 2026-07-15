const express = require('express');
const bcrypt = require('bcryptjs');

const { authMiddleware } = require('../middleware/auth');
const { superadminGuard } = require('../middleware/adminGuard');

const router = express.Router();
const prisma = require('../db');

// Todas as rotas precisam de auth + superadmin
router.use(authMiddleware);
router.use(superadminGuard);

// ========== ORGANIZAÇÕES ==========

// GET /api/admin/organizations
router.get('/organizations', async (req, res) => {
  try {
    const { status, type, search, page = 1, limit = 20 } = req.query;
    const where = {};
    if (status) where.status = status;
    if (type) where.type = type;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.organization.findMany({
        where,
        include: {
          _count: { select: { users: true } },
          subscriptions: { orderBy: { createdAt: 'desc' }, take: 1 }
        },
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.organization.count({ where })
    ]);

    res.json({ data, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar organizações', details: err.message });
  }
});

// POST /api/admin/organizations
router.post('/organizations', async (req, res) => {
  try {
    const { name, slug, type, plan, email, phone, cnpj, address, maxUsers } = req.body;

    const existing = await prisma.organization.findUnique({ where: { slug } });
    if (existing) return res.status(400).json({ error: 'Slug já em uso' });

    const org = await prisma.organization.create({
      data: {
        name,
        slug,
        type: type || 'clinic',
        plan: plan || 'basic',
        email,
        phone,
        cnpj,
        address,
        maxUsers: maxUsers || (type === 'individual' ? 1 : 5),
      }
    });

    res.status(201).json(org);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar organização', details: err.message });
  }
});

// PATCH /api/admin/organizations/:id
router.patch('/organizations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    delete data.id;
    delete data.createdAt;

    const org = await prisma.organization.update({ where: { id }, data });
    res.json(org);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar organização', details: err.message });
  }
});

// PATCH /api/admin/organizations/:id/status
router.patch('/organizations/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'inactive', 'suspended'].includes(status)) {
      return res.status(400).json({ error: 'Status inválido' });
    }

    const data = { status };
    if (status === 'suspended') data.suspendedAt = new Date();
    if (status === 'active') data.suspendedAt = null;

    const org = await prisma.organization.update({ where: { id }, data });

    // Se suspender, desativa todos os usuários da org
    if (status === 'suspended' || status === 'inactive') {
      await prisma.user.updateMany({
        where: { organizationId: id, role: { not: 'superadmin' } },
        data: { status: 'inactive' }
      });
    }

    res.json(org);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao alterar status', details: err.message });
  }
});

// ========== USUÁRIOS ==========

// GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    const { organizationId, role, status, search, page = 1, limit = 20 } = req.query;
    const where = {};
    if (organizationId) where.organizationId = organizationId;
    if (role) where.role = role;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, name: true, email: true, role: true, status: true, createdAt: true,
          organizationId: true, crp: true, phone: true, specialty: true,
          organization: { select: { name: true, slug: true } },
          _count: { select: { patients: true, appointments: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.user.count({ where })
    ]);

    res.json({ data, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar usuários', details: err.message });
  }
});

// POST /api/admin/users
router.post('/users', async (req, res) => {
  try {
    const name = req.body?.name?.trim();
    const email = req.body?.email?.trim()?.toLowerCase();
    const password = req.body?.password;
    const role = req.body?.role;
    const organizationId = req.body?.organizationId;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(400).json({ error: 'Email já cadastrado' });

    if (organizationId) {
      const org = await prisma.organization.findUnique({ where: { id: organizationId } });
      if (!org) return res.status(404).json({ error: 'Organização não encontrada' });

      const userCount = await prisma.user.count({
        where: {
          organizationId,
          role: { in: ['professional', 'secretary', 'financial', 'secretary_financial', 'admin'] },
        },
      });
      if (userCount >= org.maxUsers) {
        return res.status(400).json({ error: `Limite de ${org.maxUsers} usuários atingido nesta organização` });
      }
    }

    const crp = req.body?.crp?.trim() || null;
    const phone = req.body?.phone?.trim() || null;
    const specialty = req.body?.specialty?.trim() || null;

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: role || 'professional',
        status: 'active',
        createdAt: new Date(),
        organizationId,
        crp,
        phone,
        specialty
      },
      select: { id: true, name: true, email: true, role: true, status: true, organizationId: true, crp: true, phone: true, specialty: true }
    });

    res.status(201).json(user);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar usuário', details: err.message });
  }
});

// PATCH /api/admin/users/:id/status
router.patch('/users/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ error: 'Status inválido' });
    }

    const user = await prisma.user.update({
      where: { id },
      data: { status },
      select: { id: true, name: true, email: true, role: true, status: true }
    });

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao alterar status do usuário', details: err.message });
  }
});

// PATCH /api/admin/users/:id/role
router.patch('/users/:id/role', async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!['professional', 'admin', 'superadmin', 'secretary', 'financial', 'secretary_financial', 'patient'].includes(role)) {
      return res.status(400).json({ error: 'Perfil inválido' });
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });

    const user = await prisma.user.update({
      where: { id },
      data: { role },
      select: { id: true, name: true, email: true, role: true, status: true }
    });

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao alterar perfil', details: err.message });
  }
});

// ========== MÉTRICAS GLOBAIS ==========

// GET /api/admin/metrics
router.get('/metrics', async (req, res) => {
  try {
    const [
      totalOrgs,
      activeOrgs,
      suspendedOrgs,
      totalUsers,
      activeUsers,
      totalPatients,
      totalAppointments,
      monthlyAppointments,
      totalRevenue,
      planBreakdown
    ] = await Promise.all([
      prisma.organization.count(),
      prisma.organization.count({ where: { status: 'active' } }),
      prisma.organization.count({ where: { status: 'suspended' } }),
      prisma.user.count({ where: { role: { not: 'superadmin' } } }),
      prisma.user.count({ where: { status: 'active', role: { not: 'superadmin' } } }),
      prisma.patient.count(),
      prisma.appointment.count(),
      prisma.appointment.count({
        where: {
          date: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
          }
        }
      }),
      prisma.payment.aggregate({ _sum: { value: true }, where: { status: 'paid' } }),
      prisma.organization.groupBy({ by: ['plan'], _count: { id: true } })
    ]);

    res.json({
      organizations: { total: totalOrgs, active: activeOrgs, suspended: suspendedOrgs },
      users: { total: totalUsers, active: activeUsers },
      patients: totalPatients,
      appointments: { total: totalAppointments, monthly: monthlyAppointments },
      revenue: { total: Number(totalRevenue._sum.value || 0) },
      planBreakdown: planBreakdown.map(p => ({ plan: p.plan, count: p._count.id }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar métricas', details: err.message });
  }
});

// ========== PLANOS ==========

// POST /api/admin/organizations/:id/subscription
router.post('/organizations/:id/subscription', async (req, res) => {
  try {
    const { id } = req.params;
    const { plan, value, startDate, endDate } = req.body;

    // Atualiza plano da organização
    await prisma.organization.update({ where: { id }, data: { plan } });

    // Cria registro de assinatura
    const subscription = await prisma.subscription.create({
      data: {
        organizationId: id,
        plan,
        value: value || 0,
        startDate: new Date(startDate || Date.now()),
        endDate: endDate ? new Date(endDate) : null,
        status: 'active'
      }
    });

    res.status(201).json(subscription);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar assinatura', details: err.message });
  }
});

module.exports = router;
