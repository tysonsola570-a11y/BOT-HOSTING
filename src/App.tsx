import React, { useState, useEffect, Component, ErrorInfo, ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Terminal as TerminalIcon, Play, ExternalLink, Trash2, Server, Cpu, Globe, Zap, LogIn, LogOut, User, RefreshCw, Copy, Check, ShieldCheck, ShieldAlert } from "lucide-react";
import { Upload } from "./components/Upload";
import { Terminal } from "./components/Terminal";
import { auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged } from "./firebase";
import { 
  collection, 
  onSnapshot, 
  query, 
  where, 
  doc, 
  setDoc, 
  deleteDoc, 
  serverTimestamp,
  orderBy
} from "firebase/firestore";

interface Project {
  id: string;
  name: string;
  status: "idle" | "starting" | "running" | "error" | "stopped";
  port?: number;
  url?: string;
  ownerId: string;
  publicIp?: string;
  globalUrl?: string;
  framework?: string;
  customSubdomain?: string;
  mainFile?: string;
}

// Error Boundary Component
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: any }> {
  public state: { hasError: boolean; error: any };
  public props: { children: ReactNode };

  constructor(props: { children: ReactNode }) {
    super(props);
    this.props = props;
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
          <div className="bg-zinc-900 border border-red-500/50 p-8 rounded-3xl max-w-md w-full text-center">
            <h2 className="text-2xl font-bold text-red-400 mb-4">Algo deu errado</h2>
            <p className="text-zinc-400 mb-6">
              Ocorreu um erro inesperado. Por favor, tente recarregar a página.
            </p>
            <pre className="bg-black/50 p-4 rounded-xl text-xs text-left text-zinc-500 overflow-auto mb-6 max-h-40">
              {this.state.error?.message || String(this.state.error)}
            </pre>
            <button
              onClick={() => window.location.reload()}
              className="bg-zinc-100 text-zinc-950 font-bold px-6 py-2 rounded-xl hover:bg-white transition-all"
            >
              Recarregar Página
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [copiedIp, setCopiedIp] = useState<string | null>(null);
  const [subdomainInput, setSubdomainInput] = useState("");
  const [mainFileInput, setMainFileInput] = useState("");
  const [isSavingSubdomain, setIsSavingSubdomain] = useState(false);

  useEffect(() => {
    const selectedProject = projects.find(p => p.id === selectedProjectId);
    if (selectedProject) {
      setSubdomainInput(selectedProject.customSubdomain || "");
      setMainFileInput(selectedProject.mainFile || "");
    }
  }, [selectedProjectId, projects]);

  const saveSubdomain = async (projectId: string) => {
    setIsSavingSubdomain(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/subdomain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subdomain: subdomainInput }),
      });
      if (!response.ok) throw new Error("Falha ao salvar subdomínio");
      alert("URL salva com sucesso! Agora clique em 'Ligar Bot' ou 'Reiniciar' para usar o novo link.");
    } catch (error) {
      console.error("Subdomain Error:", error);
      alert("Erro ao salvar subdomínio.");
    } finally {
      setIsSavingSubdomain(false);
    }
  };

  const saveMainFile = async (projectId: string) => {
    setIsSavingSubdomain(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/mainfile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mainFile: mainFileInput }),
      });
      if (!response.ok) throw new Error("Falha ao salvar arquivo principal");
      alert("Arquivo principal salvo com sucesso!");
    } catch (error) {
      console.error("MainFile Error:", error);
      alert("Erro ao salvar arquivo principal.");
    } finally {
      setIsSavingSubdomain(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedIp(text);
    setTimeout(() => setCopiedIp(null), 2000);
  };
  const [user, setUser] = useState<any>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !isAuthReady) {
      setProjects([]);
      return;
    }

    const q = query(
      collection(db, "projects"),
      where("ownerId", "==", user.uid),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const projectsData = snapshot.docs.map((doc) => ({
        ...doc.data(),
        id: doc.id,
      })) as Project[];
      setProjects(projectsData);
    }, (error) => {
      console.error("Firestore Error:", error);
    });

    return () => unsubscribe();
  }, [user, isAuthReady]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error("Login Error:", error);
      if (error.code === "auth/unauthorized-domain") {
        alert("Erro: Domínio não autorizado. Você precisa adicionar 'bot-hosting-1-s5uc.onrender.com' na lista de domínios autorizados no Console do Firebase (Autenticação > Configurações > Domínios Autorizados).");
      } else {
        alert("Erro ao fazer login: " + error.message);
      }
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setSelectedProjectId(null);
    } catch (error) {
      console.error("Logout Error:", error);
    }
  };

  const handleUploadSuccess = async (projectId: string) => {
    if (!user) return;
    setSelectedProjectId(projectId);
  };

  const startProject = async (projectId: string, force = false) => {
    try {
      await setDoc(doc(db, "projects", projectId), { status: "starting" }, { merge: true });
      const response = await fetch(`/api/start/${projectId}`, { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force })
      });
      if (!response.ok) throw new Error("Falha ao iniciar");
    } catch (error) {
      console.error("Start Error:", error);
      await setDoc(doc(db, "projects", projectId), { status: "error" }, { merge: true });
      alert("Erro ao iniciar o bot. Verifique os logs.");
    }
  };

  const stopProject = async (projectId: string) => {
    try {
      // Optimistic update
      await setDoc(doc(db, "projects", projectId), { status: "stopped" }, { merge: true });
      const response = await fetch(`/api/stop/${projectId}`, { method: "POST" });
      if (!response.ok) throw new Error("Falha ao parar");
      alert("Bot parado! A página de aviso agora está ativa no seu link.");
    } catch (error) {
      console.error("Stop Error:", error);
      alert("Erro ao parar o bot.");
    }
  };

  const shutdownProject = async (projectId: string) => {
    try {
      await setDoc(doc(db, "projects", projectId), { status: "idle" }, { merge: true });
      const response = await fetch(`/api/shutdown/${projectId}`, { method: "POST" });
      if (!response.ok) throw new Error("Falha ao desativar");
      alert("Link desativado com sucesso! O site agora retornará erro ao tentar acessar.");
    } catch (error) {
      console.error("Shutdown Error:", error);
      alert("Erro ao desativar o link.");
    }
  };

  const restartProject = async (projectId: string) => {
    try {
      await setDoc(doc(db, "projects", projectId), { status: "starting" }, { merge: true });
      const response = await fetch(`/api/restart/${projectId}`, { method: "POST" });
      if (!response.ok) throw new Error("Falha ao reiniciar");
    } catch (error) {
      console.error("Restart Error:", error);
      await setDoc(doc(db, "projects", projectId), { status: "error" }, { merge: true });
    }
  };

  const forceReinstall = async (projectId: string) => {
    if (!confirm("Isso irá apagar a pasta node_modules e reinstalar todas as dependências. Deseja continuar?")) return;
    await startProject(projectId, true);
  };

  const deleteProject = async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Falha ao excluir arquivos");
      // The server already deletes the document, but we can do it here too just in case
      await deleteDoc(doc(db, "projects", projectId));
      if (selectedProjectId === projectId) setSelectedProjectId(null);
      setConfirmDelete(null);
    } catch (error) {
      console.error("Delete Error:", error);
      alert("Erro ao excluir projeto.");
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-emerald-400 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full text-center space-y-8"
        >
          <div className="w-20 h-20 rounded-3xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 mx-auto">
            <Zap className="w-10 h-10 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-4xl font-bold text-white mb-4">Thayson BOTS</h1>
            <p className="text-zinc-500">
              Hospede seus bots e aplicações web com facilidade e monitoramento em tempo real.
            </p>
          </div>
          <button
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 bg-white text-zinc-950 font-bold py-4 rounded-2xl hover:bg-zinc-100 transition-all active:scale-[0.98]"
          >
            <LogIn className="w-5 h-5" />
            Entrar com Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-emerald-500/30 selection:text-emerald-400">
      {/* Header */}
      <header className="border-b border-zinc-900 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
              <Zap className="w-6 h-6 text-emerald-400" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white">
              Thayson <span className="text-emerald-400">BOTS</span>
            </h1>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="hidden md:flex items-center gap-4 text-sm text-zinc-500">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4" />
                <span>Cloud Engine v1.0</span>
              </div>
              <div className="w-px h-4 bg-zinc-800" />
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4" />
                <span>Proxy Active</span>
              </div>
            </div>

            <div className="flex items-center gap-3 pl-6 border-l border-zinc-900">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="" className="w-8 h-8 rounded-full border border-zinc-800" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center">
                    <User className="w-4 h-4" />
                  </div>
                )}
                <span className="hidden sm:inline">{user.displayName?.split(" ")[0]}</span>
              </div>
              <button
                onClick={handleLogout}
                className="p-2 hover:bg-zinc-900 rounded-xl text-zinc-500 hover:text-white transition-colors"
                title="Sair"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          {/* Left Column: Upload & List */}
          <div className="lg:col-span-1 space-y-8">
            <section>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <UploadIcon className="w-5 h-5 text-emerald-400" />
                Novo Projeto
              </h2>
              <Upload onUploadSuccess={handleUploadSuccess} ownerId={user.uid} />
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Cpu className="w-5 h-5 text-emerald-400" />
                Seus Projetos
              </h2>
              <div className="space-y-3">
                {projects.length === 0 && (
                  <div className="text-center py-12 border border-zinc-900 rounded-2xl text-zinc-600 italic">
                    Nenhum projeto enviado ainda.
                  </div>
                )}
                {projects.map((project) => (
                  <motion.div
                    layout
                    key={project.id}
                    onClick={() => setSelectedProjectId(project.id)}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer group ${
                      selectedProjectId === project.id
                        ? "bg-zinc-900 border-emerald-500/50 shadow-lg shadow-emerald-500/5"
                        : "bg-zinc-900/50 border-zinc-900 hover:border-zinc-700"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${
                          project.status === "running" ? "bg-emerald-400 animate-pulse" :
                          project.status === "starting" ? "bg-amber-400 animate-pulse" :
                          project.status === "error" ? "bg-red-400" : "bg-zinc-700"
                        }`} />
                        <span className="font-medium text-sm truncate max-w-[150px]">
                          {project.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDelete(project.id); }}
                          className="p-1.5 hover:bg-red-500/10 text-zinc-600 hover:text-red-400 rounded-lg transition-colors"
                          title="Excluir Projeto"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </section>
          </div>

          {/* Right Column: Details & Terminal */}
          <div className="lg:col-span-2">
            <AnimatePresence mode="wait">
              {selectedProjectId ? (
                <motion.div
                  key={selectedProjectId}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="space-y-6"
                >
                  {/* Project Header */}
                  <div className="bg-zinc-900/50 border border-zinc-900 rounded-3xl p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-3">
                          <h2 className="text-3xl font-bold text-white mb-2">
                            {projects.find(p => p.id === selectedProjectId)?.name}
                          </h2>
                          {projects.find(p => p.id === selectedProjectId)?.framework && (
                            <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-400 font-mono font-bold uppercase">
                              {projects.find(p => p.id === selectedProjectId)?.framework}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="text-zinc-500 text-sm">
                            ID: {selectedProjectId}
                          </p>
                          <span className="text-[10px] text-zinc-600 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800 font-mono">ETERNAL MODE ACTIVE</span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-3 w-full md:w-auto">
                        {projects.find(p => p.id === selectedProjectId)?.status === "running" && (
                          <div className="flex flex-col gap-2 w-full">
                            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2">
                              <Globe className="w-3.5 h-3.5 text-zinc-500" />
                              <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">IP:</span>
                              <span className="text-xs text-zinc-100 font-mono font-bold">
                                {projects.find(p => p.id === selectedProjectId)?.publicIp || "..."}
                              </span>
                              <button
                                onClick={() => copyToClipboard(projects.find(p => p.id === selectedProjectId)?.publicIp || "")}
                                className="ml-auto p-1 hover:bg-zinc-800 rounded-md transition-colors text-zinc-500 hover:text-white"
                                title="Copiar IP"
                              >
                                {copiedIp === projects.find(p => p.id === selectedProjectId)?.publicIp ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2">
                              <Zap className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-[10px] text-emerald-500/60 font-mono uppercase tracking-wider">Link:</span>
                              <span className="text-xs text-emerald-400 font-mono font-bold truncate max-w-[150px]">
                                {window.location.origin}/app/{selectedProjectId}/
                              </span>
                              <button
                                onClick={() => copyToClipboard(`${window.location.origin}/app/${selectedProjectId}/`)}
                                className="ml-auto p-1 hover:bg-emerald-500/20 rounded-md transition-colors text-emerald-500 hover:text-emerald-300"
                                title="Copiar Link"
                              >
                                {copiedIp === `${window.location.origin}/app/${selectedProjectId}/` ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                            {projects.find(p => p.id === selectedProjectId)?.globalUrl && (
                              <div className="flex flex-col gap-2">
                                <div className="flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-3 py-2">
                                  <Globe className="w-3.5 h-3.5 text-indigo-400" />
                                  <span className="text-[10px] text-indigo-500/60 font-mono uppercase tracking-wider">Global:</span>
                                  <span className="text-xs text-indigo-400 font-mono font-bold truncate max-w-[150px]">
                                    {projects.find(p => p.id === selectedProjectId)?.globalUrl}
                                  </span>
                                  <button
                                    onClick={() => copyToClipboard(projects.find(p => p.id === selectedProjectId)?.globalUrl || "")}
                                    className="ml-auto p-1 hover:bg-indigo-500/20 rounded-md transition-colors text-indigo-500 hover:text-indigo-300"
                                    title="Copiar Link Global"
                                  >
                                    {copiedIp === projects.find(p => p.id === selectedProjectId)?.globalUrl ? (
                                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                </div>
                                {projects.find(p => p.id === selectedProjectId)?.globalUrl?.includes('loca.lt') && (
                                  <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
                                    <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                                    <span className="text-[10px] text-amber-500/60 font-mono uppercase tracking-wider">Senha Túnel:</span>
                                    <span className="text-xs text-amber-400 font-mono font-bold">
                                      {projects.find(p => p.id === selectedProjectId)?.publicIp}
                                    </span>
                                    <button
                                      onClick={() => copyToClipboard(projects.find(p => p.id === selectedProjectId)?.publicIp || "")}
                                      className="ml-auto p-1 hover:bg-amber-500/20 rounded-md transition-colors text-amber-400 hover:text-amber-300"
                                      title="Copiar Senha"
                                    >
                                      {copiedIp === projects.find(p => p.id === selectedProjectId)?.publicIp ? (
                                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                                      ) : (
                                        <Copy className="w-3.5 h-3.5" />
                                      )}
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        <div className="flex items-center gap-3 w-full">
                          {projects.find(p => p.id === selectedProjectId)?.status !== "running" ? (
                            <div className="flex flex-col gap-3 w-full">
                              <div className="flex items-center gap-3 w-full">
                                <button
                                  onClick={() => startProject(selectedProjectId!)}
                                  disabled={projects.find(p => p.id === selectedProjectId)?.status === "starting"}
                                  className="flex-1 flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-800 text-zinc-950 font-bold px-6 py-3 rounded-2xl transition-all active:scale-95"
                                >
                                  <Play className="w-5 h-5 fill-current" />
                                  {projects.find(p => p.id === selectedProjectId)?.status === "starting" ? "Iniciando..." : "Ligar Bot"}
                                </button>
                                {projects.find(p => p.id === selectedProjectId)?.status === "stopped" && (
                                  <button
                                    onClick={() => shutdownProject(selectedProjectId!)}
                                    className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-zinc-900 border border-orange-500/20 text-orange-500 hover:text-white hover:bg-orange-500 transition-all"
                                    title="Fechar Link (Not Found)"
                                  >
                                    <ShieldAlert className="w-4 h-4" />
                                    <span className="text-xs font-bold uppercase tracking-wider">Fechar Link</span>
                                  </button>
                                )}
                              </div>
                              <button
                                onClick={() => forceReinstall(selectedProjectId!)}
                                className="w-full py-2 rounded-xl border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 transition-all text-[10px] font-bold uppercase tracking-widest"
                              >
                                Forçar Reinstalação de Dependências
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-3 w-full">
                              <div className="flex items-center gap-3 w-full">
                                <a
                                  href={`/app/${selectedProjectId}/`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex-1 flex items-center justify-center gap-2 bg-zinc-100 hover:bg-white text-zinc-950 font-bold px-6 py-3 rounded-2xl transition-all active:scale-95"
                                >
                                  <ExternalLink className="w-5 h-5" />
                                  ABRIR SITE
                                </a>
                                <button
                                  onClick={() => restartProject(selectedProjectId!)}
                                  className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all"
                                  title="Reiniciar Bot"
                                >
                                  <RefreshCw className="w-4 h-4" />
                                  <span className="text-xs font-bold uppercase tracking-wider">Reiniciar</span>
                                </button>
                                <button
                                  onClick={() => stopProject(selectedProjectId!)}
                                  className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-zinc-900 border border-red-500/20 text-red-500 hover:text-white hover:bg-red-500 transition-all"
                                  title="Parar Bot"
                                >
                                  <LogOut className="w-4 h-4" />
                                  <span className="text-xs font-bold uppercase tracking-wider">Parar</span>
                                </button>
                              </div>
                              <div className="flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                <span className="text-[10px] text-emerald-500/80 font-bold uppercase tracking-widest">Monitoramento de Saúde Ativo</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Settings Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Custom Subdomain Section */}
                    <div className="bg-zinc-900/50 border border-zinc-900 rounded-3xl p-6 space-y-4">
                      <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                        <Globe className="w-4 h-4 text-emerald-400" />
                        URL Customizada
                      </h3>
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 focus-within:border-emerald-500/50 transition-all w-full">
                          <span className="text-zinc-600 font-mono text-xs">https://</span>
                          <input
                            type="text"
                            value={subdomainInput}
                            onChange={(e) => setSubdomainInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                            placeholder="seu-nome"
                            className="flex-1 bg-transparent border-none outline-none text-white font-mono text-sm px-1"
                          />
                          <span className="text-zinc-600 font-mono text-xs">.loca.lt</span>
                        </div>
                        <button
                          onClick={() => saveSubdomain(selectedProjectId!)}
                          disabled={isSavingSubdomain}
                          className="w-full bg-zinc-100 hover:bg-white disabled:bg-zinc-800 text-zinc-950 font-bold py-2 rounded-xl transition-all active:scale-95 text-xs"
                        >
                          {isSavingSubdomain ? "SALVANDO..." : "SALVAR URL"}
                        </button>
                      </div>
                    </div>

                    {/* Main File Section */}
                    <div className="bg-zinc-900/50 border border-zinc-900 rounded-3xl p-6 space-y-4">
                      <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                        <TerminalIcon className="w-4 h-4 text-emerald-400" />
                        Arquivo Principal
                      </h3>
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 focus-within:border-emerald-500/50 transition-all w-full">
                          <input
                            type="text"
                            value={mainFileInput}
                            onChange={(e) => setMainFileInput(e.target.value)}
                            placeholder="ex: bot.py ou server.js"
                            className="flex-1 bg-transparent border-none outline-none text-white font-mono text-sm"
                          />
                        </div>
                        <button
                          onClick={() => saveMainFile(selectedProjectId!)}
                          disabled={isSavingSubdomain}
                          className="w-full bg-zinc-100 hover:bg-white disabled:bg-zinc-800 text-zinc-950 font-bold py-2 rounded-xl transition-all active:scale-95 text-xs"
                        >
                          {isSavingSubdomain ? "SALVANDO..." : "SALVAR ARQUIVO"}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Terminal Section */}
                  <section className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <TerminalIcon className="w-5 h-5 text-emerald-400" />
                        Console em Tempo Real
                      </h3>
                      <div className="text-xs text-zinc-500 font-mono">
                        STATUS: {projects.find(p => p.id === selectedProjectId)?.status.toUpperCase()}
                      </div>
                    </div>
                    <Terminal projectId={selectedProjectId} />
                  </section>
                </motion.div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-12 border border-zinc-900 border-dashed rounded-3xl bg-zinc-900/20">
                  <div className="w-20 h-20 rounded-3xl bg-zinc-900 flex items-center justify-center mb-6">
                    <Cpu className="w-10 h-10 text-zinc-700" />
                  </div>
                  <h2 className="text-2xl font-bold text-zinc-400 mb-2">Nenhum projeto selecionado</h2>
                  <p className="text-zinc-600 max-w-md">
                    Selecione um projeto na lista lateral ou envie um novo arquivo ZIP para começar a hospedar.
                  </p>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-zinc-900 text-center text-zinc-600 text-sm">
        <p>© 2026 Thayson BOTS Hosting. Todos os direitos reservados.</p>
        <p className="mt-2">Hospedagem de alta performance para bots e aplicações web.</p>
      </footer>

      {/* Custom Confirm Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-8 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-medium text-white mb-4">Excluir Projeto?</h3>
            <p className="text-zinc-400 mb-8">
              Esta ação é irreversível. Todos os arquivos e dados do projeto serão removidos permanentemente.
            </p>
            <div className="flex gap-4">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 px-6 py-3 rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => deleteProject(confirmDelete)}
                className="flex-1 px-6 py-3 rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function Loader2(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function UploadIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" x2="12" y1="3" y2="15" />
    </svg>
  );
}
