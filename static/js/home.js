/* ===================================
   SignBridge — home.js
   Unified controller for Sign→Speech and Speech→Sign modes
   =================================== */

let currentMode = 'sign2speech';
let isRecording = false;
let isListening = false;

/* ---- Sign mapping removed: using ISL video assets instead ---- */

/* ==============================
   Mode Toggle
   ============================== */
function setMode(mode) {
  currentMode = mode;
  const s  = document.getElementById('sign-panel');
  const sp = document.getElementById('speech-panel');
  const b1 = document.getElementById('btn1');
  const b2 = document.getElementById('btn2');
  const slider = document.getElementById('toggleSlider');

  // Reset any active streams/mic when switching
  if (isRecording) handleStop();
  if (isListening) stopListening();

  // Update toolbar buttons
  updateToolbar();

  if (mode === 'sign2speech') {
    s.classList.add('active'); sp.classList.remove('active');
    b1.classList.add('active'); b2.classList.remove('active');
    slider.style.left = '6px';
    slider.style.width = b1.offsetWidth + 'px';
  } else {
    sp.classList.add('active'); s.classList.remove('active');
    b2.classList.add('active'); b1.classList.remove('active');
    slider.style.left = (b1.offsetWidth + 10) + 'px';
    slider.style.width = b2.offsetWidth + 'px';
  }
}

function updateToolbar() {
  const mainBtn      = document.getElementById('mainActionBtn');
  const stopBtn      = document.getElementById('stopBtn');
  const playAudioBtn = document.getElementById('playAudioBtn');
  const genSignsBtn  = document.getElementById('generateSignsBtn');

  if (currentMode === 'sign2speech') {
    mainBtn.textContent = isRecording ? '⏹ Stop Camera' : '▶ Start Camera';
    mainBtn.classList.toggle('danger', isRecording);
    mainBtn.classList.toggle('primary', !isRecording);
    stopBtn.style.display = 'none';
    playAudioBtn.style.display = '';
    genSignsBtn.style.display = 'none';
  } else {
    mainBtn.textContent = isListening ? '⏹ Stop Listening' : '🎤 Start Listening';
    mainBtn.classList.toggle('danger', isListening);
    mainBtn.classList.toggle('primary', !isListening);
    stopBtn.style.display = 'none';
    playAudioBtn.style.display = 'none';
    genSignsBtn.style.display = '';
  }
}

/* ==============================
   Main Action Button
   ============================== */
function handleMainAction() {
  if (currentMode === 'sign2speech') {
    if (isRecording) {
      handleStop();
    } else {
      startCamera();
    }
  } else {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }
}

/* ==============================
   SIGN → SPEECH: Camera
   ============================== */
async function startCamera() {
  const cameraStream = document.getElementById('cameraStream');
  const camRing      = document.getElementById('camRingIdle');
  const camLabel     = document.getElementById('camLabel');
  const cameraArea   = document.getElementById('cameraArea');
  const outputText   = document.getElementById('outputText');

  try {
    await fetch('/api/record/start/', { method: 'POST' });

    // Small delay to let backend prepare the camera
    await new Promise(r => setTimeout(r, 500));

    // Show MJPEG stream
    cameraStream.src = '/api/record/stream/?t=' + Date.now();
    cameraStream.style.display = 'block';
    camRing.style.display = 'none';
    camLabel.style.display = 'none';
    cameraArea.classList.add('streaming');

    outputText.innerHTML = 'Detecting signs…<span class="cursor-blink"></span>';
    isRecording = true;
    updateToolbar();
  } catch (e) {
    outputText.innerHTML = 'Failed to start camera: ' + e.message + '<span class="cursor-blink"></span>';
  }
}

