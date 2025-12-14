import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import './VoiceSelectionModal.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
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

function VoiceSelectionModal({ isOpen, onClose, onSelect, currentSettings }) {
  const [activeTab, setActiveTab] = useState('elevenlabs');
  const [predefinedVoices, setPredefinedVoices] = useState([]);
  const [customVoices, setCustomVoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [customVoiceData, setCustomVoiceData] = useState({
    name: '',
    voiceId: '',
    description: '',
    provider: 'elevenlabs'
  });
  const [filters, setFilters] = useState({
    gender: '',
    accent: '',
    type: ''
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [playingVoiceId, setPlayingVoiceId] = useState(null);
  const [previewAudio, setPreviewAudio] = useState(null);
  const [currentAudioUrl, setCurrentAudioUrl] = useState(null); // Track blob URL for cleanup

  // Function to stop and cleanup current audio
  const stopCurrentAudio = () => {
    if (previewAudio) {
      previewAudio.pause();
      previewAudio.currentTime = 0;
      // Remove all event listeners to prevent any callbacks
      previewAudio.onended = null;
      previewAudio.onerror = null;
      previewAudio.oncanplaythrough = null;
      previewAudio.onloadstart = null;
      previewAudio.onloadeddata = null;
    }
    
    // Clean up blob URL
    if (currentAudioUrl && currentAudioUrl.startsWith('blob:')) {
      URL.revokeObjectURL(currentAudioUrl);
    }
    
    setPreviewAudio(null);
    setCurrentAudioUrl(null);
  };

  useEffect(() => {
    if (isOpen) {
      fetchVoices();
    }
    
    // Cleanup: stop audio when modal closes
    return () => {
      stopCurrentAudio();
      setPlayingVoiceId(null);
    };
  }, [isOpen]);

  const fetchVoices = async () => {
    setLoading(true);
    
    // Fetch predefined voices (should always work)
    try {
      const predefinedRes = await axios.get(`${API_BASE_URL}/voices/predefined`);
      console.log('✅ Predefined voices loaded:', predefinedRes.data);
      setPredefinedVoices(predefinedRes.data || []);
    } catch (predefinedError) {
      console.error('❌ Error fetching predefined voices:', predefinedError);
      console.error('Error response:', predefinedError.response?.data);
      setPredefinedVoices([]);
    }

    // Fetch custom voices (may be empty, that's ok)
    try {
      const customRes = await axios.get(`${API_BASE_URL}/voices`);
      console.log('✅ Custom voices loaded:', customRes.data);
      setCustomVoices(customRes.data || []);
    } catch (customError) {
      console.error('❌ Error fetching custom voices:', customError);
      setCustomVoices([]);
    }
    
    setLoading(false);
  };

  const handleAddCustomVoice = async () => {
    if (!customVoiceData.name || !customVoiceData.voiceId) {
      alert('Please provide name and voice ID');
      return;
    }

    try {
      const response = await axios.post(`${API_BASE_URL}/voices`, customVoiceData);
      setCustomVoices([...customVoices, response.data]);
      setShowAddCustom(false);
      setCustomVoiceData({ name: '', voiceId: '', description: '', provider: 'elevenlabs' });
      alert('Custom voice added successfully');
    } catch (error) {
      console.error('Error adding custom voice:', error);
      alert('Failed to add custom voice');
    }
  };

  const handleVoiceSelect = (voice) => {
    // Get voiceId from either id or voiceId field
    const selectedVoiceId = voice.id || voice.voiceId;
    console.log('🎤 Voice selected in modal:', {
      voice: voice,
      selectedVoiceId: selectedVoiceId,
      voiceName: voice.name,
      hasId: !!voice.id,
      hasVoiceId: !!voice.voiceId
    });
    
    const newSettings = {
      ...currentSettings,
      voiceId: selectedVoiceId,
      voiceName: voice.name || voice.voiceName,
      voiceProvider: voice.provider || voice.voiceProvider || 'elevenlabs'
    };
    
    console.log('🎤 Calling onSelect with:', newSettings);
    onSelect(newSettings);
    onClose();
  };

  const handleVoicePreview = async (voice, e) => {
    e.stopPropagation();
    
    const voiceId = voice.id || voice.voiceId;
    const voiceName = voice.name;
    
    // If clicking the same voice that's playing, just stop it
    if (playingVoiceId === voiceId) {
      stopCurrentAudio();
      setPlayingVoiceId(null);
      return;
    }
    
    // Stop any currently playing audio before starting new one
    stopCurrentAudio();
    
    setPlayingVoiceId(voiceId);
    
    try {
      console.log(`🎵 Previewing voice: ${voiceName} (${voiceId})`);
      
      const response = await axios.post(`${API_BASE_URL}/voices/preview`, {
        voiceId: voiceId,
        voiceName: voiceName
      }, {
        responseType: 'arraybuffer' // Expect binary audio data
      });
      
      // Preview audio is now streamed directly (not JSON response)
      // The response is the audio file itself
      const audioBlob = new Blob([response.data], { type: 'audio/mpeg' });
      const audioUrl = URL.createObjectURL(audioBlob);
      
      // Store the blob URL for cleanup
      setCurrentAudioUrl(audioUrl);

      console.log('🔊 Playing preview audio from blob URL');

      const audio = new Audio(audioUrl);
      setPreviewAudio(audio);
      
      audio.onended = () => {
        console.log('✅ Preview finished');
        setPlayingVoiceId(null);
        stopCurrentAudio();
      };
      
      audio.onerror = (error) => {
        console.error('❌ Error playing preview audio:', error);
        setPlayingVoiceId(null);
        stopCurrentAudio();
        alert('Failed to play voice preview. Please try again.');
      };
      
      // Wait for audio to be ready before playing
      audio.oncanplaythrough = async () => {
        try {
          await audio.play();
          console.log('✅ Preview started playing');
        } catch (playError) {
          console.error('❌ Error starting playback:', playError);
          setPlayingVoiceId(null);
          stopCurrentAudio();
          alert('Failed to start playback. Please check browser console.');
        }
      };
      
      // If audio fails to load
      audio.onloadstart = () => console.log('🔄 Audio loading started');
      audio.onloadeddata = () => console.log('✅ Audio data loaded');
      
      // Start loading the audio
      audio.load();
      
    } catch (error) {
      console.error('❌ Error previewing voice:', error);
      console.error('Error details:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        statusText: error.response?.statusText
      });
      setPlayingVoiceId(null);
      const errorMessage = error.response?.data?.error || error.response?.data?.details || error.message || 'Failed to preview voice';
      alert(`Failed to preview voice: ${errorMessage}`);
    }
  };

  // Combine predefined and custom voices
  // Ensure we always have at least the predefined voices
  const allVoices = [
    ...(predefinedVoices || []),
    ...(customVoices || [])
  ];
  
  console.log('All voices for filtering:', allVoices.length, 'predefined:', predefinedVoices.length, 'custom:', customVoices.length);
  
  const filteredVoices = allVoices.filter(voice => {
    // Filter by tab
    if (activeTab === 'elevenlabs' && voice.provider !== 'elevenlabs') return false;
    if (activeTab === 'all') {
      // Show all voices
    } else if (voice.provider !== activeTab) return false;
    
    // Filter by search
    if (searchQuery && !voice.name.toLowerCase().includes(searchQuery.toLowerCase()) && 
        !(voice.description && voice.description.toLowerCase().includes(searchQuery.toLowerCase()))) {
      return false;
    }
    
    // Filter by gender
    if (filters.gender && voice.traits?.gender !== filters.gender) return false;
    
    // Filter by accent
    if (filters.accent && voice.traits?.accent !== filters.accent) return false;
    
    return true;
  });

  const allGenders = [...new Set([...predefinedVoices, ...customVoices].map(v => v.traits?.gender).filter(Boolean))];
  const allAccents = [...new Set([...predefinedVoices, ...customVoices].map(v => v.traits?.accent).filter(Boolean))];

  if (!isOpen) return null;

  return (
    <div className="voice-modal-overlay" onClick={onClose}>
      <motion.div
        className="voice-modal"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="voice-modal-header">
          <h2>Select Voice</h2>
          <button className="voice-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="voice-modal-tabs">
          <button
            className={activeTab === 'elevenlabs' ? 'active' : ''}
            onClick={() => setActiveTab('elevenlabs')}
          >
            ElevenLabs
          </button>
          <button
            className={activeTab === 'all' ? 'active' : ''}
            onClick={() => setActiveTab('all')}
          >
            All Voices
          </button>
        </div>

        <div className="voice-modal-actions">
          <button className="btn-add-custom" onClick={() => setShowAddCustom(!showAddCustom)}>
            + Add custom voice
          </button>
          <div className="voice-filters">
            <select
              value={filters.gender}
              onChange={(e) => setFilters({ ...filters, gender: e.target.value })}
            >
              <option value="">Gender</option>
              {allGenders.map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <select
              value={filters.accent}
              onChange={(e) => setFilters({ ...filters, accent: e.target.value })}
            >
              <option value="">Accent</option>
              {allAccents.map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="voice-search"
            />
          </div>
        </div>

        {showAddCustom && (
          <div className="custom-voice-form">
            <h3>Add Custom Voice</h3>
            <input
              type="text"
              placeholder="Voice Name"
              value={customVoiceData.name}
              onChange={(e) => setCustomVoiceData({ ...customVoiceData, name: e.target.value })}
            />
            <input
              type="text"
              placeholder="Voice ID"
              value={customVoiceData.voiceId}
              onChange={(e) => setCustomVoiceData({ ...customVoiceData, voiceId: e.target.value })}
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={customVoiceData.description}
              onChange={(e) => setCustomVoiceData({ ...customVoiceData, description: e.target.value })}
            />
            <div className="custom-voice-actions">
              <button className="btn-secondary" onClick={() => setShowAddCustom(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleAddCustomVoice}>Add Voice</button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="voice-modal-loading">Loading voices...</div>
        ) : (
          <>
            {filteredVoices.length > 0 ? (
              <div className="voice-list">
                {filteredVoices.map((voice) => {
                  const voiceId = voice.id || voice.voiceId;
                  const isSelected = currentSettings?.voiceId === voiceId;
                  
                  return (
                    <div
                      key={voiceId}
                      className={`voice-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleVoiceSelect(voice)}
                    >
                      <div className="voice-avatar">
                        {voice.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="voice-info">
                        <div className="voice-name">{voice.name}</div>
                        <div className="voice-description">
                          {voice.description || (voice.traits ? 
                            `${voice.traits?.accent || ''} · ${voice.traits?.age || ''} · ${voice.traits?.gender || ''}`.replace(/^ · | · $/g, '') :
                            'Voice')
                          }
                        </div>
                        <div className="voice-id">ID: {voiceId}</div>
                      </div>
                      <button 
                        className={`voice-play-btn ${playingVoiceId === voiceId ? 'playing' : ''}`}
                        onClick={(e) => handleVoicePreview(voice, e)}
                        title={playingVoiceId === voiceId ? 'Stop preview' : 'Preview voice'}
                      >
                        {playingVoiceId === voiceId ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="6" y="4" width="4" height="16"></rect>
                            <rect x="14" y="4" width="4" height="16"></rect>
                          </svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="5 3 19 12 5 21"></polygon>
                          </svg>
                        )}
                      </button>
                      {isSelected && (
                        <div className="voice-selected-check">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="voice-modal-empty">
                <p>No voices found. Try adjusting your filters or add a custom voice.</p>
                {allVoices.length === 0 && !loading && (
                  <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#9ca3af' }}>
                    Predefined voices should appear here. If they don't, check your backend connection.
                  </p>
                )}
                {allVoices.length > 0 && filteredVoices.length === 0 && (
                  <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#9ca3af' }}>
                    {allVoices.length} voice(s) available, but filtered out. Clear filters to see them.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}

export default VoiceSelectionModal;

