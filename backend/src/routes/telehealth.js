const express = require('express');

const { authMiddleware } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const router = express.Router();
const prisma = require('../db');
const execFileAsync = promisify(execFile);

router.use(authMiddleware);

const AUDIO_DIR = path.join(__dirname, '../../tmp/telehealth-audio');
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });
const WHISPER_SAFE_LIMIT_BYTES = 24 * 1024 * 1024; // Whisper accepts up to 25MB
const WHISPER_INITIAL_SEGMENT_SECONDS = 600;

// Helper: create audit log
async function auditLog(sessionId, action, details) {
  await prisma.telehealthAuditLog.create({
    data: { sessionId, action, details: typeof details === 'string' ? details : JSON.stringify(details) }
  });
}

// Helper: find AI key for transcription
async function findAiKey(userId) {
  const keys = await prisma.aiProviderKey.findMany({
    where: { OR: [{ userId }, { isGlobal: true }] },
    orderBy: { createdAt: 'desc' }
  });
  return keys.find(k => k.provider === 'openai') || keys[0];
}

// Helper: call OpenAI Whisper for transcription
function cleanupTempDir(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {}
}

async function whisperTranscribeOnce(filePath, apiKey) {
  const FormData = (await import('form-data')).default;
  const fetch = (await import('node-fetch')).default;
  
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('model', 'whisper-1');
  form.append('language', 'pt');
  form.append('response_format', 'text');
  
  const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, ...form.getHeaders() },
    body: form
  });
  
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Whisper API error: ${resp.status} - ${err}`);
  }
  return resp.text();
}

async function splitAudioIntoChunks(filePath, segmentSeconds = WHISPER_INITIAL_SEGMENT_SECONDS) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telehealth-chunks-'));
  const outputPattern = path.join(tempDir, 'chunk-%03d.webm');

  try {
    await execFileAsync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      filePath,
      '-vn',
      '-ac',
      '1',
      '-c:a',
      'libopus',
      '-b:a',
      '32k',
      '-f',
      'segment',
      '-segment_time',
      String(segmentSeconds),
      '-reset_timestamps',
      '1',
      outputPattern
    ]);
  } catch (err) {
    cleanupTempDir(tempDir);
    throw new Error(`Falha ao preparar áudio para transcrição: ${err.message}`);
  }

  const chunks = fs.readdirSync(tempDir)
    .filter(name => name.startsWith('chunk-') && name.endsWith('.webm'))
    .sort()
    .map(name => path.join(tempDir, name));

  if (chunks.length === 0) {
    cleanupTempDir(tempDir);
    throw new Error('Falha ao dividir o áudio em partes para transcrição.');
  }

  const hasOversizedChunks = chunks.some(chunkPath => fs.statSync(chunkPath).size > WHISPER_SAFE_LIMIT_BYTES);
  if (hasOversizedChunks && segmentSeconds > 60) {
    cleanupTempDir(tempDir);
    return splitAudioIntoChunks(filePath, Math.max(60, Math.floor(segmentSeconds / 2)));
  }

  if (hasOversizedChunks) {
    cleanupTempDir(tempDir);
    throw new Error('Não foi possível reduzir o áudio abaixo do limite da transcrição.');
  }

  return { tempDir, chunks };
}

async function transcribeLargeAudio(filePath, apiKey) {
  try {
    await execFileAsync('ffmpeg', ['-version']);
  } catch {
    throw new Error('Áudio acima do limite da transcrição e ffmpeg não está disponível para dividir automaticamente.');
  }

  const { tempDir, chunks } = await splitAudioIntoChunks(filePath);
  try {
    const parts = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const chunkText = await whisperTranscribeOnce(chunks[i], apiKey);
      parts.push(chunkText.trim());
    }
    return parts.filter(Boolean).join('\n\n');
  } finally {
    cleanupTempDir(tempDir);
  }
}

async function transcribeAudio(filePath, apiKey) {
  const fileSize = fs.statSync(filePath).size;
  if (fileSize > WHISPER_SAFE_LIMIT_BYTES) {
    return transcribeLargeAudio(filePath, apiKey);
  }

  try {
    return await whisperTranscribeOnce(filePath, apiKey);
  } catch (err) {
    if (String(err.message || '').includes('Whisper API error: 413')) {
      return transcribeLargeAudio(filePath, apiKey);
    }
    throw err;
  }
}

// Helper: organize transcription with AI
async function organizeWithAi(transcription, provider, apiKey) {
  const fetch = (await import('node-fetch')).default;
  
  const systemPrompt = `Você é um psicólogo clínico experiente. Analise a transcrição da sessão e organize o prontuário seguindo EXATAMENTE esta estrutura profissional, sendo o mais detalhado e preciso possível.

