import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";

const TrafficBar = ({ packetCount }) => {
  const [color, setColor] = useState("bg-green-500");

  useEffect(() => {
    if (packetCount < 100) setColor("bg-green-500");
    else if (packetCount < 500) setColor("bg-yellow-400");
    else setColor("bg-red-600");
  }, [packetCount]);

  // Normalizamos el ancho máximo a 1000 paquetes
  const normalizedWidth = Math.min(packetCount / 10, 100);

  return (
    <div className="w-3/4 bg-gray-800 rounded-2xl h-6 overflow-hidden shadow-lg relative">
      <motion.div
        className={`h-full ${color}`}
        style={{
          width: `${normalizedWidth}%`,
          boxShadow:
            packetCount > 500
              ? "0 0 20px rgba(255, 0, 0, 0.6)"
              : packetCount > 100
              ? "0 0 15px rgba(255, 255, 0, 0.4)"
              : "0 0 10px rgba(0, 255, 0, 0.3)",
        }}
        animate={{
          scale:
            packetCount > 500
              ? [1, 1.05, 1]
              : packetCount > 100
              ? [1, 1.02, 1]
              : [1],
        }}
        transition={{
          duration: 0.6,
          repeat: packetCount > 100 ? Infinity : 0,
        }}
      />
      <span className="absolute inset-0 text-xs text-center text-gray-300 flex items-center justify-center select-none">
        {packetCount} pkts
      </span>
    </div>
  );
};

export default TrafficBar;
