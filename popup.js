// popup.js - PsychNote Extension

// ─── Default API Keys ─────────────────────────────────────────────────────────
const DEFAULT_ELEVEN_KEY = 'apii';
const DEFAULT_GROQ_KEY   = 'apiii';

// ─── State ───────────────────────────────────────────────────────────────────
let isRecording = false;
let timerInterval = null;
let secondsElapsed = 0;
let useBrowser = true;
let useMic = true;
 
// ─── DOM ──────────────────────────────────────────────────────────────────────
const btnRecord         = document.getElementById('btnRecord');
const timer             = document.getElementById('timer');
const dot               = document.getElementById('dot');
const statusText        = document.getElementById('statusText');
const toggleBrowser     = document.getElementById('toggleBrowser');
const toggleMic         = document.getElementById('toggleMic');
const progressSection   = document.getElementById('progressSection');
const outputSection     = document.getElementById('outputSection');
const transcriptBox     = document.getElementById('transcriptBox');
const evolutionBox      = document.getElementById('evolutionBox');
const btnSettings       = document.getElementById('btnSettings');
const modalOverlay      = document.getElementById('modalOverlay');
const btnSave           = document.getElementById('btnSave');
const btnCancel         = document.getElementById('btnCancel');
const inputElevenKey    = document.getElementById('inputElevenKey');
const inputGroqKey      = document.getElementById('inputGroqKey');
const btnCopyTranscript = document.getElementById('btnCopyTranscript');
const btnCopyEvolution  = document.getElementById('btnCopyEvolution');
const toastEl           = document.getElementById('toast');
 
// ─── Init: sincronizar estado con background ──────────────────────────────────
chrome.runtime.sendMessage({ action: 'getStatus' }, (res) => {
  if (res && res.isRecording) {
    isRecording = true;
    secondsElapsed = res.elapsed;
    setRecordingUI(true);
    startTimer();
  }
});
 
// Escuchar eventos del background
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'recordingStarted') {
    setRecordingUI(true);
  }
  if (message.action === 'recordingStopped') {
    setRecordingUI(false);
  }
});
 
// ─── Toggle sources ───────────────────────────────────────────────────────────
toggleBrowser.addEventListener('click', () => {
  if (isRecording) return;
  useBrowser = !useBrowser;
  toggleBrowser.classList.toggle('on', useBrowser);
});
toggleMic.addEventListener('click', () => {
  if (isRecording) return;
  useMic = !useMic;
  toggleMic.classList.toggle('on', useMic);
});
 
// ─── Record button ────────────────────────────────────────────────────────────
btnRecord.addEventListener('click', async () => {
  if (!isRecording) await startRecording();
  else await stopRecording();
});
 
async function startRecording() {
  if (!useBrowser && !useMic) {
    showToast('Activa al menos una fuente de audio');
    return;
  }
  const keys = await getKeys();
  if (!keys.groqKey) {
    showToast('Configura tu clave Groq primero');
    modalOverlay.classList.add('open');
    return;
  }
 
  btnRecord.disabled = true;
  chrome.runtime.sendMessage({ action: 'startRecording', useMic, useBrowser }, (res) => {
    btnRecord.disabled = false;
    if (!res || !res.success) {
      showToast('Error al iniciar: ' + (res?.error || 'desconocido'));
      return;
    }
    isRecording = true;
    secondsElapsed = 0;
    setRecordingUI(true);
    startTimer();
    outputSection.classList.remove('visible');
    progressSection.classList.remove('visible');
  });
}
 
async function stopRecording() {
  btnRecord.disabled = true;
  clearInterval(timerInterval);
  statusText.textContent = 'Procesando...';
 
  chrome.runtime.sendMessage({ action: 'stopRecording' }, async (res) => {
    isRecording = false;
    setRecordingUI(false);
 
    if (!res || !res.success) {
      showToast('Error al detener: ' + (res?.error || 'desconocido'));
      btnRecord.disabled = false;
      return;
    }
 
    // Obtener el audio del background
    chrome.runtime.sendMessage({ action: 'getAudio' }, async (audioRes) => {
      if (!audioRes || !audioRes.success) {
        showToast('Error al obtener audio: ' + (audioRes?.error || ''));
        btnRecord.disabled = false;
        return;
      }
      await processAudio(audioRes.data, audioRes.mimeType);
      btnRecord.disabled = false;
      timer.classList.remove('visible');
    });
  });
}
 
// ─── Procesar audio: transcribir + analizar ───────────────────────────────────
async function processAudio(base64Data, mimeType) {
  progressSection.classList.add('visible');
  resetSteps();
 
  try {
    // Convertir base64 a blob
    const res = await fetch(base64Data);
    const blob = await res.blob();
 
    // Step 1: Transcribir con Groq Whisper
    setStep('transcribe', 'loading', 'Enviando audio a Groq Whisper...');
    const transcript = await transcribeWithGroqWhisper(blob, mimeType);
    setStep('transcribe', 'done', `Transcripción completada`);
    transcriptBox.textContent = transcript;
 
    // Step 2: Analizar con Groq Llama
    setStep('analyze', 'loading', 'Analizando con IA clínica...');
    const evolution = await analyzeWithGroq(transcript);
    setStep('analyze', 'done', 'Análisis completado');
 
    // Step 3: Formato listo
    setStep('format', 'loading', 'Estructurando evolución...');
    await new Promise(r => setTimeout(r, 400));
    setStep('format', 'done', 'Listo');
 
    evolutionBox.textContent = evolution;
    outputSection.classList.add('visible');
    statusText.textContent = 'Listo';
 
  } catch (err) {
    console.error('Processing error:', err);
    showToast('Error: ' + err.message);
    statusText.textContent = 'Error';
  }
}
 
