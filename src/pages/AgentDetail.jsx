import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { Room, RoomEvent, createLocalAudioTrack } from 'livekit-client';
import VoiceSelectionModal from '../components/VoiceSelectionModal';
import './AgentDetail.css';

// Get API base URL from environment variable or use localhost for development
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
// Helper to get full backend URL (without /api) for absolute URLs
const BACKEND_URL = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000';

function getApiOrigin() {
  try {
    // VITE_API_URL is expected to be absolute (https://.../api)
    const origin = new URL(API_BASE_URL).origin;
    // If someone accidentally built with localhost, don't use it in production.
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      throw new Error('Invalid API origin (localhost)');
    }
    return origin;
  } catch (e) {
    // Fallback: infer API origin from dashboard domain.
    // Example: https://dashboard.rapidcallai.com -> https://api.rapidcallai.com
    try {
      const { protocol, hostname } = window.location;
      if (hostname.startsWith('dashboard.')) {
        return `${protocol}//api.${hostname.slice('dashboard.'.length)}`;
      }
      // If already on api.* just use it
      if (hostname.startsWith('api.')) {
        return `${protocol}//${hostname}`;
      }
      // Last resort: current origin
      return window.location.origin;
    } catch {
      return window.location.origin;
    }
  }
}

function normalizeBackendPath(pathOrUrl) {
  if (!pathOrUrl) return null;
  const raw = String(pathOrUrl);
  if (!raw) return null;

  // If it's already absolute, use as-is.
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;

  // Fix a common broken prefix seen in production: "/.rapidcallai.com/api/api/..."
  let p = raw;
  if (p.startsWith('/.rapidcallai.com/')) {
    p = p.replace('/.rapidcallai.com', '');
  }
  // Collapse duplicate /api/api/ into /api/
  p = p.replace('/api/api/', '/api/');

  // Ensure leading slash for path-like URLs
  if (!p.startsWith('/')) p = `/${p}`;
  return p;
}

function toBackendAbsoluteUrl(pathOrUrl) {
  const normalized = normalizeBackendPath(pathOrUrl);
  if (!normalized) return null;
  // If normalizeBackendPath returned absolute URL, keep it.
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) return normalized;
  // Always use API origin for backend assets (audio), never the dashboard origin.
  return `${getApiOrigin()}${normalized}`;
}

const OPENAI_MODELS = [
  // Latest models (2024-2025)
  { id: 'gpt-4o', name: 'GPT-4o (Latest)' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Fastest)' },
  { id: 'o1-preview', name: 'O1 Preview (Reasoning)' },
  { id: 'o1-mini', name: 'O1 Mini (Reasoning)' },
  
  // GPT-4 variants
  { id: 'gpt-4', name: 'GPT-4' },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
  { id: 'gpt-4-turbo-preview', name: 'GPT-4 Turbo Preview' },
  { id: 'gpt-4-32k', name: 'GPT-4 32k' },
  { id: 'gpt-4-1106-preview', name: 'GPT-4 1106 Preview' },
  { id: 'gpt-4-0125-preview', name: 'GPT-4 0125 Preview' },
  
  // GPT-3.5 variants
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
  { id: 'gpt-3.5-turbo-16k', name: 'GPT-3.5 Turbo 16k' },
  { id: 'gpt-3.5-turbo-1106', name: 'GPT-3.5 Turbo 1106' },
  { id: 'gpt-3.5-turbo-0125', name: 'GPT-3.5 Turbo 0125' }
];

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'ru', name: 'Russian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' }
];

function AgentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [agent, setAgent] = useState(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [assistantDraft, setAssistantDraft] = useState('');
  const [callStats, setCallStats] = useState(null);
  const [pausedAudioState, setPausedAudioState] = useState(null);
  const [knowledgeBases, setKnowledgeBases] = useState([]);
  const [selectedKB, setSelectedKB] = useState(''); // Keep for backward compatibility
  const [selectedKBs, setSelectedKBs] = useState([]); // Array for multiple KBs
  const [showKBAddDropdown, setShowKBAddDropdown] = useState(false);
  const [expandedSettings, setExpandedSettings] = useState({
    knowledgeBase: false,
    speechSettings: false,
    callSettings: false,
    functions: false
  });
  const [functions, setFunctions] = useState([]);
  const [speechSettings, setSpeechSettings] = useState({
    voiceId: '21m00Tcm4TlvDq8ikWAM',
    voiceName: '',
    voiceProvider: 'elevenlabs',
    modelId: 'eleven_turbo_v2',
    openaiModel: 'gpt-4',
    language: 'en',
    stability: 0.5,
    similarityBoost: 0.75
  });
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [callSettings, setCallSettings] = useState({
    pauseBeforeSpeaking: 0,
    aiSpeaksFirst: true,
    welcomeMessageType: 'dynamic', // 'dynamic' | 'custom'
    customWelcomeMessage: ''
  });
  const [realtimeState, setRealtimeState] = useState({
    status: 'idle', // idle|connecting|connected|ended|error
    roomName: null,
    identity: null,
    callId: null,
    error: null,
    userSpeaking: false,
    agentSpeaking: false
  });
  const [isConnecting, setIsConnecting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [livekitStats, setLivekitStats] = useState({ rtt: null, e2e: null });
  const [shareableLink, setShareableLink] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [promptHasChanges, setPromptHasChanges] = useState(false);
  const [originalPrompt, setOriginalPrompt] = useState('');
  const [toasts, setToasts] = useState([]);
  
  const audioRef = useRef(null);
  const cuttingAudioRef = useRef(null);
  const ambientAudioRef = useRef(null);
  const lkRoomRef = useRef(null);
  const lkMicTrackRef = useRef(null);
  const lkAudioContainerRef = useRef(null);
  const lkLastTurnRef = useRef({ turnId: null, vadEndAt: null });
  const lkSentPlayoutRef = useRef(new Set());
  const lkAssistantCaptionRef = useRef('');
  const lkConfigAckRef = useRef(false);
  const lkAgentReadyRef = useRef(false);
  const isProcessingRef = useRef(false);
  const pendingMessageRef = useRef(null);
  const messageDebounceTimeoutRef = useRef(null);
  const isActiveRef = useRef(false);
  const wasInterruptedRef = useRef(false);
  const resumeTimeoutRef = useRef(null);
  const isInterruptingRef = useRef(false);
  const prefetchAbortRef = useRef(null);
  const prefetchDebounceTimeoutRef = useRef(null);
  const prefetchCooldownUntilRef = useRef(0);
  const prefetchLastAtRef = useRef(0);
  const prefetchLastTextRef = useRef('');
  const prefetchHiddenTextRef = useRef('');
  const audioQueueRef = useRef([]);
  const isPlayingQueueRef = useRef(false);
  const utteranceStartPerfRef = useRef(null);
  const lastFinalClientTimingsRef = useRef(null);
  const spokenCharsRef = useRef(0);
  const spokenTextRef = useRef('');
  const fullAssistantTextRef = useRef('');
  const activeChatAbortRef = useRef(null);
  const activeTurnIdRef = useRef(0);
  const abortedByBargeInRef = useRef(false);
  const audioSessionRef = useRef(0);

  const sanitizeCaptionText = useCallback((input) => {
    if (!input) return '';
    let s = String(input);
    s = s.replace(/```[\s\S]*?```/g, ' ');
    s = s.replace(/`+/g, '');
    s = s.replace(/[{}\[\]<>]/g, ' ');
    s = s.replace(/[*^%$#@|~]/g, ' ');
    s = s.replace(/[\u0000-\u001F\u007F]/g, ' ');
    s = s.replace(/\s+/g, ' ');
    return s;
  }, []);

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  // (Streaming/Deepgram removed)


  const stopPrefetch = useCallback(() => {
    if (prefetchDebounceTimeoutRef.current) {
      clearTimeout(prefetchDebounceTimeoutRef.current);
      prefetchDebounceTimeoutRef.current = null;
    }
    if (prefetchAbortRef.current) {
      try {
        prefetchAbortRef.current.abort();
      } catch (e) {}
      prefetchAbortRef.current = null;
    }
    // Prefetch should not show assistant text; keep it hidden.
    prefetchHiddenTextRef.current = '';
  }, []);

  const stopAssistantAudioQueue = useCallback(() => {
    audioSessionRef.current += 1;
    // Stop and release any queued audio elements
    try {
      for (const item of audioQueueRef.current || []) {
        if (item && typeof item.pause === 'function') {
          try {
            item.pause();
            item.currentTime = 0;
            item.src = '';
            item.load?.();
          } catch (e) {}
        }
      }
    } catch (e) {}
    audioQueueRef.current = [];
    isPlayingQueueRef.current = false;
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        // Help browsers stop audio immediately
        audioRef.current.src = '';
        audioRef.current.load?.();
      } catch (e) {}
      audioRef.current = null;
    }
  }, []);

  const bargeInStopAgent = useCallback(() => {
    abortedByBargeInRef.current = true;

    // Stop any "cutting phrase" audio immediately
    if (cuttingAudioRef.current) {
      try {
        cuttingAudioRef.current.pause();
        cuttingAudioRef.current.currentTime = 0;
        cuttingAudioRef.current.src = '';
        cuttingAudioRef.current.load?.();
      } catch (e) {}
      cuttingAudioRef.current = null;
    }

    // Stop all assistant audio
    stopAssistantAudioQueue();

    // Abort current streaming turn (stops LLM + TTS queue server-side)
    if (activeChatAbortRef.current) {
      try {
        activeChatAbortRef.current.abort();
      } catch (e) {}
      activeChatAbortRef.current = null;
    }

    // Allow next user utterance to be processed even if we were "processing"
    isProcessingRef.current = false;
    setIsProcessing(false);

    // Clear live captions/draft so it doesn't keep updating from old turn
    setAssistantDraft('');
    spokenTextRef.current = '';
    spokenCharsRef.current = 0;
    fullAssistantTextRef.current = '';

    // Keep listening
    if (isActiveRef.current) {
      setIsListening(true);
    }
  }, [stopAssistantAudioQueue]);


  const streamNdjson = useCallback(async ({ url, body, onEvent, signal }) => {
    const token = localStorage.getItem('token');
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body),
      signal
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(text || `Request failed (${resp.status})`);
    }
    const reader = resp.body?.getReader?.();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const evt = JSON.parse(line);
          onEvent?.(evt);
        } catch (e) {
          // ignore bad lines
        }
      }
    }
  }, []);

  // Start ambient office noise (low volume, looping)
  const startAmbientNoise = useCallback(() => {
    try {
      // Stop any existing ambient noise
      if (ambientAudioRef.current) {
        if (ambientAudioRef.current.pause) {
          ambientAudioRef.current.pause();
        } else if (ambientAudioRef.current.stop) {
          ambientAudioRef.current.stop();
        }
        ambientAudioRef.current = null;
      }
      
      // Generate office-like ambient noise using Web Audio API
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const bufferSize = 4096;
      const sampleRate = audioContext.sampleRate;
      const duration = 2; // 2 seconds of noise, will loop
      const frameCount = sampleRate * duration;
      
      const noiseBuffer = audioContext.createBuffer(2, frameCount, sampleRate);
      
      // Generate filtered noise for both channels (stereo)
      for (let channel = 0; channel < 2; channel++) {
        const channelData = noiseBuffer.getChannelData(channel);
        for (let i = 0; i < frameCount; i++) {
          // Generate brown noise (more natural than white noise)
          const brown = Math.random() * 2 - 1;
          channelData[i] = brown * 0.1; // Low amplitude
        }
      }
      
      const noiseSource = audioContext.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;
      
      // Add low-pass filter to make it sound like office ambience
      const filter = audioContext.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 800; // Muffled office sound
      filter.Q.value = 1;
      
      // Add slight reverb/delay for more natural sound
      const delay = audioContext.createDelay(0.1);
      delay.delayTime.value = 0.05;
      
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0.15; // 15% volume - not too loud, normal level
      
      // Connect: noise -> filter -> delay -> gain -> output
      noiseSource.connect(filter);
      filter.connect(delay);
      delay.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      noiseSource.start(0);
      
      // Store reference for cleanup
      ambientAudioRef.current = {
        pause: () => {
          try {
            noiseSource.stop();
            audioContext.close();
          } catch (e) {
            // ignore
          }
        },
        stop: () => {
          try {
            noiseSource.stop();
            audioContext.close();
          } catch (e) {
            // ignore
          }
        },
        audioContext,
        noiseSource
      };
      
      console.log('🔊 Started ambient office noise');
    } catch (err) {
      console.warn('Failed to start ambient noise:', err);
      // Silent fail - ambient noise is optional
    }
  }, []);

  // Stop ambient office noise
  const stopAmbientNoise = useCallback(() => {
    try {
      if (ambientAudioRef.current) {
        if (ambientAudioRef.current.pause) {
          ambientAudioRef.current.pause();
        } else if (ambientAudioRef.current.stop) {
          ambientAudioRef.current.stop();
        }
        if (ambientAudioRef.current.audioContext) {
          try {
            ambientAudioRef.current.audioContext.close();
          } catch (e) {
            // ignore
          }
        }
        ambientAudioRef.current = null;
        console.log('🔇 Stopped ambient office noise');
      }
    } catch (err) {
      // ignore
    }
  }, []);

  const stopConversation = useCallback(async () => {
    // Prevent multiple stop calls
    if (isStopping) return;
    
    setIsStopping(true);
    
    // Stop ambient noise
    stopAmbientNoise();
    
    // Update UI state IMMEDIATELY for instant feedback
    isActiveRef.current = false;
    isProcessingRef.current = false;
    setIsActive(false);
    setIsListening(false);
    setIsProcessing(false);
    setIsConnecting(false);
    setInterimTranscript('');
    setAssistantDraft('');
    setRealtimeState((s) => ({ ...s, status: 'ending', userSpeaking: false, agentSpeaking: false }));
    
    // Stop local mic track (non-blocking)
    try {
      lkMicTrackRef.current?.stop?.();
    } catch (e) {}
    lkMicTrackRef.current = null;

    // Disconnect room (non-blocking but more forceful)
    try {
      if (lkRoomRef.current) {
        // Get room name before disconnecting for logging
        const roomName = lkRoomRef.current.name;
        console.log(`🔌 Disconnecting room: ${roomName}`);
        
        // Disconnect and wait a bit to ensure it completes
        await Promise.race([
          lkRoomRef.current.disconnect(),
          new Promise((resolve) => setTimeout(resolve, 1000)) // Max 1s wait
        ]);
        
        console.log(`✅ Room disconnected: ${roomName}`);
      }
    } catch (e) {
      console.warn('Error disconnecting room:', e);
    }
    lkRoomRef.current = null;

    // Remove attached audio elements
    if (lkAudioContainerRef.current) {
      lkAudioContainerRef.current.innerHTML = '';
    }

    // Clear messages and stats immediately
    setCallStats(null);
    setMessages([]);
    setConversationId(null);
    setRealtimeState((s) => ({ ...s, status: 'ended', userSpeaking: false, agentSpeaking: false }));
    
    // Best-effort: end backend call record and save transcripts/audio (fire and forget - don't wait)
    if (realtimeState?.callId || realtimeState?.roomName) {
      // Prepare messages for saving (filter out system messages)
      const messagesToSave = messages
        .filter(msg => msg.role === 'user' || msg.role === 'assistant')
        .map(msg => ({
          role: msg.role,
          content: msg.content
        }));

      console.log(`💾 Saving ${messagesToSave.length} messages to call history`, {
        callId: realtimeState.callId,
        roomName: realtimeState.roomName,
        messageCount: messagesToSave.length
      });

      axios.post(
        `${API_BASE_URL}/realtime/end`,
        {
          callId: realtimeState.callId,
          roomName: realtimeState.roomName,
          endReason: 'user_hangup',
          messages: messagesToSave.length > 0 ? messagesToSave : undefined,
          // audioUrl will be set by backend if recording exists
        },
        { headers: getAuthHeaders() }
      ).then(() => {
        console.log('✅ Messages saved to call history');
      }).catch((err) => {
        console.error('❌ Failed to save messages to call history:', err);
        // ignore errors - already stopped locally
      });
    }
    
    setIsStopping(false);
  }, [isStopping, getAuthHeaders, realtimeState.callId, realtimeState.roomName, stopPrefetch, stopAssistantAudioQueue]);

  const startConversationRealtime = useCallback(async () => {
    try {
      // CRITICAL: Force disconnect any existing room FIRST (before stopConversation)
      // This prevents duplicate connections to the same room
      if (lkRoomRef.current) {
        console.log('🔌 Force disconnecting existing room before starting new call...');
        try {
          const oldRoom = lkRoomRef.current;
          await Promise.race([
            oldRoom.disconnect(),
            new Promise((resolve) => setTimeout(resolve, 1000)) // Max 1s wait
          ]);
          console.log('✅ Old room disconnected');
        } catch (e) {
          console.warn('Error disconnecting existing room:', e);
        }
        lkRoomRef.current = null;
      }
      
      // Stop any existing session
      await stopConversation();
      
      // Wait a bit to ensure old connection is fully closed before creating new one
      await new Promise((resolve) => setTimeout(resolve, 300));
      
      // Additional cleanup - ensure everything is reset
      lkConfigAckRef.current = false;
      lkAgentReadyRef.current = false;
      
      setIsConnecting(true);

      setRealtimeState({
        status: 'connecting',
        roomName: null,
        identity: null,
        callId: null,
        error: null,
        userSpeaking: false,
        agentSpeaking: false
      });
      lkAssistantCaptionRef.current = '';
      lkConfigAckRef.current = false;
      lkAgentReadyRef.current = false;
      setAssistantDraft('');
      setInterimTranscript('');

      // Get token first (needed for roomName)
      const tokenResp = await axios.post(
        `${API_BASE_URL}/realtime/token`,
        { agentId: id, provider: 'web' },
        { headers: getAuthHeaders() }
      );

      const { livekitUrl, accessToken, roomName, identity } = tokenResp.data || {};
      if (!livekitUrl || !accessToken || !roomName) {
        throw new Error('Realtime token response missing fields');
      }

      // Parallelize start request, config fetch, and LiveKit connection
      const [startResp, cfgResp] = await Promise.all([
        axios.post(
          `${API_BASE_URL}/realtime/start`,
          { agentId: id, roomName, provider: 'web' },
          { headers: getAuthHeaders() }
        ),
        axios.post(
          `${API_BASE_URL}/realtime/config`,
          {
            agentId: id,
            systemPrompt: systemPrompt?.trim?.() || '',
            knowledgeBaseIds: selectedKBs.length > 0 ? selectedKBs : (selectedKB ? [selectedKB] : []), // Pass all selected KBs
            knowledgeBaseId: selectedKBs.length > 0 ? selectedKBs[0] : (selectedKB || null) // Backward compatibility
          },
          { headers: getAuthHeaders() }
        )
      ]);

      const callId = startResp.data?.callId || null;

      // Connect to LiveKit immediately (don't wait for config)
      const room = new Room({
        adaptiveStream: true,
        dynacast: true
      });
      lkRoomRef.current = room;
      
      // Set up latency polling - store interval ref for cleanup
      const statsIntervalRef = { current: null };
      statsIntervalRef.current = setInterval(async () => {
        try {
          if (room && room.engine && room.engine.client) {
            let rtt = null;
            
            // Try to get RTT from getStats()
            try {
              const stats = await room.engine.client.getStats();
              if (stats) {
                // Try to find RTT in various places in the stats object
                if (stats.subscribedCodecs) {
                  for (const codec of stats.subscribedCodecs || []) {
                    if (codec.remoteTrackStats && codec.remoteTrackStats.length > 0) {
                      const trackStats = codec.remoteTrackStats[0];
                      if (trackStats.rtt) {
                        rtt = trackStats.rtt;
                        break;
                      }
                    }
                  }
                }
                
                // Also check publishedCodecs for local tracks
                if (!rtt && stats.publishedCodecs) {
                  for (const codec of stats.publishedCodecs || []) {
                    if (codec.localTrackStats && codec.localTrackStats.length > 0) {
                      const trackStats = codec.localTrackStats[0];
                      if (trackStats.rtt) {
                        rtt = trackStats.rtt;
                        break;
                      }
                    }
                  }
                }
              }
            } catch (e) {
              // getStats() might not be available or might throw
            }
            
            if (rtt !== null) {
              setLivekitStats(prev => ({ ...prev, rtt }));
            }
          }
        } catch (e) {
          // Ignore errors
        }
      }, 500);
      
      // Also listen for connection quality changes for RTT (alternative method)
      room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
        try {
          // ConnectionQualityChanged provides quality info
          // The quality parameter might have latency info
          if (participant && participant.identity === room.localParticipant?.identity) {
            // Try to extract RTT from quality if available
            // Note: ConnectionQuality might not directly expose RTT, but we try
            if (quality && typeof quality === 'object') {
              // Some LiveKit versions expose connection quality differently
              // This is a best-effort attempt
            }
          }
        } catch (e) {}
      });
      
      // Clean up interval on disconnect
      room.on(RoomEvent.Disconnected, () => {
        if (statsIntervalRef.current) {
          clearInterval(statsIntervalRef.current);
          statsIntervalRef.current = null;
        }
      });

      room.on(RoomEvent.Disconnected, () => {
        setRealtimeState((s) => ({ ...s, status: 'ended', userSpeaking: false, agentSpeaking: false }));
      });

      room.on(RoomEvent.TrackSubscribed, (track) => {
        // Attach remote audio (agent track)
        if (track?.kind !== 'audio') return;
        const el = track.attach();
        el.autoplay = true;
        el.controls = false;
        el.setAttribute('data-livekit-audio', 'true');
        el.onplaying = async () => {
          try {
            const now = Date.now();
            const turnId = lkLastTurnRef.current?.turnId || `play_${now}`;
            if (lkSentPlayoutRef.current.has(turnId)) return;
            lkSentPlayoutRef.current.add(turnId);
            const vadEndAt = lkLastTurnRef.current?.vadEndAt ?? null;
            const vadEndToPlayoutStartMs = typeof vadEndAt === 'number' ? now - vadEndAt : null;
            await axios.post(
              `${API_BASE_URL}/realtime/metrics`,
              {
                callId,
                roomName,
                turn: {
                  turnId,
                  vadEndAt,
                  clientPlayoutStartAt: now,
                  vadEndToPlayoutStartMs
                }
              },
              { headers: getAuthHeaders() }
            );
          } catch (e) {
            // ignore
          }
        };
        lkAudioContainerRef.current?.appendChild(el);
      });

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track?.kind !== 'audio') return;
        try {
          track.detach().forEach((el) => el.remove());
        } catch (e) {}
      });

      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const ids = new Set((speakers || []).map((p) => p?.identity).filter(Boolean));
        const localId = room.localParticipant?.identity;
        const userSpeaking = !!(localId && ids.has(localId));
        // Any non-local speaker is treated as "agent speaking" for UI
        const agentSpeaking = Array.from(ids).some((i) => i && i !== localId);
        setRealtimeState((s) => ({ ...s, userSpeaking, agentSpeaking }));
      });

      // Disable RoomEvent.TranscriptionReceived for assistant - DataChannelTranscriptTee handles all assistant transcripts
      // This prevents duplicate/conflicting transcripts and ensures word-by-word streaming works correctly

      room.on(RoomEvent.DataReceived, async (payload) => {
        try {
          // Agent-worker can send JSON events with timing fields.
          const txt = new TextDecoder().decode(payload);
          const evt = JSON.parse(txt);
          if (!evt || typeof evt !== 'object') return;

          if (evt.type === 'agent_config_ack') {
            lkConfigAckRef.current = true;
            console.log('✅ Agent config acknowledged');
            return;
          }
          
          if (evt.type === 'agent_ready') {
            console.log('✅ Agent fully initialized and ready to interact');
            lkAgentReadyRef.current = true;
            // Agent is now fully loaded with prompt and ready
            // If we're still connecting, open the dialogue now
            if (isConnecting && !isActive) {
              setIsConnecting(false);
              setIsActive(true);
              isActiveRef.current = true;
              setIsListening(true);
              setIsProcessing(false);
              console.log('🎯 Opening dialogue - agent is ready!');
            }
          }

          // Transcript events (sent via data channel)
          // { type: 'transcript', role: 'user'|'assistant', text: string, final?: boolean }
          if (evt.type === 'transcript' && typeof evt.text === 'string' && evt.text.trim()) {
            const role = evt.role === 'user' ? 'user' : 'assistant';
            const text = evt.text.trim();
            
            // Filter out system messages (like Retell AI - no internal status messages)
            const systemMessagePatterns = [
              /^\(voice agent connected\)$/i,
              /^\(agent config received\)$/i,
              /^\(agent.*connected\)$/i,
              /^\(.*config.*received\)$/i
            ];
            
            const isSystemMessage = systemMessagePatterns.some(pattern => pattern.test(text));
            if (isSystemMessage) {
              return; // Skip system messages
            }
            
            if (evt.final === false) {
              // Partial transcript - sentence-by-sentence for assistant
              if (role === 'user') {
                setInterimTranscript(text);
              } else {
                // For assistant: show sentences as they come (sentence-by-sentence)
                // Each partial update contains accumulated sentences so far
                setAssistantDraft(text);
              }
            } else {
              // Final transcript - move to permanent messages
              if (role === 'user') {
                setInterimTranscript('');
                // Add user message with unique ID - always append to maintain chronological order
                setMessages((prev) => [...prev, { 
                  role, 
                  content: text,
                  id: `user_${Date.now()}_${Math.random()}`
                }]);
              } else {
                // For assistant: Final message - move draft to permanent messages
                const finalText = text.trim();
                if (finalText) {
                  const messageId = `assistant_${Date.now()}_${Math.random()}`;
                  // Clear draft and add final message
                  setAssistantDraft('');
                  setMessages((prev) => {
                    // Simply append - no deletion, no filtering
                    return [...prev, { 
                      role, 
                      content: finalText,
                      id: messageId
                    }];
                  });
                }
              }
            }
          }

          // Handle metrics events (latency tracking)
          if (evt.type === 'metrics') {
            // Update stored metrics
            if (evt.turnId) lkLastTurnRef.current.turnId = String(evt.turnId);
            if (typeof evt.vadEndAt === 'number') {
              lkLastTurnRef.current.vadEndAt = evt.vadEndAt;
            }
            
            // Update E2E latency when we have both vadEndAt and ttsFirstFrameAt
            // Ensure values are in milliseconds (not seconds) for correct calculation
            const storedVadEnd = lkLastTurnRef.current.vadEndAt;
            if (typeof storedVadEnd === 'number' && typeof evt.ttsFirstFrameAt === 'number') {
              // Both should be in milliseconds - calculate E2E latency
              let e2e = evt.ttsFirstFrameAt - storedVadEnd;
              // Sanity check: if e2e is unreasonably large (>10 seconds), likely a calculation error
              if (e2e > 10000) {
                // If ttsFirstFrameAt seems to be in seconds, convert to ms
                if (evt.ttsFirstFrameAt < 1000000000) {
                  e2e = (evt.ttsFirstFrameAt * 1000) - storedVadEnd;
                } else {
                  // If storedVadEnd seems wrong, recalculate
                  e2e = evt.ttsFirstFrameAt - (storedVadEnd * 1000);
                }
              }
              // Only set if reasonable (between 0 and 10 seconds)
              if (e2e >= 0 && e2e <= 10000) {
                setLivekitStats(prev => ({ ...prev, e2e }));
              }
            }
            
            // Persist metrics to backend
            if (
              evt.turnId &&
              (typeof evt.vadEndAt === 'number' ||
                typeof evt.ttsFirstFrameAt === 'number' ||
                typeof evt.llmFirstTokenAt === 'number')
            ) {
              await axios.post(
                `${API_BASE_URL}/realtime/metrics`,
                {
                  callId,
                  roomName,
                  turn: {
                    turnId: String(evt.turnId),
                    vadEndAt: typeof evt.vadEndAt === 'number' ? evt.vadEndAt : undefined,
                    llmFirstTokenAt: typeof evt.llmFirstTokenAt === 'number' ? evt.llmFirstTokenAt : undefined,
                    ttsFirstFrameAt: typeof evt.ttsFirstFrameAt === 'number' ? evt.ttsFirstFrameAt : undefined
                  }
                },
                { headers: getAuthHeaders() }
              );
            }
          }
        } catch (e) {
          // ignore
        }
      });

      // Connect and publish mic in parallel
      await Promise.all([
        room.connect(livekitUrl, accessToken),
        // Publish mic
        (async () => {
          const micTrack = await createLocalAudioTrack({
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          });
          lkMicTrackRef.current = micTrack;
          await room.localParticipant.publishTrack(micTrack);
        })()
      ]);

      setRealtimeState((s) => ({
        ...s,
        status: 'connected',
        roomName,
        identity: identity || null,
        callId
      }));

      // Send config payload (reduced wait time)
      try {
        const cfg = cfgResp?.data || {};
        const cfgPayload = new TextEncoder().encode(
          JSON.stringify({
            type: 'agent_config',
            agentId: String(id),
            finalSystemPrompt: cfg.finalSystemPrompt || '',
            speechSettings: cfg.speechSettings || {},
            callSettings: {
              ...(cfg.callSettings || {}),
              aiSpeaksFirst: !!callSettings?.aiSpeaksFirst,
              welcomeMessageType: callSettings?.welcomeMessageType || 'dynamic',
              customWelcomeMessage: callSettings?.customWelcomeMessage || ''
            }
          })
        );

        // Wait for config ack: max 5s with 150ms intervals (optimized for faster startup)
        const startedAt = Date.now();
        let attempts = 0;
        while (!lkConfigAckRef.current && Date.now() - startedAt < 5000) {
          await room.localParticipant.publishData(cfgPayload, { reliable: true, topic: 'agent_config' });
          attempts++;
          if (attempts === 1) {
            console.log('📤 Sending agent config to Python worker...', {
              promptLength: cfg.finalSystemPrompt?.length || 0,
              hasSpeechSettings: !!cfg.speechSettings,
              hasCallSettings: !!cfg.callSettings
            });
          }
          await new Promise((r) => setTimeout(r, 150));
        }
        if (lkConfigAckRef.current) {
          console.log('✅ Agent config acknowledged by Python worker');
        } else {
          console.warn('⚠️ Agent config ack not received within timeout');
        }
      } catch (e) {
        // best-effort
      }
      
      // Wait for agent_ready signal before opening dialogue (max 8s total wait)
      // This ensures the agent is fully initialized and ready to speak
      const agentReadyStartedAt = Date.now();
      const maxWaitTime = 8000; // 8 seconds max wait
      
      while (!lkAgentReadyRef.current && Date.now() - agentReadyStartedAt < maxWaitTime) {
        await new Promise((r) => setTimeout(r, 100)); // Check every 100ms
      }
      
      if (lkAgentReadyRef.current) {
        console.log('✅ Agent ready - opening dialogue now');
        setIsConnecting(false);
        setIsActive(true);
        isActiveRef.current = true;
        setIsListening(true);
        setIsProcessing(false);
        
        // Start ambient office noise
        startAmbientNoise();
      } else {
        // Timeout: open anyway but log warning
        console.warn('⚠️ Agent ready signal not received within timeout, opening dialogue anyway');
        setIsConnecting(false);
        setIsActive(true);
        isActiveRef.current = true;
        setIsListening(true);
        setIsProcessing(false);
        
        // Start ambient office noise
        startAmbientNoise();
      }
    } catch (err) {
      console.error('Realtime start failed:', err);
      setIsConnecting(false);
      setIsProcessing(false);
      setRealtimeState((s) => ({
        ...s,
        status: 'error',
        error: err?.response?.data?.error || err?.message || 'Failed to start realtime call'
      }));
      isActiveRef.current = false;
      setIsActive(false);
      setIsListening(false);
    }
  }, [API_BASE_URL, getAuthHeaders, id, stopConversation, systemPrompt, selectedKBs, selectedKB, callSettings.aiSpeaksFirst, startAmbientNoise]);

  // (Streaming/Deepgram removed)

  useEffect(() => {
    fetchAgent();
    fetchKnowledgeBases();
  }, [id]);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  // Cleanup on unmount - CRITICAL: Disconnect room when navigating away
  useEffect(() => {
    const cleanup = async () => {
      // Cleanup function runs when component unmounts
      console.log('🧹 Component unmounting - cleaning up LiveKit room...');
      
      // Force disconnect room
      try {
        if (lkRoomRef.current) {
          console.log('🔌 Disconnecting room on unmount...');
          await Promise.race([
            lkRoomRef.current.disconnect(),
            new Promise((resolve) => setTimeout(resolve, 500)) // Max 500ms wait
          ]);
          lkRoomRef.current = null;
        }
      } catch (e) {
        console.error('Error disconnecting room on unmount:', e);
      }
      
      // Stop mic track
      try {
        if (lkMicTrackRef.current) {
          lkMicTrackRef.current.stop();
          lkMicTrackRef.current = null;
        }
      } catch (e) {
        // ignore
      }
      
      // Clear audio container
      if (lkAudioContainerRef.current) {
        lkAudioContainerRef.current.innerHTML = '';
      }
      
      // Reset refs
      isActiveRef.current = false;
      isProcessingRef.current = false;
      lkConfigAckRef.current = false;
      lkAgentReadyRef.current = false;
      
      // Stop ambient noise
      try {
        if (ambientAudioRef.current) {
          ambientAudioRef.current.pause();
          ambientAudioRef.current = null;
        }
      } catch (e) {
        // ignore
      }
    };
    
    return () => {
      cleanup();
    };
  }, []); // Empty deps = runs on mount/unmount only

  // Also cleanup when page becomes hidden (user navigates away)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && lkRoomRef.current) {
        console.log('👋 Page hidden - cleaning up LiveKit room...');
        // Stop ambient noise when page is hidden
        try {
          if (ambientAudioRef.current) {
            ambientAudioRef.current.pause();
            ambientAudioRef.current = null;
          }
        } catch (e) {
          // ignore
        }
        stopConversation();
      }
    };
    
    const handleBeforeUnload = () => {
      if (lkRoomRef.current) {
        console.log('👋 Page unloading - cleaning up LiveKit room...');
        // Force disconnect synchronously on unload
        try {
          lkRoomRef.current.disconnect();
        } catch (e) {
          // ignore
        }
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [stopConversation]);


  const fetchAgent = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/agents/${id}`);
      setAgent(response.data);
      const prompt = response.data.systemPrompt || '';
      setSystemPrompt(prompt);
      setOriginalPrompt(prompt); // Store original for change detection
      setPromptHasChanges(false);
      setSelectedKB(response.data.knowledgeBaseId || '');
      // Initialize selectedKBs array from knowledgeBaseIds or fallback to knowledgeBaseId
      if (response.data.knowledgeBaseIds && Array.isArray(response.data.knowledgeBaseIds) && response.data.knowledgeBaseIds.length > 0) {
        setSelectedKBs(response.data.knowledgeBaseIds);
      } else if (response.data.knowledgeBaseId) {
        setSelectedKBs([response.data.knowledgeBaseId]);
      } else {
        setSelectedKBs([]);
      }
      
      // Save selected agent to localStorage
      localStorage.setItem('lastSelectedAgentId', id);
      
      if (response.data.speechSettings) {
        console.log('📥 Loaded speech settings from agent:', {
          voiceId: response.data.speechSettings.voiceId,
          voiceName: response.data.speechSettings.voiceName,
          language: response.data.speechSettings.language,
          fullSettings: response.data.speechSettings
        });
        // Ensure all speech settings are properly loaded
        setSpeechSettings({
          voiceId: response.data.speechSettings.voiceId || '21m00Tcm4TlvDq8ikWAM',
          voiceName: response.data.speechSettings.voiceName || '',
          voiceProvider: response.data.speechSettings.voiceProvider || 'elevenlabs',
          modelId: response.data.speechSettings.modelId || 'eleven_turbo_v2',
          openaiModel: response.data.speechSettings.openaiModel || 'gpt-4',
          language: response.data.speechSettings.language || 'en',
          stability: response.data.speechSettings.stability ?? 0.5,
          similarityBoost: response.data.speechSettings.similarityBoost ?? 0.75
        });
      }
      if (response.data.callSettings) {
        setCallSettings({
          pauseBeforeSpeaking: response.data.callSettings.pauseBeforeSpeaking || 0,
          aiSpeaksFirst: response.data.callSettings.aiSpeaksFirst !== undefined ? response.data.callSettings.aiSpeaksFirst : true,
          welcomeMessageType: response.data.callSettings.welcomeMessageType || 'dynamic',
          customWelcomeMessage: response.data.callSettings.customWelcomeMessage || ''
        });
      }
      if (response.data.functions && response.data.functions.length > 0) {
        console.log('📋 Loaded functions from agent:', response.data.functions);
        setFunctions(response.data.functions);
      }
      // Only set shareable link if agent is public AND has a token
      if (response.data.isPublic && response.data.shareableToken) {
        const baseUrl = window.location.origin;
        setShareableLink(`${baseUrl}/test/${response.data.shareableToken}`);
      } else {
        setShareableLink('');
      }
      setIsPublic(response.data.isPublic || false);
      if (!response.data.functions || response.data.functions.length === 0) {
        // Initialize with default end_call function if none exist
        console.log('📋 No functions found, initializing default end_call function');
        const defaultFunction = [{
          name: 'end_call',
          description: 'End the call when user says goodbye, bye, or similar phrases',
          enabled: true,
          triggers: ['bye', 'goodbye', 'see you', 'talk later', 'end call', 'hang up'],
          config: {}
        }];
        setFunctions(defaultFunction);
        // Save the default function to the agent
        try {
          await axios.put(`${API_BASE_URL}/agents/${id}`, {
            functions: defaultFunction
          });
        } catch (error) {
          console.error('Error saving default function:', error);
        }
      }
    } catch (error) {
      console.error('Error fetching agent:', error);
      navigate('/');
    }
  };

  const fetchKnowledgeBases = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/knowledge-bases`);
      setKnowledgeBases(response.data);
    } catch (error) {
      console.error('Error fetching knowledge bases:', error);
    }
  };

  const generateShareableLink = async () => {
    try {
      const response = await axios.post(`${API_BASE_URL}/agents/${id}/generate-token`);
      const baseUrl = window.location.origin;
      setShareableLink(`${baseUrl}/test/${response.data.shareableToken}`);
      setIsPublic(true);
      setAgent(response.data);
      showToast('Shareable link generated successfully!', 'success');
    } catch (error) {
      console.error('Error generating shareable link:', error);
      showToast('Failed to generate shareable link. Please try again.', 'error');
    }
  };

  const togglePublicStatus = async () => {
    try {
      const newPublicStatus = !isPublic;
      const response = await axios.put(`${API_BASE_URL}/agents/${id}`, {
        isPublic: newPublicStatus
      });
      setIsPublic(newPublicStatus);
      if (newPublicStatus && response.data.shareableToken) {
        const baseUrl = window.location.origin;
        setShareableLink(`${baseUrl}/test/${response.data.shareableToken}`);
      } else if (!newPublicStatus) {
        setShareableLink('');
      }
      setAgent(response.data);
    } catch (error) {
      console.error('Error updating public status:', error);
      alert('Failed to update public status');
    }
  };

  const copyShareableLink = () => {
    if (shareableLink) {
      navigator.clipboard.writeText(shareableLink);
      showToast('Link copied to clipboard!', 'success');
    }
  };

  const removeShareableLink = async () => {
    try {
      const response = await axios.put(`${API_BASE_URL}/agents/${id}`, {
        isPublic: false
      });
      setShareableLink('');
      setIsPublic(false);
      setAgent(response.data);
      showToast('Shareable link removed successfully', 'success');
    } catch (error) {
      console.error('Error removing shareable link:', error);
      showToast('Failed to remove shareable link. Please try again.', 'error');
    }
  };

  const saveAgent = async () => {
    try {
      console.log('💾 Saving agent with speech settings:', {
        voiceId: speechSettings.voiceId,
        voiceName: speechSettings.voiceName,
        language: speechSettings.language,
        fullSpeechSettings: speechSettings
      });
      
      // Ensure voiceId is present before saving
      if (!speechSettings.voiceId) {
        console.warn('⚠️ No voiceId in speechSettings, this might cause issues');
      }
      
      const response = await axios.put(`${API_BASE_URL}/agents/${id}`, {
        systemPrompt: systemPrompt,
        knowledgeBaseId: selectedKB || null,
        speechSettings: speechSettings,
        callSettings: callSettings,
        functions: functions
      });
      
      console.log('✅ Agent saved successfully. Response:', {
        savedVoiceId: response.data.speechSettings?.voiceId,
        savedVoiceName: response.data.speechSettings?.voiceName
      });
      
      // Update local state with the saved data to ensure consistency
      if (response.data.speechSettings) {
        setSpeechSettings(response.data.speechSettings);
      }
      
      alert('Agent saved successfully');
    } catch (error) {
      console.error('❌ Error saving agent:', error);
      console.error('❌ Error details:', error.response?.data);
      alert('Failed to save agent: ' + (error.response?.data?.error || error.message));
    }
  };


  const handleUserMessage = useCallback(async (userMessage) => {
    if (!conversationId) return;
    
    // Prevent duplicate processing - if already processing, ignore this message
    if (isProcessingRef.current) {
      console.log('⚠️ Already processing, ignoring duplicate message:', userMessage);
      return;
    }
    
    // Check if this is an interruption (user speaking while AI is processing or speaking)
    const isInterruption = isProcessingRef.current || (audioRef.current && audioRef.current.currentTime > 0);
    
    if (isInterruption) {
      isInterruptingRef.current = true;
    }

    // Clear any paused audio state since we're starting a new interaction
    setPausedAudioState(null);
    wasInterruptedRef.current = false;
    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current);
      resumeTimeoutRef.current = null;
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (cuttingAudioRef.current) {
      cuttingAudioRef.current.pause();
      cuttingAudioRef.current = null;
    }

    // Don't stop recognition - keep it running continuously
    // This allows user to interrupt even while processing
    isProcessingRef.current = true;
    setIsProcessing(true);
    setInterimTranscript('');
    stopPrefetch();
    stopAssistantAudioQueue();
    setAssistantDraft('');
    setLatencyInfo(null);
    setCallStats(null);
    spokenCharsRef.current = 0;
    spokenTextRef.current = '';
    fullAssistantTextRef.current = '';
    abortedByBargeInRef.current = false;

    const myTurnId = (activeTurnIdRef.current += 1);

    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    try {
      // Stream response + early chunked TTS
      const ac = new AbortController();
      activeChatAbortRef.current = ac;
      // If user starts speaking again, we can cancel by calling stopPrefetch/stopAssistantAudioQueue, but chat stream is per-turn.

      let fullAssistantText = '';
      let shouldEndCall = false;
      let receivedAny = false;
      const stallTimer = setTimeout(() => {
        if (!receivedAny) {
          try {
            ac.abort();
          } catch (e) {}
        }
      }, 20000); // GPT-4 can take longer; don't abort too aggressively

      await streamNdjson({
        url: `${API_BASE_URL}/conversation/chat-stream`,
        body: {
          message: userMessage,
          conversationId: conversationId,
          agentId: id,
          clientTimings: lastFinalClientTimingsRef.current || undefined
        },
        signal: ac.signal,
        onEvent: (evt) => {
          // Ignore late events from a cancelled/previous turn
          if (myTurnId !== activeTurnIdRef.current) return;
          if (!evt || !evt.type) return;
          receivedAny = true;
          if (evt.type === 'assistant_delta') {
            fullAssistantText += evt.delta || '';
            fullAssistantTextRef.current = fullAssistantText;
            // Don't show the full LLM text ahead of audio.
            // We only show captions from tts_audio chunks (what is actually being spoken).
          }
          if (evt.type === 'tts_audio' && evt.audioUrl) {
            if (typeof evt.spokenUpTo === 'number' && Number.isFinite(evt.spokenUpTo)) {
              spokenCharsRef.current = evt.spokenUpTo;
            }
            if (typeof evt.text === 'string' && evt.text) {
              // Grow captions steadily based on the actual queued chunk text (Retell-like).
              spokenTextRef.current = (spokenTextRef.current || '') + sanitizeCaptionText(evt.text);
              setAssistantDraft(spokenTextRef.current.trimStart());
            }
            // Audio handled by LiveKit WebRTC - no need to enqueue
          }
          if (evt.type === 'latency') {
            setLatencyInfo(evt.latency || null);
          }
          if (evt.type === 'rate_limited') {
            // stop the stream and let the catch() path fallback / retry
            try {
              ac.abort();
            } catch (e) {}
          }
          if (evt.type === 'final') {
            if (typeof evt.text === 'string') {
              fullAssistantText = evt.text;
              fullAssistantTextRef.current = fullAssistantText;
              // Keep captions as-is; final transcript is committed after stream ends.
            }
            shouldEndCall = !!evt.shouldEndCall;
          }
        }
      });
      clearTimeout(stallTimer);
      if (activeChatAbortRef.current === ac) activeChatAbortRef.current = null;

      // Always show the response - the interruption flag was just for tracking
      // Reset the interruption flag after we get the response
      const wasInterruption = isInterruptingRef.current;
      isInterruptingRef.current = false;

      // Commit assistant message to transcript
      const finalText = (fullAssistantText || '').trim();
      if (finalText) {
        setMessages(prev => [...prev, { role: 'assistant', content: finalText }]);
      }
      setAssistantDraft('');
      
      // If end_call function was triggered, stop the conversation (exactly like pressing Stop button)
      if (shouldEndCall) {
        console.log('🔚 End call function triggered, stopping conversation immediately');
        // Stop all audio first
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current = null;
        }
        if (cuttingAudioRef.current) {
          cuttingAudioRef.current.pause();
          cuttingAudioRef.current = null;
        }
        // Call stopConversation which does everything the Stop button does
        // This will stop recognition, clear state, and end the call
        await stopConversation();
        // Don't continue with audio playback - conversation is ended
        return;
      }
      // Audio is streamed in chunks; playback is handled via queue in enqueueAssistantAudio().
      // Always keep listening.
      if (isActiveRef.current) {
        setIsListening(true);
      }
    } catch (error) {
      // If we aborted due to barge-in, do NOT fallback (it causes double voices).
      if (abortedByBargeInRef.current || error?.name === 'AbortError') {
        return;
      }
      console.error('Error in chat:', error);
      // Fallback to legacy endpoint so user always gets a response.
      try {
        const response = await axios.post(`${API_BASE_URL}/conversation/chat`, {
          message: userMessage,
          conversationId: conversationId,
          agentId: id
        });
        const aiResponse = response.data.text;
        const audioUrl = response.data.audioUrl;
        const shouldEndCallLegacy = response.data.shouldEndCall || false;
        if (aiResponse) {
          setMessages(prev => [...prev, { role: 'assistant', content: aiResponse }]);
        }
        setAssistantDraft('');

        if (shouldEndCallLegacy) {
          await stopConversation();
          return;
        }

        // Audio handled by LiveKit WebRTC - no need to enqueue
      } catch (fallbackErr) {
        console.error('Legacy fallback failed:', fallbackErr);
        alert('Failed to get AI response');
      }
      // Just ensure listening restarts
      if (isActiveRef.current) {
        setIsListening(true);
      }
    } finally {
      // Only clear processing if this turn is still the active one
      if (myTurnId === activeTurnIdRef.current) {
        isProcessingRef.current = false;
        setIsProcessing(false);
      }
      isInterruptingRef.current = false;
      
      // Always ensure listening is active after processing completes
      // This is critical to ensure the AI responds to subsequent messages
      if (isActiveRef.current) {
        setIsListening(true);
      }
    }
  }, [conversationId, id]);

  // SpeechRecognition removed - using WebRTC only

  // Poll live call stats (Retell-like header)
  useEffect(() => {
    if (!isActive || !conversationId) return;
    let cancelled = false;

    const fetchStats = async () => {
      try {
        const resp = await axios.get(`${API_BASE_URL}/call-history/by-conversation/${conversationId}`);
        if (!cancelled) setCallStats(resp.data);
      } catch (e) {
        // ignore
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isActive, conversationId]);

  // Toast notification system - MUST be before any early returns
  const showToast = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random();
    const newToast = { id, message, type };
    setToasts((prev) => [...prev, newToast]);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const startConversation = async () => {
    console.log('[call] startConversation');
    return startConversationRealtime();
  };

  if (!agent) {
    return <div className="agent-detail-loading">Loading...</div>;
  }

  const shortId = (value, n = 6) => {
    const s = String(value || '');
    if (!s) return '';
    return s.length <= n * 2 ? s : `${s.slice(0, n)}…${s.slice(-n)}`;
  };

  const fmtMsRange = (range) => {
    if (!range || typeof range.min !== 'number' || typeof range.max !== 'number') return '—';
    return `${Math.round(range.min)}–${Math.round(range.max)}ms`;
  };

  const fmtMs = (n) => {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
    return `${Math.round(n)}ms`;
  };

  const fmtTokensRange = (range) => {
    if (!range || typeof range.min !== 'number' || typeof range.max !== 'number') return '—';
    return `${Math.round(range.min)}–${Math.round(range.max)} tokens`;
  };

  const fmtTokens = (n) => {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
    return `${Math.round(n)} tokens`;
  };

  const fmtUsdPerMin = (n) => {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
    return `$${n.toFixed(2)}/min`;
  };

  const copyAgentId = async () => {
    try {
      await navigator.clipboard.writeText(String(id || ''));
    } catch (e) {
      // Fallback for some browsers
      const ta = document.createElement('textarea');
      ta.value = String(id || '');
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
    }
  };

  return (
    <div className="agent-detail-container">
      <div className="agent-detail-header">
        <div className="agent-detail-title">
          {/* Compact Shareable Link Section */}
          <div style={{
            display: 'flex',
            width: '100%',
            minWidth: '600px',
            maxWidth: '100%', 
            gap: '3rem'
          }}>
            {!shareableLink ? (
              <button
                className="btn-secondary"
                onClick={generateShareableLink}
                style={{ fontSize: '0.875rem', padding: '0.5rem 1rem', alignSelf: 'flex-start' }}
              >
                Generate Shareable Link
              </button>
            ) : (
              <div style={{
                display: 'flex',
                gap: '0.5rem',
                alignItems: 'center',
                minWidth: '600px'
              }}>
                <input
                  type="text"
                  value={shareableLink}
                  readOnly
                  style={{
                    padding: '0.5rem 0.75rem',
                    border: '1px solid #d1d5db',
                    borderRadius: '0.375rem',
                    fontSize: '0.875rem',
                    background: 'white',
                    minWidth: '500px',
                  }}
                  placeholder="No shareable link generated"
                />
                <button
                  className="btn-secondary"
                  onClick={copyShareableLink}
                  title="Copy link"
                  style={{ padding: '0.5rem', minWidth: 'auto' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                </button>
                <button
                  className="btn-secondary"
                  onClick={generateShareableLink}
                  title="Generate new link"
                  style={{ padding: '0.5rem 0.75rem', fontSize: '0.875rem', whiteSpace: 'nowrap' }}
                >
                  Regenerate
                </button>
                <button
                  className="btn-secondary"
                  onClick={removeShareableLink}
                  title="Remove link"
                  style={{ padding: '0.5rem', minWidth: 'auto', color: '#dc2626' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18"></path>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </button>
              </div>
            )}



            {/* Retell-style live stats strip */}
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.5rem',
              fontSize: '0.875rem',
              color: '#111827',
              justifyContent: 'center',
              alignItems: 'center'
            }}>
              <span style={{ opacity: 0.75 }}>Agent ID:</span>
              <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                {shortId(id, 6)}
                <button
                  className="btn-secondary"
                  onClick={copyAgentId}
                  title="Copy Agent ID"
                  style={{ padding: '0.25rem 0.4rem', minWidth: 'auto', fontSize: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  Copy
                </button>
              </strong>


              <span style={{ opacity: 0.5 }}>•</span>
              <span style={{ opacity: 0.75 }}>Cost/min:</span>
              <strong>{fmtUsdPerMin(callStats?.costPerMin)}</strong>

              <span style={{ opacity: 0.5 }}>•</span>
              <span style={{ opacity: 0.75 }}>Latency:</span>
              <strong>
                {livekitStats.rtt != null ? `RTT: ${Math.round(livekitStats.rtt)}ms` : ''}
                {livekitStats.rtt != null && livekitStats.e2e != null ? ' | ' : ''}
                {livekitStats.e2e != null ? `E2E: ${Math.round(livekitStats.e2e)}ms` : (callStats?.lastTurn?.e2eFirstAudioMs ? `E2E: ${Math.round(callStats.lastTurn.e2eFirstAudioMs)}ms` : callStats?.avgLatencyMs ? `E2E: ${Math.round(callStats.avgLatencyMs)}ms` : (isActive ? 'E2E: —' : '—'))}
              </strong>

              <span style={{ opacity: 0.5 }}>•</span>
              <span style={{ opacity: 0.75 }}>Tokens:</span>
              <strong>{fmtTokens(callStats?.avgTokensUsed ?? callStats?.tokensRange?.max ?? callStats?.lastTurn?.tokensUsed)}</strong>
            </div>
          </div>
        </div>
        <div className="agent-detail-actions">
          <button
            className="btn-primary"
            onClick={async () => {
              try {
                await axios.put(
                  `${API_BASE_URL}/agents/${id}`,
                  { 
                    systemPrompt,
                    speechSettings,
                    callSettings,
                    functions,
                    knowledgeBaseIds: selectedKBs.length > 0 ? selectedKBs : [],
                    knowledgeBaseId: selectedKBs.length > 0 ? selectedKBs[0] : (selectedKB || null), // Use first selected KB for backward compatibility
                    isPublic: true
                  },
                  { headers: getAuthHeaders() }
                );
                setIsPublic(true);
                showToast('Agent published successfully!', 'success');
              } catch (error) {
                console.error('Failed to publish agent:', error);
                showToast('Failed to publish agent. Please try again.', 'error');
              }
            }}
          >
            Publish
          </button>
          <button className="btn-primary" onClick={() => navigate('/')}>
            Back to Agents
          </button>
        </div>
      </div>

      <div className="agent-detail-layout">
        {/* Left Panel - Prompt Configuration */}
        <div className="agent-panel agent-panel-left">
          <div className="prompt-header">
            <div className="prompt-controls-compact">
              <div className="control-group-compact">
                <select
                  value={speechSettings.openaiModel || 'gpt-4o-mini'}
                  onChange={(e) => {
                    const newModel = e.target.value;
                    setSpeechSettings({ ...speechSettings, openaiModel: newModel });
                    console.log(`🔄 Model changed to: ${newModel}`);
                    // Auto-save model change immediately
                    if (id) {
                      axios.put(`${API_BASE_URL}/agents/${id}`, {
                        speechSettings: {
                          ...speechSettings,
                          openaiModel: newModel
                        }
                      }).catch(err => console.error('Error saving model:', err));
                    }
                  }}
                  className="control-select-compact"
                >
                  {OPENAI_MODELS.map(model => (
                    <option key={model.id} value={model.id}>{model.name}</option>
                  ))}
                </select>
              </div>

              <div className="control-group-compact">
                <button 
                  className="control-select-compact-btn"
                  onClick={() => setShowVoiceModal(true)}
                >
                  {speechSettings.voiceName || 'Select Voice'}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>
              </div>

              <div className="control-group-compact">
                <select
                  value={speechSettings.language || 'en'}
                  onChange={(e) => setSpeechSettings({ ...speechSettings, language: e.target.value })}
                  className="control-select-compact"
                >
                  {LANGUAGES.map(lang => (
                    <option key={lang.code} value={lang.code}>{lang.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="prompt-editor">
            <div className="prompt-textarea-wrapper">
              <textarea
                className="prompt-textarea"
                value={systemPrompt}
                onChange={(e) => {
                  setSystemPrompt(e.target.value);
                  setPromptHasChanges(e.target.value !== originalPrompt);
                }}
                placeholder="You are a helpful AI agent..."
                rows={30}
              />
              {promptHasChanges && (
                <div className="prompt-buttons-overlay">
                  <button
                    className="btn-revert-prompt"
                    onClick={() => {
                      setSystemPrompt(originalPrompt);
                      setPromptHasChanges(false);
                    }}
                  >
                    Revert
                  </button>
                  <button
                    className="btn-save-prompt"
                    onClick={async () => {
                      try {
                        await axios.put(
                          `${API_BASE_URL}/agents/${id}`,
                          { systemPrompt },
                          { headers: getAuthHeaders() }
                        );
                        setOriginalPrompt(systemPrompt);
                        setPromptHasChanges(false);
                        if (agent) {
                          setAgent({ ...agent, systemPrompt });
                        }
                        showToast('Prompt saved successfully!', 'success');
                      } catch (error) {
                        console.error('Failed to save prompt:', error);
                        showToast('Failed to save prompt. Please try again.', 'error');
                      }
                    }}
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
            
            {/* Welcome Message Section */}
            <div className="welcome-message-section">
              <div className="welcome-message-header">
                <h3>Welcome Message</h3>
                <div className="pause-before-speaking">
                  <label>Pause Before Speaking:</label>
                  <select
                    value={callSettings.pauseBeforeSpeaking || 0}
                    onChange={(e) => setCallSettings({ ...callSettings, pauseBeforeSpeaking: Number(e.target.value) })}
                    className="pause-select"
                  >
                    <option value="0">0s</option>
                    <option value="0.5">0.5s</option>
                    <option value="1">1s</option>
                    <option value="1.5">1.5s</option>
                    <option value="2">2s</option>
                  </select>
                </div>
              </div>
              
              <div className="welcome-message-options">
                {/* AI/User Speaks First Dropdown */}
                <div className="welcome-dropdown-group">
                  <select
                    value={callSettings.aiSpeaksFirst ? 'ai' : 'user'}
                    onChange={(e) => setCallSettings({ ...callSettings, aiSpeaksFirst: e.target.value === 'ai' })}
                    className="welcome-dropdown"
                  >
                    <option value="ai">AI speaks first</option>
                    <option value="user">User speaks first</option>
                  </select>
                </div>
                
                {/* Dynamic vs Custom Message Dropdown - Only show if AI speaks first */}
                {callSettings.aiSpeaksFirst && (
                  <>
                    <div className="welcome-dropdown-group" style={{ marginTop: '1rem' }}>
                      <label>Custom message</label>
                      <select
                        value={callSettings.welcomeMessageType || 'dynamic'}
                        onChange={(e) => setCallSettings({ ...callSettings, welcomeMessageType: e.target.value })}
                        className="welcome-dropdown"
                      >
                        <option value="dynamic">Dynamic message</option>
                        <option value="custom">Custom message</option>
                      </select>
                    </div>
                    
                    {/* Custom Message Input */}
                    {callSettings.welcomeMessageType === 'custom' && (
                      <div className="custom-message-input" style={{ marginTop: '1rem' }}>
                        <input
                          type="text"
                          value={callSettings.customWelcomeMessage || ''}
                          onChange={(e) => setCallSettings({ ...callSettings, customWelcomeMessage: e.target.value })}
                          placeholder="Enter custom welcome message..."
                          className="custom-message-field"
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Middle Panel - Settings */}
        <div className="agent-panel agent-panel-middle">
          <div className="panel-header">
            <h2>Settings</h2>
          </div>
          <div className="settings-list">
            <div className="setting-item">
              <div 
                className="setting-header"
                onClick={() => setExpandedSettings({ ...expandedSettings, knowledgeBase: !expandedSettings.knowledgeBase })}
                style={{ cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="9" y1="3" x2="9" y2="21"></line>
                    <line x1="3" y1="9" x2="21" y2="9"></line>
                  </svg>
                  <span>Knowledge Base</span>
                </div>
                <svg 
                  width="16" 
                  height="16" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2"
                  style={{ transform: expandedSettings.knowledgeBase ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
              {expandedSettings.knowledgeBase && (
                <div className="setting-content">
                  <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1rem' }}>
                    Add knowledge base to provide context to the agent.
                  </p>
                  
                  {/* List of Selected Knowledge Bases */}
                  <div className="kb-list">
                    {selectedKBs.map(kbId => {
                      const kb = knowledgeBases.find(k => (k._id || k.id) === kbId);
                      if (!kb) return null;
                      return (
                        <div 
                          key={kbId} 
                          className="kb-item kb-item-selected"
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                              <line x1="9" y1="3" x2="9" y2="21"></line>
                              <line x1="3" y1="9" x2="21" y2="9"></line>
                            </svg>
                            <span>{kb.name}</span>
                          </div>
                          <button
                            className="kb-delete-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedKBs(selectedKBs.filter(id => id !== kbId));
                              // Also update selectedKB for backward compatibility
                              if (selectedKB === kbId) {
                                setSelectedKB(selectedKBs.length > 1 ? selectedKBs.find(id => id !== kbId) : '');
                              }
                            }}
                            title="Remove knowledge base"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                          </button>
                        </div>
                      );
                    })}
                    {selectedKBs.length === 0 && (
                      <p style={{ fontSize: '0.875rem', color: '#9ca3af', fontStyle: 'italic', padding: '0.5rem' }}>
                        No knowledge bases added
                      </p>
                    )}
                  </div>
                  
                  {/* Add Button with Dropdown */}
                  <div className="kb-add-wrapper" style={{ position: 'relative' }}>
                    <button 
                      className="kb-add-btn"
                      onClick={() => {
                        setShowKBAddDropdown(!showKBAddDropdown);
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                      </svg>
                      Add
                    </button>
                    {showKBAddDropdown && (
                      <div className="kb-add-dropdown">
                        {knowledgeBases
                          .filter(kb => !selectedKBs.includes(kb._id || kb.id))
                          .map(kb => (
                            <div
                              key={kb._id || kb.id}
                              className="kb-dropdown-item"
                              onClick={() => {
                                const kbId = kb._id || kb.id;
                                setSelectedKBs([...selectedKBs, kbId]);
                                // Also update selectedKB for backward compatibility (use first one)
                                if (selectedKBs.length === 0) {
                                  setSelectedKB(kbId);
                                }
                                setShowKBAddDropdown(false);
                              }}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                                <line x1="9" y1="3" x2="9" y2="21"></line>
                                <line x1="3" y1="9" x2="21" y2="9"></line>
                              </svg>
                              <span>{kb.name}</span>
                            </div>
                          ))}
                        {knowledgeBases.filter(kb => !selectedKBs.includes(kb._id || kb.id)).length === 0 && (
                          <div className="kb-dropdown-item" style={{ color: '#9ca3af', fontStyle: 'italic' }}>
                            No more knowledge bases available
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="setting-item">
              <div 
                className="setting-header"
                onClick={() => setExpandedSettings({ ...expandedSettings, speechSettings: !expandedSettings.speechSettings })}
                style={{ cursor: 'pointer' }}
              >
                <span>Speech Settings</span>
                <svg 
                  width="16" 
                  height="16" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2"
                  style={{ transform: expandedSettings.speechSettings ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
              {expandedSettings.speechSettings && (
                <div className="setting-content">
                  {/* Removed LLM Model, Voice, and Language - they're already at the top */}
                  <div className="speech-setting-group">
                    <label>ElevenLabs Model</label>
                    <select
                      value={speechSettings.modelId || 'eleven_turbo_v2'}
                      onChange={(e) => setSpeechSettings({ ...speechSettings, modelId: e.target.value })}
                      className="model-select"
                    >
                      <option value="eleven_turbo_v2">Eleven Turbo v2</option>
                      <option value="eleven_multilingual_v2">Eleven Multilingual v2</option>
                      <option value="eleven_monolingual_v1">Eleven Monolingual v1</option>
                    </select>
                  </div>

                  <div className="speech-setting-group">
                    <label>Stability: {speechSettings.stability || 0.5}</label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={speechSettings.stability || 0.5}
                      onChange={(e) => setSpeechSettings({ ...speechSettings, stability: parseFloat(e.target.value) })}
                      className="slider"
                    />
                  </div>

                  <div className="speech-setting-group">
                    <label>Similarity Boost: {speechSettings.similarityBoost || 0.75}</label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={speechSettings.similarityBoost || 0.75}
                      onChange={(e) => setSpeechSettings({ ...speechSettings, similarityBoost: parseFloat(e.target.value) })}
                      className="slider"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="setting-item">
              <div 
                className="setting-header"
                onClick={() => setExpandedSettings({ ...expandedSettings, callSettings: !expandedSettings.callSettings })}
                style={{ cursor: 'pointer' }}
              >
                <span>Call Settings</span>
                <svg 
                  width="16" 
                  height="16" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2"
                  style={{ transform: expandedSettings.callSettings ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
              {expandedSettings.callSettings && (
                <div className="setting-content">
                  <div className="speech-setting-group">
                    <label>
                      <input
                        type="checkbox"
                        checked={callSettings.aiSpeaksFirst || false}
                        onChange={(e) => setCallSettings({ ...callSettings, aiSpeaksFirst: e.target.checked })}
                        style={{ marginRight: '0.5rem' }}
                      />
                      AI Speaks First
                    </label>
                    <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                      When enabled, the AI will greet the user first when the conversation starts.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="setting-item">
              <div 
                className="setting-header"
                onClick={() => setExpandedSettings({ ...expandedSettings, functions: !expandedSettings.functions })}
                style={{ cursor: 'pointer' }}
              >
                <span>
                  Functions
                </span>
                <svg 
                  width="16" 
                  height="16" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2"
                  style={{ transform: expandedSettings.functions ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
              {expandedSettings.functions && (
                <div className="setting-content">
                  <p style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '1rem' }}>
                    Enable your agent with capabilities such as calendar bookings, call termination, etc.
                  </p>
                  
                  {functions.map((func, index) => (
                    <div key={index} className="function-item" style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between',
                      padding: '0.75rem',
                      background: '#f9fafb',
                      borderRadius: '0.5rem',
                      marginBottom: '0.5rem'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                        </svg>
                        <span style={{ fontWeight: 500 }}>{func.name}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          className="btn-icon"
                          onClick={() => {
                            const newFunctions = [...functions];
                            newFunctions[index] = { ...newFunctions[index], enabled: !newFunctions[index].enabled };
                            setFunctions(newFunctions);
                          }}
                          title={func.enabled ? 'Disable' : 'Enable'}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            {func.enabled ? (
                              <path d="M5 13l4 4L19 7"></path>
                            ) : (
                              <line x1="18" y1="6" x2="6" y2="18"></line>
                            )}
                          </svg>
                        </button>
                        <button
                          className="btn-icon"
                          onClick={() => {
                            const newFunctions = functions.filter((_, i) => i !== index);
                            setFunctions(newFunctions);
                          }}
                          title="Delete"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                  
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      const newFunction = {
                        name: 'end_call',
                        description: 'End the call when user says goodbye, bye, or similar phrases',
                        enabled: true,
                        triggers: ['bye', 'goodbye', 'see you', 'talk later', 'end call', 'hang up'],
                        config: {}
                      };
                      setFunctions([...functions, newFunction]);
                    }}
                    style={{ width: '100%', marginTop: '0.5rem' }}
                  >
                    + Add
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Panel - Test Agent */}
        <div className="agent-panel agent-panel-right">
          <div className="panel-header">
            <h2>Test Agent</h2>
          </div>
          
          <div className="test-agent-content">
            {!isActive ? (
              <div className="test-start">
                <div className="test-icon">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                  </svg>
                </div>
                <p className="test-label">Test your agent</p>
                <button 
                  className="btn-primary btn-test"
                  onClick={startConversation}
                  disabled={isProcessing || isConnecting || isStopping || !systemPrompt.trim()}
                  style={{ 
                    opacity: (isProcessing || isConnecting || isStopping || !systemPrompt.trim()) ? 0.6 : 1,
                    cursor: (isProcessing || isConnecting || isStopping || !systemPrompt.trim()) ? 'not-allowed' : 'pointer'
                  }}
                >
                  {isConnecting ? (
                    <>
                      <span className="spinner" style={{ display: 'inline-block', marginRight: '8px', animation: 'spin 1s linear infinite' }}>⟳</span>
                      Connecting...
                    </>
                  ) : isProcessing ? 'Starting...' : 'Test'}
                </button>
              </div>
            ) : (
              <div className="test-active">
                <div className="test-conversation">
                  {/* Hidden-ish container for LiveKit audio track attachments.
                      Avoid `display:none` because some browsers won't autoplay hidden media. */}
                  <div
                    ref={lkAudioContainerRef}
                    style={{
                      position: 'absolute',
                      width: '1px',
                      height: '1px',
                      overflow: 'hidden',
                      clip: 'rect(0 0 0 0)',
                      clipPath: 'inset(50%)',
                      whiteSpace: 'nowrap'
                    }}
                  />

                  <div className="messages-container">
                    <AnimatePresence mode="popLayout">
                      {messages.map((message) => (
                        <motion.div
                          key={message.id || `msg_${message.role}_${message.content.substring(0, 20)}`}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className={`message ${message.role}`}
                        >
                          <div className="message-content">
                            {message.content}
                          </div>
                        </motion.div>
                      ))}
                      
                      {/* Show assistant draft (sentence-by-sentence) - appears AFTER all messages as TTS speaks */}
                      {assistantDraft && (
                        <motion.div
                          key="assistant-draft"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="message assistant draft"
                        >
                          <div className="message-content">
                            {assistantDraft}
                          </div>
                        </motion.div>
                      )}

                      {/* Show user interim transcript - appears AFTER all messages and assistant draft */}
                      {interimTranscript && (
                        <motion.div
                          key="user-interim"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="message user interim"
                        >
                          <div className="message-content">
                            {interimTranscript}
                            <span className="typing-cursor">|</span>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {isProcessing && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="message assistant processing"
                      >
                        <div className="typing-indicator">
                          <span></span>
                          <span></span>
                          <span></span>
                        </div>
                      </motion.div>
                    )}
                  </div>

                  <div className="listening-indicator" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {isActive && !isProcessing ? (
                        <div className="listening-pulse">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                          </svg>
                          Mic live...
                        </div>
                      ) : (
                        <div className="listening-pulse inactive">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="1" y1="1" x2="23" y2="23"></line>
                          </svg>
                          {isProcessing ? 'Processing...' : 'Not listening'}
                        </div>
                      )}
                    </div>
                    <button 
                      className="btn-secondary btn-small"
                      onClick={stopConversation}
                      disabled={isStopping || isConnecting}
                      style={{ 
                        opacity: (isStopping || isConnecting) ? 0.6 : 1,
                        cursor: (isStopping || isConnecting) ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                      }}
                    >
                      {isStopping ? (
                        <>
                          <span className="spinner" style={{ 
                            display: 'inline-block', 
                            width: '14px', 
                            height: '14px', 
                            border: '2px solid currentColor',
                            borderTopColor: 'transparent',
                            borderRadius: '50%',
                            animation: 'spin 0.6s linear infinite'
                          }}></span>
                          Stopping...
                        </>
                      ) : 'Stop'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <VoiceSelectionModal
        isOpen={showVoiceModal}
        onClose={() => setShowVoiceModal(false)}
        onSelect={(voiceSettings) => {
          // VoiceSelectionModal passes an object with voiceId, voiceName, voiceProvider already set
          console.log('🎤 Voice selected in AgentDetail, received:', voiceSettings);
          // The modal already constructs the full settings object, so we can use it directly
          setSpeechSettings(voiceSettings);
          console.log('🎤 Updated speech settings in AgentDetail:', voiceSettings);
        }}
        currentSettings={speechSettings}
      />

      {/* Toast Notifications */}
      <div className="toast-container">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 50, x: 0 }}
              animate={{ opacity: 1, y: 0, x: 0 }}
              exit={{ opacity: 0, x: 100 }}
              className={`toast toast-${toast.type}`}
            >
              {toast.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      
      {/* Click outside handler for KB dropdown */}
      {showKBAddDropdown && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 99
          }}
          onClick={() => setShowKBAddDropdown(false)}
        />
      )}
    </div>
  );
}

export default AgentDetail;
