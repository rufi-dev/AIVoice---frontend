import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './Dashboard.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

function Dashboard() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');

  useEffect(() => {
    // Test API connection first
    axios.get(`${API_BASE_URL}/health`)
      .then(() => {
        fetchAgents();
      })
      .catch((error) => {
        console.error('Backend server not reachable:', error);
        const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
        alert(`Cannot connect to backend server. Please make sure the backend is running on ${backendUrl}`);
        setLoading(false);
      });
  }, []);

  const fetchAgents = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/agents`);
      setAgents(response.data);
      return response.data; // Return agents for use in useEffect
    } catch (error) {
      console.error('Error fetching agents:', error);
      setAgents([]);
      return [];
    } finally {
      setLoading(false);
    }
  };

  const createAgent = async () => {
    if (!newAgentName.trim()) {
      alert('Please enter an agent name');
      return;
    }

    try {
      const response = await axios.post(`${API_BASE_URL}/agents`, {
        name: newAgentName.trim(),
        systemPrompt: ''
      });
      
      setAgents([...agents, response.data]);
      setShowCreateModal(false);
      setNewAgentName('');
      navigate(`/agent/${response.data.id}`);
    } catch (error) {
      console.error('Error creating agent:', error);
      let errorMessage = 'Failed to create agent';
      
      if (error.response) {
        // Server responded with error
        errorMessage = error.response.data?.error || error.response.data?.message || `Server error: ${error.response.status}`;
      } else if (error.request) {
        // Request was made but no response received
        const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
        errorMessage = `Cannot connect to server. Please make sure the backend is running on ${backendUrl}`;
      } else {
        // Something else happened
        errorMessage = error.message || 'Failed to create agent';
      }
      
      alert(errorMessage);
    }
  };

  const deleteAgent = async (agentId, e) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this agent?')) {
      return;
    }

    try {
      await axios.delete(`${API_BASE_URL}/agents/${agentId}`);
      setAgents(agents.filter(a => a.id !== agentId));
    } catch (error) {
      console.error('Error deleting agent:', error);
      alert('Failed to delete agent');
    }
  };

  if (loading) {
    return (
      <div className="dashboard-container">
        <div className="dashboard-loading">Loading agents...</div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1 className="dashboard-title">All Agents</h1>
        <div className="dashboard-actions">
          <button 
            className="btn-primary"
            onClick={() => setShowCreateModal(true)}
          >
            Create an Agent
          </button>
        </div>
      </div>

      <div className="agents-grid">
        {agents.length === 0 ? (
          <div className="empty-state">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <path d="M9 9h6v6H9z"></path>
            </svg>
            <h3>No agents yet</h3>
            <p>Create your first agent to get started</p>
            <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
              Create an Agent
            </button>
          </div>
        ) : (
          agents.map(agent => (
            <div 
              key={agent.id} 
              className="agent-card"
              onClick={() => {
                // Save selected agent to localStorage
                localStorage.setItem('lastSelectedAgentId', agent.id);
                navigate(`/agent/${agent.id}`);
              }}
            >
              <div className="agent-card-header">
                <div className="agent-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <path d="M9 9h6v6H9z"></path>
                  </svg>
                </div>
                <div className="agent-info">
                  <h3 className="agent-name">{agent.name}</h3>
                  <span className="agent-type">Single Prompt</span>
                </div>
                <button 
                  className="agent-delete"
                  onClick={(e) => deleteAgent(agent.id, e)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </button>
              </div>
              <div className="agent-card-footer">
                <span className="agent-meta">Edited {new Date(agent.updatedAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Create New Agent</h2>
            <input
              type="text"
              placeholder="Agent name"
              value={newAgentName}
              onChange={(e) => setNewAgentName(e.target.value)}
              className="modal-input"
              autoFocus
              onKeyPress={(e) => e.key === 'Enter' && createAgent()}
            />
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowCreateModal(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={createAgent}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;

