const express = require('express');

const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const prisma = require('../db');

router.use(authMiddleware);

// ── helpers ──────────────────────────────────────────────────
function parseDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return null;
    return raw;
  }
  const s = String(raw).trim();
  if (!s) return null;

  // dd/mm/yyyy
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  
  // yyyy-mm-dd
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) {
    const d = new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]));
    return isValidDate(d) ? d : null;
  }

  // Excel serial number (as string of digits, typically 4-5 chars, between ~1900 and ~2100)
  if (/^\d{4,6}$/.test(s)) {
    const n = Number(s);
    if (n > 1 && n < 80000) {
      const d2 = new Date(1899, 11, 30);
      d2.setDate(d2.getDate() + n);
      if (isValidDate(d2)) return d2;
    }
  }

  // Try standard JS date parsing as last resort (only if it looks like a date)
  if (/[-/T:]/.test(s)) {
    const d = new Date(s);
    if (isValidDate(d)) return d;
  }

  return null;
}

function isValidDate(d) {
  if (!d || isNaN(d.getTime())) return false;
  const y = d.getFullYear();
  return y >= 1900 && y <= 2100;
}

function normalise(name) {
  return str(name).trim().replace(/\s+/g, ' ').toLowerCase();
}

function str(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function detectCoupleInfo(name, notes) {
  const combined = `${name || ''} ${notes || ''}`.toLowerCase();
  const coupleMatch = combined.match(/casal\s+(?:com\s+)?(\w+)/i) || name?.match(/casal\s+(\w+)/i);
  const isCoupleSession = /casal/i.test(combined);
  return { isCoupleSession, partnerHint: coupleMatch ? coupleMatch[1] : null };
}

// ── POST /api/import/xlsx  – preview or execute ──────────────
router.post('/xlsx', async (req, res) => {
  try {
    const { patients: rawPatients, sessions: rawSessions, preview } = req.body;
    const userId = req.userId;

    // ── 1) Build patient map ────────────────────────────────
    const patientRows = (rawPatients || []).map(r => ({
      name: str(r['Nome'] || r.name).trim(),
      email: str(r['E-mail'] || r['Email'] || r.email).trim() || null,
      phone: str(r['Telefone'] || r.phone).trim() || null,
      notes: str(r['Observações'] || r.notes).trim() || null,
      cpf: str(r['CPF'] || r.cpf).trim() || null,
      cep: str(r['CEP'] || r.cep).trim() || null,
      address: str(r['Endereço'] || r.address).trim() || null,
      birthDate: parseDate(r['Data de Nascimento'] || r.birthDate),
      paymentDate: parseDate(r['Data de Pagamento'] || r.paymentDate),
      createdAt: parseDate(r['Criado em'] || r.createdAt),
    })).filter(r => r.name && !/^teste?$/i.test(r.name));

    // ── 2) Build session list ───────────────────────────────
    const sessionRows = (rawSessions || []).map(r => {
      const value = parseFloat(r['Valor Esperado'] || r.expectedValue || 0) || 0;
      const paidValue = parseFloat(r['Valor Pago'] || r.paidValue || 0) || 0;
      const statusRaw = str(r['Status'] || r.status).toLowerCase();
      const paymentRaw = str(r['Pagamento'] || r.payment).toLowerCase();
      let status = 'scheduled';
      if (statusRaw.includes('realizada')) status = 'completed';
      else if (statusRaw.includes('cancelada')) status = 'cancelled';

      return {
        patientName: str(r['Paciente'] || r.patient).trim(),
        date: parseDate(r['Data'] || r.date),
        time: str(r['Horário'] || r.time || '09:00').substring(0, 5),
        duration: parseInt(r['Duração (min)'] || r.duration || 50),
        status,
        value,
        paidValue,
        isPaid: paymentRaw.includes('pago'),
        notes: str(r['Observações'] || r.notes).trim() || null,
      };
    }).filter(r => r.patientName && r.date);

    // ── 3) Detect couples ───────────────────────────────────
    const couplePatients = patientRows.filter(p => {
      const { isCoupleSession } = detectCoupleInfo(p.name, p.notes);
      return isCoupleSession;
    });

    // Build couple pairs from names like "Guilherme casal Helaine"
    const couplePairs = [];
    const coupleNameMap = new Map(); // normalised patient name -> couple pair index

    for (const cp of couplePatients) {
      const match = cp.name.match(/^(.+?)\s+casal\s+(.+)$/i);
      if (match) {
        const name1 = match[1].trim();
        const name2 = match[2].trim();
        // Find full patient records for each name
        const p1 = patientRows.find(p => normalise(p.name) === normalise(name1) || normalise(p.name).includes(normalise(name1)));
        const p2 = patientRows.find(p => normalise(p.name) === normalise(name2) || normalise(p.name).includes(normalise(name2)));
        if (p1 && p2) {
          const idx = couplePairs.length;
          couplePairs.push({ name: `${name1} & ${name2}`, patient1: p1, patient2: p2, coupleRowName: cp.name });
          coupleNameMap.set(normalise(cp.name), idx);
        }
      }
    }

    // Remove "couple-row" patients (e.g. "Guilherme casal Helaine") from individual import 
    const individualPatients = patientRows.filter(p => {
      return !p.name.match(/^.+\s+casal\s+.+$/i);
    });

    // ── PREVIEW MODE ────────────────────────────────────────
    if (preview) {
      return res.json({
        patients: individualPatients.length,
        sessions: sessionRows.length,
        couples: couplePairs.map(c => c.name),
        futureAppointments: sessionRows.filter(s => s.date > new Date() && s.status === 'scheduled').length,
        pastSessions: sessionRows.filter(s => s.status === 'completed').length,
        cancelledSessions: sessionRows.filter(s => s.status === 'cancelled').length,
        financialEntries: sessionRows.filter(s => s.value > 0 && s.status === 'completed').length,
      });
    }

    // ── EXECUTE IMPORT ──────────────────────────────────────
    const batch = await prisma.importBatch.create({
      data: {
        professionalId: userId,
        type: 'xlsx',
        fileName: 'pacientes.xlsx + sessoes.xlsx',
        status: 'completed',
      }
    });

    // 4a) Create individual patients
    const patientIdMap = new Map(); // normalised name -> id
    for (const p of individualPatients) {
      // Check if exists
      const existing = await prisma.patient.findFirst({
        where: { professionalId: userId, name: { equals: p.name, mode: 'insensitive' } }
      });
      if (existing) {
        patientIdMap.set(normalise(p.name), existing.id);
        // Update missing fields
        const updates = {};
        if (!existing.email && p.email) updates.email = p.email;
        if (!existing.phone && p.phone) updates.phone = p.phone;
        if (!existing.clinicalNotes && p.notes) updates.clinicalNotes = p.notes;
        if (!existing.cpf && p.cpf) updates.cpf = p.cpf;
        if (!existing.cep && p.cep) updates.cep = p.cep;
        if (!existing.address && p.address) updates.address = p.address;
        if (!existing.birthDate && p.birthDate) updates.birthDate = p.birthDate;

        if (Object.keys(updates).length) {
          await prisma.patient.update({ where: { id: existing.id }, data: updates });
        }
        continue;
      }
      const created = await prisma.patient.create({
        data: {
          professionalId: userId,
          name: p.name,
          email: p.email,
          phone: p.phone,
          clinicalNotes: p.notes,
          cpf: p.cpf,
          cep: p.cep,
          address: p.address,
          birthDate: p.birthDate,
          importBatchId: batch.id,
          createdAt: p.createdAt || new Date(),
        }
      });
      patientIdMap.set(normalise(p.name), created.id);
    }

    // 4b) Create couples
    const coupleIdMap = new Map(); // coupleRowName normalised -> coupleId
    for (const cp of couplePairs) {
      const p1Id = patientIdMap.get(normalise(cp.patient1.name));
      const p2Id = patientIdMap.get(normalise(cp.patient2.name));
      if (!p1Id || !p2Id) continue;
      // Check existing
      const existing = await prisma.couple.findFirst({
        where: { professionalId: userId, patient1Id: p1Id, patient2Id: p2Id }
      });
      if (existing) {
        coupleIdMap.set(normalise(cp.coupleRowName), existing.id);
        continue;
      }
      const couple = await prisma.couple.create({
        data: {
          professionalId: userId,
          patient1Id: p1Id,
          patient2Id: p2Id,
          name: cp.name,
          importBatchId: batch.id,
        }
      });
      coupleIdMap.set(normalise(cp.coupleRowName), couple.id);
    }

    // 4c) Create appointments + financial entries
    let appointmentsCreated = 0;
    let financialCreated = 0;
    for (const s of sessionRows) {
      const normName = normalise(s.patientName);
      const coupleIdx = coupleNameMap.get(normName);
      const isCouple = coupleIdx !== undefined;
      const coupleId = isCouple ? coupleIdMap.get(normName) : null;
      let patientId = patientIdMap.get(normName);

      // For couple sessions, try to find the couple's first patient
      if (!patientId && isCouple && couplePairs[coupleIdx]) {
        patientId = patientIdMap.get(normalise(couplePairs[coupleIdx].patient1.name));
      }

      if (!patientId && !coupleId) continue; // skip unmatched

      const appt = await prisma.appointment.create({
        data: {
          professionalId: userId,
          patientId: isCouple ? null : patientId,
          coupleId: coupleId || null,
          type: isCouple ? 'couple' : 'individual',
          date: s.date,
          time: s.time || '09:00',
          duration: s.duration || 50,
          value: s.value,
          status: s.status,
          paymentStatus: s.isPaid ? 'paid' : 'pending',
          attended: s.status === 'completed',
          notes: s.notes,
          importBatchId: batch.id,
        }
      });
      appointmentsCreated++;

      // Create financial entry for completed sessions with value
      if (s.status === 'completed' && s.value > 0) {
        await prisma.account.create({
          data: {
            professionalId: userId,
            type: 'receivable',
            description: `Sessão ${isCouple ? 'casal' : 'individual'} - ${s.patientName}`,
            value: s.value,
            dueDate: s.date,
            status: s.isPaid ? 'paid' : 'pending',
            paidAt: s.isPaid ? s.date : null,
            category: 'Sessão',
            patientId: patientId || null,
            importBatchId: batch.id,
          }
        });
        financialCreated++;
      }
    }

    // Update batch summary
    await prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        summary: {
          patients: individualPatients.length,
          couples: couplePairs.length,
          appointments: appointmentsCreated,
          financialEntries: financialCreated,
        }
      }
    });

    res.json({
      batchId: batch.id,
      patients: individualPatients.length,
      couples: couplePairs.length,
      appointments: appointmentsCreated,
      financialEntries: financialCreated,
      message: 'Importação concluída com sucesso',
    });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({
      error: 'Erro ao importar dados',
      details: err.message,
      hint: 'Revise o mapeamento de colunas e os campos obrigatórios antes de tentar novamente.',
    });
  }
});

