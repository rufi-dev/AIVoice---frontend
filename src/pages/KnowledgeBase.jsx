import { useState, useEffect } from 'react';
import axios from 'axios';
import './KnowledgeBase.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

function KnowledgeBase() {
  const [knowledgeBases, setKnowledgeBases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKBName, setNewKBName] = useState('');
  const [selectedKB, setSelectedKB] = useState(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchKnowledgeBases();
  }, []);

  const fetchKnowledgeBases = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/knowledge-bases`);
      setKnowledgeBases(response.data);
    } catch (error) {
      console.error('Error fetching knowledge bases:', error);
      setKnowledgeBases([]);
    } finally {
      setLoading(false);
    }
  };

  const createKnowledgeBase = async () => {
    if (!newKBName.trim()) {
      alert('Please enter a knowledge base name');
      return;
    }

    try {
      const response = await axios.post(`${API_BASE_URL}/knowledge-bases`, {
        name: newKBName.trim()
      });
      
      setKnowledgeBases([...knowledgeBases, response.data]);
      setShowCreateModal(false);
      setNewKBName('');
      setSelectedKB(response.data);
    } catch (error) {
      console.error('Error creating knowledge base:', error);
      let errorMessage = 'Failed to create knowledge base';
      
      if (error.response) {
        errorMessage = error.response.data?.error || error.response.data?.message || `Server error: ${error.response.status}`;
      } else if (error.request) {
        const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
        errorMessage = `Cannot connect to server. Please make sure the backend is running on ${backendUrl}`;
      } else {
        errorMessage = error.message || 'Failed to create knowledge base';
      }
      
      alert(errorMessage);
    }
  };

  const deleteKnowledgeBase = async (kbId) => {
    if (!window.confirm('Are you sure you want to delete this knowledge base?')) {
      return;
    }

    try {
      await axios.delete(`${API_BASE_URL}/knowledge-bases/${kbId}`);
      setKnowledgeBases(knowledgeBases.filter(kb => kb.id !== kbId));
      if (selectedKB?.id === kbId) {
        setSelectedKB(null);
      }
    } catch (error) {
      console.error('Error deleting knowledge base:', error);
      alert('Failed to delete knowledge base');
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !selectedKB) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      await axios.post(`${API_BASE_URL}/knowledge-bases/${selectedKB.id}/documents`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      
      alert('Document uploaded successfully');
      // Refresh the selected KB to get updated documents
      const response = await axios.get(`${API_BASE_URL}/knowledge-bases/${selectedKB.id}`);
      setSelectedKB(response.data);
      fetchKnowledgeBases();
    } catch (error) {
      console.error('Error uploading document:', error);
      alert('Failed to upload document');
    } finally {
      setUploading(false);
      // Reset file input
      e.target.value = '';
    }
  };

  const handleKBSelect = async (kb) => {
    // Fetch full KB details including documents
    try {
      const response = await axios.get(`${API_BASE_URL}/knowledge-bases/${kb.id}`);
      setSelectedKB(response.data);
    } catch (error) {
      console.error('Error fetching KB details:', error);
      setSelectedKB(kb);
    }
  };

  if (loading) {
    return (
      <div className="kb-container">
        <div className="kb-loading">Loading knowledge bases...</div>
      </div>
    );
  }

  return (
    <div className="kb-container">
      <div className="kb-header">
        <h1 className="kb-title">Knowledge Base</h1>
        <button 
          className="btn-primary"
          onClick={() => setShowCreateModal(true)}
        >
          Create Knowledge Base
        </button>
      </div>

      <div className="kb-layout">
        <div className="kb-sidebar">
          <h3>Knowledge Bases</h3>
          {knowledgeBases.length === 0 ? (
            <div className="kb-empty">
              <p>No knowledge bases yet</p>
            </div>
          ) : (
            <div className="kb-list">
              {knowledgeBases.map(kb => (
                <div
                  key={kb.id}
                  className={`kb-item ${selectedKB?.id === kb.id ? 'active' : ''}`}
                  onClick={() => handleKBSelect(kb)}
                >
                  <div className="kb-item-content">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                    </svg>
                    <span>{kb.name}</span>
                  </div>
                  <button
                    className="kb-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteKnowledgeBase(kb.id);
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="kb-main">
          {selectedKB ? (
            <div className="kb-detail">
              <div className="kb-detail-header">
                <h2>{selectedKB.name}</h2>
              </div>

              <div className="kb-upload-section">
                <h3>Upload Documents</h3>
                <p className="kb-description">
                  Upload documents (PDF, TXT, DOCX) to add to this knowledge base.
                </p>
                <label className="kb-upload-label">
                  <input
                    type="file"
                    accept=".pdf,.txt,.docx"
                    onChange={handleFileUpload}
                    disabled={uploading}
                    style={{ display: 'none' }}
                  />
                  <div className="kb-upload-box">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                      <polyline points="17 8 12 3 7 8"></polyline>
                      <line x1="12" y1="3" x2="12" y2="15"></line>
                    </svg>
                    <p>{uploading ? 'Uploading...' : 'Click to upload or drag and drop'}</p>
                    <p className="kb-upload-hint">PDF, TXT, DOCX up to 10MB</p>
                  </div>
                </label>
              </div>

              <div className="kb-documents">
                <h3>Documents</h3>
                {selectedKB.documents && selectedKB.documents.length > 0 ? (
                  <div className="kb-doc-list">
                    {selectedKB.documents.map((doc, index) => (
                      <div key={index} className="kb-doc-item">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                          <polyline points="14 2 14 8 20 8"></polyline>
                        </svg>
                        <span>{doc.name || `Document ${index + 1}`}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="kb-empty-docs">No documents uploaded yet</p>
                )}
              </div>
            </div>
          ) : (
            <div className="kb-empty-state">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
              </svg>
              <h3>Select a knowledge base</h3>
              <p>Choose a knowledge base from the sidebar to view and manage documents</p>
            </div>
          )}
        </div>
      </div>

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Create Knowledge Base</h2>
            <input
              type="text"
              placeholder="Knowledge base name"
              value={newKBName}
              onChange={(e) => setNewKBName(e.target.value)}
              className="modal-input"
              autoFocus
              onKeyPress={(e) => e.key === 'Enter' && createKnowledgeBase()}
            />
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowCreateModal(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={createKnowledgeBase}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default KnowledgeBase;

