import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import "./App.css";

function App() {
  const svgRef = useRef();
  const [data, setData] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [showLegend, setShowLegend] = useState(true);

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8000/ws/recon");
  
    ws.onopen = () => {
      console.log("✅ Conectado al WebSocket del backend");
    };
  
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        // Si el backend envía datos tipo { aps: [...] }
        if (message.aps) {
          setData(message);
        } else {
          console.warn("Mensaje desconocido recibido:", message);
        }
      } catch (err) {
        console.error("Error al parsear datos del WebSocket:", err);
      }
    };
  
    ws.onerror = (error) => {
      console.error("❌ Error en WebSocket:", error);
    };
  
    ws.onclose = () => {
      console.warn("⚠️ WebSocket cerrado, reconectando en 3s...");
      setTimeout(() => {
        window.location.reload();
      }, 3000);
    };
  
    // Limpieza
    return () => {
      ws.close();
    };
  }, []);
  

  useEffect(() => {
    if (!data) return;

    const updateDimensions = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const headerHeight = 70;
      
      const nodes = [];
      const links = [];

      const sortedAps = [...data.aps].sort((a, b) => b.power - a.power);

      sortedAps.forEach((ap) => {
        nodes.push({ 
          id: ap.bssid, 
          label: ap.essid || ap.bssid, 
          type: "ap",
          data: ap
        });
        
        const sortedClients = [...ap.clients].sort((a, b) => b.power - a.power);
        
        sortedClients.forEach((client) => {
          nodes.push({ 
            id: client.mac, 
            label: client.mac, 
            type: "client",
            data: client
          });
          links.push({ source: ap.bssid, target: client.mac });
        });
      });

      const svg = d3.select(svgRef.current)
        .attr("width", width)
        .attr("height", height);

      svg.selectAll("*").remove();

      const forceBoundary = (alpha) => {
        const padding = 60;
        const topPadding = headerHeight + padding;
        for (const node of nodes) {
          node.x = Math.max(padding, Math.min(width - padding, node.x));
          node.y = Math.max(topPadding, Math.min(height - padding, node.y));
        }
      };

      const simulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links).id(d => d.id).distance(100))
        .force("charge", d3.forceManyBody().strength(-150))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(35))
        .force("boundary", forceBoundary)
        .force("radial", d3.forceRadial(
          Math.min(width, height) * 0.25,
          width / 2,
          height / 2
        ).strength(0.2));

      const link = svg.append("g")
        .attr("stroke", "#ffeb3b")
        .attr("stroke-opacity", 0.7)
        .selectAll("line")
        .data(links)
        .join("line")
        .attr("stroke-width", 2)
        .attr("stroke-dasharray", "3,3");

      const calculateNodeSize = (node) => {
        if (node.type === "ap") {
          const power = node.data.power;
          const normalizedPower = Math.max(0, Math.min(1, (power + 80) / 60));
          return 18 + (normalizedPower * 12);
        } else {
          const power = node.data.power;
          const normalizedPower = Math.max(0, Math.min(1, (power + 80) / 60));
          return 12 + (normalizedPower * 10);
        }
      };

      const calculateNodeColor = (node) => {
        const power = node.data.power;
        if (power >= -30) return "#ffeb3b";
        if (power >= -50) return "#ff9800";
        if (power >= -70) return "#ff5722";
        return "#795548";
      };

      const node = svg.append("g")
        .selectAll("circle")
        .data(nodes)
        .join("circle")
        .attr("r", d => calculateNodeSize(d))
        .attr("fill", d => calculateNodeColor(d))
        .attr("stroke", d => d.type === "ap" ? "#fbc02d" : "#f57c00")
        .attr("stroke-width", 2)
        .style("cursor", "pointer")
        .style("filter", "drop-shadow(0 0 8px rgba(255, 235, 59, 0.6))")
        .call(drag(simulation))
        .on("click", (event, d) => {
          setSelectedNode(d);
          setModalOpen(true);
        })
        .on("mouseover", function(event, d) {
          d3.select(this)
            .transition()
            .duration(200)
            .attr("r", calculateNodeSize(d) + 4)
            .style("filter", "drop-shadow(0 0 12px rgba(255, 235, 59, 0.8))");
        })
        .on("mouseout", function(event, d) {
          d3.select(this)
            .transition()
            .duration(200)
            .attr("r", calculateNodeSize(d))
            .style("filter", "drop-shadow(0 0 8px rgba(255, 235, 59, 0.6))");
        });

      const label = svg.append("g")
        .selectAll("text")
        .data(nodes)
        .join("text")
        .text(d => {
          if (d.type === "client" && d.label.length > 10) {
            return d.label.substring(0, 8) + "...";
          }
          if (d.type === "ap" && d.label.length > 12) {
            return d.label.substring(0, 10) + "...";
          }
          return d.label;
        })
        .attr("text-anchor", "middle")
        .attr("dy", 4)
        .attr("font-size", "10px")
        .attr("font-weight", "bold")
        .attr("fill", "#000")
        .style("pointer-events", "none")
        .style("text-shadow", "1px 1px 2px rgba(255, 255, 255, 0.8)");

      simulation.on("tick", () => {
        node.attr("cx", d => d.x).attr("cy", d => d.y);
        label.attr("x", d => d.x).attr("y", d => d.y);
        link.attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);
      });

      function drag(simulation) {
        return d3.drag()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          });
      }
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    
    return () => {
      window.removeEventListener("resize", updateDimensions);
    };
  }, [data]);

  const closeModal = () => {
    setModalOpen(false);
    setSelectedNode(null);
  };

  const getPowerLevel = (power) => {
    if (power >= -30) return "Muy Cercano";
    if (power >= -50) return "Cercano";
    if (power >= -70) return "Medio";
    return "Lejano";
  };

  const getPowerColor = (power) => {
    if (power >= -30) return "#4caf50";
    if (power >= -50) return "#ff9800";
    if (power >= -70) return "#ff5722";
    return "#795548";
  };

  return (
    <div className="App">
      <header className="app-header">
        <h1>Black Swan — WiFi Recon</h1>
        <p>Visualización de redes y dispositivos conectados</p>
      </header>
      
      <svg ref={svgRef} className="fullscreen-svg"></svg>

      {/* Leyenda flotante */}
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
                    <strong>Excelente (-30 dBm o mejor)</strong>
                    <span>Muy cercano - Señal óptima</span>
                  </div>
                </div>
                <div className="legend-item">
                  <div className="color-dot" style={{ backgroundColor: '#ff9800' }}></div>
                  <div className="legend-text">
                    <strong>Bueno (-30 a -50 dBm)</strong>
                    <span>Cercano - Buena conexión</span>
                  </div>
                </div>
                <div className="legend-item">
                  <div className="color-dot" style={{ backgroundColor: '#ff5722' }}></div>
                  <div className="legend-text">
                    <strong>Regular (-50 a -70 dBm)</strong>
                    <span>Distancia media - Conexión aceptable</span>
                  </div>
                </div>
                <div className="legend-item">
                  <div className="color-dot" style={{ backgroundColor: '#795548' }}></div>
                  <div className="legend-text">
                    <strong>Débil (menos de -70 dBm)</strong>
                    <span>Lejano - Señal pobre</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="legend-section">
              <h4>Tamaño de los Nodos</h4>
              <div className="legend-items">
                <div className="legend-item">
                  <div className="size-dots">
                    <div className="size-dot large"></div>
                    <div className="size-dot medium"></div>
                    <div className="size-dot small"></div>
                  </div>
                  <div className="legend-text">
                    <strong>Señal más fuerte → Nodo más grande</strong>
                    <span>El tamaño indica la potencia de la señal</span>
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

      {/* Botón para mostrar leyenda cuando está minimizada */}
      {!showLegend && (
        <button 
          className="legend-show-btn"
          onClick={() => setShowLegend(true)}
        >
          📊 Mostrar Leyenda
        </button>
      )}

      {modalOpen && selectedNode && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
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