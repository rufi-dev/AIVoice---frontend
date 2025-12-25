import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Room, RoomEvent, createLocalAudioTrack } from 'livekit-client';
import './PublicAgentTest.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

function getApiOrigin() {
  try {
    const origin = new URL(API_BASE_URL).origin;
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      throw new Error('Invalid API origin (localhost)');
    }
    return origin;
  } catch (e) {
    try {
      const { protocol, hostname } = window.location;
      if (hostname.startsWith('dashboard.')) {
        return `${protocol}//api.${hostname.slice('dashboard.'.length)}`;
      }
      if (hostname.startsWith('api.')) {
        return `${protocol}//${hostname}`;
      }
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
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;

  let p = raw;
  if (p.startsWith('/.rapidcallai.com/')) {
    p = p.replace('/.rapidcallai.com', '');
  }
  p = p.replace('/api/api/', '/api/');
  if (!p.startsWith('/')) p = `/${p}`;
  return p;
}

function toBackendAbsoluteUrl(pathOrUrl) {
  const normalized = normalizeBackendPath(pathOrUrl);
  if (!normalized) return null;
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) return normalized;
  return `${getApiOrigin()}${normalized}`;
}

function PublicAgentTest() {
  const { token } = useParams();
  const [agent, setAgent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isActive, setIsActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [pausedAudioState, setPausedAudioState] = useState(null);
  const [realtimeState, setRealtimeState] = useState({
    status: 'idle',
    roomName: null,
    identity: null,
    callId: null,
    error: null,
    userSpeaking: false,
    agentSpeaking: false
  });
  const [isConnecting, setIsConnecting] = useState(false);
  const [livekitStats, setLivekitStats] = useState({ rtt: null, e2e: null });
  
  const audioRef = useRef(null);
  const cuttingAudioRef = useRef(null);
  const lkRoomRef = useRef(null);
  const lkMicTrackRef = useRef(null);
  const lkAudioContainerRef = useRef(null);
  const lkLastTurnRef = useRef({ turnId: null, vadEndAt: null });
  const lkSentPlayoutRef = useRef(new Set());
  const lkConfigAckRef = useRef(false);
  const isProcessingRef = useRef(false);
  const isActiveRef = useRef(false);

  useEffect(() => {
    if (token) {
      fetchAgent();
    }
  }, [token]);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);


  const fetchAgent = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_BASE_URL}/public/agent/${token}`);
      setAgent(response.data);
      setError(null);
    } catch (err) {
      console.error('Error fetching agent:', err);
      setError('Agent not found or not publicly accessible');
    } finally {
      setLoading(false);
    }
  };

  // SpeechRecognition removed - using WebRTC only

  const startConversation = async () => {
    return startRealtimeCall();
  };

  const stopConversation = async () => {
    try {
      try {
        lkMicTrackRef.current?.stop?.();
      } catch (e) {}
      lkMicTrackRef.current = null;
      try {
        lkRoomRef.current?.disconnect?.();
      } catch (e) {}
      lkRoomRef.current = null;
      if (lkAudioContainerRef.current) lkAudioContainerRef.current.innerHTML = '';

      if (realtimeState?.callId || realtimeState?.roomName) {
        try {
          await axios.post(`${API_BASE_URL}/realtime/end`, {
            callId: realtimeState.callId,
            roomName: realtimeState.roomName,
            endReason: 'user_hangup',
            publicToken: token,
            agentId: agent?.id
          });
        } catch (e) {}
      }
    } finally {
      isActiveRef.current = false;
      isProcessingRef.current = false;
      setIsActive(false);
      setIsListening(false);
      setIsProcessing(false);
      setInterimTranscript('');
      setMessages([]);
      setConversationId(null);
      setRealtimeState((s) => ({ ...s, status: 'ended', userSpeaking: false, agentSpeaking: false }));
    }
  };

  const startRealtimeCall = useCallback(async () => {
    if (!agent?.id) {
      alert('Agent not loaded');
      return;
    }
    try {
      // stop any existing state
      await stopConversation();
      
      setIsConnecting(true);
      setIsProcessing(true);

      setRealtimeState({
        status: 'connecting',
        roomName: null,
        identity: null,
        callId: null,
        error: null,
        userSpeaking: false,
        agentSpeaking: false
      });
      lkConfigAckRef.current = false;

      // Get token first (needed for roomName)
      const tokenResp = await axios.post(`${API_BASE_URL}/realtime/token`, {
        agentId: agent.id,
        publicToken: token,
        provider: 'web'
      });
      const { livekitUrl, accessToken, roomName, identity } = tokenResp.data || {};
      if (!livekitUrl || !accessToken || !roomName) throw new Error('Realtime token response missing fields');

      // Parallelize start request and config fetch
      const [startResp, cfgResp] = await Promise.all([
        axios.post(`${API_BASE_URL}/realtime/start`, {
          agentId: agent.id,
          publicToken: token,
          provider: 'web',
          roomName
        }),
        axios.post(`${API_BASE_URL}/realtime/config`, {
          agentId: agent.id,
          systemPrompt: agent.systemPrompt?.trim?.() || '',
          knowledgeBaseId: agent.knowledgeBaseId || null,
          publicToken: token
        })
      ]);
      const callId = startResp.data?.callId || null;

      const room = new Room({ adaptiveStream: true, dynacast: true });
      lkRoomRef.current = room;
      
      // Set up latency polling
      const statsInterval = setInterval(async () => {
        try {
          if (room && room.engine) {
            const stats = await room.engine.client.getStats();
            if (stats && stats.subscribedCodecs) {
              // Get RTT from remote track stats
              let rtt = null;
              for (const codec of stats.subscribedCodecs || []) {
                if (codec.remoteTrackStats && codec.remoteTrackStats.length > 0) {
                  const trackStats = codec.remoteTrackStats[0];
                  if (trackStats.rtt) {
                    rtt = trackStats.rtt;
                    break;
                  }
                }
              }
              setLivekitStats(prev => ({ ...prev, rtt }));
            }
          }
        } catch (e) {
          // Ignore errors
        }
      }, 500);
      
      // Clean up interval on disconnect
      room.on(RoomEvent.Disconnected, () => {
        clearInterval(statsInterval);
        setRealtimeState((s) => ({ ...s, status: 'ended', userSpeaking: false, agentSpeaking: false }));
      });

      room.on(RoomEvent.TrackSubscribed, (track) => {
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
            await axios.post(`${API_BASE_URL}/realtime/metrics`, {
              callId,
              roomName,
              agentId: agent.id,
              publicToken: token,
              turn: {
                turnId,
                vadEndAt,
                clientPlayoutStartAt: now,
                vadEndToPlayoutStartMs
              }
            });
          } catch (e) {}
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
        const agentSpeaking = Array.from(ids).some((i) => i && i !== localId);
        setRealtimeState((s) => ({ ...s, userSpeaking, agentSpeaking }));
      });

      // Built-in LiveKit transcription (delta segments) – lets us render assistant text while it speaks.
      room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
        try {
          const pid = participant?.identity ? String(participant.identity) : '';
          const isAssistant = pid && !pid.startsWith('web_');
          if (!isAssistant) return;

          const text = (segments || [])
            .map((s) => (s?.text ? String(s.text) : ''))
            .join('')
            .trim();
          if (!text) return;

          const isFinal = (segments || []).every((s) => !!s?.final);
          if (isFinal) {
            setMessages((prev) => [...prev, { role: 'assistant', content: text }]);
          }
        } catch (e) {}
      });

      room.on(RoomEvent.DataReceived, async (payload) => {
        try {
          const txt = new TextDecoder().decode(payload);
          const evt = JSON.parse(txt);
          if (!evt || typeof evt !== 'object') return;

          if (evt.type === 'agent_config_ack') {
            // Config ack received
            lkConfigAckRef.current = true;
            return;
          }

          // Transcript events (sent via data channel)
          if (evt.type === 'transcript' && typeof evt.text === 'string' && evt.text.trim()) {
            const role = evt.role === 'user' ? 'user' : 'assistant';
            const text = evt.text.trim();
            
            // Filter out system messages
            const systemMessagePatterns = [
              /^\(voice agent connected\)$/i,
              /^\(agent config received\)$/i,
              /^\(agent.*connected\)$/i,
              /^\(.*config.*received\)$/i
            ];
            const isSystemMessage = systemMessagePatterns.some(pattern => pattern.test(text));
            if (isSystemMessage) {
              return;
            }
            
            if (evt.final === false) {
              // Partial transcript - word-by-word streaming
              if (role === 'user') {
                setInterimTranscript(text);
              }
            } else {
              // Final transcript
              if (role === 'user') {
                setInterimTranscript('');
                setMessages((prev) => [...prev, { role, content: text }]);
              } else {
                setMessages((prev) => [...prev, { role, content: text }]);
              }
            }
          }

          if (evt.turnId) lkLastTurnRef.current.turnId = String(evt.turnId);
          if (typeof evt.vadEndAt === 'number') lkLastTurnRef.current.vadEndAt = evt.vadEndAt;
          
          // Update E2E latency from metrics
          if (typeof evt.vadEndAt === 'number' && typeof evt.ttsFirstFrameAt === 'number') {
            const e2e = evt.ttsFirstFrameAt - evt.vadEndAt;
            setLivekitStats(prev => ({ ...prev, e2e }));
          }
          
          if (evt.turnId && (typeof evt.vadEndAt === 'number' || typeof evt.ttsFirstFrameAt === 'number' || typeof evt.llmFirstTokenAt === 'number')) {
            await axios.post(`${API_BASE_URL}/realtime/metrics`, {
              callId,
              roomName,
              agentId: agent.id,
              publicToken: token,
              turn: {
                turnId: String(evt.turnId),
                vadEndAt: typeof evt.vadEndAt === 'number' ? evt.vadEndAt : undefined,
                llmFirstTokenAt: typeof evt.llmFirstTokenAt === 'number' ? evt.llmFirstTokenAt : undefined,
                ttsFirstFrameAt: typeof evt.ttsFirstFrameAt === 'number' ? evt.ttsFirstFrameAt : undefined
              }
            });
          }
        } catch (e) {}
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

      setRealtimeState((s) => ({ ...s, status: 'connected', roomName, identity: identity || null, callId }));

      // Send config payload (reduced wait time)
      try {
        const cfg = cfgResp?.data || {};
        const cfgPayload = new TextEncoder().encode(
          JSON.stringify({
            type: 'agent_config',
            agentId: String(agent.id),
            finalSystemPrompt: cfg.finalSystemPrompt || '',
            speechSettings: cfg.speechSettings || {},
            callSettings: cfg.callSettings || {}
          })
        );

        // Reduced wait time: max 3s with 200ms intervals
        const startedAt = Date.now();
        let configAck = false;
        while (!configAck && Date.now() - startedAt < 3000) {
          await room.localParticipant.publishData(cfgPayload, { reliable: true, topic: 'agent_config' });
          await new Promise((r) => setTimeout(r, 200));
          // Check if ack received (would need to track this via data channel)
        }
      } catch (e) {
        // best-effort
      }
      
      setIsConnecting(false);
      setIsActive(true);
      isActiveRef.current = true;
      setIsListening(true);
      setIsProcessing(false);
    } catch (err) {
      console.error('Public realtime start failed:', err);
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
  }, [agent?.id, stopConversation, token]);

  if (loading) {
    return (
      <div className="public-agent-container">
        <div className="public-agent-loading">Loading agent...</div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="public-agent-container">
        <div className="public-agent-error">
          <h2>Agent Not Found</h2>
          <p>{error || 'The agent you are looking for is not available.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="public-agent-container">
      <div className="public-agent-header">
        <h1>{agent.name}</h1>
        <p className="public-agent-subtitle">Voice Assistant</p>
      </div>

      <div className="public-agent-content">
        {!isActive ? (
          <div className="public-agent-start">
            <button
              className="public-start-btn"
              onClick={startConversation}
              disabled={isProcessing || isConnecting}
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
          <>
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
            <div className="public-agent-messages">
              {messages.map((msg, idx) => (
                <div key={idx} className={`public-message ${msg.role}`}>
                  <div className="public-message-content">{msg.content}</div>
                </div>
              ))}
              {interimTranscript && (
                <div className="public-message user interim">
                  <div className="public-message-content">{interimTranscript}</div>
                </div>
              )}
            </div>

            <div className="public-agent-controls">
              <div className="public-status">
                {isListening && !isProcessing && (
                  <span className="public-status-indicator listening">Listening...</span>
                )}
                {isProcessing && (
                  <span className="public-status-indicator processing">Processing...</span>
                )}
                {!isListening && !isProcessing && isActive && (
                  <span className="public-status-indicator waiting">Waiting...</span>
                )}
              </div>
              <button
                className="public-stop-btn"
                onClick={stopConversation}
              >
                End Call
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default PublicAgentTest;
