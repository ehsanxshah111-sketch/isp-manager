import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import API from '../utils/api';
import { isVoiceSupported, createRecognizer, speak, stopSpeaking, isTouchDevice, isIOS } from '../utils/voiceEngine';
import { runVoiceCommand, VOICE_LANGUAGES } from '../utils/voiceCommands';
import './VoiceController.css';

// Status: 'idle' | 'listening' | 'processing' | 'error'
const VoiceController = () => {
  const [status, setStatus] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [lastReply, setLastReply] = useState('');
  const [supported] = useState(isVoiceSupported());
  const [touchMode] = useState(isTouchDevice());
  const [lang, setLang] = useState('en');
  // Holds { type, payload, message } while a destructive/important
  // action (add/delete a customer, mark paid/unpaid, change status,
  // bulk WhatsApp blast) is waiting for the person to say "yes"/"no"
  // or tap the Confirm/Cancel buttons shown below the mic.
  const [pendingConfirmation, setPendingConfirmation] = useState(null);
  const langOrder = ['en', 'ur', 'pa'];

  const recognizerRef = useRef(null);
  const finalTranscriptRef = useRef(''); // accumulated across auto-restarts
  const interimRef = useRef('');
  const isHeldRef = useRef(false); // true from press-down until actual release
  const restartTimeoutRef = useRef(null);
  const maxDurationTimeoutRef = useRef(null); // safety net for tap-to-toggle mode on touch devices
  const customersCacheRef = useRef(null); // in-memory only, never persisted
  const pendingConfirmationRef = useRef(null); // mirrors state, read synchronously by runVoiceCommand
  const navigate = useNavigate();

  const getCustomers = useCallback(async () => {
    if (customersCacheRef.current) return customersCacheRef.current;
    const res = await API.get('/customers?limit=1000');
    const list = Array.isArray(res.data) ? res.data : res.data?.data || [];
    customersCacheRef.current = list;
    return list;
  }, []);

  const refreshCustomers = useCallback(() => {
    customersCacheRef.current = null; // force a fresh read next time it's needed
  }, []);

  const setPendingConfirmationBoth = useCallback((value) => {
    pendingConfirmationRef.current = value;
    setPendingConfirmation(value);
  }, []);

  const executeTranscript = useCallback(
    async (text) => {
      const result = await runVoiceCommand(text, {
        API,
        navigate,
        getCustomers,
        refreshCustomers,
        lang,
        pendingConfirmation: pendingConfirmationRef.current,
        setPendingConfirmation: setPendingConfirmationBoth,
      });
      setLastReply(result.message);
      if (result.needsConfirmation) {
        // Don't toast this as success/error - it's a question, shown in its
        // own bubble with Confirm/Cancel buttons below.
        toast(result.message, { icon: '❓', duration: 6000 });
      } else if (result.ok) {
        toast.success(result.message, { duration: 4500 });
      } else {
        toast.error(result.message, { duration: 4500 });
      }
      speak(result.message);
      return result;
    },
    [navigate, getCustomers, refreshCustomers, lang, setPendingConfirmationBoth]
  );

  const handleFinalTranscript = useCallback(
    async (text) => {
      if (!text || !text.trim()) {
        setStatus('idle');
        return;
      }
      setStatus('processing');
      try {
        await executeTranscript(text);
      } catch (err) {
        const msg = err.response?.data?.message || 'Something went wrong running that command.';
        setLastReply(msg);
        toast.error(msg);
        speak(msg);
      } finally {
        setStatus('idle');
      }
    },
    [executeTranscript]
  );

  // Tapping Confirm/Cancel just feeds "yes"/"no" straight through the same
  // logic a spoken "yes"/"no" would - no separate code path to keep in sync.
  const handleConfirmTap = useCallback(
    async (answer) => {
      setStatus('processing');
      try {
        await executeTranscript(answer);
      } catch (err) {
        const msg = err.response?.data?.message || 'Something went wrong running that command.';
        setLastReply(msg);
        toast.error(msg);
        speak(msg);
      } finally {
        setStatus('idle');
      }
    },
    [executeTranscript]
  );

  // Starts (or restarts) one recognition session. Chrome/Edge sometimes end
  // a session on their own after a short pause even while the button is
  // still held - when that happens and the user hasn't actually released
  // the button, we transparently start a new session and keep appending to
  // the same transcript, so a slightly slower sentence never gets cut off.
  const beginSession = useCallback(() => {
    const recognizer = createRecognizer({
      lang: VOICE_LANGUAGES[lang].code,
      onResult: (text, isFinal) => {
        interimRef.current = text;
        setTranscript([finalTranscriptRef.current, text].filter(Boolean).join(' '));
        if (isFinal) {
          finalTranscriptRef.current = [finalTranscriptRef.current, text].filter(Boolean).join(' ');
          interimRef.current = '';
        }
      },
      onError: (error) => {
        if (error === 'no-speech' || error === 'aborted') return;
        isHeldRef.current = false;
        setStatus('error');
        toast.error('Microphone error: ' + error);
      },
      onEnd: () => {
        if (isHeldRef.current) {
          // Still holding the button - the browser stopped on its own, resume.
          restartTimeoutRef.current = setTimeout(() => {
            if (isHeldRef.current) {
              recognizerRef.current = beginSession();
            }
          }, 120);
        } else {
          const finalText = [finalTranscriptRef.current, interimRef.current].filter(Boolean).join(' ');
          handleFinalTranscript(finalText);
        }
      },
    });

    if (!recognizer) {
      setStatus('error');
      return null;
    }
    try {
      recognizer.start();
    } catch (e) {
      // start() throws if called twice in a row - safe to ignore
    }
    return recognizer;
  }, [lang, handleFinalTranscript]);

  useEffect(() => {
    return () => {
      isHeldRef.current = false;
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
      recognizerRef.current && recognizerRef.current.stop();
      stopSpeaking();
    };
  }, []);

  const stopListening = useCallback(() => {
    isHeldRef.current = false;
    if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
    if (maxDurationTimeoutRef.current) {
      clearTimeout(maxDurationTimeoutRef.current);
      maxDurationTimeoutRef.current = null;
    }
    if (recognizerRef.current) {
      recognizerRef.current.stop();
      recognizerRef.current = null;
    } else {
      // Nothing was actively running (rare race) - finalize with what we have.
      const finalText = [finalTranscriptRef.current, interimRef.current].filter(Boolean).join(' ');
      handleFinalTranscript(finalText);
    }
  }, [handleFinalTranscript]);

  const startListening = useCallback(() => {
    if (!supported) {
      if (isIOS()) {
        toast.error("Voice control isn't available in Safari on iPhone/iPad yet - please use Chrome on Android or a laptop.");
      } else {
        toast.error('Voice control needs Chrome or Edge on this device.');
      }
      return;
    }
    stopSpeaking();
    finalTranscriptRef.current = '';
    interimRef.current = '';
    setTranscript('');
    setLastReply('');
    setStatus('listening');
    isHeldRef.current = true;
    recognizerRef.current = beginSession();

    // Safety net for tap-to-toggle (touch) mode: if the person taps to
    // start and then forgets to tap again, don't leave the mic running
    // forever - auto-send after 20s of held-open listening.
    if (maxDurationTimeoutRef.current) clearTimeout(maxDurationTimeoutRef.current);
    maxDurationTimeoutRef.current = setTimeout(() => {
      if (isHeldRef.current) stopListening();
    }, 20000);
  }, [supported, beginSession, stopListening]);

  // Two interaction models, chosen once based on the device:
  //
  // Desktop (mouse): press-and-hold, exactly as before - mouse down starts,
  // mouse up (anywhere on the page) sends. Reliable with a mouse because
  // there's no OS-level permission popup competing for the same gesture.
  //
  // Touch (phone/tablet): tap-to-toggle instead of hold-to-talk. Holding a
  // finger down is exactly when the browser's one-time "allow microphone"
  // prompt likes to appear, and that prompt steals the touch, so the finger
  // lifts (release fires) before a word is spoken and the command comes
  // through empty. Tapping once to start and tapping again to send sidesteps
  // that race entirely and is the standard pattern for push-to-talk on touch.
  const handlePressStart = (e) => {
    e.preventDefault();
    if (status === 'processing') return;

    if (touchMode) {
      if (status === 'idle') {
        startListening();
      } else if (status === 'listening') {
        stopListening();
      }
      return;
    }

    if (status === 'listening') return;
    startListening();
  };

  // Hold-to-talk release - desktop/mouse only. On touch devices this never
  // attaches (tap-to-toggle above handles start AND stop), so a finger
  // lifting off the button mid-sentence can never end the recording early.
  useEffect(() => {
    if (touchMode || status !== 'listening') return undefined;
    const release = () => stopListening();
    window.addEventListener('mouseup', release);
    return () => {
      window.removeEventListener('mouseup', release);
    };
  }, [touchMode, status, stopListening]);

  const cycleLanguage = () => {
    if (status !== 'idle') return; // don't switch mid-listen
    const next = langOrder[(langOrder.indexOf(lang) + 1) % langOrder.length];
    setLang(next);
    toast(`Voice language: ${VOICE_LANGUAGES[next].label}`, { icon: '🌐', duration: 1500 });
  };

  const statusLabel = touchMode
    ? status === 'listening'
      ? 'Listening… tap again to send'
      : status === 'processing'
      ? 'Thinking…'
      : 'Tap to speak a command'
    : status === 'listening'
    ? 'Listening… release to send'
    : status === 'processing'
    ? 'Thinking…'
    : 'Hold to speak a command';

  return (
    <div className="voice-controller">
      {(transcript || lastReply) && status !== 'idle' && (
        <div className="voice-bubble">
          {status === 'listening' && <span className="voice-bubble-transcript">{transcript || '…'}</span>}
          {status === 'processing' && <span className="voice-bubble-transcript">"{transcript}"</span>}
        </div>
      )}
      {status === 'idle' && lastReply && !pendingConfirmation && (
        <div className="voice-bubble voice-bubble-reply">{lastReply}</div>
      )}

      {/* Confirmation card - shown until the person answers, either by
          voice ("yes"/"no") or by tapping one of these buttons. Used
          before adding/deleting a customer, marking paid/unpaid,
          changing a customer's status, or a bulk WhatsApp blast. */}
      {status === 'idle' && pendingConfirmation && (
        <div className="voice-bubble voice-bubble-confirm">
          <span className="voice-bubble-transcript">{pendingConfirmation.message}</span>
          <div className="voice-confirm-actions">
            <button type="button" className="voice-confirm-btn voice-confirm-yes" onClick={() => handleConfirmTap('yes')}>
              ✅ Yes
            </button>
            <button type="button" className="voice-confirm-btn voice-confirm-no" onClick={() => handleConfirmTap('no')}>
              ✕ Cancel
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        className="voice-lang-pill"
        onClick={cycleLanguage}
        disabled={status !== 'idle'}
        title="Tap to change voice command language"
      >
        {VOICE_LANGUAGES[lang].label}
      </button>

      <button
        type="button"
        className={`voice-fab voice-fab-${status}`}
        onMouseDown={handlePressStart}
        onTouchStart={handlePressStart}
        title={supported ? statusLabel : isIOS() ? 'Not supported in Safari on iPhone/iPad' : 'Voice control not supported in this browser'}
        aria-label={touchMode ? 'Tap to give a voice command' : 'Hold to give a voice command'}
      >
        <span className="voice-fab-ring" />
        <span className="voice-fab-icon">
          {status === 'processing' ? '⏳' : status === 'error' ? '⚠️' : '🎙️'}
        </span>
      </button>
      <div className="voice-fab-caption">
        {pendingConfirmation ? 'Waiting for yes/no…' : statusLabel}
      </div>
    </div>
  );
};

export default VoiceController;
