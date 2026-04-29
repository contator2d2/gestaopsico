const express = require('express');

const { authMiddleware } = require('../middleware/auth');
const { superadminGuard } = require('../middleware/adminGuard');

const router = express.Router();
const prisma = require('../db');

router.use(authMiddleware);

// ========== INSTANCES (superadmin) ==========

// GET /api/whatsapp/instances
router.get('/instances', superadminGuard, async (req, res) => {
  try {
    const instances = await prisma.whatsappInstance.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { secretaryConfigs: true, notifications: true } } }
    });
    res.json(instances);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar instâncias', details: err.message });
  }
});

// POST /api/whatsapp/instances (create via W-API)
router.post('/instances', superadminGuard, async (req, res) => {
  try {
    const tokenSetting = await prisma.systemSetting.findUnique({ where: { key: 'wapi_token' } });
    if (!tokenSetting?.value) {
      return res.status(400).json({ error: 'Token W-API não configurado' });
    }

    const { instanceName, callMessage } = req.body;
    if (!instanceName) return res.status(400).json({ error: 'Nome da instância é obrigatório' });

    // Create on W-API
    const wapiRes = await fetch('https://api.w-api.app/v1/integrator/create-instance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenSetting.value}`
      },
      body: JSON.stringify({
        instanceName,
        rejectCalls: false,
        callMessage: callMessage || 'Não estamos disponíveis no momento.'
      })
    });

    const wapiData = await wapiRes.json();
    if (!wapiRes.ok) {
      return res.status(wapiRes.status).json({ error: 'Erro na W-API', details: wapiData });
    }

    // Save locally
    const instance = await prisma.whatsappInstance.create({
      data: {
        instanceId: wapiData.id || wapiData.instanceId || String(Date.now()),
        instanceName,
        status: 'disconnected'
      }
    });

    res.status(201).json({ instance, wapi: wapiData });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar instância', details: err.message });
  }
});

// GET /api/whatsapp/instances/:id/qrcode
router.get('/instances/:id/qrcode', superadminGuard, async (req, res) => {
  try {
    const inst = await prisma.whatsappInstance.findUnique({ where: { id: req.params.id } });
    if (!inst) return res.status(404).json({ error: 'Instância não encontrada' });

    const tokenSetting = await prisma.systemSetting.findUnique({ where: { key: 'wapi_token' } });
    if (!tokenSetting?.value) return res.status(400).json({ error: 'Token W-API não configurado' });

    const wapiRes = await fetch(`https://api.w-api.app/v1/instance/qrcode/${inst.instanceId}`, {
      headers: { 'Authorization': `Bearer ${tokenSetting.value}` }
    });
    const data = await wapiRes.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar QR code', details: err.message });
  }
});

// ========== SECRETARY CONFIG ==========

// GET /api/whatsapp/secretary (current user's config)
router.get('/secretary', async (req, res) => {
  try {
    let config = await prisma.secretaryConfig.findUnique({
      where: { userId: req.userId },
      include: { instance: { select: { id: true, instanceName: true, status: true } } }
    });
    res.json(config || null);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar configuração' });
  }
});

// PUT /api/whatsapp/secretary (create/update current user's config)
router.put('/secretary', async (req, res) => {
  try {
    const {
      secretaryName, workingHoursStart, workingHoursEnd, workingDays,
      clinicName, clinicAddress, clinicPhone, professionalInfo,
      promptComplement, instanceId, isActive
    } = req.body;

    const data = {};
    if (secretaryName !== undefined) data.secretaryName = secretaryName;
    if (workingHoursStart !== undefined) data.workingHoursStart = workingHoursStart;
    if (workingHoursEnd !== undefined) data.workingHoursEnd = workingHoursEnd;
    if (workingDays !== undefined) data.workingDays = workingDays;
    if (clinicName !== undefined) data.clinicName = clinicName;
    if (clinicAddress !== undefined) data.clinicAddress = clinicAddress;
    if (clinicPhone !== undefined) data.clinicPhone = clinicPhone;
    if (professionalInfo !== undefined) data.professionalInfo = professionalInfo;
    if (promptComplement !== undefined) data.promptComplement = promptComplement;
    if (instanceId !== undefined) data.instanceId = instanceId || null;
    if (isActive !== undefined) data.isActive = isActive;

    const config = await prisma.secretaryConfig.upsert({
      where: { userId: req.userId },
      create: { userId: req.userId, ...data },
      update: data,
      include: { instance: { select: { id: true, instanceName: true, status: true } } }
    });

    res.json(config);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao salvar configuração', details: err.message });
  }
});

