import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
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
  
  const audioRef = useRef(null);
  const cuttingAudioRef = useRef(null);
  const recognitionRef = useRef(null);
  const isProcessingRef = useRef(false);
  const pendingMessageRef = useRef(null);
  const messageDebounceTimeoutRef = useRef(null);
  const isActiveRef = useRef(false);
  const wasInterruptedRef = useRef(false);
  const resumeTimeoutRef = useRef(null);
  const isInterruptingRef = useRef(false);
  const originalRecognitionHandlerRef = useRef(null); // Store original recognition handler

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

  const handleUserMessage = useCallback(async (message) => {
    if (!conversationId || isProcessingRef.current) return;
    
    // Don't process empty messages
    if (!message || !message.trim()) return;

    isProcessingRef.current = true;
    setIsProcessing(true);
    setInterimTranscript(''); // Clear interim transcript after finalizing
    setMessages(prev => [...prev, { role: 'user', content: message.trim() }]);

    // Stop recognition while processing
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }

    // Pause any playing audio
    if (audioRef.current && !audioRef.current.paused) {
      const currentTime = audioRef.current.currentTime;
      const audioUrl = audioRef.current.src;
      audioRef.current.pause();
      setPausedAudioState({ currentTime, audioUrl });
    }

    try {
      const response = await axios.post(`${API_BASE_URL}/conversation/chat`, {
        message: message,
        conversationId: conversationId,
        publicToken: token // Include token for public access
      });

      const aiResponse = response.data.text;
      setMessages(prev => [...prev, { role: 'assistant', content: aiResponse }]);

      if (response.data.shouldEndCall) {
        await stopConversation();
        return;
      }

      if (response.data.audioUrl && isActiveRef.current) {
        const audioUrl = toBackendAbsoluteUrl(response.data.audioUrl);
        const audio = audioUrl ? new Audio(audioUrl) : null;
        audioRef.current = audio;

        // Handle interruption detection - check if user speaks while AI is talking
        const checkForInterruption = (event) => {
          if (!audio || audio.paused) return;
          
          let hasSpeech = false;
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i][0].transcript.trim()) {
              hasSpeech = true;
              break;
            }
          }

          if (hasSpeech) {
            wasInterruptedRef.current = true;
            audio.pause();
            if (recognitionRef.current) {
              recognitionRef.current.stop();
            }
            setTimeout(() => {
              if (recognitionRef.current && isActiveRef.current) {
                try {
                  recognitionRef.current.start();
                } catch (e) {}
              }
            }, 100);
          }
        };
        
        // Wrap the original handler to add interruption detection
        const originalOnResult = originalRecognitionHandlerRef.current;
        if (originalOnResult) {
          const wrappedHandler = (event) => {
            // Always call original handler first to process transcript
            originalOnResult(event);
            // Then check for interruption
            checkForInterruption(event);
          };
          
          recognitionRef.current.onresult = wrappedHandler;
        }

        audio && (audio.onended = () => {
          audioRef.current = null;
          // Restore original handler
          if (recognitionRef.current && originalRecognitionHandlerRef.current) {
            recognitionRef.current.onresult = originalRecognitionHandlerRef.current;
          }
          if (isActiveRef.current && !isProcessingRef.current) {
            setIsListening(true);
            setTimeout(() => {
              if (recognitionRef.current && isActiveRef.current) {
                try {
                  recognitionRef.current.start();
                } catch (e) {}
              }
            }, 100);
          }
        });

        audio && (audio.onerror = () => {
          audioRef.current = null;
          // Restore original handler
          if (recognitionRef.current && originalRecognitionHandlerRef.current) {
            recognitionRef.current.onresult = originalRecognitionHandlerRef.current;
          }
          if (isActiveRef.current && !isProcessingRef.current) {
            setIsListening(true);
            setTimeout(() => {
              if (recognitionRef.current && isActiveRef.current) {
                try {
                  recognitionRef.current.start();
                } catch (e) {}
              }
            }, 100);
          }
        });

        // Handle interruption
        audio && (audio.onplay = () => {
          wasInterruptedRef.current = false;
        });

        audio && (audio.onpause = () => {
          if (wasInterruptedRef.current && pausedAudioState) {
            audio.currentTime = pausedAudioState.currentTime;
          }
        });

        audio?.play().catch(() => {
          audioRef.current = null;
          if (isActiveRef.current && !isProcessingRef.current) {
            setIsListening(true);
            setTimeout(() => {
              if (recognitionRef.current && isActiveRef.current) {
                try {
                  recognitionRef.current.start();
                } catch (e) {}
              }
            }, 100);
          }
        });
      } else {
        setIsListening(true);
        setTimeout(() => {
          if (recognitionRef.current && isActiveRef.current) {
            try {
              recognitionRef.current.start();
            } catch (e) {}
          }
        }, 100);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setIsListening(true);
      setTimeout(() => {
        if (recognitionRef.current && isActiveRef.current) {
          try {
            recognitionRef.current.start();
          } catch (e) {}
        }
      }, 100);
    } finally {
      isProcessingRef.current = false;
      setIsProcessing(false);
    }
  }, [conversationId, token]);

  // Initialize speech recognition
  useEffect(() => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      console.warn('Speech recognition not supported');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = agent?.speechSettings?.language || 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onend = () => {
      setIsListening(false);
      if (isActiveRef.current && !isProcessingRef.current) {
        setTimeout(() => {
          if (recognitionRef.current && isActiveRef.current) {
            try {
              recognitionRef.current.start();
            } catch (e) {
              console.log('Recognition already running');
            }
          }
        }, 100);
      }
    };

    // Main recognition result handler - processes transcripts
    const handleRecognitionResult = (event) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript + ' ';
        } else {
          interim += transcript;
        }
      }

      setInterimTranscript(interim);

      if (final.trim()) {
        if (messageDebounceTimeoutRef.current) {
          clearTimeout(messageDebounceTimeoutRef.current);
        }

        messageDebounceTimeoutRef.current = setTimeout(() => {
          if (final.trim() && !isProcessingRef.current) {
            handleUserMessage(final.trim());
          }
        }, 500);
      }
    };
    
    recognition.onresult = handleRecognitionResult;
    // Store the recognition object and the original handler
    recognitionRef.current = recognition;
    originalRecognitionHandlerRef.current = handleRecognitionResult;

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'no-speech') {
        // Restart recognition if no speech detected
        if (isActiveRef.current && !isProcessingRef.current) {
          setTimeout(() => {
            if (recognitionRef.current && isActiveRef.current) {
              try {
                recognitionRef.current.start();
              } catch (e) {}
            }
          }, 1000);
        }
      }
    };

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [agent, handleUserMessage]);

  const startConversation = async () => {
    if (!agent || !agent.systemPrompt?.trim()) {
      alert('Agent is not properly configured');
      return;
    }

    try {
      isProcessingRef.current = true;
      setIsProcessing(true);
      
      const response = await axios.post(`${API_BASE_URL}/conversation/start`, {
        systemPrompt: agent.systemPrompt.trim(),
        agentId: agent.id,
        knowledgeBaseId: agent.knowledgeBaseId || null,
        aiSpeaksFirst: agent.callSettings?.aiSpeaksFirst || false,
        publicToken: token // Include token for public access
      });

      setConversationId(response.data.conversationId);
      setIsActive(true);
      isActiveRef.current = true;
      setMessages([]);
      setInterimTranscript('');

      isProcessingRef.current = false;
      setIsProcessing(false);

      // If AI should speak first
      if (agent.callSettings?.aiSpeaksFirst && response.data.initialGreeting) {
        setMessages(prev => [...prev, { role: 'assistant', content: response.data.initialGreeting }]);

        if (response.data.initialAudioUrl && isActiveRef.current) {
          const audioUrl = toBackendAbsoluteUrl(response.data.initialAudioUrl);
          const audio = audioUrl ? new Audio(audioUrl) : null;
          audioRef.current = audio;

          audio && (audio.onended = () => {
            audioRef.current = null;
            if (isActiveRef.current && !isProcessingRef.current) {
              setIsListening(true);
              setTimeout(() => {
                if (recognitionRef.current && isActiveRef.current) {
                  try {
                    recognitionRef.current.start();
                  } catch (e) {}
                }
              }, 100);
            }
          });

          audio?.play().catch(() => {
            audioRef.current = null;
            if (isActiveRef.current && !isProcessingRef.current) {
              setIsListening(true);
            }
          });
        } else {
          setIsListening(true);
        }
      } else {
        setIsListening(true);
        setTimeout(() => {
          if (recognitionRef.current && isActiveRef.current) {
            try {
              recognitionRef.current.start();
            } catch (e) {}
          }
        }, 300);
      }
    } catch (error) {
      console.error('Error starting conversation:', error);
      alert('Failed to start conversation');
      isProcessingRef.current = false;
      setIsProcessing(false);
    }
  };

  const stopConversation = async () => {
    isActiveRef.current = false;
    isProcessingRef.current = false;
    setIsActive(false);
    setIsListening(false);
    setIsProcessing(false);
    setInterimTranscript('');
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (cuttingAudioRef.current) {
      cuttingAudioRef.current.pause();
      cuttingAudioRef.current = null;
    }
    setPausedAudioState(null);
    wasInterruptedRef.current = false;

    if (conversationId) {
      try {
        await axios.post(`${API_BASE_URL}/conversation/${conversationId}/end`, {
          endReason: 'user_hangup',
          publicToken: token // Include token for public access
        });
      } catch (error) {
        console.error('Error ending call:', error);
      }
    }
  };

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
              disabled={isProcessing}
            >
              {isProcessing ? 'Starting...' : 'Start Conversation'}
            </button>
          </div>
        ) : (
          <>
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
