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
  const finalTranscriptRef = useRef('');
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

  useEffect(() => {
    return () => {
      recognizerRef.current && recognizerRef.current.stop();
      stopSpeaking();
    };
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
        });
        setLastReply(result.message);
        if (result.ok) {
          toast.success(result.message, { duration: 4500 });
        } else {
          toast.error(result.message, { duration: 4500 });
        }
        speak(result.message);
      } catch (err) {
        const msg = err.response?.data?.message || 'Something went wrong running that command.';
        setLastReply(msg);
        toast.error(msg);
        speak(msg);
      } finally {
        setStatus('idle');
      }
    },
    [navigate, getCustomers, refreshCustomers]
  );

  const startListening = useCallback(() => {
    if (!supported) {
      toast.error('Voice control needs Chrome or Edge on this device.');
      return;
    }
    stopSpeaking();
    finalTranscriptRef.current = '';
    setTranscript('');
    setLastReply('');
    setStatus('listening');

    const recognizer = createRecognizer({
      lang: VOICE_LANGUAGES[lang].code,
      onResult: (text, isFinal) => {
        setTranscript(text);
        if (isFinal) finalTranscriptRef.current = text;
      },
      onError: (error) => {
        if (error === 'no-speech') return;
        setStatus('error');
        toast.error('Microphone error: ' + error);
      },
      onEnd: () => {},
    });

    if (!recognizer) {
      setStatus('error');
      return;
    }

    recognizerRef.current = recognizer;
    try {
      recognizer.start();
    } catch (e) {
      // start() throws if called twice in a row - safe to ignore
    }
  }, [supported, lang]);

  const stopListening = useCallback(() => {
    if (recognizerRef.current) {
      recognizerRef.current.stop();
      recognizerRef.current = null;
    }
    const finalText = finalTranscriptRef.current || transcript;
    handleFinalTranscript(finalText);
  }, [transcript, handleFinalTranscript]);

  // Press-and-hold handlers - voice control is ONLY active while held down
  const handlePressStart = (e) => {
    e.preventDefault();
    if (status === 'listening' || status === 'processing') return;
    startListening();
  };
  const handlePressEnd = (e) => {
    e.preventDefault();
    if (status !== 'listening') return;
    stopListening();
  };

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
        onMouseUp={handlePressEnd}
        onMouseLeave={handlePressEnd}
        onTouchStart={handlePressStart}
        onTouchEnd={handlePressEnd}
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