// GET /api/whatsapp/instances/available (for users to select)
router.get('/instances/available', async (req, res) => {
  try {
    const instances = await prisma.whatsappInstance.findMany({
      where: { status: { not: 'deleted' } },
      select: { id: true, instanceName: true, status: true }
    });
    res.json(instances);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar instâncias' });
  }
});

// ========== NOTIFICATIONS ==========

// POST /api/whatsapp/notifications/send (queue a notification)
router.post('/notifications/send', async (req, res) => {
  try {
    const { phone, message, type, referenceId, referenceType, instanceId } = req.body;
    if (!phone || !message || !type) {
      return res.status(400).json({ error: 'phone, message e type são obrigatórios' });
    }

    // Find instance
    let instId = instanceId;
    if (!instId) {
      const config = await prisma.secretaryConfig.findUnique({ where: { userId: req.userId } });
      instId = config?.instanceId;
    }
    if (!instId) return res.status(400).json({ error: 'Nenhuma instância WhatsApp configurada' });

    // Calculate queue position with random delay (4-7 min)
    const pendingCount = await prisma.whatsappNotification.count({
      where: { instanceId: instId, status: 'queued' }
    });
    const randomDelay = Math.floor(Math.random() * (7 - 4 + 1) + 4) * 60 * 1000; // 4-7 min in ms
    const scheduledAt = new Date(Date.now() + (pendingCount * randomDelay));

    const notification = await prisma.whatsappNotification.create({
      data: {
        instanceId: instId,
        phone: phone.replace(/\D/g, ''),
        message,
        type,
        scheduledAt,
        referenceId,
        referenceType
      }
    });

    res.status(201).json(notification);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao enfileirar notificação', details: err.message });
  }
});

// POST /api/whatsapp/notifications/bulk (queue multiple notifications)
router.post('/notifications/bulk', async (req, res) => {
  try {
    const { notifications, instanceId } = req.body;
    if (!Array.isArray(notifications) || !notifications.length) {
      return res.status(400).json({ error: 'Lista de notificações é obrigatória' });
    }

    let instId = instanceId;
    if (!instId) {
      const config = await prisma.secretaryConfig.findUnique({ where: { userId: req.userId } });
      instId = config?.instanceId;
    }
    if (!instId) return res.status(400).json({ error: 'Nenhuma instância configurada' });

    const pendingCount = await prisma.whatsappNotification.count({
      where: { instanceId: instId, status: 'queued' }
    });

    const created = [];
    for (let i = 0; i < notifications.length; i++) {
      const n = notifications[i];
      // Random 4-7 min delay between each
      const randomDelay = Math.floor(Math.random() * (7 - 4 + 1) + 4) * 60 * 1000;
      const scheduledAt = new Date(Date.now() + ((pendingCount + i) * randomDelay));

      const notif = await prisma.whatsappNotification.create({
        data: {
          instanceId: instId,
          phone: n.phone.replace(/\D/g, ''),
          message: n.message,
          type: n.type || 'general',
          scheduledAt,
          referenceId: n.referenceId,
          referenceType: n.referenceType
        }
      });
      created.push(notif);
    }

    res.status(201).json({ count: created.length, notifications: created });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao enfileirar notificações', details: err.message });
  }
});

// GET /api/whatsapp/notifications (list queue)
router.get('/notifications', async (req, res) => {
  try {
    const { status, type, page = 1, limit = 50 } = req.query;
    const where = {};

    // If not superadmin, filter by user's instance
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (user?.role !== 'superadmin') {
      const config = await prisma.secretaryConfig.findUnique({ where: { userId: req.userId } });
      if (config?.instanceId) where.instanceId = config.instanceId;
      else return res.json({ data: [], total: 0 });
    }

    if (status) where.status = status;
    if (type) where.type = type;

    const [data, total] = await Promise.all([
      prisma.whatsappNotification.findMany({
        where,
        orderBy: { scheduledAt: 'asc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
        include: { instance: { select: { instanceName: true } } }
      }),
      prisma.whatsappNotification.count({ where })
    ]);

    res.json({ data, total });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar notificações' });
  }
});

// POST /api/whatsapp/notifications/process (process queue - called by cron/scheduler)
router.post('/notifications/process', superadminGuard, async (req, res) => {
  try {
    const tokenSetting = await prisma.systemSetting.findUnique({ where: { key: 'wapi_token' } });
    if (!tokenSetting?.value) return res.status(400).json({ error: 'Token W-API não configurado' });

    // Get notifications ready to send
    const ready = await prisma.whatsappNotification.findMany({
      where: {
        status: 'queued',
        scheduledAt: { lte: new Date() }
      },
      include: { instance: true },
      orderBy: { scheduledAt: 'asc' },
      take: 10
    });

    const results = [];
    for (const notif of ready) {
      try {
        const wapiRes = await fetch(
          `https://api.w-api.app/v1/instance/send-text/${notif.instance.instanceId}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${tokenSetting.value}`
            },
            body: JSON.stringify({
              phone: notif.phone,
              message: notif.message
            })
          }
        );

        const wapiData = await wapiRes.json();

        if (wapiRes.ok) {
          await prisma.whatsappNotification.update({
            where: { id: notif.id },
            data: { status: 'sent', sentAt: new Date() }
          });
          results.push({ id: notif.id, status: 'sent' });
        } else {
          await prisma.whatsappNotification.update({
            where: { id: notif.id },
            data: { status: 'failed', error: JSON.stringify(wapiData) }
          });
          results.push({ id: notif.id, status: 'failed', error: wapiData });
        }
      } catch (sendErr) {
        await prisma.whatsappNotification.update({
          where: { id: notif.id },
          data: { status: 'failed', error: sendErr.message }
        });
        results.push({ id: notif.id, status: 'failed', error: sendErr.message });
      }
    }

    res.json({ processed: results.length, results });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao processar fila', details: err.message });
  }
});