Estrutura esperada (JSON):
{
  "subjetivo": {
    "queixa_principal": ["Dificuldades relatadas pelo paciente", "..."],
    "sentimentos_percepcoes": ["Sentimentos e percepções expressos", "..."]
  },
  "objetivo": {
    "observacoes_clinicas": ["Comportamentos, padrões, insights do terapeuta", "..."],
    "testes_psicologicos": ["Testes aplicados, planejados ou sugeridos", "..."]
  },
  "avaliacao": {
    "analise_clinica": "Síntese detalhada do quadro atual, hipóteses diagnósticas e evolução.",
    "sugestoes_cid": ["Códigos CID como hipótese", "..."]
  },
  "planos": {
    "intervencoes": ["Ações realizadas ou planejadas", "..."],
    "encaminhamentos": ["Encaminhamentos sugeridos", "..."],
    "proxima_consulta": ["Foco planejado para a próxima sessão", "..."],
    "objetivos_terapeuticos": ["Metas de curto e médio prazo", "..."]
  },
  "estrategias_especificas": [
    {
      "categoria": "Nome da área (ex: Gestão do Tempo, Perfeccionismo)",
      "itens": ["Ações práticas e estratégias definidas", "..."]
    }
  ],
  "resumo_profissional": "Resumo executivo da sessão",
  "temas_abordados": ["Padrões e temas recorrentes"]
}

