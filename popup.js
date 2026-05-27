// popup.js

const DEFAULT_GROQ_KEY = 'gsk_...zrs3';

let isRecording = false;
let mediaRecorder = null;
let timerInterval = null;
let secondsElapsed = 0;
let useBrowser = true;
let useMic = true;

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
const inputGroqKey      = document.getElementById('inputGroqKey');
const btnCopyTranscript = document.getElementById('btnCopyTranscript');
const btnCopyEvolution  = document.getElementById('btnCopyEvolution');
const btnClear          = document.getElementById('btnClear');
const toastEl           = document.getElementById('toast');

// ── Al abrir: restaurar resultados guardados y verificar grabación activa ──
chrome.storage.local.get(['lastTranscript', 'lastEvolution'], (data) => {
  if (data.lastTranscript || data.lastEvolution) {
    transcriptBox.textContent = data.lastTranscript || '';
    evolutionBox.textContent  = data.lastEvolution  || '';
    outputSection.classList.add('visible');
  }
});

chrome.runtime.sendMessage({ action: 'getStatus' }, (res) => {
  if (res && res.isRecording) {
    isRecording = true;
    secondsElapsed = res.elapsed;
    setRecordingUI(true);
    startTimer();
  }
});

// ── Toggles ──
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

// ── Botón principal ──
btnRecord.addEventListener('click', async () => {
  if (!isRecording) await startRecording();
  else await stopAndProcess();
});

// ── Limpiar resultados ──
btnClear.addEventListener('click', () => {
  transcriptBox.textContent = '';
  evolutionBox.textContent  = '';
  outputSection.classList.remove('visible');
  chrome.storage.local.remove(['lastTranscript', 'lastEvolution']);
});

async function startRecording() {
  if (!useBrowser && !useMic) { showToast('Activa al menos una fuente de audio'); return; }
  const keys = await getKeys();
  if (!keys.groqKey) { showToast('Configura tu clave Groq primero'); modalOverlay.classList.add('open'); return; }

  btnRecord.disabled = true;

  try {
    const streams = [];

    // ── Micrófono ──
    if (useMic) {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        streams.push(micStream);
        console.log('Micrófono OK');
      } catch(e) {
        showToast('Sin permiso de micrófono: ' + e.message);
        btnRecord.disabled = false;
        return;
      }
    }

    // ── Audio de pantalla/sistema ──
    // Usamos getDisplayMedia pero pedimos solo audio, sin video
    // Esto evita el diálogo grande de compartir pantalla en muchos casos
    if (useBrowser) {
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: 1, height: 1, frameRate: 1 }, // video mínimo obligatorio
          audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 44100 }
        });
        const audioTracks = displayStream.getAudioTracks();
        displayStream.getVideoTracks().forEach(t => t.stop()); // detener video inmediatamente
        if (audioTracks.length > 0) {
          streams.push(new MediaStream(audioTracks));
          console.log('Audio del sistema OK');
        } else {
          showToast('Marca "Compartir audio de la pestaña" en el diálogo');
        }
      } catch(e) {
        console.warn('getDisplayMedia cancelado:', e.message);
        if (!useMic) { showToast('Cancelado'); btnRecord.disabled = false; return; }
      }
    }

    if (streams.length === 0) { showToast('Sin fuentes de audio'); btnRecord.disabled = false; return; }

    // ── Mezclar streams ──
    const audioCtx = new AudioContext();
    const destination = audioCtx.createMediaStreamDestination();
    streams.forEach(s => {
      const src = audioCtx.createMediaStreamSource(s);
      const gain = audioCtx.createGain();
      gain.gain.value = 1.5;
      src.connect(gain);
      gain.connect(destination);
    });

    const mimeType = getSupportedMimeType();
    mediaRecorder = new MediaRecorder(destination.stream, mimeType ? { mimeType } : {});

    chrome.runtime.sendMessage({ action: 'recordingStarted', mimeType: mediaRecorder.mimeType || mimeType });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        const reader = new FileReader();
        reader.onloadend = () => chrome.runtime.sendMessage({ action: 'audioChunk', chunk: reader.result });
        reader.readAsDataURL(e.data);
        console.log('Chunk:', e.data.size, 'bytes');
      }
    };
    mediaRecorder.onerror = (e) => console.error('MediaRecorder error:', e);
    mediaRecorder.start(2000);

    isRecording = true;
    secondsElapsed = 0;
    setRecordingUI(true);
    startTimer();
    outputSection.classList.remove('visible');
    progressSection.classList.remove('visible');

  } catch(err) {
    console.error('Error al iniciar:', err);
    showToast('Error: ' + err.message);
  }

  btnRecord.disabled = false;
}

