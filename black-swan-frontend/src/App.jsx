import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import * as d3 from "d3";
import "./App.css";

function App() {
  const svgRef = useRef();
  const [data, setData] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [showLegend, setShowLegend] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState("Desconectado");
  const [connectionStats, setConnectionStats] = useState({ 
    messages: 0, 
    networks: 0, 
    clients: 0,
    connectedClients: 0,
    lastUpdate: null 
  });
  const socketRef = useRef(null);
  const nodesCache = useRef(new Map());
  const simulationRef = useRef(null);

  // Funciones auxiliares
  const getPowerColor = (power) => {
    if (power >= -30) return "#ffeb3b";
    if (power >= -50) return "#ff9800";
    if (power >= -70) return "#ff5722";
    return "#795548";
  };

  const getPowerLevel = (power) => {
    if (power >= -30) return "Excelente";
    if (power >= -50) return "Bueno";
    if (power >= -70) return "Regular";
    return "Débil";
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedNode(null);
  };

  // Socket.IO Connection
  useEffect(() => {
    const connectSocket = () => {
      const socketUrl = "http://localhost:8000";
      console.log(`🔗 Conectando a ${socketUrl}...`);
      
      try {
        const socket = io(socketUrl, {
          transports: ['websocket', 'polling'],
          timeout: 10000
        });
        socketRef.current = socket;

        socket.on('connect', () => {
          console.log("✅ Socket.IO conectado exitosamente");
          setConnectionStatus("Conectado");
          socket.emit('request_data');
        });

        socket.on('wifi_data', (newData) => {
          setData(newData);
          setConnectionStats(prev => ({
            messages: prev.messages + 1,
            networks: newData.aps?.length || 0,
            clients: newData.total_clients || 0,
            connectedClients: prev.connectedClients,
            lastUpdate: new Date().toLocaleTimeString()
          }));
        });

        socket.on('status', (status) => {
          setConnectionStats(prev => ({
            ...prev,
            connectedClients: status.clients || 0
          }));
        });

        socket.on('disconnect', (reason) => {
          console.log(`🔌 Desconectado: ${reason}`);
          setConnectionStatus("Desconectado");
          setTimeout(connectSocket, 3000);
        });

        socket.on('connect_error', (error) => {
          console.error("❌ Error de conexión:", error);
          setConnectionStatus("Error de conexión");
          setTimeout(connectSocket, 5000);
        });

      } catch (error) {
        console.error("❌ Error:", error);
        setConnectionStatus("Error");
        setTimeout(connectSocket, 5000);
      }
    };

    connectSocket();

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (simulationRef.current) {
        simulationRef.current.stop();
      }
    };
  }, []);

  // D3 Visualization con nodos flotantes y arrastrables
  useEffect(() => {
    if (!data || !data.aps) return;

    const svg = d3.select(svgRef.current);
    const width = window.innerWidth;
    const height = window.innerHeight;
    const centerX = width / 2;
    const centerY = height / 2;

    // Configurar tamaño
    svg.attr("width", width).attr("height", height);

    // Limpiar solo elementos de datos, mantener círculos guía
    svg.selectAll(".data-group").remove();
    
    // Crear grupo para datos
    const dataGroup = svg.append("g").attr("class", "data-group");

    // Dibujar círculos de guía (solo una vez)
    if (!svg.select(".guide-circles").node()) {
      const circleRadii = [
        Math.min(width, height) * 0.15,
        Math.min(width, height) * 0.25,  
        Math.min(width, height) * 0.35
      ];

      const circleLabels = ["Excelente (-30 a -50 dBm)", "Bueno (-50 a -70 dBm)", "Débil (< -70 dBm)"];

      const guideGroup = svg.append("g").attr("class", "guide-circles");

      circleRadii.forEach((radius, index) => {
        guideGroup.append("circle")
          .attr("class", "guide-circle")
          .attr("cx", centerX)
          .attr("cy", centerY)
          .attr("r", radius);

        guideGroup.append("text")
          .attr("class", "circle-label")
          .attr("x", centerX)
          .attr("y", centerY - radius - 10)
          .text(circleLabels[index]);
      });
    }

    // Procesar datos
    const nodes = [];
    const links = [];
    
    // Agrupar APs por círculo según potencia
    const circle1APs = [];
    const circle2APs = [];  
    const circle3APs = [];

    data.aps.forEach(ap => {
      if (ap.power >= -50) {
        circle1APs.push(ap);
      } else if (ap.power >= -70) {
        circle2APs.push(ap);
      } else {
        circle3APs.push(ap);
      }
    });

    // Función para crear posiciones iniciales
    const createInitialPosition = (id, type, circleIndex, index, total, isClient = false, parentAP = null) => {
      // Si es cliente, posición alrededor del AP padre
      if (isClient && parentAP) {
        const parentNode = nodes.find(n => n.id === parentAP);
        if (parentNode) {
          const angle = (index / total) * 2 * Math.PI;
          const distance = 60 + Math.random() * 40;
          return {
            x: parentNode.x + Math.cos(angle) * distance,
            y: parentNode.y + Math.sin(angle) * distance
          };
        }
      }
      
      // Para APs, posición en círculo concéntrico
      const radius = [0.15, 0.25, 0.35][circleIndex - 1] * Math.min(width, height);
      const angle = (index / total) * 2 * Math.PI;
      const variation = (Math.random() - 0.5) * 0.5;
      const finalAngle = angle + variation;
      
      return {
        x: centerX + Math.cos(finalAngle) * radius,
        y: centerY + Math.sin(finalAngle) * radius
      };
    };

    // Procesar APs y sus clientes
    const processCircle = (aps, circleIndex) => {
      aps.forEach((ap, apIndex) => {
        // Crear nodo AP
        const apPosition = createInitialPosition(ap.bssid, "ap", circleIndex, apIndex, aps.length);
        
        const apNode = {
          id: ap.bssid,
          label: ap.essid || ap.bssid,
          type: "ap",
          data: ap,
          x: apPosition.x,
          y: apPosition.y,
          circle: circleIndex,
          radius: [0.15, 0.25, 0.35][circleIndex - 1] * Math.min(width, height)
        };
        
        nodes.push(apNode);

        // Crear nodos para clientes conectados
        if (ap.clients && ap.clients.length > 0) {
          ap.clients.forEach((client, clientIndex) => {
            const clientPosition = createInitialPosition(
              client.mac, 
              "client", 
              circleIndex, 
              clientIndex, 
              ap.clients.length,
              true,
              ap.bssid
            );
            
            const clientNode = {
              id: client.mac,
              label: client.mac,
              type: "client",
              data: client,
              x: clientPosition.x,
              y: clientPosition.y,
              parentAP: ap.bssid,
              circle: circleIndex
            };
            
            nodes.push(clientNode);
            links.push({ source: ap.bssid, target: client.mac });
          });
        }
      });
    };

    // Procesar todos los círculos
    processCircle(circle1APs, 1);
    processCircle(circle2APs, 2);
    processCircle(circle3APs, 3);

    // ----- LINKS -----
    const linkSel = dataGroup.selectAll("line.link")
      .data(links, d => `${d.source}-${d.target}`);
    
    linkSel.join(
      enter => enter.append("line")
        .attr("class", "link")
        .attr("stroke-width", 1.5)
        .attr("stroke-dasharray", "4,2")
        .attr("stroke-opacity", 0.4)
        .attr("stroke", "#666"),
      update => update,
      exit => exit.remove()
    );

    // ----- NODES -----
    const calculateNodeSize = (node) => {
      const power = node.data.power;
      const normalizedPower = Math.max(0, Math.min(1, (power + 100) / 70));
      return node.type === "ap" ? 20 + normalizedPower * 12 : 8 + normalizedPower * 6;
    };

    const calculateNodeColor = (node) => getPowerColor(node.data.power);

    const nodeSel = dataGroup.selectAll("circle.node")
      .data(nodes, d => d.id);
    
    // Crear/actualizar nodos
    const nodeEnter = nodeSel.enter()
      .append("circle")
      .attr("class", "node")
      .attr("r", d => calculateNodeSize(d))
      .attr("cx", d => d.x)
      .attr("cy", d => d.y)
      .attr("fill", d => calculateNodeColor(d))
      .attr("stroke", d => d.type === "ap" ? "#fbc02d" : "#f57c00")
      .attr("stroke-width", d => d.type === "ap" ? 2 : 1)
      .style("cursor", "pointer")
      .style("filter", d => `drop-shadow(0 0 8px ${calculateNodeColor(d)}40)`);

    // Actualizar nodos existentes
    nodeSel
      .attr("r", d => calculateNodeSize(d))
      .attr("fill", d => calculateNodeColor(d))
      .style("filter", d => `drop-shadow(0 0 8px ${calculateNodeColor(d)}40)`);

    // Remover nodos que ya no existen
    nodeSel.exit().remove();

    // ----- LABELS -----
    const labelSel = dataGroup.selectAll("text.label")
      .data(nodes, d => d.id);
    
    labelSel.join(
      enter => enter.append("text")
        .attr("class", "label")
        .attr("text-anchor", "middle")
        .attr("dy", d => d.type === "ap" ? -18 : 15)
        .attr("font-size", d => d.type === "ap" ? "12px" : "9px")
        .attr("font-weight", "bold")
        .style("pointer-events", "none")
        .style("text-shadow", "1px 1px 2px rgba(0,0,0,0.8)")
        .style("fill", "white")
        .text(d => {
          if (d.type === "client") return d.label.substring(0, 8) + "...";
          if (d.label.length > 12) return d.label.substring(0, 10) + "...";
          return d.label;
        }),
      update => update
        .text(d => {
          if (d.type === "client") return d.label.substring(0, 8) + "...";
          if (d.label.length > 12) return d.label.substring(0, 10) + "...";
          return d.label;
        }),
      exit => exit.remove()
    );

    // ----- SIMULACIÓN FÍSICA PARA EFECTO FLOTANTE -----
    if (simulationRef.current) {
      simulationRef.current.stop();
    }

    const simulation = d3.forceSimulation(nodes)
      .force("charge", d3.forceManyBody()
        .strength(d => d.type === "ap" ? -60 : -30)
        .distanceMax(200)
      )
      .force("center", d3.forceCenter(centerX, centerY).strength(0.05))
      .force("collision", d3.forceCollide()
        .radius(d => calculateNodeSize(d) + 10)
        .strength(0.8)
      )
      .force("link", d3.forceLink(links)
        .id(d => d.id)
        .distance(d => {
          const source = nodes.find(n => n.id === d.source);
          const target = nodes.find(n => n.id === d.target);
          if (source && target && source.type === "ap" && target.type === "client") {
            return 80; // Distancia AP-Cliente
          }
          return 120; // Distancia por defecto
        })
        .strength(0.1)
      )
      .force("radial", d3.forceRadial()
        .radius(d => d.radius || Math.min(width, height) * 0.35)
        .x(centerX)
        .y(centerY)
        .strength(d => d.type === "ap" ? 0.1 : 0.05) // APs más fijos a su círculo
      )
      .alphaDecay(0.02)
      .velocityDecay(0.4);

    simulationRef.current = simulation;

    // ----- DRAG BEHAVIOR -----
    const dragStarted = (event, d) => {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    };

    const dragged = (event, d) => {
      d.fx = event.x;
      d.fy = event.y;
    };

    const dragEnded = (event, d) => {
      if (!event.active) simulation.alphaTarget(0);
      // Liberar después de un tiempo para que vuelvan a flotar
      setTimeout(() => {
        d.fx = null;
        d.fy = null;
      }, 3000);
    };

    const drag = d3.drag()
      .on("start", dragStarted)
      .on("drag", dragged)
      .on("end", dragEnded);

    // Aplicar drag a todos los nodos
    dataGroup.selectAll("circle.node")
      .call(drag);

    // ----- INTERACCIONES -----
    dataGroup.selectAll("circle.node")
      .on("click", (event, d) => {
        event.stopPropagation();
        setSelectedNode(d);
        setModalOpen(true);
      })
      .on("mouseover", function(event, d) {
        d3.select(this)
          .transition()
          .duration(200)
          .attr("r", calculateNodeSize(d) + 4)
          .style("filter", `drop-shadow(0 0 15px ${calculateNodeColor(d)}80)`);
        
        // Resaltar conexiones
        dataGroup.selectAll("line.link")
          .transition()
          .duration(200)
          .attr("stroke-opacity", l => 
            (l.source === d.id || l.target === d.id) ? 0.8 : 0.1
          )
          .attr("stroke-width", l => 
            (l.source === d.id || l.target === d.id) ? 2.5 : 1.5
          )
          .attr("stroke", l => 
            (l.source === d.id || l.target === d.id) ? getPowerColor(d.data.power) : "#666"
          );
      })
      .on("mouseout", function(event, d) {
        d3.select(this)
          .transition()
          .duration(200)
          .attr("r", calculateNodeSize(d))
          .style("filter", `drop-shadow(0 0 8px ${calculateNodeColor(d)}40)`);
        
        // Restaurar conexiones
        dataGroup.selectAll("line.link")
          .transition()
          .duration(200)
          .attr("stroke-opacity", 0.4)
          .attr("stroke-width", 1.5)
          .attr("stroke", "#666");
      });

    // ----- TICK ANIMATION -----
    simulation.on("tick", () => {
      dataGroup.selectAll("circle.node")
        .attr("cx", d => d.x)
        .attr("cy", d => d.y);

      dataGroup.selectAll("text.label")
        .attr("x", d => d.x)
        .attr("y", d => d.y);

      dataGroup.selectAll("line.link")
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);
    });

    // Click en el SVG para liberar todos los nodos
    svg.on("click", () => {
      nodes.forEach(node => {
        node.fx = null;
        node.fy = null;
      });
      simulation.alpha(0.3).restart();
    });

    const onResize = () => {
      if (data && data.aps) {
        simulation.stop();
        setData({...data});
      }
    };
    
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [data]);

  return (
    <div className="App">
      <header className="app-header">
        <h1>Black Swan — WiFi Recon</h1>
        <p>Visualización de redes y dispositivos conectados</p>
      </header>
      
      {/* Logo central - SIEMPRE visible */}
      <div className="center-logo">
        <div className="logo-icon">📡</div>
        <div className="logo-text">BLACK SWAN</div>
        <div className="logo-subtitle">WiFi Reconnaissance</div>
      </div>
      
      <svg ref={svgRef} className="fullscreen-svg"></svg>

      {/* Barra de estado */}
      <div className={`connection-status ${connectionStatus.toLowerCase().replace(' ', '-')}`}>
        <div className="status-indicator"></div>
        <span className="status-text">Estado: {connectionStatus}</span>
        {connectionStats.messages > 0 && (
          <span className="connection-stats">
            Mensajes: {connectionStats.messages} • 
            Redes: {connectionStats.networks} • 
            Clientes: {connectionStats.clients}
            {connectionStats.lastUpdate && ` • Actualizado: ${connectionStats.lastUpdate}`}
          </span>
        )}
      </div>

      {/* Instrucciones de uso */}
      <div className="usage-hint">
        💡 Haz click y arrastra los nodos • Click en el fondo para liberarlos
      </div>

      {/* Resto del JSX igual */}
      {showLegend && (
        <div className="legend-panel">
          <div className="legend-header">
            <h3>Leyenda de Señal WiFi</h3>
            <button 
              className="legend-toggle"
              onClick={() => setShowLegend(false)}
            >
              ×
            </button>
          </div>
          
          <div className="legend-content">
            <div className="legend-section">
              <h4>Intensidad de Señal</h4>
              <div className="legend-items">
                <div className="legend-item">
                  <div className="color-dot" style={{ backgroundColor: '#ffeb3b' }}></div>
                  <div className="legend-text">
                    <strong>Excelente (-30 a -50 dBm)</strong>
                    <span>Círculo interno - Señal óptima</span>
                  </div>
                </div>
                <div className="legend-item">
                  <div className="color-dot" style={{ backgroundColor: '#ff9800' }}></div>
                  <div className="legend-text">
                    <strong>Bueno (-50 a -70 dBm)</strong>
                    <span>Círculo medio - Buena conexión</span>
                  </div>
                </div>
                <div className="legend-item">
                  <div className="color-dot" style={{ backgroundColor: '#ff5722' }}></div>
                  <div className="legend-text">
                    <strong>Débil (menos de -70 dBm)</strong>
                    <span>Círculo externo - Señal pobre</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="legend-section">
              <h4>Tipos de Dispositivos</h4>
              <div className="legend-items">
                <div className="legend-item">
                  <div className="device-type ap">
                    <div className="device-icon">📡</div>
                  </div>
                  <div className="legend-text">
                    <strong>Puntos de Acceso (AP)</strong>
                    <span>Routers WiFi y hotspots</span>
                  </div>
                </div>
                <div className="legend-item">
                  <div className="device-type client">
                    <div className="device-icon">📱</div>
                  </div>
                  <div className="legend-text">
                    <strong>Dispositivos Clientes</strong>
                    <span>Teléfonos, laptops, etc.</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="legend-footer">
            <button 
              className="btn-minimize"
              onClick={() => setShowLegend(false)}
            >
              Minimizar
            </button>
          </div>
        </div>
      )}

      {!showLegend && (
        <button className="legend-show-btn" onClick={() => setShowLegend(true)}>
          📊 Mostrar Leyenda
        </button>
      )}

      {modalOpen && selectedNode && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                {selectedNode.type === "ap" ? "Punto de Acceso WiFi" : "Dispositivo Cliente"}
              </h2>
              <button className="close-button" onClick={closeModal}>×</button>
            </div>
            
            <div className="modal-body">
              <div className="info-section">
                <h3>Información básica</h3>
                <div className="info-grid">
                  <div className="info-item">
                    <span className="info-label">Tipo:</span>
                    <span className="info-value">
                      {selectedNode.type === "ap" ? "Punto de Acceso" : "Dispositivo Cliente"}
                    </span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">ID:</span>
                    <span className="info-value">{selectedNode.id}</span>
                  </div>
                  {selectedNode.type === "ap" && (
                    <div className="info-item">
                      <span className="info-label">Nombre (ESSID):</span>
                      <span className="info-value">{selectedNode.data.essid || "Oculto"}</span>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="info-section">
                <h3>Datos de señal</h3>
                <div className="info-grid">
                  <div className="info-item">
                    <span className="info-label">Potencia de señal:</span>
                    <span 
                      className="info-value" 
                      style={{ 
                        color: getPowerColor(selectedNode.data.power),
                        fontWeight: 'bold'
                      }}
                    >
                      {selectedNode.data.power} dBm
                    </span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Nivel:</span>
                    <span 
                      className="info-value"
                      style={{ 
                        color: getPowerColor(selectedNode.data.power),
                        fontWeight: 'bold'
                      }}
                    >
                      {getPowerLevel(selectedNode.data.power)}
                    </span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Círculo:</span>
                    <span className="info-value">
                      {selectedNode.circle === 1 ? "Interno (Excelente)" : 
                       selectedNode.circle === 2 ? "Medio (Bueno)" : 
                       "Externo (Débil)"}
                    </span>
                  </div>
                </div>
              </div>

              {selectedNode.type === "ap" && (
                <>
                  <div className="info-section">
                    <h3>Configuración de red</h3>
                    <div className="info-grid">
                      <div className="info-item">
                        <span className="info-label">Canal:</span>
                        <span className="info-value">{selectedNode.data.channel || "N/A"}</span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Seguridad:</span>
                        <span className="info-value">{selectedNode.data.privacy || "Desconocido"}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="info-section">
                    <h3>Dispositivos conectados</h3>
                    <div className="clients-list">
                      {selectedNode.data.clients && selectedNode.data.clients.length > 0 ? (
                        selectedNode.data.clients.map((client, index) => (
                          <div key={index} className="client-item">
                            <div className="client-mac">{client.mac}</div>
                            <div className="client-power">
                              <span>Señal: </span>
                              <span style={{ color: getPowerColor(client.power), fontWeight: 'bold' }}>
                                {client.power} dBm ({getPowerLevel(client.power)})
                              </span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="no-clients">No hay dispositivos conectados</div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            
            <div className="modal-footer">
              <button className="btn-close" onClick={closeModal}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;