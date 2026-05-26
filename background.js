// background.js - Service Worker
// Recibe streams ya conectados via offscreen o directamente el MediaRecorder desde popup

let isRecording = false;
let startTime = null;
let audioChunks = [];
let mimeTypeUsed = 'audio/webm';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.action === 'getStatus') {
    sendResponse({
      isRecording,
      elapsed: isRecording ? Math.floor((Date.now() - startTime) / 1000) : 0
    });
    return true;
  }

  if (message.action === 'recordingStarted') {
    isRecording = true;
    startTime = Date.now();
    audioChunks = [];
    mimeTypeUsed = message.mimeType || 'audio/webm';
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'audioChunk') {
    // Recibir chunks de audio desde el popup como base64
    audioChunks.push(message.chunk);
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'recordingStopped') {
    isRecording = false;
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'getAudio') {
    if (audioChunks.length === 0) {
      sendResponse({ success: false, error: 'No hay audio grabado' });
      return true;
    }
    // Devolver todos los chunks acumulados
    sendResponse({ success: true, chunks: audioChunks, mimeType: mimeTypeUsed });
    return true;
  }
});