async function handleStop() {
  if (!isRecording) return;
  const cameraStream = document.getElementById('cameraStream');
  const camRing      = document.getElementById('camRingIdle');
  const camLabel     = document.getElementById('camLabel');
  const cameraArea   = document.getElementById('cameraArea');
  const outputText   = document.getElementById('outputText');
  const confLabel    = document.getElementById('confLabel');
  const confFill     = document.getElementById('confFill');

  try {
    await fetch('/api/record/stop/', { method: 'POST' });

    cameraStream.src = '';
    cameraStream.style.display = 'none';
    camRing.style.display = 'flex';
    camLabel.style.display = '';
    cameraArea.classList.remove('streaming');

    isRecording = false;
    updateToolbar();

    outputText.innerHTML = 'Processing signs…<span class="cursor-blink"></span>';

    // Poll for the translated sentence - Faster polling (300ms)
    const result = await fetchSentenceWithRetry(15, 300);
    const sentence = result && typeof result.sentence === 'string' ? result.sentence.trim() : '';
    const gloss    = result && typeof result.gloss === 'string' ? result.gloss.trim() : '';

    const validSentence = sentence && sentence.toLowerCase() !== 'no signs detected.';
    const displayText = validSentence ? sentence : (gloss || 'No signs detected.');

    outputText.innerHTML = displayText + '<span class="cursor-blink"></span>';

    // Update confidence bar
    if (validSentence) {
      confLabel.textContent = 'Confidence — 82%';
      confFill.style.width = '82%';
    } else {
      confLabel.textContent = 'Confidence — 0%';
      confFill.style.width = '0%';
    }
  } catch (e) {
    outputText.innerHTML = 'Error: ' + e.message + '<span class="cursor-blink"></span>';
  }
}

async function fetchSentenceWithRetry(maxAttempts = 10, delayMs = 800) {
  await new Promise(r => setTimeout(r, 400));
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const r = await fetch('/api/gloss/sentence/?t=' + Date.now(), { cache: 'no-store' });
      const j = await r.json();
      const sentence = j && typeof j.sentence === 'string' ? j.sentence.trim() : '';
      const gloss    = j && typeof j.gloss === 'string' ? j.gloss.trim() : '';
      const sentenceOk = sentence && sentence.toLowerCase() !== 'no signs detected.';
      const glossOk = gloss && gloss.length > 0;
      if (sentenceOk || glossOk) return j;
    } catch (e) {}
    await new Promise(r => setTimeout(r, delayMs));
  }
  try {
    const r = await fetch('/api/gloss/sentence/?t=' + Date.now(), { cache: 'no-store' });
    return await r.json();
  } catch {
    return { sentence: '', gloss: '' };
  }
}

/* ==============================
   Play Audio (Server-side pyttsx3)
   ============================== */
async function playAudio() {
  const outputText = document.getElementById('outputText');
  const text = (outputText ? outputText.textContent : '').trim();
  if (!text || text === 'Waiting for signs…' || text === 'Detecting signs…') {
    return;
  }
  
  try {
    await fetch('/api/tts/speak/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text })
    });
  } catch (e) {
    console.error('TTS error:', e);
  }
}

/* ==============================
   Copy Text
   ============================== */
function copyText() {
  let text = '';
  if (currentMode === 'sign2speech') {
    text = (document.getElementById('outputText')?.textContent || '').trim();
  } else {
    text = (document.getElementById('transcriptText')?.textContent || '').trim();
  }
  if (text && text !== '—') {
    navigator.clipboard.writeText(text).catch(() => {});
  }
}

/* ==============================
   SPEECH → SIGN: Mic & Recognition
   ============================== */
let recognition = null;

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onresult = function(event) {
    const transcript = event.results[0][0].transcript;
    const transcriptEl = document.getElementById('transcriptText');
    const textInput = document.getElementById('textInput');
    if (transcriptEl) transcriptEl.innerHTML = '"' + transcript + '"<span class="cursor-blink"></span>';
    if (textInput) textInput.value = transcript;
    stopListening();
  };

  recognition.onerror = function(event) {
    const transcriptEl = document.getElementById('transcriptText');
    if (transcriptEl) transcriptEl.innerHTML = 'Error: ' + event.error + '<span class="cursor-blink"></span>';
    stopListening();
  };

  recognition.onend = function() {
    if (isListening) stopListening();
  };
}

