import { useState, useEffect } from 'react';
import axios from 'axios';
import './CallHistory.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

function CallHistory() {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCall, setSelectedCall] = useState(null);
  const [showDetailSidebar, setShowDetailSidebar] = useState(false);

  useEffect(() => {
    fetchCallHistory();
  }, []);

  const fetchCallHistory = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/call-history`);
      setCalls(response.data);
    } catch (error) {
      console.error('Error fetching call history:', error);
      setCalls([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCallClick = async (callId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/call-history/${callId}`);
      setSelectedCall(response.data);
      setShowDetailSidebar(true);
    } catch (error) {
      console.error('Error fetching call details:', error);
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  };

  const getEndReasonColor = (reason) => {
    if (reason === 'user_hangup' || reason === 'agent_hangup') return '#10b981';
    return '#6b7280';
  };

  const getStatusColor = (status) => {
    if (status === 'ended') return '#6b7280';
    if (status === 'active') return '#2563eb';
    return '#ef4444';
  };

  if (loading) {
    return (
      <div className="call-history-container">
        <div className="call-history-loading">Loading call history...</div>
      </div>
    );
  }

  return (
    <div className="call-history-container">
      <div className="call-history-header">
        <h1 className="call-history-title">Call History</h1>
        <div className="call-history-actions">
          <button className="btn-secondary" onClick={fetchCallHistory}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
            Refresh
          </button>
        </div>
      </div>

      <div className="call-history-table-container">
        <table className="call-history-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Duration</th>
              <th>Channel Type</th>
              <th>Cost</th>
              <th>Session ID</th>
              <th>End Reason</th>
              <th>Session Status</th>
              <th>Agent</th>
            </tr>
          </thead>
          <tbody>
            {calls.length === 0 ? (
              <tr>
                <td colSpan="8" className="empty-state-cell">
                  <div className="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"></circle>
                      <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    <p>No call history yet</p>
                  </div>
                </td>
              </tr>
            ) : (
              calls.map(call => (
                <tr 
                  key={call.id} 
                  className="call-row"
                  onClick={() => handleCallClick(call.id)}
                >
                  <td>{formatDate(call.startTime)}</td>
                  <td>{formatDuration(call.duration)}</td>
                  <td>
                    <span className="channel-badge">{call.channelType || 'web_call'}</span>
                  </td>
                  <td>${call.cost.toFixed(3)}</td>
                  <td>
                    <span className="session-id">{call.id.substring(0, 20)}...</span>
                  </td>
                  <td>
                    <div className="status-cell">
                      <span 
                        className="status-dot" 
                        style={{ backgroundColor: getEndReasonColor(call.endReason) }}
                      ></span>
                      <span>{call.endReason || 'N/A'}</span>
                    </div>
                  </td>
                  <td>
                    <div className="status-cell">
                      <span 
                        className="status-dot" 
                        style={{ backgroundColor: getStatusColor(call.status) }}
                      ></span>
                      <span>{call.status}</span>
                    </div>
                  </td>
                  <td>{call.agentName || 'Unknown'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Detail Sidebar */}
      {showDetailSidebar && selectedCall && (
        <div className="detail-sidebar-overlay" onClick={() => setShowDetailSidebar(false)}>
          <div className="detail-sidebar" onClick={(e) => e.stopPropagation()}>
            <div className="detail-sidebar-header">
              <div className="detail-nav-hint">
                <span>Use ↑ ↓ to navigate</span>
              </div>
              <button 
                className="detail-close-btn"
                onClick={() => setShowDetailSidebar(false)}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <div className="detail-content">
              <div className="detail-section">
                <h2 className="detail-call-title">
                  {formatDate(selectedCall.startTime)} {selectedCall.channelType || 'web_call'}
                </h2>
                <div className="detail-meta">
                  <div className="detail-meta-item">
                    <span className="detail-label">Agent:</span>
                    <span>{selectedCall.agentName || 'Unknown'}</span>
                  </div>
                  <div className="detail-meta-item">
                    <span className="detail-label">Call ID:</span>
                    <span className="call-id-text">{selectedCall.id}</span>
                    <button 
                      className="copy-btn"
                      onClick={() => {
                        navigator.clipboard.writeText(selectedCall.id);
                        alert('Call ID copied!');
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                      </svg>
                    </button>
                  </div>
                  <div className="detail-meta-item">
                    <span className="detail-label">Duration:</span>
                    <span>{formatDate(selectedCall.startTime)} - {formatDate(selectedCall.endTime) || 'Ongoing'}</span>
                  </div>
                  <div className="detail-meta-item">
                    <span className="detail-label">Cost:</span>
                    <span>${selectedCall.cost.toFixed(3)}</span>
                  </div>
                </div>
              </div>

              <div className="detail-section">
                <h3 className="detail-section-title">Conversation Analysis</h3>
                <div className="analysis-grid">
                  <div className="analysis-item">
                    <span className="analysis-label">Call Status</span>
                    <div className="analysis-value">
                      <span 
                        className="status-dot" 
                        style={{ backgroundColor: getStatusColor(selectedCall.status) }}
                      ></span>
                      <span>{selectedCall.status}</span>
                    </div>
                  </div>
                  <div className="analysis-item">
                    <span className="analysis-label">End Reason</span>
                    <div className="analysis-value">
                      <span 
                        className="status-dot" 
                        style={{ backgroundColor: getEndReasonColor(selectedCall.endReason) }}
                      ></span>
                      <span>{selectedCall.endReason || 'N/A'}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="detail-section">
                <h3 className="detail-section-title">Transcription</h3>
                <div className="transcription-content">
                  {selectedCall.messages && selectedCall.messages.length > 0 ? (
                    selectedCall.messages
                      .filter(msg => msg.role !== 'system')
                      .map((message, index) => (
                        <div key={index} className={`transcription-message ${message.role}`}>
                          <div className="transcription-role">
                            {message.role === 'user' ? 'User' : 'Agent'}
                          </div>
                          <div className="transcription-text">{message.content}</div>
                        </div>
                      ))
                  ) : (
                    <p className="no-transcription">No transcription available</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CallHistory;

