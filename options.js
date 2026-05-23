document.getElementById('btnGrant').addEventListener('click', async () => {
  const status = document.getElementById('status');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    status.className = 'status ok';
    status.textContent = '✓ Permiso concedido. Ya puedes cerrar esta página y usar la extensión.';
  } catch(e) {
    status.className = 'status err';
    status.textContent = '✕ No se pudo obtener permiso: ' + e.message;
  }
});