import React, { useEffect, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import axios from "axios";

export default function BlackSwanRecon() {
  const [data, setData] = useState({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const fgRef = useRef();

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        // Use full host to avoid dev server proxy issues
        const res = await axios.get("http://localhost:8000/api/recon", { timeout: 5000 });
        console.log("API /api/recon response:", res.data);
        const aps = Array.isArray(res.data.aps) ? res.data.aps : [];
        const nodes = [];
        const links = [];

        // if no aps, keep nodes empty (we'll show message)
        aps.forEach((ap) => {
          const apId = ap.bssid || `ap-${Math.random().toString(36).slice(2,7)}`;
          nodes.push({
            id: apId,
            name: ap.essid || apId,
            type: "ap",
            signal: ap.power ?? null,
            encryption: ap.privacy ?? null
          });

          if (Array.isArray(ap.clients)) {
            ap.clients.forEach((client) => {
              const clientId = client.mac || `c-${Math.random().toString(36).slice(2,7)}`;
              nodes.push({
                id: clientId,
                name: clientId,
                type: "client",
                signal: client.power ?? null,
                connected_to: apId
              });
              links.push({ source: apId, target: clientId });
            });
          }
        });

        // dedupe nodes by id
        const deduped = Object.values(nodes.reduce((acc, n) => { acc[n.id]=n; return acc; }, {}));
        setData({ nodes: deduped, links });
      } catch (e) {
        console.error("Error fetching /api/recon:", e);
        setError(e.message || "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // optional: poll every 10s
    // const id = setInterval(fetchData, 10000);
    // return () => clearInterval(id);
  }, []);

  const onNodeRightClick = (node, event) => {
    event.preventDefault();
    setSelectedNode(node);
    setContextMenu({ x: event.clientX, y: event.clientY });
  };

  const handleAttack = async (type) => {
    if (!selectedNode) return;
    setContextMenu(null);

    try {
      const payload = { type, target: selectedNode.id, interface: "wlan0mon" };
      const res = await axios.post("http://localhost:8000/api/attack", payload, { timeout: 2000 });
      alert(`Started ${type} on ${selectedNode.id} (server pid: ${res.data.pid ?? "n/a"})`);
      console.log("attack started response:", res.data);
    } catch (err) {
      console.error("attack error:", err);
      alert("Attack failed: " + (err.response?.data?.detail || err.message));
    }
  };

  // draw labels and different sizes
  const nodeCanvas = (node, ctx, globalScale) => {
    const label = node.name || node.id;
    const fontSize = 12 / globalScale;
    ctx.beginPath();
    ctx.fillStyle = node.type === "ap" ? "#00bcd4" : "#4caf50";
    const r = node.type === "ap" ? 16 : 10;
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
    ctx.fill();

    ctx.font = `${fontSize}px Sans-Serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, node.x, node.y + (r + 2));
  };

  return (
    <div style={{ backgroundColor: "#0b0b0b", height: "100vh", color: "cyan", padding: 10 }}>
      <h2 style={{ color: "cyan", textAlign: "center", margin: 8 }}>Black Swan — WiFi Recon</h2>

      {loading && <div style={{ color: "#9ad", textAlign: "center" }}>Loading recon data...</div>}
      {error && <div style={{ color: "tomato", textAlign: "center" }}>Error: {error}</div>}
      {!loading && !error && data.nodes.length === 0 && (
        <div style={{ color: "#9ad", textAlign: "center" }}>
          No APs found. Run `parse_airodump.py` to generate recon_output.json or load a test JSON.
        </div>
      )}

      <div style={{ height: "80vh" }}>
        <ForceGraph2D
          ref={fgRef}
          graphData={data}
          nodeLabel="name"
          nodePointerAreaPaint={(node, color, ctx) => {
            // pointer area larger
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(node.x, node.y, node.type === "ap" ? 18 : 12, 0, 2 * Math.PI, false);
            ctx.fill();
          }}
          nodeCanvasObject={nodeCanvas}
          onNodeRightClick={onNodeRightClick}
          width={window.innerWidth - 20}
          height={(window.innerHeight * 0.8)}
        />
      </div>

      {contextMenu && (
        <div style={{
          position: "absolute", top: contextMenu.y, left: contextMenu.x,
          backgroundColor: "#222", color: "#fff", padding: 10, borderRadius: 8, zIndex: 1000
        }}>
          <div style={{ marginBottom: 6 }}>🎯 Attacks for: {selectedNode?.id}</div>
          <button onClick={() => handleAttack("deauth")}>💣 Deauth</button><br />
          <button onClick={() => handleAttack("handshake")}>💍 Handshake</button><br />
          <button onClick={() => handleAttack("crack")}>🔓 Crack</button><br />
          <button onClick={() => setContextMenu(null)}>❌ Cancel</button>
        </div>
      )}
    </div>
  );
}
