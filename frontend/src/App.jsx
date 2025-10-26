import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import * as d3 from "d3";
import "./App.css";
import AccessPointModal from "/src/components/AccessPointModal";
import TrafficBar from "/src/components/TrafficBar";

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
  const simulationRef = useRef(null);
  const alertNodesRef = useRef(new Set());
  const fixedNodesRef = useRef(new Set()); // Para trackear nodos fijados

  // Colores según potencia
  const getPowerColor = (power) => {
    if (power >= -30) return "#00ff88";
    if (power >= -50) return "#00cc66";
    if (power >= -70) return "#ffaa00";
    return "#ff4444";
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

  // Función para animar alertas
  const animateAlerts = (alertBssids) => {
    const svg = d3.select(svgRef.current);
    
    // Detener todas las animaciones previas
    svg.selectAll(".node.alert").classed("alert", false);
    
    // Aplicar animación a nodos con alertas
    alertBssids.forEach(bssid => {
      const node = svg.select(`circle.node[data-id="${bssid}"]`);
      if (!node.empty()) {
        node.classed("alert", true);
        
        // Animación manual de parpadeo
        const blink = () => {
          node
            .transition().duration(500)
            .style("fill", "#ff4444")
            .style("filter", "drop-shadow(0 0 15px rgba(255, 68, 68, 0.9))")
            .transition().duration(500)
            .style("fill", d => getPowerColor(d.data.power || -80))
            .style("filter", "drop-shadow(0 0 6px rgba(255,235,59,0.6))")
            .on("end", function() {
              if (node.classed("alert")) {
                blink();
              }
            });
        };
        
        blink();
      }
    });
  };

  // ---------------- SOCKET.IO ----------------
  useEffect(() => {
    const connectSocket = () => {
      const socketUrl = "http://localhost:8000";
      console.log(`🔗 Conectando a ${socketUrl}...`);

      try {
        const socket = io(socketUrl, {
          transports: ["websocket", "polling"],
          timeout: 10000,
        });
        socketRef.current = socket;

        socket.on("connect", () => {
          console.log("✅ Conectado al servidor");
          setConnectionStatus("Conectado");
          socket.emit("request_data");
        });

        socket.on("wifi_data", (newData) => {
          console.log("📡 wifi_data recibido:");
          console.log("🔹 APs:", newData.aps?.length || 0);
          console.log("🔹 Clientes:", newData.total_clients || 0);
          console.log("🔹 Alertas:", newData.alerts?.length || 0);

          setData(newData);
          setConnectionStats((prev) => ({
            messages: prev.messages + 1,
            networks: newData.aps?.length || 0,
            clients: newData.total_clients || 0,
            connectedClients: prev.connectedClients,
            lastUpdate: new Date().toLocaleTimeString(),
          }));

          // Procesar alertas después de actualizar el estado
          if (newData.alerts && newData.alerts.length > 0) {
            const alertBssids = newData.alerts
              .filter(alert => alert.bssid)
              .map(alert => alert.bssid);
            
            console.log("🚨 BSSIDs con alertas:", alertBssids);
            
            // Pequeño delay para asegurar que los nodos estén renderizados
            setTimeout(() => {
              animateAlerts(alertBssids);
            }, 500);
          } else {
            // Si no hay alertas, detener animaciones
            const svg = d3.select(svgRef.current);
            svg.selectAll(".node.alert").classed("alert", false);
          }
        });

        socket.on("status", (status) => {
          setConnectionStats((prev) => ({
            ...prev,
            connectedClients: status.clients || 0,
          }));
        });

        socket.on("disconnect", (reason) => {
          console.log(`🔌 Desconectado: ${reason}`);
          setConnectionStatus("Desconectado");
          setTimeout(connectSocket, 3000);
        });

        socket.on("connect_error", (error) => {
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
      if (socketRef.current) socketRef.current.disconnect();
      if (simulationRef.current) simulationRef.current.stop();
    };
  }, []);

  // ---------------- D3 ----------------
  useEffect(() => {
    if (!data || !data.aps) return;

    const svg = d3.select(svgRef.current);
    const width = window.innerWidth;
    const height = window.innerHeight;
    const centerX = width / 2;
    const centerY = height / 2;

    svg.attr("width", width).attr("height", height);

    // Limpiar solo elementos de datos
    svg.select(".data-group").remove();

    // ---------------- RADAR Y PULSO ----------------
    if (!svg.select(".guide-circles").node()) {
      const guideGroup = svg.append("g").attr("class", "guide-circles");
      const radii = [
        Math.min(width, height) * 0.15,
        Math.min(width, height) * 0.25,
        Math.min(width, height) * 0.35,
      ];

      radii.forEach((r, i) => {
        const circle = guideGroup.append("circle")
          .attr("cx", centerX)
          .attr("cy", centerY)
          .attr("r", r)
          .attr("fill", "none")
          .attr("stroke", i === 0 ? "#ffeb3b" : i === 1 ? "#ffd740" : "#ffc107")
          .attr("stroke-width", 1.5)
          .attr("stroke-dasharray", "4,4")
          .attr("opacity", 0.6);

        const pulseCircle = () => {
          circle.transition()
            .duration(2000).ease(d3.easeSinInOut)
            .attr("stroke-width", 3).attr("opacity", 0.9)
            .transition().duration(2000).ease(d3.easeSinInOut)
            .attr("stroke-width", 1.5).attr("opacity", 0.6)
            .on("end", pulseCircle);
        };
        setTimeout(pulseCircle, i * 800);
      });

      // Líneas radiales
      const lines = 8;
      for (let i = 0; i < lines; i++) {
        const angle = (i / lines) * 2 * Math.PI;
        const x2 = centerX + Math.cos(angle) * radii[2];
        const y2 = centerY + Math.sin(angle) * radii[2];
        const line = guideGroup.append("line")
          .attr("x1", centerX).attr("y1", centerY)
          .attr("x2", x2).attr("y2", y2)
          .attr("stroke", "#ffeb3b").attr("stroke-width", 1)
          .attr("opacity", 0.4);

        const pulseLine = () => {
          line.transition()
            .duration(1500).ease(d3.easeSinInOut)
            .attr("stroke-width", 2).attr("opacity", 0.8)
            .attr("x2", centerX + Math.cos(angle) * (radii[2]*1.05))
            .attr("y2", centerY + Math.sin(angle) * (radii[2]*1.05))
            .transition().duration(1500).ease(d3.easeSinInOut)
            .attr("stroke-width", 1).attr("opacity", 0.4)
            .attr("x2", x2).attr("y2", y2)
            .on("end", pulseLine);
        };
        setTimeout(pulseLine, i*300);
      }

      const scanCircle = guideGroup.append("circle")
        .attr("cx", centerX).attr("cy", centerY)
        .attr("r", 5)
        .attr("fill", "#ffeb3b")
        .attr("opacity", 0.8);

      const pulseScan = () => {
        scanCircle.transition()
          .duration(1000).ease(d3.easeSinInOut)
          .attr("r", 8).attr("opacity", 1)
          .transition().duration(1000).ease(d3.easeSinInOut)
          .attr("r", 5).attr("opacity", 0.8)
          .on("end", pulseScan);
      };
      pulseScan();
    }

    // ---------------- NODOS Y LINKS ----------------
    const nodes = [];
    const links = [];

    data.aps.forEach((ap, index) => {
      let radius;
      if (ap.power >= -50) radius = Math.min(width, height)*0.15;
      else if (ap.power >= -70) radius = Math.min(width, height)*0.25;
      else radius = Math.min(width, height)*0.35;

      const angle = (index / data.aps.length) * 2 * Math.PI;
      const x = centerX + Math.cos(angle)*radius;
      const y = centerY + Math.sin(angle)*radius;

      const apNode = {
        id: ap.bssid,
        label: ap.essid || ap.bssid,
        type: "ap",
        data: ap,
        x: x,
        y: y,
        radius: radius
      };
      nodes.push(apNode);

      if(ap.clients){
        ap.clients.forEach((client, cIndex)=>{
          const clientAngle = (cIndex/ap.clients.length)*2*Math.PI;
          const clientDistance = 60 + Math.random()*40;
          const clientX = x + Math.cos(clientAngle)*clientDistance;
          const clientY = y + Math.sin(clientAngle)*clientDistance;
          const clientNode = {
            id: client.mac,
            label: client.mac,
            type: "client",
            data: client,
            parentAP: ap.bssid,
            x: clientX,
            y: clientY
          };
          nodes.push(clientNode);
          links.push({source: ap.bssid, target: client.mac});
        });
      }
    });

    const dataGroup = svg.append("g").attr("class","data-group");

    // LINKS
    const linkSel = dataGroup.selectAll("line.link").data(links, d => d.source+"-"+d.target)
      .join("line")
      .attr("class","link")
      .attr("stroke","#ffeb3b").attr("stroke-opacity",0.3)
      .attr("stroke-dasharray","3,3").attr("stroke-width",1.2);

    // NODOS
    const nodeSel = dataGroup.selectAll("circle.node").data(nodes, d => d.id)
      .join("circle")
      .attr("class","node")
      .attr("data-id", d => d.id)
      .attr("r", d => d.type === "ap" ? 16 : 8)
      .attr("cx", d => d.x).attr("cy", d => d.y)
      .attr("fill", d => getPowerColor(d.data.power || -80))
      .attr("stroke", d => (d.type === "ap" ? "#ffeb3b" : "#ffd740"))
      .attr("stroke-width", d => (d.type === "ap" ? 2.5 : 1.5))
      .style("cursor","pointer")
      .style("filter", "drop-shadow(0 0 6px rgba(255,235,59,0.6))")
      .on("click", (e, d) => {
        e.stopPropagation(); 
        setSelectedNode(d); 
        setModalOpen(true);
      });

    const labelSel = dataGroup.selectAll("text.label").data(nodes, d => d.id)
      .join("text")
      .attr("class","label")
      .attr("text-anchor","middle")
      .attr("x", d => d.x).attr("y", d => d.y - 20)
      .attr("font-size","10px")
      .attr("fill","#ffeb3b")
      .style("text-shadow","1px 1px 3px rgba(0,0,0,0.8)")
      .style("font-weight","bold")
      .text(d => (d.label.length > 10 ? d.label.slice(0,10) + "…" : d.label));

    // DRAG MEJORADO - NODOS SE QUEDAN FIJOS
    const drag = d3.drag()
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
        
        // ✅ MARCAR NODO COMO FIJADO PERMANENTEMENTE
        fixedNodesRef.current.add(d.id);
        
        // ✅ MANTENER POSICIÓN FIJA DONDE SE SOLTÓ
        d.fx = event.x;
        d.fy = event.y;
      });

    nodeSel.call(drag);

    // DOBLE CLIC PARA LIBERAR NODOS FIJADOS
    nodeSel.on("dblclick", (event, d) => {
      event.stopPropagation();
      d.fx = null;
      d.fy = null;
      fixedNodesRef.current.delete(d.id);
      simulation.alpha(0.3).restart();
    });

    // SIMULACION
    if(simulationRef.current) simulationRef.current.stop();
    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id(d => d.id).distance(d => {
        const s = nodes.find(n => n.id === d.source);
        const t = nodes.find(n => n.id === d.target);
        if(s && t && s.type === "ap" && t.type === "client") return 60;
        return 100;
      }).strength(0.1))
      .force("charge", d3.forceManyBody().strength(d => (d.type === "ap" ? -80 : -40)))
      .force("center", d3.forceCenter(centerX, centerY).strength(0.05))
      .force("collision", d3.forceCollide().radius(d => (d.type === "ap" ? 20 : 12)).strength(0.7))
      .force("radial", d3.forceRadial().radius(d => d.radius || Math.min(width, height) * 0.35).x(centerX).y(centerY).strength(d => (d.type === "ap" ? 0.1 : 0.02)))
      .alphaDecay(0.02)
      .velocityDecay(0.4)
      .on("tick", () => {
        linkSel.attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        nodeSel.attr("cx", d => d.x).attr("cy", d => d.y);
        labelSel.attr("x", d => d.x).attr("y", d => d.y - 20);
      });

    simulationRef.current = simulation;

    // Click SVG para liberar solo nodos NO FIJADOS
    svg.on("click", (event) => {
      // Solo liberar si se hace click en fondo (no en un nodo)
      if (event.target === svg.node()) {
        nodes.forEach(n => {
          // ✅ SOLO LIBERAR NODOS NO FIJADOS MANUALMENTE
          if (!fixedNodesRef.current.has(n.id)) {
            n.fx = null;
            n.fy = null;
          }
        });
        simulation.alpha(0.3).restart();
      }
    });

    // RESIZE
    const handleResize = () => {
      svg.attr("width", window.innerWidth).attr("height", window.innerHeight);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if(simulationRef.current) simulationRef.current.stop();
    };

  }, [data]);

  return (
    <div className="App">
      <header className="app-header">
        <h1>Black Swan — WiFi Recon</h1>
        <p>Visualización de redes y dispositivos conectados</p>
        
        {data && data.total_traffic !== undefined && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            gap: '10px',
            marginTop: '10px'
          }}>
            <span style={{ color: '#ffeb3b', fontWeight: 'bold' }}>Tráfico Global:</span>
            <TrafficBar packetCount={data.total_traffic} />
          </div>
        )}

        {data && data.alerts && data.alerts.length > 0 && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            gap: '10px',
            marginTop: '5px'
          }}>
            <span style={{ 
              color: '#ff4444', 
              fontWeight: 'bold',
              textShadow: '0 0 8px rgba(255, 68, 68, 0.8)',
              animation: 'pulse 1s infinite'
            }}>
              ⚠️ {data.alerts.length} ALERTA(S) ACTIVA(S) - NODOS EN ROJO PARPADEANTE
            </span>
          </div>
        )}
      </header>

      <svg ref={svgRef} className="fullscreen-svg"></svg>

      <div className={`connection-status ${connectionStatus.toLowerCase()}`}>
        <div className="status-indicator"></div>
        <span>Estado: {connectionStatus}</span>
        {connectionStats.lastUpdate && (<span> • Última actualización: {connectionStats.lastUpdate}</span>)}
        {connectionStats.networks > 0 && (<span> • Redes: {connectionStats.networks}</span>)}
        {connectionStats.clients > 0 && (<span> • Clientes: {connectionStats.clients}</span>)}
        {data && data.alerts && data.alerts.length > 0 && (
          <span style={{color: '#ff4444', fontWeight: 'bold'}}> • Alertas: {data.alerts.length}</span>
        )}
      </div>

      <div className="usage-hint">
        ❗ Click y arrastra nodos para dejarlos fijos<br/>
        🔄 Escaneo: Responde inmediatamente a cambios, <br/>actualización periódico cada 3 minutos

      </div>

      {showLegend && (
        <div className="legend-panel">
          <h3>Leyenda de señal</h3>
          <div className="legend-item"><span className="color-dot" style={{backgroundColor:"#00ff88"}}></span>Excelente (-30 dBm)</div>
          <div className="legend-item"><span className="color-dot" style={{backgroundColor:"#00cc66"}}></span>Buena (-50 dBm)</div>
          <div className="legend-item"><span className="color-dot" style={{backgroundColor:"#ffaa00"}}></span>Regular (-70 dBm)</div>
          <div className="legend-item"><span className="color-dot" style={{backgroundColor:"#ff4444"}}></span>{"Débil (< -70 dBm)"}</div>
          <div className="legend-item"><span className="color-dot" style={{backgroundColor:"#ff4444", animation: "pulse 1s infinite"}}></span>Alerta activa (parpadeante)</div>
          <button onClick={()=>setShowLegend(false)}>Minimizar</button>
        </div>
      )}

      {!showLegend && (<button className="legend-show-btn" onClick={()=>setShowLegend(true)}>📊 Mostrar leyenda</button>)}

      {modalOpen && selectedNode && (
        <AccessPointModal 
          selectedNode={selectedNode} 
          onClose={closeModal} 
        />
      )}
    </div>
  );
}

export default App;