function startListening() {
  if (!recognition) return;
  const micArea  = document.getElementById('micArea');
  const micLabel = document.getElementById('micLabel');
  const transcriptEl = document.getElementById('transcriptText');

  recognition.start();
  isListening = true;
  micArea.classList.add('listening');
  micLabel.textContent = 'Listening…';
  transcriptEl.innerHTML = 'Listening…<span class="cursor-blink"></span>';
  updateToolbar();
}

function stopListening() {
  if (recognition) {
    try { recognition.abort(); } catch (e) {}
  }
  isListening = false;
  const micArea  = document.getElementById('micArea');
  const micLabel = document.getElementById('micLabel');
  if (micArea)  micArea.classList.remove('listening');
  if (micLabel) micLabel.textContent = 'Click to start listening';
  updateToolbar();
}

/* ==============================
   SPEECH → SIGN: Generate
   ============================== */
let gloss = [];
let wordIndex = 0;
let letterIndex = 0;
let spellingMode = false;
let currentWord = '';

async function generateSigns() {
  const textInput = document.getElementById('textInput');
  const transcriptEl = document.getElementById('transcriptText');
  const text = (textInput?.value || '').trim();
  if (!text) return;

  // Show transcript
  if (transcriptEl) transcriptEl.innerHTML = '"' + text + '"<span class="cursor-blink"></span>';

  try {
    const response = await fetch('/convert_speech/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text })
    });
    const data = await response.json();
    gloss = data.gloss || [];
    wordIndex = 0;
    spellingMode = false;

    // Start playing sign videos
    playWord();
  } catch (e) {
    console.error('Generate signs error:', e);
  }
}

function playWord() {
  const video   = document.getElementById('signVideo');
  const wordEl  = document.getElementById('currentWordDisplay');
  if (wordIndex >= gloss.length) {
    if (wordEl) wordEl.textContent = '✅ Done';
    return;
  }
  currentWord = gloss[wordIndex];
  if (wordEl) wordEl.textContent = currentWord;
  video.src = `/media/signs/${currentWord}.mp4`;
  video.load();
  video.play().catch(() => {});
}

function playLetter() {
  const video  = document.getElementById('signVideo');
  const wordEl = document.getElementById('currentWordDisplay');
  if (letterIndex >= currentWord.length) {
    spellingMode = false;
    letterIndex = 0;
    wordIndex++;
    playWord();
    return;
  }
  const letter = currentWord[letterIndex];
  if (wordEl) wordEl.textContent = letter;
  video.src = `/media/signs/${letter}.mp4`;
  video.load();
  video.play().catch(() => {});
  letterIndex++;
}

/* Video events for speech→sign */
document.addEventListener('DOMContentLoaded', () => {
  const video = document.getElementById('signVideo');
  if (video) {
    video.addEventListener('ended', () => {
      if (spellingMode) {
        playLetter();
      } else {
        wordIndex++;
        playWord();
      }
    });
    video.addEventListener('error', () => {
      spellingMode = true;
      letterIndex = 0;
      playLetter();
    });
  }
});

/* ==============================
   Waveform builder
   ============================== */
function buildWaveforms() {
  ['waveform', 'waveform2'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '';
    for (let i = 0; i < 22; i++) {
      const bar = document.createElement('div');
      bar.className = 'wave-bar';
      bar.style.animationDelay = (i * 0.06) + 's';
      bar.style.animationDuration = (0.6 + Math.random() * 0.6) + 's';
      el.appendChild(bar);
    }
  });
}

/* ==============================
   Toggle slider init
   ============================== */
function initSlider() {
  const slider = document.getElementById('toggleSlider');
  const b1 = document.getElementById('btn1');
  if (slider && b1) {
    slider.style.width = b1.offsetWidth + 'px';
    slider.style.left = '6px';
  }
}

/* ==============================
   Text input handler for speech→sign
   ============================== */
document.addEventListener('DOMContentLoaded', () => {
  const textInput = document.getElementById('textInput');
  if (textInput) {
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        generateSigns();
      }
    });
  }
});

/* ==============================
   Init
   ============================== */
window.addEventListener('load', () => {
  buildWaveforms();
  setTimeout(initSlider, 50);
  updateToolbar();
});