async function stopAndProcess() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    btnRecord.disabled = true;
    clearInterval(timerInterval);
    statusText.textContent = 'Finalizando...';
    await new Promise((resolve) => {
      mediaRecorder.onstop = resolve;
      mediaRecorder.requestData();
      mediaRecorder.stop();
    });
  }

  chrome.runtime.sendMessage({ action: 'recordingStopped' });
  isRecording = false;
  setRecordingUI(false);
  timer.classList.remove('visible');
  statusText.textContent = 'Procesando...';

  chrome.runtime.sendMessage({ action: 'getAudio' }, async (res) => {
    if (!res || !res.success || !res.chunks || res.chunks.length === 0) {
      showToast('No hay audio grabado');
      btnRecord.disabled = false;
      statusText.textContent = 'Listo';
      return;
    }
    console.log('Chunks del background:', res.chunks.length);
    const blobParts = await Promise.all(res.chunks.map(b64 => fetch(b64).then(r => r.blob())));
    const blob = new Blob(blobParts, { type: res.mimeType });
    console.log('Blob total:', blob.size, 'bytes');

    if (blob.size < 3000) {
      showToast('Audio muy corto o vacío (' + blob.size + ' bytes)');
      btnRecord.disabled = false;
      statusText.textContent = 'Listo';
      return;
    }

    await processAudio(blob, res.mimeType);
    chrome.runtime.sendMessage({ action: 'clearAudio' });
    btnRecord.disabled = false;
  });
}

async function processAudio(blob, mimeType) {
  progressSection.classList.add('visible');
  resetSteps();
  try {
    setStep('transcribe', 'loading', 'Enviando audio a Groq Whisper...');
    const transcript = await transcribeWithGroqWhisper(blob, mimeType);
    setStep('transcribe', 'done', 'Transcripción completada');
    transcriptBox.textContent = transcript;

    setStep('analyze', 'loading', 'Analizando con IA clínica...');
    const evolution = await analyzeWithGroq(transcript);
    setStep('analyze', 'done', 'Análisis completado');

    setStep('format', 'loading', 'Estructurando evolución...');
    await new Promise(r => setTimeout(r, 300));
    setStep('format', 'done', 'Listo');

    evolutionBox.textContent = evolution;
    outputSection.classList.add('visible');
    statusText.textContent = 'Listo';

    // Guardar resultados para que persistan al cerrar el popup
    chrome.storage.local.set({ lastTranscript: transcript, lastEvolution: evolution });

  } catch(err) {
    console.error('Error:', err);
    showToast('Error: ' + err.message);
    statusText.textContent = 'Error';
  }
}

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
  if (!res.ok) throw new Error(`Groq Whisper (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.text || '';
}

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
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${keys.groqKey}` },
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
  if (!res.ok) throw new Error(`Groq Llama (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

// ─── UI ───────────────────────────────────────────────────────────────────────
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
  timerInterval = setInterval(() => { secondsElapsed++; timer.textContent = formatTime(secondsElapsed); }, 1000);
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

btnSettings.addEventListener('click', () => {
  getKeys().then(keys => { inputGroqKey.value = keys.groqKey || ''; });
  modalOverlay.classList.add('open');
});
btnCancel.addEventListener('click', () => modalOverlay.classList.remove('open'));
btnSave.addEventListener('click', () => {
  chrome.storage.local.set({ groqKey: inputGroqKey.value.trim() }, () => {
    modalOverlay.classList.remove('open');
    showToast('Clave guardada');
  });
});

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4'];
  for (const t of types) { if (MediaRecorder.isTypeSupported(t)) return t; }
  return '';
}

function getKeys() {
  return new Promise(resolve => {
    chrome.storage.local.get(['groqKey'], (data) => {
      resolve({ groqKey: data.groqKey || DEFAULT_GROQ_KEY });
    });
  });
}