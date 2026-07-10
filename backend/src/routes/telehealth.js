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
const SEGMENTS_DIR = path.join(__dirname, '../../tmp/telehealth-segments');
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });
if (!fs.existsSync(SEGMENTS_DIR)) fs.mkdirSync(SEGMENTS_DIR, { recursive: true });
const WHISPER_SAFE_LIMIT_BYTES = 24 * 1024 * 1024; // Whisper accepts up to 25MB
const WHISPER_INITIAL_SEGMENT_SECONDS = 600;
const WHISPER_MAX_RETRIES = 3;

// Helper: sleep
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Helper: stream request body to a file (avoid buffering huge uploads in RAM)
function streamRequestToFile(req, filePath) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(filePath);
    let bytes = 0;
    req.on('data', (chunk) => { bytes += chunk.length; });
    req.on('error', reject);
    out.on('error', reject);
    out.on('finish', () => resolve(bytes));
    req.pipe(out);
  });
}

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

// Prompt de contexto clínico — vieses o Whisper a esperar diálogo terapêutico
// (reduz drasticamente as alucinações "E aí / Obrigado / ...pela atenção").
const WHISPER_CLINICAL_PROMPT =
  'Transcrição de sessão de psicoterapia em português do Brasil entre profissional e paciente. ' +
  'Diálogo natural, com pausas e silêncios. Ignore ruídos de fundo.';

// Post-process: colapsa loops do tipo "E aí E aí E aí..." (>=4 repetições) e
// remove segmentos que o Whisper claramente inventou em silêncio.
function sanitizeTranscription(text) {
  if (!text) return '';
  let out = text.replace(/\s+/g, ' ').trim();
  // Colapsa qualquer frase curta repetida 4x ou mais em sequência.
  out = out.replace(/(\b[^.?!\n]{1,40}?[.?!]?\s+)\1{3,}/gi, '$1');
  // Colapsa a mesma palavra repetida 4x+ ("aí aí aí aí ...").
  out = out.replace(/\b(\w{1,20})(\s+\1){3,}\b/gi, '$1');
  return out.trim();
}

