import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import API from '../utils/api';
import { isVoiceSupported, createRecognizer, speak, stopSpeaking } from '../utils/voiceEngine';
import { runVoiceCommand, VOICE_LANGUAGES } from '../utils/voiceCommands';
import './VoiceController.css';

// Status: 'idle' | 'listening' | 'processing' | 'error'
const VoiceController = () => {
  const [status, setStatus] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [lastReply, setLastReply] = useState('');
  const [supported] = useState(isVoiceSupported());
  const [lang, setLang] = useState('en');
  const langOrder = ['en', 'ur', 'pa'];

  const recognizerRef = useRef(null);
  const finalTranscriptRef = useRef(''); // accumulated across auto-restarts
  const interimRef = useRef('');
  const isHeldRef = useRef(false); // true from press-down until actual release
  const restartTimeoutRef = useRef(null);
  const customersCacheRef = useRef(null); // in-memory only, never persisted
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

  const handleFinalTranscript = useCallback(
    async (text) => {
      if (!text || !text.trim()) {
        setStatus('idle');
        return;
      }
      setStatus('processing');
      try {
        const result = await runVoiceCommand(text, {
          API,
          navigate,
          getCustomers,
          refreshCustomers,
          lang,
        });
        setLastReply(result.message);
        if (result.ok) {
          toast.success(result.message, { duration: 4500 });
        } else {
          toast.error(result.message, { duration: 4500 });
        }
        speak(result.message, { lang: VOICE_LANGUAGES[lang].code });
      } catch (err) {
        const msg = err.response?.data?.message || 'Something went wrong running that command.';
        setLastReply(msg);
        toast.error(msg);
        speak(msg, { lang: VOICE_LANGUAGES[lang].code });
      } finally {
        setStatus('idle');
      }
    },
    [navigate, getCustomers, refreshCustomers, lang]
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

  const startListening = useCallback(() => {
    if (!supported) {
      toast.error('Voice control needs Chrome or Edge on this device.');
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
  }, [supported, beginSession]);

  const stopListening = useCallback(() => {
    isHeldRef.current = false;
    if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
    if (recognizerRef.current) {
      recognizerRef.current.stop();
      recognizerRef.current = null;
    } else {
      // Nothing was actively running (rare race) - finalize with what we have.
      const finalText = [finalTranscriptRef.current, interimRef.current].filter(Boolean).join(' ');
      handleFinalTranscript(finalText);
    }
  }, [handleFinalTranscript]);

  // Press-and-hold handlers - voice control is ONLY active while held down.
  // We listen for the "release" on window (not just the button) so a small
  // amount of finger/mouse drift off the button never cuts you off mid-sentence.
  const handlePressStart = (e) => {
    e.preventDefault();
    if (status === 'listening' || status === 'processing') return;
    startListening();
  };

  useEffect(() => {
    if (status !== 'listening') return undefined;
    const release = () => stopListening();
    window.addEventListener('mouseup', release);
    window.addEventListener('touchend', release);
    window.addEventListener('touchcancel', release);
    return () => {
      window.removeEventListener('mouseup', release);
      window.removeEventListener('touchend', release);
      window.removeEventListener('touchcancel', release);
    };
  }, [status, stopListening]);

  const cycleLanguage = () => {
    if (status !== 'idle') return; // don't switch mid-listen
    const next = langOrder[(langOrder.indexOf(lang) + 1) % langOrder.length];
    setLang(next);
    toast(`Voice language: ${VOICE_LANGUAGES[next].label}`, { icon: '🌐', duration: 1500 });
  };

  const statusLabel =
    status === 'listening' ? 'Listening… release to send' : status === 'processing' ? 'Thinking…' : 'Hold to speak a command';

  return (
    <div className="voice-controller">
      {(transcript || lastReply) && status !== 'idle' && (
        <div className="voice-bubble">
          {status === 'listening' && <span className="voice-bubble-transcript">{transcript || '…'}</span>}
          {status === 'processing' && <span className="voice-bubble-transcript">"{transcript}"</span>}
        </div>
      )}
      {status === 'idle' && lastReply && (
        <div className="voice-bubble voice-bubble-reply">{lastReply}</div>
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
        title={supported ? statusLabel : 'Voice control not supported in this browser'}
        aria-label="Hold to give a voice command"
      >
        <span className="voice-fab-ring" />
        <span className="voice-fab-icon">
          {status === 'processing' ? '⏳' : status === 'error' ? '⚠️' : '🎙️'}
        </span>
      </button>
      <div className="voice-fab-caption">{statusLabel}</div>
    </div>
  );
};

export default VoiceController;
