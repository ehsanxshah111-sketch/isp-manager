// ============================================================
// voiceEngine.js
// Thin wrapper around the browser's built-in Web Speech API.
// 100% client-side: no server calls, no MongoDB storage used.
// ============================================================

export function isVoiceSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function isSpeakingSupported() {
  return 'speechSynthesis' in window;
}

/**
 * Creates a one-shot recognizer. Call .start() on press, .stop() on release.
 * onResult(transcript, isFinal) fires as speech is recognized.
 */
export function createRecognizer({ onResult, onEnd, onError, lang = 'en-US' }) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;

  const recognizer = new SpeechRecognition();
  recognizer.continuous = true;
  recognizer.interimResults = true;
  recognizer.lang = lang;
  recognizer.maxAlternatives = 1;

  recognizer.onresult = (event) => {
    let transcript = '';
    let isFinal = false;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
      if (event.results[i].isFinal) isFinal = true;
    }
    onResult(transcript.trim(), isFinal);
  };
  recognizer.onerror = (e) => onError && onError(e.error);
  recognizer.onend = () => onEnd && onEnd();

  return recognizer;
}

/**
 * Speaks a short response back to the user. Nothing is stored anywhere.
 */
export function speak(text, { rate = 1.02, pitch = 1 } = {}) {
  if (!isSpeakingSupported() || !text) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = rate;
  utter.pitch = pitch;
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find((v) => /en-US|en-GB/i.test(v.lang));
  if (preferred) utter.voice = preferred;
  window.speechSynthesis.speak(utter);
}

export function stopSpeaking() {
  if (isSpeakingSupported()) window.speechSynthesis.cancel();
}