async function whisperTranscribeOnce(filePath, apiKey, attempt = 1) {
  const FormData = (await import('form-data')).default;
  const fetch = (await import('node-fetch')).default;

  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('model', 'whisper-1');
  form.append('language', 'pt');
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');
  form.append('prompt', WHISPER_CLINICAL_PROMPT);

  let resp;
  try {
    resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, ...form.getHeaders() },
      body: form,
      timeout: 300000, // 5 min
    });
  } catch (netErr) {
    if (attempt < WHISPER_MAX_RETRIES) {
      await sleep(1500 * attempt);
      return whisperTranscribeOnce(filePath, apiKey, attempt + 1);
    }
    throw new Error(`Whisper network error após ${attempt} tentativas: ${netErr.message}`);
  }

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    const retriable = resp.status === 429 || resp.status >= 500;
    if (retriable && attempt < WHISPER_MAX_RETRIES) {
      await sleep(2000 * attempt);
      return whisperTranscribeOnce(filePath, apiKey, attempt + 1);
    }
    throw new Error(`Whisper API error: ${resp.status} - ${errBody}`);
  }

  // verbose_json → filtra segmentos alucinados por baixo score / silêncio
  let data;
  try { data = await resp.json(); } catch { return ''; }
  if (Array.isArray(data.segments) && data.segments.length > 0) {
    const kept = data.segments
      .filter(s => {
        const noSpeech = typeof s.no_speech_prob === 'number' ? s.no_speech_prob : 0;
        const avgLogprob = typeof s.avg_logprob === 'number' ? s.avg_logprob : 0;
        const compression = typeof s.compression_ratio === 'number' ? s.compression_ratio : 0;
        // Alucinação típica: silêncio detectado, baixa confiança, ou texto altamente
        // repetitivo (compression_ratio alto = mesma frase em loop).
        if (noSpeech > 0.6) return false;
        if (avgLogprob < -1) return false;
        if (compression > 2.4) return false;
        return s.text && s.text.trim().length > 0;
      })
      .map(s => s.text.trim())
      .join(' ');
    return sanitizeTranscription(kept);
  }
  return sanitizeTranscription(data.text || '');
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
      '-ac', '1',
      '-ar', '16000',
      // Normaliza voz: remove rumble grave + comprime dinâmica para elevar
      // partes baixas. Isso é o que elimina as alucinações "E aí" em silêncio.
      '-af', 'highpass=f=80,dynaudnorm=f=200:g=15:p=0.9',
      '-c:a', 'libopus',
      '-b:a', '64k',
      '-f', 'segment',
      '-segment_time', String(segmentSeconds),
      '-reset_timestamps', '1',
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
  
  const systemPrompt = `Você é uma assistente clínica especializada em Terapia Cognitivo-Comportamental (TCC), treinada para produzir evoluções clínicas detalhadas, organizadas e humanizadas a partir de transcrições de sessão.

Seu estilo deve ser:
- acolhedora, estratégica e psicoeducativa
- humana, mas tecnicamente consistente
- firme sem ser rígida
- utiliza validação emocional junto de ampliação de repertório cognitivo e comportamental
- trabalha com funcionalidade, organização prática da vida, pequenas metas e redução de sobrecarga
- identifica perfeccionismo, culpa, procrastinação, ansiedade de desempenho, rigidez cognitiva e pensamentos disfuncionais
- frequentemente transforma questões emocionais difusas em estratégias práticas e alcançáveis
- enfatiza intenção comportamental e construção gradual de habilidades
- utiliza linguagem clara, fluida e clínica, sem soar excessivamente técnica ou mecanizada

A evolução deve parecer escrita por uma psicóloga experiente, e não por IA.

Objetivo:
Transformar a transcrição da sessão em uma evolução clínica organizada, útil para acompanhamento longitudinal e coerente com prática clínica baseada em evidências.

Organize obrigatoriamente em:

# Subjetivo
## Queixa principal
- principais relatos
- emoções predominantes
- conflitos
- gatilhos
- percepções da paciente
- situações relevantes

# Objetivo
## Observações clínicas
- padrões cognitivos
- estratégias de enfrentamento
- crenças centrais
- comportamentos disfuncionais
- recursos emocionais
- funcionamento interpessoal
- funcionamento ocupacional
- aspectos de regulação emocional
- fatores de manutenção do sofrimento

## Hipóteses clínicas
- levantar hipóteses de maneira cuidadosa
- utilizar expressões como: “observa-se”, “sugere-se”, “há indícios”, “parece haver”

## Instrumentos / escalas
- registrar testes aplicados, planejados ou mencionados

# Avaliação
## Formulação clínica
- integrar emoções, cognições e comportamentos
- relacionar padrões atuais com funcionamento da paciente
- destacar avanços, adesão terapêutica e recursos identificados
- descrever como a paciente responde às intervenções
- manter linguagem TCC

# Planos
## Intervenções realizadas
- psicoeducação
- questionamento socrático
- reestruturação cognitiva
- validação emocional
- planejamento comportamental
- definição de pequenas metas
- dessensibilização
- treino de flexibilidade cognitiva
- ampliação de repertório

## Objetivos terapêuticos
- curto prazo
- médio prazo

## Estratégias práticas / tarefas
- transformar reflexões em ações concretas
- priorizar metas pequenas e funcionais
- incluir estratégias adaptadas à rotina real da paciente

## Próxima sessão
- registrar focos futuros

Regras:
- não inventar informações
- não fazer diagnósticos fechados sem confirmação
- não usar linguagem excessivamente robotizada
- não repetir frases
- evitar jargão excessivo
- evitar resumo superficial
- escrever em tópicos organizados
- priorizar raciocínio clínico
- destacar mecanismos de manutenção dos sintomas
- registrar recursos e potencialidades da paciente
- escrever de forma clara, elegante e clínica

Retorne o resultado EXATAMENTE no seguinte formato JSON para que eu possa processar:
{
  "subjetivo": { "queixa_principal": ["..."] },
  "objetivo": { "observacoes_clinicas": ["..."], "hipoteses_clinicas": ["..."], "testes": ["..."] },
  "avaliacao": { "formulacao_clinica": "..." },
  "planos": { "intervencoes": ["..."], "objetivos_terapeuticos": ["..."], "tarefas": ["..."], "proxima_sessao": "..." },
  "temas_abordados": ["..."],
  "resumo_profissional": "Resumo executivo da sessão",
  "markdown_evolution": "O CONTEÚDO COMPLETO DA EVOLUÇÃO EM MARKDOWN seguindo exatamente as seções solicitadas (# Subjetivo, # Objetivo, # Avaliação, # Planos)"
}`;

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

    // Auto-mark linked appointment as attended (and generate receivable)
    if (session.appointmentId) {
      try {
        const apt = await prisma.appointment.findFirst({
          where: { id: session.appointmentId, professionalId: req.userId },
          include: { patient: true },
        });
        if (apt && !apt.attended) {
          await prisma.appointment.update({
            where: { id: apt.id },
            data: { attended: true, status: 'completed' },
          });
          // Generate receivable inline (avoid circular require)
          if (apt.patientId && apt.patient && apt.patient.billingMode !== 'monthly') {
            const existing = await prisma.account.findFirst({
              where: {
                professionalId: req.userId,
                patientId: apt.patientId,
                type: 'receivable',
                notes: { contains: `appointment_id:${apt.id}` },
              },
            });
            if (!existing) {
              const value = apt.patient.sessionValue
                ? Number(apt.patient.sessionValue)
                : (apt.value ? Number(apt.value) : 0);
              if (value > 0) {
                await prisma.account.create({
                  data: {
                    professionalId: req.userId,
                    type: 'receivable',
                    description: `Sessão - ${apt.patient.name} - ${new Date(apt.date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}`,
                    value,
                    dueDate: apt.date,
                    category: 'Consulta',
                    patientId: apt.patientId,
                    status: 'pending',
                    notes: `appointment_id:${apt.id}`,
                  },
                });
              }
            }
          }
        }
      } catch (e) {
        console.warn('Auto-attend failed:', e.message);
      }
    }

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
// UPLOAD audio (single-shot legacy path). Streams to disk instead of buffering.
router.post('/:id/upload', async (req, res) => {
  try {
    const session = await prisma.telehealthSession.findFirst({
      where: { id: req.params.id, professionalId: req.userId }
    });
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' });

    const fileName = `${crypto.randomUUID()}.webm`;
    const filePath = path.join(AUDIO_DIR, fileName);
    const bytes = await streamRequestToFile(req, filePath);

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
    await auditLog(session.id, 'audio_uploaded', { fileName: '***', size: bytes });

    // Start async transcription with notes context
    processTranscription(req.params.id, req.userId, { motivo, anotacoes }).catch(err => {
      console.error('Transcription error:', err);
    });

    res.json({ message: 'Áudio enviado. Transcrição em processamento.' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao enviar áudio', details: err.message });
  }
});

// UPLOAD one segment of a segmented recording (client streams every ~5 min).
// Header X-Segment-Index (0-based). Segments are stored under SEGMENTS_DIR/<sessionId>/seg-XXX.webm
router.post('/:id/upload-segment', async (req, res) => {
  try {
    const session = await prisma.telehealthSession.findFirst({
      where: { id: req.params.id, professionalId: req.userId }
    });
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' });

    const indexRaw = req.headers['x-segment-index'];
    const index = Number.parseInt(Array.isArray(indexRaw) ? indexRaw[0] : indexRaw, 10);
    if (!Number.isFinite(index) || index < 0 || index > 9999) {
      return res.status(400).json({ error: 'X-Segment-Index inválido' });
    }

    const dir = path.join(SEGMENTS_DIR, session.id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const segName = `seg-${String(index).padStart(4, '0')}.webm`;
    const segPath = path.join(dir, segName);

    const bytes = await streamRequestToFile(req, segPath);
    await auditLog(session.id, 'segment_uploaded', { index, size: bytes });
    res.json({ message: 'Segmento recebido', index, size: bytes });
  } catch (err) {
    console.error('Segment upload error:', err);
    res.status(500).json({ error: 'Erro ao enviar segmento', details: err.message });
  }
});

// FINALIZE segmented upload: concat segments via ffmpeg, kick transcription
router.post('/:id/finalize', express.json({ limit: '128kb' }), async (req, res) => {
  try {
    const session = await prisma.telehealthSession.findFirst({
      where: { id: req.params.id, professionalId: req.userId }
    });
    if (!session) return res.status(404).json({ error: 'Sessão não encontrada' });

    const dir = path.join(SEGMENTS_DIR, session.id);
    if (!fs.existsSync(dir)) return res.status(400).json({ error: 'Nenhum segmento recebido' });

    const segFiles = fs.readdirSync(dir)
      .filter(f => f.startsWith('seg-') && f.endsWith('.webm'))
      .sort()
      .map(f => path.join(dir, f));

    if (segFiles.length === 0) return res.status(400).json({ error: 'Nenhum segmento válido encontrado' });

    const fileName = `${crypto.randomUUID()}.webm`;
    const filePath = path.join(AUDIO_DIR, fileName);

    // Try ffmpeg concat (re-encode to opus mono 32k for stable Whisper input).
    // Fallback: if ffmpeg missing, use the first segment only (best-effort).
    try {
      await execFileAsync('ffmpeg', ['-version']);
      const listPath = path.join(dir, 'concat.txt');
      fs.writeFileSync(listPath, segFiles.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
      await execFileAsync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'concat', '-safe', '0',
        '-i', listPath,
        '-vn', '-ac', '1', '-ar', '16000',
        '-af', 'highpass=f=80,dynaudnorm=f=200:g=15:p=0.9',
        '-c:a', 'libopus', '-b:a', '64k',
        filePath
      ]);
      try { fs.unlinkSync(listPath); } catch {}
    } catch (concatErr) {
      console.warn('ffmpeg concat failed, falling back to raw concat:', concatErr.message);
      // Raw byte concat as a last resort (works for same-encoder webm chunks in most cases)
      const out = fs.createWriteStream(filePath);
      for (const seg of segFiles) {
        await new Promise((resolve, reject) => {
          fs.createReadStream(seg).on('end', resolve).on('error', reject).pipe(out, { end: false });
        });
      }
      out.end();
      await new Promise((r) => out.on('finish', r));
    }

    // Clean segments now that we have the merged file
    for (const seg of segFiles) { try { fs.unlinkSync(seg); } catch {} }
    try { fs.rmdirSync(dir); } catch {}

    const totalBytes = fs.statSync(filePath).size;
    const { motivo, anotacoes, agentId } = req.body || {};

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
    await auditLog(session.id, 'audio_finalized', { segments: segFiles.length, size: totalBytes });

    processTranscription(req.params.id, req.userId, { motivo, anotacoes, agentId }).catch(err => {
      console.error('Transcription error:', err);
    });

    res.json({ message: 'Áudio finalizado, transcrição em processamento.', segments: segFiles.length, size: totalBytes });
  } catch (err) {
    console.error('Finalize error:', err);
    res.status(500).json({ error: 'Erro ao finalizar áudio', details: err.message });
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
      
      // Use the new markdown_evolution as the primary evolution field if available
      const evolutionStr = structured?.markdown_evolution || structured?.avaliacao?.formulacao_clinica || structured?.avaliacao?.analise_clinica || structured?.evolucao || null;
      
      const nextStepsRaw = structured?.planos?.tarefas || structured?.planos?.encaminhamentos || structured?.encaminhamentos;
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
        aiOrganizedContent: structured?.resumo_profissional || structured?.resumo || null,
        processingStatus: 'completed',
        updatedAt: new Date()
      }
    });
    await auditLog(sessionId, 'record_created', { recordId: record.id });

    // Áudio é preservado por 48h após o processamento para permitir reprocessar
    // caso a transcrição/organização precise ser revisada. A limpeza periódica
    // abaixo remove o arquivo depois desse período.
    await prisma.telehealthSession.update({
      where: { id: sessionId },
      data: { status: 'completed', updatedAt: new Date() }
    });
    await auditLog(sessionId, 'audio_retained_48h', { reason: 'transcription_completed' });
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