// ── GET /api/import/batches ─────────────────────────────────
router.get('/batches', async (req, res) => {
  try {
    const batches = await prisma.importBatch.findMany({
      where: { professionalId: req.userId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(batches);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar importações' });
  }
});

// ── DELETE /api/import/batches/:id  – rollback ──────────────
router.delete('/batches/:id', async (req, res) => {
  try {
    const batch = await prisma.importBatch.findFirst({
      where: { id: req.params.id, professionalId: req.userId }
    });
    if (!batch) return res.status(404).json({ error: 'Lote não encontrado' });

    // Delete in correct order (accounts -> appointments -> couples -> patients)
    const accounts = await prisma.account.deleteMany({ where: { importBatchId: batch.id } });
    const appointments = await prisma.appointment.deleteMany({ where: { importBatchId: batch.id } });
    const couples = await prisma.couple.deleteMany({ where: { importBatchId: batch.id } });
    const patients = await prisma.patient.deleteMany({ where: { importBatchId: batch.id } });

    await prisma.importBatch.delete({ where: { id: batch.id } });

    res.json({
      message: 'Importação desfeita com sucesso',
      removed: {
        accounts: accounts.count,
        appointments: appointments.count,
        couples: couples.count,
        patients: patients.count,
      }
    });
  } catch (err) {
    console.error('Rollback error:', err);
    res.status(500).json({ error: 'Erro ao desfazer importação', details: err.message });
  }
});

// POST /api/import/csv - Import CSV bank statement
router.post('/csv', async (req, res) => {
  try {
    const { rows, bankName, accountName } = req.body;
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'Nenhuma transação encontrada no arquivo' });
    }

    const created = [];
    for (const row of rows) {
      const value = Math.abs(parseFloat(row.value) || 0);
      if (value === 0) continue;

      const isExpense = parseFloat(row.value) < 0;
      const account = await prisma.account.create({
        data: {
          professionalId: req.userId,
          type: isExpense ? 'payable' : 'receivable',
          description: row.description || 'Transação importada',
          value,
          dueDate: row.date ? new Date(row.date) : new Date(),
          status: 'paid',
          paidAt: row.date ? new Date(row.date) : new Date(),
          category: row.category || (isExpense ? 'Importado - Saída' : 'Importado - Entrada'),
          notes: `Importado de ${bankName || 'extrato'}${accountName ? ` - ${accountName}` : ''}`,
        }
      });
      created.push(account);
    }

    res.json({
      imported: created.length,
      total: rows.length,
      message: `${created.length} transações importadas com sucesso`
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao importar transações', details: err.message });
  }
});

// POST /api/import/ofx - Import OFX bank statement
router.post('/ofx', async (req, res) => {
  try {
    const { content, bankName } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'Conteúdo OFX não fornecido' });
    }

    const transactions = [];
    const stmtTrnRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
    let match;
    while ((match = stmtTrnRegex.exec(content)) !== null) {
      const block = match[1];
      const getField = (name) => {
        const r = new RegExp(`<${name}>([^<\\n]+)`, 'i');
        const m = block.match(r);
        return m ? m[1].trim() : null;
      };
      const trnType = getField('TRNTYPE');
      const dtPosted = getField('DTPOSTED');
      const trnAmt = getField('TRNAMT');
      const memo = getField('MEMO') || getField('NAME') || 'Transação OFX';

      if (trnAmt) {
        const value = parseFloat(trnAmt.replace(',', '.'));
        let date = new Date();
        if (dtPosted && dtPosted.length >= 8) {
          date = new Date(parseInt(dtPosted.substring(0, 4)), parseInt(dtPosted.substring(4, 6)) - 1, parseInt(dtPosted.substring(6, 8)));
        }
        transactions.push({ value, date, description: memo, type: trnType });
      }
    }

    let balance = null;
    const balAmtMatch = content.match(/<BALAMT>([^<\n]+)/i);
    if (balAmtMatch) balance = parseFloat(balAmtMatch[1].replace(',', '.'));

    const created = [];
    for (const txn of transactions) {
      const absValue = Math.abs(txn.value);
      if (absValue === 0) continue;
      const isExpense = txn.value < 0;
      const account = await prisma.account.create({
        data: {
          professionalId: req.userId,
          type: isExpense ? 'payable' : 'receivable',
          description: txn.description,
          value: absValue,
          dueDate: txn.date,
          status: 'paid',
          paidAt: txn.date,
          category: isExpense ? 'Importado - Saída' : 'Importado - Entrada',
          notes: `Importado OFX${bankName ? ` - ${bankName}` : ''}`,
        }
      });
      created.push(account);
    }

    res.json({ imported: created.length, total: transactions.length, balance, message: `${created.length} transações importadas com sucesso` });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao importar OFX', details: err.message });
  }
});

module.exports = router;