IMPORTANTE:
- Seja extremamente detalhista. Use o exemplo do usuário como padrão de qualidade.
- Identifique estratégias práticas e "lições de casa" de forma clara.
- Na avaliação, faça uma síntese analítica profunda sobre o funcionamento do paciente.
- Mantenha compatibilidade com os campos legados mapeando para as chaves acima.`;

  let url, headers, body;
  if (provider === 'openai') {
    url = 'https://api.openai.com/v1/chat/completions';
    headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    body = JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: transcription }],
      response_format: { type: 'json_object' }
    });
  } else if (provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages';
    headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' };
    body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: transcription }]
    });
  } else {
    url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    headers = { 'Content-Type': 'application/json' };
    body = JSON.stringify({
      contents: [{ parts: [{ text: `${systemPrompt}\n\nTranscrição:\n${transcription}` }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8192 }
    });
  }

  const resp = await fetch(url, { method: 'POST', headers, body });
  const data = await resp.json();
  
  let content;
  if (provider === 'openai') content = data.choices?.[0]?.message?.content;
  else if (provider === 'anthropic') content = data.content?.[0]?.text;
  else content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  
  try { return JSON.parse(content); } catch { return { resumo: content }; }
}

// LIST sessions
router.get('/', async (req, res) => {
  try {
    const sessions = await prisma.telehealthSession.findMany({
      where: { professionalId: req.userId },
      include: { patient: { select: { id: true, name: true } }, couple: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' }
    });
    // Never expose audio file names
    const safe = sessions.map(s => ({ ...s, audioFileName: undefined }));
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar sessões', details: err.message });
  }
});

// GET single session
router.get('/:id', async (req, res) => {
  try {
    const session = await prisma.telehealthSession.findFirst({
      where: { id: req.params.id, professionalId: req.userId },
      include: {
        patient: { select: { id: true, name: true } },
        couple: { select: { id: true, name: true } },
        auditLogs: { orderBy: { createdAt: 'asc' } }
      }
    });
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' });
    res.json({ ...session, audioFileName: undefined });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar sessão', details: err.message });
  }
});

// CREATE session
router.post('/', async (req, res) => {
  try {
    const { patientId, coupleId, appointmentId, meetingLink } = req.body;
    const session = await prisma.telehealthSession.create({
      data: {
        professionalId: req.userId,
        patientId: patientId || null,
        coupleId: coupleId || null,
        appointmentId: appointmentId || null,
        meetingLink: meetingLink || null,
        consentAccepted: true
      },
      include: { patient: { select: { id: true, name: true } }, couple: { select: { id: true, name: true } } }
    });
    await auditLog(session.id, 'session_created', { patientId, coupleId });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar sessão', details: err.message });
  }
});

// UPDATE session (only if not yet uploaded/processed)
router.patch('/:id', async (req, res) => {
  try {
    const session = await prisma.telehealthSession.findFirst({
      where: { id: req.params.id, professionalId: req.userId }
    });
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' });
    if (session.status !== 'waiting') return res.status(400).json({ error: 'Sessão já iniciada, não pode ser editada' });

    const { patientId, meetingLink } = req.body;
    const updated = await prisma.telehealthSession.update({
      where: { id: req.params.id },
      data: {
        ...(patientId !== undefined && { patientId: patientId || null }),
        ...(meetingLink !== undefined && { meetingLink: meetingLink || null }),
        updatedAt: new Date()
      },
      include: { patient: { select: { id: true, name: true } }, couple: { select: { id: true, name: true } } }
    });
    await auditLog(session.id, 'session_updated', { patientId, meetingLink });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar sessão', details: err.message });
  }
});

// DELETE session (only if not yet uploaded/processed)
router.delete('/:id', async (req, res) => {
  try {
    const session = await prisma.telehealthSession.findFirst({
      where: { id: req.params.id, professionalId: req.userId }
    });
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' });
    if (!['waiting', 'completed', 'error'].includes(session.status) && session.processingStatus === 'transcribing') {
      return res.status(400).json({ error: 'Sessão em processamento, não pode ser excluída' });
    }

    // Clean up audio file if exists
    if (session.audioFileName) {
      const filePath = path.join(AUDIO_DIR, session.audioFileName);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
    }

    await prisma.telehealthAuditLog.deleteMany({ where: { sessionId: session.id } });
    await prisma.telehealthSession.delete({ where: { id: session.id } });
    res.json({ message: 'Sessão excluída' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir sessão', details: err.message });
  }
});

// PROCESS session with AI (for uploaded sessions not yet processed)
router.post('/:id/process', async (req, res) => {
  try {
    const session = await prisma.telehealthSession.findFirst({
      where: { id: req.params.id, professionalId: req.userId }
    });
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' });
    if (session.processingStatus === 'completed') return res.status(400).json({ error: 'Sessão já processada' });
    if (!session.audioFileName) return res.status(400).json({ error: 'Nenhum áudio disponível para processar' });

    processTranscription(req.params.id, req.userId).catch(console.error);
    res.json({ message: 'Processamento iniciado' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao processar', details: err.message });
  }
});

// START capture
router.post('/:id/start', async (req, res) => {
  try {
    const session = await prisma.telehealthSession.update({
      where: { id: req.params.id },
      data: { status: 'capturing', startedAt: new Date(), updatedAt: new Date() }
    });
    await auditLog(session.id, 'capture_started', null);
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao iniciar captura', details: err.message });
  }
});

// STOP capture without upload (fallback after refresh/crash)
router.post('/:id/stop', async (req, res) => {
  try {
    const session = await prisma.telehealthSession.findFirst({
      where: { id: req.params.id, professionalId: req.userId }
    });
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' });
    if (session.status !== 'capturing') return res.status(400).json({ error: 'Sessão não está em captura' });

    const updated = await prisma.telehealthSession.update({
      where: { id: session.id },
      data: {
        status: 'waiting',
        processingStatus: 'none',
        processingError: null,
        startedAt: null,
        endedAt: null,
        duration: null,
        updatedAt: new Date()
      }
    });

    await auditLog(session.id, 'capture_stopped', { mode: 'manual_without_upload' });
    res.json({ ...updated, audioFileName: undefined });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao encerrar captura', details: err.message });
  }
});

// UPLOAD audio
router.post('/:id/upload', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '200mb' }), async (req, res) => {
  try {
    const session = await prisma.telehealthSession.findFirst({
      where: { id: req.params.id, professionalId: req.userId }
    });
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' });

    const fileName = `${crypto.randomUUID()}.webm`;
    const filePath = path.join(AUDIO_DIR, fileName);
    fs.writeFileSync(filePath, req.body);

    // Read session notes from headers
    const motivo = req.headers['x-session-motivo'] ? decodeURIComponent(req.headers['x-session-motivo']) : null;
    const anotacoes = req.headers['x-session-anotacoes'] ? decodeURIComponent(req.headers['x-session-anotacoes']) : null;

    await prisma.telehealthSession.update({
      where: { id: req.params.id },
      data: {
        audioFileName: fileName,
        audioUploadedAt: new Date(),
        status: 'uploaded',
        endedAt: new Date(),
        duration: session.startedAt ? Math.round((Date.now() - new Date(session.startedAt).getTime()) / 1000) : null,
        processingStatus: 'uploaded',
        updatedAt: new Date()
      }
    });
    await auditLog(session.id, 'audio_uploaded', { fileName: '***', size: req.body.length });

    // Start async transcription with notes context
    processTranscription(req.params.id, req.userId, { motivo, anotacoes }).catch(err => {
      console.error('Transcription error:', err);
    });

    res.json({ message: 'Áudio enviado. Transcrição em processamento.' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao enviar áudio', details: err.message });
  }
});

// Async transcription + AI organization + auto-delete
async function processTranscription(sessionId, userId, notes = {}) {
  try {
    await prisma.telehealthSession.update({
      where: { id: sessionId },
      data: { processingStatus: 'transcribing', transcriptionStartedAt: new Date(), updatedAt: new Date() }
    });
    await auditLog(sessionId, 'transcription_started', null);

    const session = await prisma.telehealthSession.findUnique({ where: { id: sessionId } });
    if (!session?.audioFileName) throw new Error('Arquivo de áudio não encontrado');

    const filePath = path.join(AUDIO_DIR, session.audioFileName);
    const aiKey = await findAiKey(userId);
    if (!aiKey) throw new Error('Chave de IA não configurada. Configure uma chave OpenAI para transcrição.');

    // Transcribe
    const transcription = await transcribeAudio(filePath, aiKey.apiKey);

    await prisma.telehealthSession.update({
      where: { id: sessionId },
      data: { transcription, transcriptionEndedAt: new Date(), processingStatus: 'organizing', updatedAt: new Date() }
    });
    await auditLog(sessionId, 'transcription_completed', { length: transcription.length });

    // Organize with AI — include professional notes as context
    let structured = null;
    try {
      let enrichedTranscription = transcription;
      if (notes.motivo) enrichedTranscription = `[Motivo da consulta informado pelo profissional: ${notes.motivo}]\n\n${enrichedTranscription}`;
      if (notes.anotacoes) enrichedTranscription = `${enrichedTranscription}\n\n[Anotações do profissional durante a sessão: ${notes.anotacoes}]`;
      structured = await organizeWithAi(enrichedTranscription, aiKey.provider, aiKey.apiKey);
    } catch (e) {
      console.error('AI organization error:', e);
    }

    // Create record
      // Normalize fields for backward compatibility and structured view
      const clinicalObs = structured?.objetivo?.observacoes_clinicas || structured?.observacoes_relevantes;
      const clinicalObsStr = Array.isArray(clinicalObs) ? clinicalObs.join('; ') : (clinicalObs || null);
      
      const keyPointsRaw = structured?.resumo_profissional || structured?.pontos_principais;
      const keyPointsStr = Array.isArray(keyPointsRaw) ? keyPointsRaw.join('; ') : (keyPointsRaw || null);
      
      const evolutionRaw = structured?.avaliacao?.analise_clinica || structured?.evolucao;
      const evolutionStr = Array.isArray(evolutionRaw) ? evolutionRaw.join('; ') : (evolutionRaw || null);
      
      const nextStepsRaw = structured?.planos?.encaminhamentos || structured?.encaminhamentos;
      const nextStepsStr = Array.isArray(nextStepsRaw) ? nextStepsRaw.join('; ') : (nextStepsRaw || null);
      
      const complaintRaw = structured?.subjetivo?.queixa_principal || structured?.motivo_sessao;
      const complaintStr = Array.isArray(complaintRaw) ? complaintRaw.join('; ') : (complaintRaw || notes.motivo || null);

      const record = await prisma.record.create({
      data: {
        professionalId: userId,
        patientId: session.patientId,
        coupleId: session.coupleId,
        appointmentId: session.appointmentId,
        type: session.coupleId ? 'couple' : 'individual',
        date: session.startedAt || new Date(),
        content: notes.anotacoes ? `${transcription}\n\n---\nAnotações do profissional:\n${notes.anotacoes}` : transcription,
        aiContent: structured ? JSON.stringify(structured) : null,
        complaint: complaintStr,
        keyPoints: keyPointsStr,
        clinicalObservations: clinicalObsStr,
        evolution: evolutionStr,
        nextSteps: nextStepsStr,
        modality: 'telehealth',
        themes: Array.isArray(structured?.temas_abordados) ? structured.temas_abordados : []
      }
    });

    await prisma.telehealthSession.update({
      where: { id: sessionId },
      data: {
        recordId: record.id,
        structuredContent: structured ? JSON.stringify(structured) : null,
        aiOrganizedContent: structured?.resumo || null,
        processingStatus: 'completed',
        updatedAt: new Date()
      }
    });
    await auditLog(sessionId, 'record_created', { recordId: record.id });

    // DELETE audio file immediately
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      await prisma.telehealthSession.update({
        where: { id: sessionId },
        data: { audioFileName: null, audioDeletedAt: new Date(), status: 'completed', updatedAt: new Date() }
      });
      await auditLog(sessionId, 'audio_deleted', { reason: 'transcription_completed' });
    } catch (delErr) {
      console.error('Error deleting audio:', delErr);
      // Schedule for later cleanup
      await auditLog(sessionId, 'audio_delete_failed', { error: delErr.message });
    }
  } catch (err) {
    const rawError = err?.message || 'Erro desconhecido no processamento';
    const processingError = rawError.includes('Whisper API error: 413')
      ? 'Áudio acima do limite da transcrição. O sistema tentou fracionar automaticamente, mas não conseguiu concluir.'
      : rawError;

    await prisma.telehealthSession.update({
      where: { id: sessionId },
      data: {
        processingStatus: 'error',
        processingError,
        updatedAt: new Date()
      }
    });
    await auditLog(sessionId, 'processing_error', { error: rawError });
    // Audio is kept for 24h so the user can retry — periodic cleanup handles expiry
  }
}

// GET processing status
router.get('/:id/status', async (req, res) => {
  try {
    const session = await prisma.telehealthSession.findFirst({
      where: { id: req.params.id, professionalId: req.userId },
      select: { id: true, status: true, processingStatus: true, processingError: true, recordId: true, transcription: true, structuredContent: true }
    });
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar status', details: err.message });
  }
});

// RETRY transcription
router.post('/:id/retry', async (req, res) => {
  try {
    const session = await prisma.telehealthSession.findFirst({
      where: { id: req.params.id, professionalId: req.userId }
    });
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' });
    if (!['error', 'uploaded', 'none'].includes(session.processingStatus)) return res.status(400).json({ error: 'Sessão não pode ser reprocessada neste estado' });
    if (!session.audioFileName) return res.status(400).json({ error: 'Áudio já foi excluído' });

    processTranscription(req.params.id, req.userId).catch(console.error);
    res.json({ message: 'Reprocessamento iniciado' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao reprocessar', details: err.message });
  }
});

// Periodic cleanup: delete any audio files older than 24 hours
setInterval(async () => {
  try {
    const stale = await prisma.telehealthSession.findMany({
      where: {
        audioFileName: { not: null },
        audioUploadedAt: { lt: new Date(Date.now() - 86400000) } // 24h
      }
    });
    for (const s of stale) {
      const fp = path.join(AUDIO_DIR, s.audioFileName);
      try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch {}
      await prisma.telehealthSession.update({
        where: { id: s.id },
        data: { audioFileName: null, audioDeletedAt: new Date(), updatedAt: new Date() }
      });
      await auditLog(s.id, 'audio_deleted', { reason: 'periodic_cleanup_24h' });
    }
  } catch {}
}, 1800000); // every 30 min

module.exports = router;
