const DEFAULT_ELEVEN_KEY = '';
const DEFAULT_GROQ_KEY   = '';


let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
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
const inputElevenKey    = document.getElementById('inputElevenKey');
const inputGroqKey      = document.getElementById('inputGroqKey');
const btnCopyTranscript = document.getElementById('btnCopyTranscript');
const btnCopyEvolution  = document.getElementById('btnCopyEvolution');
const toastEl           = document.getElementById('toast');

const isPopout = new URLSearchParams(window.location.search).get('popout') === '1';

// Si es popout, el botón grabar ya funciona directo
if (!isPopout) {
  // En el popup normal, el botón abre la ventana popout
  btnRecord.addEventListener('click', async () => {
    const keys = await getKeys();
    if (!keys.groqKey) {
      showToast('Configura tu clave Groq primero');
      modalOverlay.classList.add('open');
      return;
    }
    const params = new URLSearchParams({
      popout: '1',
      mic: useMic ? '1' : '0',
      browser: useBrowser ? '1' : '0'
    });
    chrome.windows.create({
      url: chrome.runtime.getURL('popup.html?' + params.toString()),
      type: 'popup',
      width: 420,
      height: 640,
      focused: true
    });
    window.close();
  });
} else {
  // En la ventana popout, el botón graba/detiene
  btnRecord.addEventListener('click', async () => {
    if (!isRecording) await startRecording();
    else await stopRecording();
  });

  // Leer preferencias de la URL
  const urlParams = new URLSearchParams(window.location.search);
  useMic     = urlParams.get('mic') !== '0';
  useBrowser = urlParams.get('browser') !== '0';
  toggleBrowser.classList.toggle('on', useBrowser);
  toggleMic.classList.toggle('on', useMic);
}

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

async function startRecording() {
  if (!useBrowser && !useMic) { showToast('Activa al menos una fuente de audio'); return; }

  btnRecord.disabled = true;

  try {
    const streams = [];

    // ── Audio del sistema/tab con getDisplayMedia ──
    // Permite elegir pestaña, ventana o pantalla entera
    if (useBrowser) {
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,   // requerido por Chrome aunque no lo usemos
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            sampleRate: 44100
          }
        });
        // Solo nos quedamos con el track de audio
        const audioTracks = displayStream.getAudioTracks();
        if (audioTracks.length > 0) {
          const audioOnlyStream = new MediaStream(audioTracks);
          streams.push(audioOnlyStream);
          // Detener el track de video (no lo necesitamos)
          displayStream.getVideoTracks().forEach(t => t.stop());
          console.log('Audio del sistema capturado:', audioTracks.length, 'tracks');
        } else {
          console.warn('getDisplayMedia no devolvió audio. ¿Marcaste "Compartir audio del sistema"?');
          showToast('Activa "Compartir audio del sistema" en el diálogo');
        }
      } catch(e) {
        console.warn('getDisplayMedia falló:', e.message);
        if (!useMic) {
          showToast('No se pudo capturar audio del sistema');
          btnRecord.disabled = false;
          return;
        }
      }
    }

    // ── Micrófono ──
    if (useMic) {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 44100
          },
          video: false
        });
        streams.push(micStream);
        console.log('Micrófono capturado:', micStream.getAudioTracks().length, 'tracks');
      } catch(e) {
        showToast('Sin permiso de micrófono: ' + e.message);
        btnRecord.disabled = false;
        return;
      }
    }

    if (streams.length === 0) {
      showToast('No se pudo obtener ninguna fuente de audio');
      btnRecord.disabled = false;
      return;
    }

    // ── Mezclar streams ──
    const audioCtx = new AudioContext();
    const destination = audioCtx.createMediaStreamDestination();

    streams.forEach((s, i) => {
      try {
        const source = audioCtx.createMediaStreamSource(s);
        const gain = audioCtx.createGain();
        gain.gain.value = 1.5;
        source.connect(gain);
        gain.connect(destination);
        console.log(`Stream ${i} conectado`);
      } catch(e) {
        console.warn('Error conectando stream:', e);
      }
    });

    const mimeType = getSupportedMimeType();
    mediaRecorder = new MediaRecorder(destination.stream, mimeType ? { mimeType } : {});
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        audioChunks.push(e.data);
        console.log(`Chunk #${audioChunks.length}: ${e.data.size} bytes`);
      }
    };
    mediaRecorder.onerror = (e) => console.error('MediaRecorder error:', e);
    mediaRecorder.start(1000);

    console.log('Grabando... mimeType:', mediaRecorder.mimeType);
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

async function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    showToast('No hay grabación activa');
    return;
  }

  btnRecord.disabled = true;
  clearInterval(timerInterval);
  statusText.textContent = 'Procesando...';

  await new Promise((resolve) => {
    mediaRecorder.onstop = () => {
      console.log('Detenido. Chunks:', audioChunks.length);
      resolve();
    };
    mediaRecorder.requestData();
    mediaRecorder.stop();
  });

  isRecording = false;
  setRecordingUI(false);
  timer.classList.remove('visible');

  if (audioChunks.length === 0) {
    showToast('No se grabó audio');
    btnRecord.disabled = false;
    return;
  }

  const mimeType = mediaRecorder.mimeType || 'audio/webm';
  const blob = new Blob(audioChunks, { type: mimeType });
  console.log('Blob:', blob.size, 'bytes');

  if (blob.size < 3000) {
    showToast(`Audio vacío (${blob.size} bytes). Verifica el micrófono.`);
    btnRecord.disabled = false;
    return;
  }

  await processAudio(blob, mimeType);
  btnRecord.disabled = false;
}

async function processAudio(blob, mimeType) {
  progressSection.classList.add('visible');
  resetSteps();
  try {
    setStep('transcribe', 'loading', 'Enviando audio a Groq Whisper...');
    const transcript = await transcribeWithGroqWhisper(blob, mimeType);
    console.log('Transcripción:', transcript);
    setStep('transcribe', 'done', 'Transcripción completada');
    transcriptBox.textContent = transcript;

    setStep('analyze', 'loading', 'Analizando con IA clínica...');
    const evolution = await analyzeWithGroq(transcript);
    setStep('analyze', 'done', 'Análisis completado');

    setStep('format', 'loading', 'Estructurando evolución...');
    await new Promise(r => setTimeout(r, 400));
    setStep('format', 'done', 'Listo');

    evolutionBox.textContent = evolution;
    outputSection.classList.add('visible');
    statusText.textContent = 'Listo';
  } catch(err) {
    console.error('Error procesando:', err);
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
  loadKeys().then(keys => { inputElevenKey.value = keys.elevenKey || ''; inputGroqKey.value = keys.groqKey || ''; });
  modalOverlay.classList.add('open');
});
btnCancel.addEventListener('click', () => modalOverlay.classList.remove('open'));
btnSave.addEventListener('click', () => {
  chrome.storage.local.set({ elevenKey: inputElevenKey.value.trim(), groqKey: inputGroqKey.value.trim() }, () => {
    modalOverlay.classList.remove('open');
    showToast('Claves guardadas correctamente');
  });
});

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4'];
  for (const t of types) { if (MediaRecorder.isTypeSupported(t)) return t; }
  return '';
}

function loadKeys() {
  return new Promise(resolve => {
    chrome.storage.local.get(['elevenKey', 'groqKey'], (data) => {
      resolve({ elevenKey: data.elevenKey || DEFAULT_ELEVEN_KEY, groqKey: data.groqKey || DEFAULT_GROQ_KEY });
    });
  });
}
async function getKeys() { return await loadKeys(); }