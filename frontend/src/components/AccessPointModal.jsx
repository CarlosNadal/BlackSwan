import React, { useEffect, useState } from 'react';
import './AccessPointModal.css';

const AccessPointModal = ({ selectedNode, onClose }) => {
  if (!selectedNode) return null;

  // Estado local del tráfico (reactivo)
  const [traffic, setTraffic] = useState(selectedNode.data.data || 0);

  useEffect(() => {
    setTraffic(selectedNode.data.data || 0);
  }, [selectedNode.data.data]);

  const getPowerColor = (power) => {
    if (power >= -50) return '#00e676';
    if (power >= -65) return '#c6ff00';
    if (power >= -75) return '#ffb300';
    return '#ff5252';
  };

  const getPowerLevel = (power) => {
    if (power >= -50) return 'Excelente';
    if (power >= -65) return 'Bueno';
    if (power >= -75) return 'Regular';
    return 'Débil';
  };

  const getTrafficColor = (packets) => {
    if (packets > 800) return '#ff5252';
    if (packets > 300) return '#ffb300';
    return '#00e676';
  };

  const getTrafficLabel = (packets) => {
    if (packets > 800) return 'Alto tráfico';
    if (packets > 300) return 'Moderado';
    return 'Normal';
  };

  const trafficColor = getTrafficColor(traffic);
  const trafficLabel = getTrafficLabel(traffic);

  return (
    <div className="modal-overlay glow-bg" onClick={onClose}>
      <div 
        className="modal-content neon-border fade-in" 
        onClick={(e) => e.stopPropagation()}
        style={{ width: '50vw', minWidth: '500px', maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div className="modal-header">
          <h2 className="modal-title">
            <span role="img" aria-label="antenna">📡</span> Punto de Acceso
          </h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="info-section">
            <p><strong>ID:</strong> {selectedNode.data.bssid}</p>
            <p><strong>ESSID:</strong> {selectedNode.data.essid}</p>

            <p>
              <strong>Potencia:</strong>{" "}
              <span
                style={{
                  color: getPowerColor(selectedNode.data.power),
                  fontWeight: 'bold',
                  marginLeft: '8px',
                }}
              >
                {selectedNode.data.power} dBm ({getPowerLevel(selectedNode.data.power)})
              </span>
            </p>

            {traffic !== undefined && (
              <div style={{ margin: '15px 0' }}>
                <p>
                  <strong>Tráfico:</strong>{" "}
                  <span
                    style={{
                      color: trafficColor,
                      fontWeight: 'bold',
                      marginLeft: '8px',
                      textShadow: '0 0 8px rgba(255, 235, 59, 0.9)',
                      transition: 'color 0.3s ease',
                    }}
                  >
                    {traffic} paquetes ({trafficLabel})
                  </span>
                </p>
                <div
                  style={{
                    background: 'rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    height: '8px',
                    overflow: 'hidden',
                    marginTop: '8px',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(traffic / 10, 100)}%`,
                      height: '100%',
                      background: trafficColor,
                      boxShadow: `0 0 10px ${trafficColor}`,
                      transition: 'width 0.5s ease-in-out, background 0.3s ease',
                    }}
                  />
                </div>
              </div>
            )}

            {selectedNode.data.channel && (
              <p><strong>Canal:</strong> {selectedNode.data.channel}</p>
            )}
            {selectedNode.data.privacy && (
              <p><strong>Seguridad:</strong> {selectedNode.data.privacy}</p>
            )}

            {/* ⚠️ Alertas */}
            {selectedNode.data.alerts && selectedNode.data.alerts.length > 0 && (
              <div className="alerts-section" style={{ marginTop: '20px' }}>
                <h3 style={{ color: '#ff4444', marginBottom: '10px' }}>
                  ⚠️ Alertas ({selectedNode.data.alerts.length})
                </h3>
                <ul className="alerts-list" style={{ paddingLeft: '0', listStyle: 'none' }}>
                  {selectedNode.data.alerts.map((alert, idx) => (
                    <li
                      key={idx}
                      style={{
                        marginBottom: '6px',
                        padding: '6px',
                        borderLeft: '4px solid',
                        borderColor:
                          alert.type === 'high_traffic'
                            ? '#ff5252'
                            : alert.type === 'suspicious_traffic'
                            ? '#ffb300'
                            : '#00e676',
                        backgroundColor: 'rgba(255,255,255,0.05)',
                        fontSize: '0.9rem',
                        color: '#fff',
                        textShadow: '0 0 6px rgba(255, 235, 59, 0.6)',
                      }}
                    >
                      <strong>[{alert.type.replace('_', ' ').toUpperCase()}]</strong> {alert.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* 🔌 Clientes conectados */}
          {selectedNode.data.clients && selectedNode.data.clients.length > 0 && (
            <div className="clients-section">
              <h3 style={{ marginTop: '20px', marginBottom: '15px', color: '#ffeb3b' }}>
                Dispositivos conectados ({selectedNode.data.clients.length})
              </h3>
              <div className="clients-list" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                {selectedNode.data.clients.map((client, idx) => (
                  <div key={idx} className="client-box" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px', padding: '4px 8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px' }}>
                    <span className="client-mac">{client.mac}</span>
                    <span 
                      className="client-signal"
                      style={{ color: getPowerColor(client.power) }}
                    >
                      {client.power} dBm
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AccessPointModal;
