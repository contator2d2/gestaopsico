const express = require('express');

const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const prisma = require('../db');

// PUBLIC: GET /api/org-settings/portal/:slug - get org branding by portal slug (no auth)
router.get('/portal/:slug', async (req, res) => {
  try {
    const org = await prisma.organization.findFirst({
      where: { portalSlug: req.params.slug, status: 'active' },
      select: { id: true, name: true, portalSlug: true, logo: true }
    });

    if (!org) {
      return res.status(404).json({ error: 'Clínica não encontrada' });
    }

    const settings = await prisma.organizationSetting.findUnique({
      where: { organizationId: org.id }
    });

    res.json({
      organizationId: org.id,
      businessName: settings?.businessName || org.name,
      logo: settings?.logo || org.logo,
      primaryColor: settings?.primaryColor,
      secondaryColor: settings?.secondaryColor,
      accentColor: settings?.accentColor,
      timezone: settings?.timezone || 'America/Sao_Paulo',
      portalSlug: org.portalSlug,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar clínica', details: err.message });
  }
});

router.use(authMiddleware);

// GET /api/org-settings - get organization settings (white-label)
router.get('/', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { organizationId: true, role: true }
    });

    if (!user?.organizationId) {
      return res.json(null);
    }

    let settings = await prisma.organizationSetting.findUnique({
      where: { organizationId: user.organizationId }
    });

    if (!settings) {
      const org = await prisma.organization.findUnique({ where: { id: user.organizationId } });
      settings = await prisma.organizationSetting.create({
        data: {
          organizationId: user.organizationId,
          businessName: org?.name || ''
        }
      });
    }

    // Include portalSlug from organization
    const org = await prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: { portalSlug: true }
    });

    res.json({ ...settings, portalSlug: org?.portalSlug });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar configurações', details: err.message });
  }
});

// PUT /api/org-settings - update organization settings
router.put('/', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { organizationId: true, role: true }
    });

    if (!user?.organizationId) {
      return res.status(400).json({ error: 'Usuário sem organização' });
    }

    // Only admin or professional can update
    if (!['admin', 'professional', 'superadmin', 'secretary', 'secretary_financial'].includes(user.role)) {
      return res.status(403).json({ error: 'Sem permissão para alterar configurações' });
    }

    const {
      logo, primaryColor, secondaryColor, accentColor,
      businessName, businessPhone, businessEmail, businessAddress,
      allowPatientBooking, requireBookingApproval, portalSlug,
      scheduleStartHour, scheduleEndHour,
      patientBookingStartHour, patientBookingEndHour,
      sessionDuration, bookingWeekdays, timezone,
      sharedAgenda
    } = req.body;

    const data = {};
    if (logo !== undefined) data.logo = logo;
    if (primaryColor !== undefined) data.primaryColor = primaryColor;
    if (secondaryColor !== undefined) data.secondaryColor = secondaryColor;
    if (accentColor !== undefined) data.accentColor = accentColor;
    if (businessName !== undefined) data.businessName = businessName;
    if (businessPhone !== undefined) data.businessPhone = businessPhone;
    if (businessEmail !== undefined) data.businessEmail = businessEmail;
    if (businessAddress !== undefined) data.businessAddress = businessAddress;
    if (allowPatientBooking !== undefined) data.allowPatientBooking = allowPatientBooking;
    if (requireBookingApproval !== undefined) data.requireBookingApproval = requireBookingApproval;
    if (scheduleStartHour !== undefined) data.scheduleStartHour = Number(scheduleStartHour);
    if (scheduleEndHour !== undefined) data.scheduleEndHour = Number(scheduleEndHour);
    if (patientBookingStartHour !== undefined) data.patientBookingStartHour = Number(patientBookingStartHour);
    if (patientBookingEndHour !== undefined) data.patientBookingEndHour = Number(patientBookingEndHour);
    if (sessionDuration !== undefined) data.sessionDuration = Number(sessionDuration);
    if (bookingWeekdays !== undefined) data.bookingWeekdays = bookingWeekdays;
    if (timezone !== undefined) data.timezone = timezone;
    if (sharedAgenda !== undefined) data.sharedAgenda = Boolean(sharedAgenda);

    // Handle portal slug - save to organization table
    if (portalSlug !== undefined) {
      // Validate slug uniqueness
      if (portalSlug) {
        const existing = await prisma.organization.findFirst({
          where: { portalSlug, id: { not: user.organizationId } }
        });
        if (existing) {
          return res.status(400).json({ error: 'Este slug já está em uso. Escolha outro.' });
        }
        await prisma.organization.update({
          where: { id: user.organizationId },
          data: { portalSlug }
        });
      } else {
        await prisma.organization.update({
          where: { id: user.organizationId },
          data: { portalSlug: null }
        });
      }
    }

    const settings = await prisma.organizationSetting.upsert({
      where: { organizationId: user.organizationId },
      create: { organizationId: user.organizationId, ...data },
      update: data
    });

    // Include portalSlug in response
    const org = await prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: { portalSlug: true }
    });
    
    res.json({ ...settings, portalSlug: org?.portalSlug });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao salvar configurações', details: err.message });
  }
});

module.exports = router;
