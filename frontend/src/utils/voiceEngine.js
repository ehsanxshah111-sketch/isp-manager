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
 * Pass the BCP-47 lang code (e.g. "ur-PK") that matches the reply text so
 * the browser picks a matching voice when one is installed on the device.
 */
export function speak(text, { rate = 1.0, pitch = 1, lang = 'en-US' } = {}) {
  if (!isSpeakingSupported() || !text) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = rate;
  utter.pitch = pitch;
  utter.lang = lang;

  const voices = window.speechSynthesis.getVoices();
  const shortLang = lang.split('-')[0].toLowerCase();
  const preferred =
    voices.find((v) => v.lang?.toLowerCase() === lang.toLowerCase()) ||
    voices.find((v) => v.lang?.toLowerCase().startsWith(shortLang));
  // If the device has no Urdu/Punjabi voice installed, the browser falls
  // back to its default voice - the text is still correct, it just won't
  // be spoken with native pronunciation. Chrome/Android usually ship one;
  // desktop Windows/Mac often don't unless a language pack is installed.
  if (preferred) utter.voice = preferred;
  window.speechSynthesis.speak(utter);
}

export function stopSpeaking() {
  if (isSpeakingSupported()) window.speechSynthesis.cancel();
}