// ========== GROUPS & CHANNELS ==========

// GET /api/whatsapp/groups
router.get('/groups', async (req, res) => {
  try {
    const config = await prisma.secretaryConfig.findUnique({ where: { userId: req.userId } });
    if (!config?.instanceId) return res.status(400).json({ error: 'Nenhuma instância configurada' });
    
    const inst = await prisma.whatsappInstance.findUnique({ where: { id: config.instanceId } });
    if (!inst) return res.status(404).json({ error: 'Instância não encontrada' });

    const tokenSetting = await prisma.systemSetting.findUnique({ where: { key: 'wapi_token' } });
    if (!tokenSetting?.value) return res.status(400).json({ error: 'Token W-API não configurado' });

    const wapiRes = await fetch(`https://api.w-api.app/v1/instance/groups/${inst.instanceId}`, {
      headers: { 'Authorization': `Bearer ${tokenSetting.value}` }
    });
    const data = await wapiRes.json();
    
    if (!wapiRes.ok) {
      return res.status(wapiRes.status).json({ error: 'Erro na W-API ao buscar grupos', details: data });
    }

    res.json(data.groups || data || []);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar grupos', details: err.message });
  }
});

// GET /api/whatsapp/channels
router.get('/channels', async (req, res) => {
  try {
    const config = await prisma.secretaryConfig.findUnique({ where: { userId: req.userId } });
    if (!config?.instanceId) return res.status(400).json({ error: 'Nenhuma instância configurada' });
    
    const inst = await prisma.whatsappInstance.findUnique({ where: { id: config.instanceId } });
    if (!inst) return res.status(404).json({ error: 'Instância não encontrada' });

    const tokenSetting = await prisma.systemSetting.findUnique({ where: { key: 'wapi_token' } });
    if (!tokenSetting?.value) return res.status(400).json({ error: 'Token W-API não configurado' });

    const wapiRes = await fetch(`https://api.w-api.app/v1/instance/channels/${inst.instanceId}`, {
      headers: { 'Authorization': `Bearer ${tokenSetting.value}` }
    });
    const data = await wapiRes.json();
    
    if (!wapiRes.ok) {
      return res.status(wapiRes.status).json({ error: 'Erro na W-API ao buscar canais', details: data });
    }

    res.json(data.channels || data || []);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar canais', details: err.message });
  }
});

// POST /api/whatsapp/groups/:groupId/participants
router.post('/groups/:groupId/participants', async (req, res) => {
  try {
    const { participants } = req.body; // Array of phone numbers
    if (!Array.isArray(participants) || !participants.length) {
      return res.status(400).json({ error: 'Lista de participantes é obrigatória' });
    }

    const config = await prisma.secretaryConfig.findUnique({ where: { userId: req.userId } });
    if (!config?.instanceId) return res.status(400).json({ error: 'Nenhuma instância configurada' });
    
    const inst = await prisma.whatsappInstance.findUnique({ where: { id: config.instanceId } });
    const tokenSetting = await prisma.systemSetting.findUnique({ where: { key: 'wapi_token' } });

    const wapiRes = await fetch(`https://api.w-api.app/v1/instance/group-add-participant/${inst.instanceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenSetting.value}`
      },
      body: JSON.stringify({
        groupId: req.params.groupId,
        participants: participants.map(p => p.replace(/\D/g, '') + '@s.whatsapp.net')
      })
    });

    const data = await wapiRes.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao adicionar participantes', details: err.message });
  }
});

module.exports = router;

