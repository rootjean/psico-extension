# PsychNote – Extensión Chrome para Evoluciones Clínicas

## ¿Qué hace?
Graba el audio del navegador y/o micrófono durante sesiones psicológicas/psiquiátricas, transcribe automáticamente con ElevenLabs (con diarización de hablantes), y genera la **evolución clínica** lista para la historia clínica del paciente usando Groq (Llama 3.3 70B).

---

## Instalación en Google Chrome

1. **Descarga** y descomprime la carpeta `psych-recorder-extension`.
2. Abre Chrome y ve a: `chrome://extensions/`
3. Activa el **"Modo desarrollador"** (esquina superior derecha).
4. Haz clic en **"Cargar descomprimida"**.
5. Selecciona la carpeta `psych-recorder-extension`.
6. La extensión aparecerá en tu barra de herramientas.

---

## Configuración inicial

1. Haz clic en el ícono de la extensión.
2. Presiona **"⚙ Configuración API"** abajo.
3. Ingresa tus claves:
   - **ElevenLabs API Key**: `sk_...`
   - **Groq API Key**: `gsk_...`
4. Guarda.

---

## Uso

1. **Activa las fuentes** de audio que deseas (Navegador y/o Micrófono).
   - **Navegador**: captura el audio de la pestaña activa (útil para videollamadas en Zoom, Meet, etc.)
   - **Micrófono**: captura tu voz directamente.
2. Presiona **"Iniciar Grabación"**.
3. Al terminar la sesión, presiona **"Detener Grabación"**.
4. La extensión:
   - Transcribe el audio con ElevenLabs (diferenciando Terapeuta / Paciente)
   - Genera la evolución clínica con IA
5. Copia la **Evolución Clínica** con el botón "Copiar".

---

## Notas importantes

- Para capturar audio del navegador (videollamadas), Chrome pedirá permiso de compartir pantalla/tab al iniciar la grabación.
- La diarización (diferenciación de voces) la realiza ElevenLabs automáticamente. La primera voz detectada se asigna como "Terapeuta" y la segunda como "Paciente".
- El idioma de transcripción está configurado en **español (spa)**.
- Las claves API se guardan localmente en tu navegador (nunca se envían a terceros más allá de las APIs oficiales).

---

## Privacidad
Todo el procesamiento ocurre directamente entre tu navegador y las APIs de ElevenLabs y Groq. No se almacena audio ni texto en ningún servidor propio.