// ─── Groq Whisper (transcripción) ─────────────────────────────────────────────
async function transcribeWithGroqWhisper(audioBlob, mimeType) {
  const keys = await getKeys();
 
  let ext = 'webm';
  if (mimeType && mimeType.includes('ogg')) ext = 'ogg';
  else if (mimeType && mimeType.includes('mp4')) ext = 'mp4';
 
  const formData = new FormData();
  formData.append('file', new File([audioBlob], `sesion.${ext}`, { type: mimeType || 'audio/webm' }));
  formData.append('model', 'whisper-large-v3');
  formData.append('language', 'es');
  formData.append('response_format', 'verbose_json');
 
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${keys.groqKey}` },
    body: formData
  });
 
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq Whisper (${res.status}): ${err}`);
  }
 
  const data = await res.json();
  return data.text || '';
}
 
// ─── Groq Llama (análisis clínico) ────────────────────────────────────────────
async function analyzeWithGroq(transcript) {
  const keys = await getKeys();
 
  const systemPrompt = `Eres un asistente clínico especializado en salud mental. Tu función es analizar transcripciones de sesiones psicológicas y psiquiátricas para redactar la EVOLUCIÓN CLÍNICA del paciente, que formará parte de su historia clínica oficial.
 
La evolución clínica debe incluir:
1. FECHA Y TIPO DE SESIÓN
2. MOTIVO DE CONSULTA / TEMA CENTRAL DE LA SESIÓN
3. ESTADO MENTAL Y EMOCIONAL DEL PACIENTE (observado durante la sesión)
4. CONTENIDO RELEVANTE DE LA SESIÓN (temas abordados, relatos del paciente)
5. INTERVENCIONES TERAPÉUTICAS (técnicas o estrategias utilizadas por el terapeuta)
6. RESPUESTA DEL PACIENTE A LAS INTERVENCIONES
7. OBJETIVOS TRABAJADOS Y AVANCES
8. PLAN Y PRÓXIMOS PASOS
9. OBSERVACIONES CLÍNICAS ADICIONALES
 
Redacta de forma profesional, en tercera persona refiriéndote al paciente, usando terminología clínica apropiada.`;
 
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${keys.groqKey}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Transcripción de sesión:\n\n---\n${transcript}\n---` }
      ],
      max_tokens: 2000,
      temperature: 0.3
    })
  });
 
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq Llama (${res.status}): ${err}`);
  }
 
  const data = await res.json();
  return data.choices[0].message.content;
}
 
// ─── UI Helpers ───────────────────────────────────────────────────────────────
function setRecordingUI(recording) {
  if (recording) {
    btnRecord.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> Detener Grabación`;
    btnRecord.classList.add('recording');
    timer.classList.add('visible');
    dot.classList.add('active');
    statusText.textContent = 'Grabando';
  } else {
    btnRecord.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg> Iniciar Grabación`;
    btnRecord.classList.remove('recording');
    dot.classList.remove('active');
  }
}
 
function startTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    secondsElapsed++;
    timer.textContent = formatTime(secondsElapsed);
  }, 1000);
}
 
function setStep(name, state, detail) {
  const icon = document.getElementById(`icon-${name}`);
  const detailEl = document.getElementById(`detail-${name}`);
  icon.className = `step-icon ${state}`;
  if (state === 'loading') icon.textContent = '◌';
  else if (state === 'done') icon.textContent = '✓';
  else if (state === 'error') icon.textContent = '✕';
  else icon.textContent = '○';
  if (detail && detailEl) detailEl.textContent = detail;
}
 
function resetSteps() {
  ['transcribe', 'analyze', 'format'].forEach(s => setStep(s, 'pending', null));
}
 
function formatTime(secs) {
  const h = String(Math.floor(secs / 3600)).padStart(2, '0');
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
 
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 3500);
}
 
// ─── Copy buttons ─────────────────────────────────────────────────────────────
btnCopyTranscript.addEventListener('click', () => {
  navigator.clipboard.writeText(transcriptBox.textContent);
  btnCopyTranscript.textContent = '¡Copiado!';
  setTimeout(() => btnCopyTranscript.textContent = 'Copiar', 2000);
});
 
btnCopyEvolution.addEventListener('click', () => {
  navigator.clipboard.writeText(evolutionBox.textContent);
  btnCopyEvolution.textContent = '¡Copiado!';
  setTimeout(() => btnCopyEvolution.textContent = 'Copiar', 2000);
});
 
// ─── Settings modal ───────────────────────────────────────────────────────────
btnSettings.addEventListener('click', () => {
  loadKeys().then(keys => {
    inputElevenKey.value = keys.elevenKey || '';
    inputGroqKey.value = keys.groqKey || '';
  });
  modalOverlay.classList.add('open');
});
 
btnCancel.addEventListener('click', () => modalOverlay.classList.remove('open'));
 
btnSave.addEventListener('click', () => {
  const elevenKey = inputElevenKey.value.trim();
  const groqKey = inputGroqKey.value.trim();
  chrome.storage.local.set({ elevenKey, groqKey }, () => {
    modalOverlay.classList.remove('open');
    showToast('Claves guardadas correctamente');
  });
});
 
// ─── Key management ───────────────────────────────────────────────────────────
function loadKeys() {
  return new Promise(resolve => {
    chrome.storage.local.get(['elevenKey', 'groqKey'], (data) => {
      resolve({
        elevenKey: data.elevenKey || DEFAULT_ELEVEN_KEY,
        groqKey:   data.groqKey   || DEFAULT_GROQ_KEY
      });
    });
  });
}
 
async function getKeys() {
  return await loadKeys();
}