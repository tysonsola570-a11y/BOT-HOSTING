import React, { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { db, collection, onSnapshot, query, orderBy, limit } from "../firebase";
import { Copy, Trash2 } from "lucide-react";

interface TerminalProps {
  projectId: string;
}

export const Terminal: React.FC<TerminalProps> = ({ projectId }) => {
  const [logs, setLogs] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const terminalRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Fetch initial logs from Firestore
    const logsQuery = query(
      collection(db, "projects", projectId, "logs"),
      orderBy("timestamp", "asc"),
      limit(500)
    );

    const unsubscribeFirestore = onSnapshot(logsQuery, (snapshot) => {
      const firestoreLogs = snapshot.docs.map(doc => doc.data().content);
      setLogs(firestoreLogs);
    });

    const socket = io();
    socketRef.current = socket;

    socket.emit("join", `terminal-${projectId}`);

    socket.on("log", (data: string) => {
      // Socket logs are also saved to Firestore, so we might get duplicates if we're not careful.
      // However, Firestore onSnapshot will handle the state update.
      // To keep it real-time and snappy, we can keep the socket listener but Firestore is the source of truth.
    });

    return () => {
      unsubscribeFirestore();
      socket.disconnect();
    };
  }, [projectId]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  const handleCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !socketRef.current) return;

    socketRef.current.emit("command", { projectId, command: input });
    setInput("");
  };

  const formatLog = (log: string) => {
    if (log.includes("[Intelligence]")) {
      return <span className="text-emerald-400 font-bold">{log}</span>;
    }
    if (log.includes("[Auto-Fix]")) {
      return <span className="text-amber-400 italic">{log}</span>;
    }
    if (log.includes("[Warning]")) {
      return <span className="text-red-400 font-semibold">{log}</span>;
    }
    return <span>{log}</span>;
  };

  const copyLogs = () => {
    const text = logs.join("\n");
    navigator.clipboard.writeText(text);
    alert("Logs copiados para a área de transferência!");
  };

  const clearLogs = () => {
    setLogs([]);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Console Output</span>
        <div className="flex items-center gap-2">
          <button 
            onClick={copyLogs}
            className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all text-[10px] font-bold"
          >
            <Copy className="w-3 h-3" />
            COPIAR
          </button>
          <button 
            onClick={clearLogs}
            className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all text-[10px] font-bold"
          >
            <Trash2 className="w-3 h-3" />
            LIMPAR
          </button>
        </div>
      </div>
      <div className="bg-black text-zinc-400 p-6 rounded-2xl font-mono text-sm h-[400px] overflow-y-auto border border-zinc-900 shadow-inner" ref={terminalRef}>
        <div className="space-y-1">
          {logs.map((log, i) => (
            <div key={i} className="whitespace-pre-wrap break-all leading-relaxed">
              {formatLog(log)}
            </div>
          ))}
          {logs.length === 0 && <div className="text-zinc-700 animate-pulse italic">Aguardando logs do servidor...</div>}
        </div>
      </div>
      
      <form onSubmit={handleCommand} className="relative">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Digite um comando (ex: ls, npm install, python)..."
          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-100 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
        />
        <button 
          type="submit"
          className="absolute right-2 top-1/2 -translate-y-1/2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 px-3 py-1 rounded-lg text-xs font-bold transition-colors"
        >
          EXECUTAR
        </button>
      </form>
    </div>
  );
};
