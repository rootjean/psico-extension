// background.js - Service Worker (vive en segundo plano, no se cierra con el popup)

let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let startTime = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.action === 'startRecording') {
    startRecording(message.useMic, message.useBrowser)
      .then(() => sendResponse({ success: true }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.action === 'stopRecording') {
    stopRecording()
      .then(blob => sendResponse({ success: true, size: blob.size }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.action === 'getStatus') {
    sendResponse({
      isRecording,
      elapsed: isRecording ? Math.floor((Date.now() - startTime) / 1000) : 0
    });
    return true;
  }

  if (message.action === 'getAudio') {
    // Devolver el audio grabado como base64
    if (audioChunks.length === 0) {
      sendResponse({ success: false, error: 'No hay audio grabado' });
      return true;
    }
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    const reader = new FileReader();
    reader.onloadend = () => {
      sendResponse({ success: true, data: reader.result, mimeType: 'audio/webm' });
    };
    reader.readAsDataURL(blob);
    return true;
  }
});

async function startRecording(useMic, useBrowser) {
  if (isRecording) return;

  const streams = [];

  if (useMic) {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streams.push(micStream);
    } catch(e) {
      throw new Error('Sin permiso de micrófono: ' + e.message);
    }
  }

  if (useBrowser) {
    try {
      const tabStream = await new Promise((resolve, reject) => {
        chrome.tabCapture.capture({ audio: true, video: false }, (stream) => {
          if (chrome.runtime.lastError || !stream) {
            reject(new Error(chrome.runtime.lastError?.message || 'No se pudo capturar tab'));
          } else {
            resolve(stream);
          }
        });
      });
      streams.push(tabStream);
    } catch(e) {
      console.warn('tabCapture falló:', e.message);
    }
  }

  if (streams.length === 0) throw new Error('No se obtuvo ninguna fuente de audio');

  const audioCtx = new AudioContext();
  const destination = audioCtx.createMediaStreamDestination();
  streams.forEach(s => {
    try {
      audioCtx.createMediaStreamSource(s).connect(destination);
    } catch(e) { console.warn(e); }
  });

  audioChunks = [];
  const mimeType = getSupportedMimeType();
  mediaRecorder = new MediaRecorder(destination.stream, mimeType ? { mimeType } : {});
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) audioChunks.push(e.data);
  };
  mediaRecorder.start(1000);
  isRecording = true;
  startTime = Date.now();

  // Notificar al popup si está abierto
  chrome.runtime.sendMessage({ action: 'recordingStarted' }).catch(() => {});
}

function stopRecording() {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder || !isRecording) {
      reject(new Error('No hay grabación activa'));
      return;
    }
    mediaRecorder.onstop = () => {
      isRecording = false;
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      chrome.runtime.sendMessage({ action: 'recordingStopped' }).catch(() => {});
      resolve(blob);
    };
    mediaRecorder.stop();
  });
}

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4'];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}