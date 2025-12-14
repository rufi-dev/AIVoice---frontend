import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import VoiceSelectionModal from '../components/VoiceSelectionModal';
import './AgentDetail.css';

// Get API base URL from environment variable or use localhost for development
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
// Helper to get full backend URL (without /api) for absolute URLs
const BACKEND_URL = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000';

const OPENAI_MODELS = [
  { id: 'gpt-4', name: 'GPT-4' },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
  { id: 'gpt-4o', name: 'GPT-4o' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
  { id: 'gpt-4-1106-preview', name: 'GPT-4 1106 Preview' },
  { id: 'gpt-4-0125-preview', name: 'GPT-4 0125 Preview' }
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
  const [pausedAudioState, setPausedAudioState] = useState(null);
  const [knowledgeBases, setKnowledgeBases] = useState([]);
  const [selectedKB, setSelectedKB] = useState('');
  const [expandedSettings, setExpandedSettings] = useState({
    knowledgeBase: true,
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
    aiSpeaksFirst: true
  });
  
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

  useEffect(() => {
    fetchAgent();
    fetchKnowledgeBases();
  }, [id]);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  const fetchAgent = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/agents/${id}`);
      setAgent(response.data);
      setSystemPrompt(response.data.systemPrompt || '');
      setSelectedKB(response.data.knowledgeBaseId || '');
      
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
        setCallSettings(response.data.callSettings);
      }
      if (response.data.functions && response.data.functions.length > 0) {
        console.log('📋 Loaded functions from agent:', response.data.functions);
        setFunctions(response.data.functions);
      } else {
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

  const stopAudioAndResumeListening = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    
    if (isActiveRef.current && !isProcessingRef.current) {
      setIsListening(true);
      setTimeout(() => {
        if (recognitionRef.current && isActiveRef.current && !isProcessingRef.current) {
          try {
            recognitionRef.current.start();
          } catch (e) {
            console.log('Recognition already running');
          }
        }
      }, 200);
    }
  }, []);

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

    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    try {
      // Get streaming response from backend
      const response = await axios.post(`${API_BASE_URL}/conversation/chat`, {
        message: userMessage,
        conversationId: conversationId,
        agentId: id
      });

      const aiResponse = response.data.text;
      const audioUrl = response.data.audioUrl;
      const shouldEndCall = response.data.shouldEndCall || false;

      console.log('📥 Response received:', { 
        hasText: !!aiResponse, 
        hasAudio: !!audioUrl, 
        shouldEndCall 
      });

      // Always show the response - the interruption flag was just for tracking
      // Reset the interruption flag after we get the response
      const wasInterruption = isInterruptingRef.current;
      isInterruptingRef.current = false;

      // Show full response immediately
      setMessages(prev => [...prev, { role: 'assistant', content: aiResponse }]);
      
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

      // Play audio response - but keep listening while playing
      // Ensure only one audio plays at a time - stop any existing audio first
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (cuttingAudioRef.current) {
        cuttingAudioRef.current.pause();
        cuttingAudioRef.current = null;
      }
      
      if (audioUrl && isActiveRef.current) {
        // Audio URL is now /api/audio/{fileId} from MongoDB GridFS
        const fullAudioUrl = audioUrl.startsWith('http') 
          ? audioUrl 
          : `${BACKEND_URL}${audioUrl}`;
        const audio = new Audio(fullAudioUrl);
        audioRef.current = audio;

        // Always restart listening after we get a response (even while processing)
        // This ensures we can capture the next user message
        setIsListening(true);
        setTimeout(() => {
          if (recognitionRef.current && isActiveRef.current) {
            try {
              recognitionRef.current.start();
            } catch (e) {
              // Recognition might already be running, that's fine
              console.log('Recognition already running or starting');
            }
          }
        }, 100);

        audio.onended = () => {
          audioRef.current = null;
          // Always restart listening after audio ends
          if (isActiveRef.current) {
            setIsListening(true);
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

        audio.onerror = () => {
          audioRef.current = null;
          // Always restart listening even if audio fails
          if (isActiveRef.current) {
            setIsListening(true);
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

        audio.onpause = () => {
          // Don't clear audioRef on pause - we might resume it
        };

        audio.play().catch(() => {
          audioRef.current = null;
          // Always restart listening even if play fails
          if (isActiveRef.current) {
            setIsListening(true);
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
        });
      } else {
        // No audio, but always keep listening
        if (isActiveRef.current) {
          setIsListening(true);
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
      }
    } catch (error) {
      console.error('Error in chat:', error);
      alert('Failed to get AI response');
      // Don't use stopAudioAndResumeListening here - it might have conditions
      // Just ensure listening restarts
      if (isActiveRef.current) {
        setIsListening(true);
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
    } finally {
      isProcessingRef.current = false;
      setIsProcessing(false);
      isInterruptingRef.current = false;
      
      // Always ensure listening is active after processing completes
      // This is critical to ensure the AI responds to subsequent messages
      if (isActiveRef.current) {
        setIsListening(true);
        setTimeout(() => {
          if (recognitionRef.current && isActiveRef.current) {
            try {
              recognitionRef.current.start();
            } catch (e) {
              // Recognition might already be running, that's fine
              console.log('Recognition restart in finally - already running');
            }
          }
        }, 200);
      }
    }
  }, [conversationId, id, stopAudioAndResumeListening]);

  // Update recognition language when speech settings change
  useEffect(() => {
    if (recognitionRef.current && speechSettings.language) {
      const langCode = speechSettings.language || 'en';
      const langMap = {
        'en': 'en-US',
        'es': 'es-ES',
        'fr': 'fr-FR',
        'de': 'de-DE',
        'it': 'it-IT',
        'pt': 'pt-PT',
        'zh': 'zh-CN',
        'ja': 'ja-JP',
        'ko': 'ko-KR',
        'ru': 'ru-RU',
        'ar': 'ar-SA',
        'hi': 'hi-IN'
      };
      recognitionRef.current.lang = langMap[langCode] || 'en-US';
    }
  }, [speechSettings.language]);

  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true; // Keep listening continuously
      recognitionRef.current.interimResults = true;
      
      // Set recognition language based on speech settings
      const langCode = speechSettings.language || 'en';
      const langMap = {
        'en': 'en-US',
        'es': 'es-ES',
        'fr': 'fr-FR',
        'de': 'de-DE',
        'it': 'it-IT',
        'pt': 'pt-PT',
        'zh': 'zh-CN',
        'ja': 'ja-JP',
        'ko': 'ko-KR',
        'ru': 'ru-RU',
        'ar': 'ar-SA',
        'hi': 'hi-IN'
      };
      recognitionRef.current.lang = langMap[langCode] || 'en-US';

      recognitionRef.current.onresult = async (event) => {
        let interim = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript.trim();
          if (event.results[i].isFinal) {
            final += transcript + ' ';
          } else {
            interim += transcript;
          }
        }

        if (interim) {
          setInterimTranscript(interim);
        }

        // Handle interruption with cutting phrase
        const isMainAudioPlaying = audioRef.current && audioRef.current.currentTime > 0;
        
        if (interim && isMainAudioPlaying && !wasInterruptedRef.current) {
          wasInterruptedRef.current = true;
          
          // Clear any existing resume timeout
          if (resumeTimeoutRef.current) {
            clearTimeout(resumeTimeoutRef.current);
            resumeTimeoutRef.current = null;
          }
          
          // Save current audio state for potential resume (only if main audio is playing)
          if (isMainAudioPlaying) {
            const currentTime = audioRef.current.currentTime;
            const audioUrl = audioRef.current.src;
            setPausedAudioState({ currentTime, audioUrl });
            
            // Pause the main audio
            audioRef.current.pause();
          }
          
          // Generate and play cutting phrase
          try {
            const cuttingResponse = await axios.post(`${API_BASE_URL}/conversation/cutting-phrase`, {
              conversationId: conversationId,
              agentId: id
            });
            
            if (cuttingResponse.data.audioUrl && isActiveRef.current) {
              // Audio URL is now /api/audio/{fileId} from MongoDB GridFS
              const cuttingAudioUrl = cuttingResponse.data.audioUrl.startsWith('http') 
                ? cuttingResponse.data.audioUrl 
                : `${BACKEND_URL}${cuttingResponse.data.audioUrl}`;
              const cuttingAudio = new Audio(cuttingAudioUrl);
              cuttingAudioRef.current = cuttingAudio;
              
              cuttingAudio.onended = () => {
                cuttingAudioRef.current = null;
              };
              
              cuttingAudio.play().catch(() => {
                cuttingAudioRef.current = null;
              });
            }
          } catch (error) {
            console.error('Error generating cutting phrase:', error);
          }
        }

        // Clear resume timeout when user is speaking
        if (interim || final) {
          if (resumeTimeoutRef.current) {
            clearTimeout(resumeTimeoutRef.current);
            resumeTimeoutRef.current = null;
          }
        }

        if (final.trim()) {
          setInterimTranscript('');
          
          // Clear any pending debounce timeout
          if (messageDebounceTimeoutRef.current) {
            clearTimeout(messageDebounceTimeoutRef.current);
            messageDebounceTimeoutRef.current = null;
          }
          
          // Debounce rapid speech results - wait 300ms to see if more speech comes
          // This prevents processing multiple messages when user speaks in quick succession
          const messageToProcess = final.trim();
          pendingMessageRef.current = messageToProcess;
          
          messageDebounceTimeoutRef.current = setTimeout(() => {
            const message = pendingMessageRef.current;
            pendingMessageRef.current = null;
            messageDebounceTimeoutRef.current = null;
            
            if (!message) return;
            
            // Clear paused audio state since we're processing a new message
            if (resumeTimeoutRef.current) {
              clearTimeout(resumeTimeoutRef.current);
              resumeTimeoutRef.current = null;
            }
            setPausedAudioState(null);
            wasInterruptedRef.current = false;
            
            // Prevent duplicate processing - only process if not already processing
            // This prevents multiple API calls when user speaks in quick succession
            if (!isProcessingRef.current) {
              // Process the message
              handleUserMessage(message);
            } else {
              // If already processing, ignore this message
              console.log('⚠️ Ignoring message while processing:', message);
            }
          }, 300); // 300ms debounce - wait for more speech
        }
      };

      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
        setInterimTranscript('');
        
        if (event.error === 'no-speech') {
          if (isActiveRef.current && !isProcessingRef.current) {
            setTimeout(() => {
              if (recognitionRef.current && isActiveRef.current && !isProcessingRef.current) {
                try {
                  recognitionRef.current.start();
                } catch (e) {}
              }
            }, 500);
          }
        }
      };

      recognitionRef.current.onend = () => {
        // If audio was interrupted and user stopped speaking, resume it
        if (wasInterruptedRef.current && pausedAudioState && !isProcessingRef.current) {
          // Wait a bit to see if user starts speaking again
          resumeTimeoutRef.current = setTimeout(() => {
            if (wasInterruptedRef.current && pausedAudioState && !isProcessingRef.current && isActiveRef.current) {
              wasInterruptedRef.current = false;
              const audio = new Audio(pausedAudioState.audioUrl);
              audioRef.current = audio;
              audio.currentTime = pausedAudioState.currentTime;
              
              audio.onended = () => {
                audioRef.current = null;
                // Keep listening after audio ends
                if (isActiveRef.current && !isProcessingRef.current) {
                  setIsListening(true);
                  setTimeout(() => {
                    if (recognitionRef.current && isActiveRef.current && !isProcessingRef.current) {
                      try {
                        recognitionRef.current.start();
                      } catch (e) {}
                    }
                  }, 100);
                }
              };

              audio.onerror = () => {
                audioRef.current = null;
                if (isActiveRef.current && !isProcessingRef.current) {
                  setIsListening(true);
                  setTimeout(() => {
                    if (recognitionRef.current && isActiveRef.current && !isProcessingRef.current) {
                      try {
                        recognitionRef.current.start();
                      } catch (e) {}
                    }
                  }, 100);
                }
              };

              audio.onpause = () => {
                // Don't clear audioRef on pause
              };

              audio.play().catch(() => {
                audioRef.current = null;
                if (isActiveRef.current && !isProcessingRef.current) {
                  setIsListening(true);
                  setTimeout(() => {
                    if (recognitionRef.current && isActiveRef.current && !isProcessingRef.current) {
                      try {
                        recognitionRef.current.start();
                      } catch (e) {}
                    }
                  }, 100);
                }
              });
              
              setPausedAudioState(null);
              resumeTimeoutRef.current = null;
            }
          }, 1500); // Wait 1.5 seconds after user stops speaking
        }
        
        // Always restart recognition if active (even if processing, so we can capture interruptions)
        if (isActiveRef.current) {
          setTimeout(() => {
            if (recognitionRef.current && isActiveRef.current) {
              try {
                recognitionRef.current.start();
              } catch (e) {
                // Recognition might already be running, that's okay
                console.log('Recognition already running in onend');
              }
            }
          }, 100);
        }
      };
    }
  }, [isListening, handleUserMessage]);

  const startConversation = async () => {
    if (!systemPrompt.trim()) {
      alert('Please enter a system prompt for the agent');
      return;
    }

    try {
      isProcessingRef.current = true;
      setIsProcessing(true);
      
      const response = await axios.post(`${API_BASE_URL}/conversation/start`, {
        systemPrompt: systemPrompt.trim(),
        agentId: id,
        knowledgeBaseId: selectedKB || null,
        aiSpeaksFirst: callSettings.aiSpeaksFirst || false
      });

      setConversationId(response.data.conversationId);
      setIsActive(true);
      isActiveRef.current = true;
      setMessages([]);
      setInterimTranscript('');

      isProcessingRef.current = false;
      setIsProcessing(false);

      // If AI should speak first, play the initial greeting
      if (callSettings.aiSpeaksFirst && response.data.initialGreeting) {
        setMessages(prev => [...prev, { role: 'assistant', content: response.data.initialGreeting }]);

        if (response.data.initialAudioUrl && isActiveRef.current) {
          // Audio URL is now /api/audio/{fileId} from MongoDB GridFS
          const audioUrl = response.data.initialAudioUrl.startsWith('http') 
            ? response.data.initialAudioUrl 
            : `${BACKEND_URL}${response.data.initialAudioUrl}`;
          const audio = new Audio(audioUrl);
          audioRef.current = audio;

          audio.onended = () => {
            audioRef.current = null;
            if (isActiveRef.current && !isProcessingRef.current) {
              setIsListening(true);
              setTimeout(() => {
                if (recognitionRef.current && isActiveRef.current && !isProcessingRef.current) {
                  try {
                    recognitionRef.current.start();
                  } catch (e) {}
                }
              }, 100);
            }
          };

          audio.onerror = () => {
            audioRef.current = null;
            if (isActiveRef.current && !isProcessingRef.current) {
              setIsListening(true);
              setTimeout(() => {
                if (recognitionRef.current && isActiveRef.current && !isProcessingRef.current) {
                  try {
                    recognitionRef.current.start();
                  } catch (e) {}
                }
              }, 100);
            }
          };

          audio.onpause = () => {
            // Don't clear audioRef on pause
          };

          audio.play().catch(() => {
            audioRef.current = null;
            if (isActiveRef.current && !isProcessingRef.current) {
              setIsListening(true);
              setTimeout(() => {
                if (recognitionRef.current && isActiveRef.current && !isProcessingRef.current) {
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
            if (recognitionRef.current && isActiveRef.current && !isProcessingRef.current) {
              try {
                recognitionRef.current.start();
              } catch (e) {}
            }
          }, 100);
        }
      } else {
        // User starts first - just start listening
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
    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current);
      resumeTimeoutRef.current = null;
    }

    // End the call and save to history
    if (conversationId) {
      try {
        await axios.post(`${API_BASE_URL}/conversation/${conversationId}/end`, {
          endReason: 'user_hangup'
        });
      } catch (error) {
        console.error('Error ending call:', error);
      }
    }
  };

  if (!agent) {
    return <div className="agent-detail-loading">Loading...</div>;
  }

  return (
    <div className="agent-detail-container">
      <div className="agent-detail-header">
        <div className="agent-detail-title">
          <h1>{agent.name}</h1>
        </div>
        <div className="agent-detail-actions">
          <button className="btn-secondary" onClick={saveAgent}>
            Save
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
            <div className="prompt-controls">
              <div className="control-group">
                <label>LLM</label>
                <div className="control-select-wrapper">
                  <select
                    value={speechSettings.openaiModel || 'gpt-4'}
                    onChange={(e) => setSpeechSettings({ ...speechSettings, openaiModel: e.target.value })}
                    className="control-select"
                  >
                    {OPENAI_MODELS.map(model => (
                      <option key={model.id} value={model.id}>{model.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="control-group">
                <label>Voice</label>
                <div className="control-select-wrapper">
                  <button 
                    className="control-select-btn"
                    onClick={() => setShowVoiceModal(true)}
                  >
                    {speechSettings.voiceName || 'Select Voice'}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                  </button>
                </div>
              </div>

              <div className="control-group">
                <label>Language</label>
                <div className="control-select-wrapper">
                  <select
                    value={speechSettings.language || 'en'}
                    onChange={(e) => setSpeechSettings({ ...speechSettings, language: e.target.value })}
                    className="control-select"
                  >
                    {LANGUAGES.map(lang => (
                      <option key={lang.code} value={lang.code}>{lang.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div className="prompt-editor">
            <div className="prompt-label">## ROLE</div>
            <textarea
              className="prompt-textarea"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are a helpful AI agent..."
              rows={30}
            />
          </div>
        </div>

        {/* Middle Panel - Settings */}
        <div className="agent-panel agent-panel-middle">
          <div className="panel-header">
            <h2>Settings</h2>
          </div>
          <div className="settings-list">
            <div className="setting-item">
              <div className="setting-header">
                <span>Knowledge Base</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
              <div className="setting-content">
                <label>Connect Knowledge Base</label>
                <select 
                  value={selectedKB} 
                  onChange={(e) => setSelectedKB(e.target.value)}
                  className="kb-select"
                >
                  <option value="">None</option>
                  {knowledgeBases.map(kb => (
                    <option key={kb.id} value={kb.id}>{kb.name}</option>
                  ))}
                </select>
                {selectedKB && (
                  <p className="kb-connected">Knowledge base connected</p>
                )}
              </div>
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
                  disabled={isProcessing || !systemPrompt.trim()}
                >
                  {isProcessing ? 'Starting...' : 'Test'}
                </button>
              </div>
            ) : (
              <div className="test-active">
                <div className="test-controls-top">
                  <button 
                    className="btn-secondary btn-small"
                    onClick={stopConversation}
                  >
                    Stop
                  </button>
                </div>

                <div className="test-conversation">
                  <div className="messages-container">
                    <AnimatePresence>
                      {messages.map((message, index) => (
                        <motion.div
                          key={index}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={`message ${message.role}`}
                        >
                          <div className="message-content">
                            {message.content}
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>

                    {interimTranscript && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="message user interim"
                      >
                        <div className="message-content">
                          {interimTranscript}
                          <span className="typing-cursor">|</span>
                        </div>
                      </motion.div>
                    )}

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

                  <div className="listening-indicator">
                    {isActive && !isProcessing ? (
                      <div className="listening-pulse">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                        </svg>
                        Listening...
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
    </div>
  );
}

export default AgentDetail;
