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

// True on phones/tablets (touch as the primary input). Used to switch the
// mic button from "hold to talk" (great with a mouse) to "tap to start,
// tap again to send" (reliable on touch - holding a finger down is exactly
// when the browser's one-time mic-permission prompt likes to steal the
// touch and end up releasing the button before you've said anything).
export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return coarse || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

// iOS Safari (and every browser on iOS, since they all use WebKit under
// the hood) has no speech-recognition engine at all - only Chrome/Edge on
// desktop and Chrome on Android expose it. Used to give a precise reason
// instead of a generic "not supported" message.
export function isIOS() {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
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
