import express from "express";
import { createServer as createViteServer } from "vite";
import { Server } from "socket.io";
import { createServer } from "http";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import AdmZip from "adm-zip";
import firebaseConfig from "./firebase-applet-config.json";
import { db, collection, doc, setDoc, addDoc, updateDoc, serverTimestamp } from "./src/firebase";
import { createProxyMiddleware } from "http-proxy-middleware";
import cors from "cors";
import localtunnel from "localtunnel";
import { GoogleGenAI } from "@google/genai";

const PORT = 3000;
const PROJECTS_DIR = path.join(process.cwd(), "projects");

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

const proxyTargets = new Map<string, string>();

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function handleFirestoreError(error: any, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    serverSide: true
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return new Error(JSON.stringify(errInfo));
}

if (!fs.existsSync(PROJECTS_DIR)) {
  fs.mkdirSync(PROJECTS_DIR);
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: "*" }
  });

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));

  const activeProjects = new Map<string, { port: number; process: any; cwd: string; tunnel?: any; lastCheck?: number }>();
  const startingProjects = new Set<string>();
  let nextPort = 3001;

  // Framework Detection Logic
  const findProjectRoot = (dir: string): string => {
    const files = fs.readdirSync(dir);
    
    // If it's a wrapper folder (only one directory inside), go deeper
    if (files.length === 1 && fs.statSync(path.join(dir, files[0])).isDirectory()) {
      return findProjectRoot(path.join(dir, files[0]));
    }

    // Check if this folder has common project markers
    const markers = ["package.json", "requirements.txt", "manage.py", "index.js", "server.js", "app.js", "index.html", "go.mod", "Cargo.toml"];
    if (markers.some(m => fs.existsSync(path.join(dir, m)))) {
      return dir;
    }

    // If not, look for a folder that has these markers
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory() && file !== "node_modules" && !file.startsWith(".")) {
        if (markers.some(m => fs.existsSync(path.join(fullPath, m)))) {
          return fullPath;
        }
      }
    }

    return dir;
  };

  const detectFramework = (dir: string) => {
    const hasFile = (file: string) => fs.existsSync(path.join(dir, file));
    const pkgPath = path.join(dir, "package.json");
    let pkg: any = {};
    if (fs.existsSync(pkgPath)) {
      try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      } catch (e) {
        console.error("Error parsing package.json", e);
      }
    }

    // 1. Vite / React / Vue / Svelte (Node-based)
    if (pkg.devDependencies?.vite || pkg.dependencies?.vite) return { type: "Vite", cmd: "npm", args: ["run", "dev"] };
    if (pkg.dependencies?.next) return { type: "Next.js", cmd: "npm", args: ["run", "dev"] };
    if (pkg.dependencies?.["@angular/core"]) return { type: "Angular", cmd: "npm", args: ["start"] };
    if (pkg.dependencies?.nuxt) return { type: "Nuxt", cmd: "npm", args: ["run", "dev"] };
    if (pkg.dependencies?.gatsby) return { type: "Gatsby", cmd: "npm", args: ["run", "develop"] };
    if (pkg.dependencies?.["@remix-run/react"]) return { type: "Remix", cmd: "npm", args: ["run", "dev"] };
    if (pkg.dependencies?.astro) return { type: "Astro", cmd: "npm", args: ["run", "dev"] };
    if (pkg.dependencies?.["hexo-cli"]) return { type: "Hexo", cmd: "npx", args: ["hexo", "server", "-p", "$PORT"] };
    
    // 2. Python (Django, Flask, FastAPI, Streamlit)
    if (hasFile("manage.py")) return { type: "Django", cmd: "python3", args: ["manage.py", "runserver", "0.0.0.0:$PORT"] };
    if (hasFile("requirements.txt")) {
      const reqs = fs.readFileSync(path.join(dir, "requirements.txt"), "utf8");
      if (reqs.includes("flask")) return { type: "Flask", cmd: "python3", args: ["-m", "flask", "run", "--host=0.0.0.0", "--port=$PORT"] };
      if (reqs.includes("fastapi")) return { type: "FastAPI", cmd: "uvicorn", args: ["main:app", "--host", "0.0.0.0", "--port", "$PORT"] };
      if (reqs.includes("streamlit")) return { type: "Streamlit", cmd: "streamlit", args: ["run", "app.py", "--server.port", "$PORT"] };
    }
    if (hasFile("main.py") || hasFile("app.py")) return { type: "Python", cmd: "python3", args: [hasFile("main.py") ? "main.py" : "app.py"] };

    // 3. PHP (Laravel, Symfony, Generic)
    if (hasFile("artisan")) return { type: "Laravel", cmd: "php", args: ["artisan", "serve", "--host=0.0.0.0", "--port=$PORT"] };
    if (hasFile("bin/console")) return { type: "Symfony", cmd: "php", args: ["bin/console", "server:run", "0.0.0.0:$PORT"] };
    if (hasFile("index.php")) return { type: "PHP", cmd: "php", args: ["-S", "0.0.0.0:$PORT"] };

    // 4. Go (Hugo, Gin, Fiber)
    if (hasFile("go.mod")) return { type: "Go", cmd: "go", args: ["run", "."] };
    if (hasFile("config.toml") && hasFile("content")) return { type: "Hugo", cmd: "hugo", args: ["server", "--bind", "0.0.0.0", "-p", "$PORT"] };

    // 5. Rust (Rocket, Actix)
    if (hasFile("Cargo.toml")) return { type: "Rust", cmd: "cargo", args: ["run"] };

    // 6. Ruby (Rails, Jekyll)
    if (hasFile("Gemfile")) {
      const gemfile = fs.readFileSync(path.join(dir, "Gemfile"), "utf8");
      if (gemfile.includes("rails")) return { type: "Rails", cmd: "bundle", args: ["exec", "rails", "server", "-b", "0.0.0.0", "-p", "$PORT"] };
      if (gemfile.includes("jekyll")) return { type: "Jekyll", cmd: "bundle", args: ["exec", "jekyll", "serve", "--host", "0.0.0.0", "--port", "$PORT"] };
    }

    // 6. Generic Node
    if (pkg.scripts?.dev) return { type: "Node (Dev)", cmd: "npm", args: ["run", "dev"] };
    if (pkg.scripts?.start) return { type: "Node (Start)", cmd: "npm", args: ["npm", "start"] };
    if (hasFile("server.js") || hasFile("index.js") || hasFile("app.js")) {
      return { type: "Node", cmd: "node", args: [hasFile("server.js") ? "server.js" : (hasFile("index.js") ? "index.js" : "app.js")] };
    }

    // 7. Static
    if (hasFile("index.html")) return { type: "Static", cmd: "npx", args: ["serve", "-p", "$PORT"] };

    return { type: "Unknown", cmd: "node", args: ["index.js"] };
  };

  const stopProject = async (projectId: string) => {
    const project = activeProjects.get(projectId);
    if (project) {
      if (project.process) project.process.kill();
      if (project.tunnel) project.tunnel.close();
      activeProjects.delete(projectId);
      await updateDoc(doc(db, "projects", projectId), { status: "stopped", globalUrl: "" });
      return true;
    }
    return false;
  };

  const startProject = async (projectId: string) => {
    if (startingProjects.has(projectId)) {
      console.log(`[Intelligence] Project ${projectId} is already starting. Skipping duplicate call.`);
      return;
    }
    startingProjects.add(projectId);

    const projectPath = path.join(PROJECTS_DIR, projectId);

    if (!fs.existsSync(projectPath)) {
      throw new Error("Project not found");
    }

    // Kill existing if any
    if (activeProjects.has(projectId)) {
      activeProjects.get(projectId)!.process.kill();
      activeProjects.delete(projectId);
    }

    const port = nextPort++;
    const terminalId = `terminal-${projectId}`;
    const log = async (data: string) => {
      io.to(terminalId).emit("log", data);

      // Dynamic Port Detection
      const urlMatch = data.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\]):(\d+)/i) || 
                       data.match(/Running on (?:https?:\/\/)?(?:[^\s:]+):(\d+)/i) ||
                       data.match(/port\s*[:=]\s*(\d+)/i);
      
      if (urlMatch && !data.includes("[Intelligence]")) {
        const detectedPort = urlMatch[1];
        if (parseInt(detectedPort) !== 3000 && parseInt(detectedPort) !== port) {
          log(`[Intelligence] Detected application running on port ${detectedPort}. Updating tunnel target...\n`);
          proxyTargets.set(projectId, `http://localhost:${detectedPort}`);
        }
      }

      // Save to Firestore for persistence
      try {
        await addDoc(collection(db, "projects", projectId, "logs"), {
          content: data,
          timestamp: serverTimestamp(),
          projectId
        });
      } catch (e) {
        handleFirestoreError(e, OperationType.WRITE, `projects/${projectId}/logs`);
      }
    };

    log(`[Intelligence] Starting automatic deployment for ${projectId} on port ${port}...\n`);

    // Auto-Fix: Only patches hardcoded ports to avoid EADDRINUSE errors
    const autoFix = (dir: string, projectId: string) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
          if (file !== "node_modules" && file !== ".git") autoFix(fullPath, projectId);
        } else if (file.endsWith(".ts") || file.endsWith(".js") || file.endsWith(".json") || file.endsWith(".mjs") || file.endsWith(".tsx")) {
          try {
            let content = fs.readFileSync(fullPath, "utf8");
            let changed = false;

            // Port patching - ONLY this part is allowed to avoid EADDRINUSE
            // We target common hardcoded ports that conflict in this environment
            const portRegex = /(?:port|PORT|listen|target)\s*[:=(]\s*(3000|5173|8080|8000|24678|3001|3002)/g;
            if (portRegex.test(content)) {
              log(`[Auto-Fix] Patching port conflict in ${file}...\n`);
              content = content.replace(portRegex, (match, p1) => {
                if (match.includes("(")) return match.replace(p1, "process.env.PORT || " + p1);
                if (match.includes(":")) return match.replace(p1, "parseInt(process.env.PORT || '" + p1 + "')");
                return match.replace(p1, "process.env.PORT || " + p1);
              });
              changed = true;
            }
            
            // Host/AllowedHosts patching - Surgical fix for Vite 6 tunnel blocking
            // This is treated as a "Host Conflict" fix, necessary for the tunnel to work
            if (file.includes("vite.config") && !content.includes("allowedHosts")) {
               log(`[Auto-Fix] Patching allowedHosts in ${file} for tunnel compatibility...\n`);
               if (content.includes("server: {")) {
                 content = content.replace("server: {", "server: {\n    allowedHosts: true,");
               } else if (content.includes("return {")) {
                 content = content.replace("return {", "return {\n    server: { allowedHosts: true },");
               } else if (content.includes("defineConfig({")) {
                 content = content.replace("defineConfig({", "defineConfig({\n    server: { allowedHosts: true },");
               }
               changed = true;
            }
            
            // Fix hardcoded host/port strings
            if (content.includes("0.0.0.0:3000") || content.includes("localhost:3000") || content.includes("127.0.0.1:3000")) {
               content = content.replace(/(?:0\.0\.0\.0|localhost|127\.0\.0\.1):3000/g, `0.0.0.0:\${process.env.PORT || '3000'}`);
               changed = true;
            }
            
            // Broad host patching for server listening
            if (content.includes("localhost") || content.includes("127.0.0.1")) {
              const hostMatch = content.match(/(?:'|"|`)(?:localhost|127\.0\.0\.1)(?:'|"|`)/);
              if (hostMatch && (content.includes("listen") || content.includes("host") || content.includes("server"))) {
                log(`[Auto-Fix] Patching host to 0.0.0.0 in ${file}...\n`);
                content = content.replace(/(['"`])(?:localhost|127\.0\.0\.1)(['"`])/g, "$10.0.0.0$2");
                changed = true;
              }
            }

            if (changed) fs.writeFileSync(fullPath, content);
          } catch (e) {}
        }
      }
    };

    const aiSelfHeal = async (errorLog: string, filePath: string) => {
      // If it's a port error, we try to fix it surgically
      if (errorLog.includes("EADDRINUSE")) {
        log(`[Self-Healing] Port conflict detected in ${path.basename(filePath)}. Attempting surgical fix...\n`);
        try {
          let content = fs.readFileSync(filePath, "utf8");
          content = content.replace(/(?:port|PORT|listen)\s*[:=(]\s*(\d{4,5})/g, (match, p1) => {
            if (match.includes("(")) return match.replace(p1, "process.env.PORT || " + p1);
            if (match.includes(":")) return match.replace(p1, "parseInt(process.env.PORT || '" + p1 + "')");
            return match.replace(p1, "process.env.PORT || " + p1);
          });
          fs.writeFileSync(filePath, content);
          return true;
        } catch (e) {
          return false;
        }
      }

      log(`[Intelligence] Error detected in ${path.basename(filePath)}:\n`);
      log(`--------------------------------------------------\n`);
      log(`${errorLog}\n`);
      log(`--------------------------------------------------\n`);
      log(`[Tip] Please check the file and line mentioned above to fix the error manually.\n`);
      return false; // Do not attempt to fix other errors
    };

    // Sequential command execution
    const runCommand = (cmd: string, args: string[], env = {}, cwd = projectPath) => {
      return new Promise((resolve) => {
        log(`[Intelligence] Executing: ${cmd} ${args.join(" ")} in ${cwd}\n`);
        
        // Add optimization flags for npm install
        if (cmd === "npm" && args[0] === "install") {
          if (!args.includes("--prefer-offline")) args.push("--prefer-offline");
          if (!args.includes("--no-audit")) args.push("--no-audit");
          if (!args.includes("--no-fund")) args.push("--no-fund");
        }

        const child = spawn(cmd, args, {
          cwd: cwd,
          env: { ...process.env, ...env, PORT: port.toString() },
          shell: true
        });

        // Keep-alive timer for long commands (like npm install)
        const keepAlive = setInterval(() => {
          log(`[Intelligence] Still working on ${cmd}... Please wait.\n`);
        }, 15000);

        child.stdout.on("data", (data) => log(data.toString()));
        child.stderr.on("data", async (data) => {
          const output = data.toString();
          log(output);

          // Self-Healing: Detect missing modules
          const moduleMatch = output.match(/Cannot find module '([^']+)'/i) || 
                              output.match(/Error: Cannot find module "([^"]+)"/i) ||
                              output.match(/Module not found: Error: Can't resolve '([^']+)'/i);
          
          if (moduleMatch) {
            const missingModule = moduleMatch[1];
            if (!missingModule.startsWith("/") && !missingModule.startsWith(".")) {
              log(`[Self-Healing] Missing module detected: ${missingModule}. Installing now...\n`);
              const installChild = spawn("npm", ["install", missingModule, "--no-save"], { cwd: cwd, shell: true });
              installChild.on("close", () => {
                log(`[Self-Healing] Module ${missingModule} installed. Retrying...\n`);
                resolve("retry");
              });
            } else if (missingModule.endsWith(".js") || missingModule.endsWith(".ts") || output.includes("Expected") || output.includes("Unexpected")) {
              // Try AI Self-Healing for syntax errors
              const targetFile = output.includes("vite.config.ts") ? path.join(cwd, "vite.config.ts") : 
                                (missingModule.startsWith("/") ? missingModule : path.join(cwd, missingModule));
              
              if (fs.existsSync(targetFile)) {
                const healed = await aiSelfHeal(output, targetFile);
                if (healed) resolve("retry");
              }
            }
          }
          
          // Catch generic syntax errors that don't match "Cannot find module"
          if (output.includes("ERROR") && (output.includes("Expected") || output.includes("Unexpected") || output.includes("SyntaxError"))) {
             const fileMatch = output.match(/([a-zA-Z0-9._\-\/]+\.(?:ts|js|tsx|jsx))/);
             if (fileMatch) {
               const targetFile = path.isAbsolute(fileMatch[1]) ? fileMatch[1] : path.join(cwd, fileMatch[1]);
               if (fs.existsSync(targetFile)) {
                 const healed = await aiSelfHeal(output, targetFile);
                 if (healed) resolve("retry");
               }
             }
          }
        });

        child.on("close", (code) => {
          clearInterval(keepAlive);
          resolve(code);
        });
        
        if (cmd === "npm" && (args.includes("run") || args.includes("start") || args.includes("dev"))) {
          activeProjects.set(projectId, { port, process: child, cwd: cwd });
        }
        // Also track direct node processes
        if (cmd === "node" || cmd === "tsx" || cmd === "python3" || cmd === "php" || cmd === "go" || cmd === "cargo") {
          activeProjects.set(projectId, { port, process: child, cwd: cwd });
        }
      });
    };

    const startSequence = async () => {
      try {
        const realRoot = findProjectRoot(projectPath);
        log(`[Intelligence] Real project root detected at: ${realRoot}\n`);
        
        log(`[Intelligence] Starting automatic deployment for ${projectId} on port ${port}...\n`);
        autoFix(realRoot, projectId);

        log(`[Intelligence] Step 1: Checking environment and dependencies...\n`);
        const hasPackageJson = fs.existsSync(path.join(realRoot, "package.json"));
        
        if (hasPackageJson) {
          const hasNodeModules = fs.existsSync(path.join(realRoot, "node_modules"));
          if (!hasNodeModules) {
            log(`[Intelligence] node_modules missing. Running npm install...\n`);
            await runCommand("npm", ["install"], {}, realRoot);
          }
        }

        // Fetch Public IP
        let publicIp = "";
        try {
          const ipRes = await fetch("https://api.ipify.org?format=json");
          const ipData: any = await ipRes.json();
          publicIp = ipData.ip;
        } catch (e) {
          log(`[Warning] Failed to fetch public IP: ${e}\n`);
        }

        // Setup Public Tunnel (Localtunnel with Subdomain & Reconnect)
        // We start the tunnel BEFORE the server so it's ready
        let globalUrl = "";

        const setupTunnel = async (targetPort: number): Promise<void> => {
          let retryCount = 0;
          const cleanId = projectId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
          const subdomain = `thayson-${cleanId}`;

          while (retryCount <= 3) {
            try {
              // Close existing tunnel if any
              const existing = activeProjects.get(projectId);
              if (existing && existing.tunnel) {
                existing.tunnel.close();
              }

              log(`[Intelligence] Opening persistent global tunnel (subdomain: ${subdomain})...\n`);
              
              const tunnel = await localtunnel({ 
                port: targetPort,
                subdomain: subdomain
              });

              if (tunnel.url.includes(subdomain) || retryCount === 3) {
                if (tunnel.url.includes(subdomain)) {
                  log(`[Intelligence] Persistent Link Secured: ${tunnel.url}\n`);
                } else {
                  log(`[Warning] Subdomain still busy. Using temporary link: ${tunnel.url}\n`);
                }

                globalUrl = tunnel.url;
                log(`[Intelligence] Global Tunnel Ready: ${globalUrl}\n`);
                log(`[Security] Tunnel Password (IP): ${publicIp}\n`);
                log(`[Tip] If you get a 503 error, wait 5 seconds and refresh (F5). Your app is just finishing its startup.\n`);
                
                await updateDoc(doc(db, "projects", projectId), { globalUrl });

                const current = activeProjects.get(projectId);
                if (current) {
                  activeProjects.set(projectId, { ...current, tunnel });
                }

                tunnel.on('close', () => {
                  log(`[Warning] Global tunnel closed. Reconnecting in 5s...\n`);
                  setTimeout(() => setupTunnel(targetPort), 5000);
                });

                tunnel.on('error', (err) => {
                  log(`[Error] Tunnel error: ${err.message}. Retrying...\n`);
                  tunnel.close();
                });

                return; // Success or final fallback
              } else {
                log(`[Warning] Subdomain ${subdomain} was busy. Retrying in 5s (${retryCount + 1}/3)...\n`);
                tunnel.close();
                retryCount++;
                await new Promise(resolve => setTimeout(resolve, 5000));
              }
            } catch (e: any) {
              log(`[Warning] Localtunnel attempt failed: ${e.message}. Retrying in 10s...\n`);
              retryCount++;
              await new Promise(resolve => setTimeout(resolve, 10000));
            }
          }
          
          // If we reach here, localtunnel failed completely
          log(`[Intelligence] Switching to SSH Tunnel fallback (localhost.run)...\n`);
          setupSSHTunnel(targetPort);
        };

        const setupSSHTunnel = (targetPort: number) => {
          const ssh = spawn("ssh", ["-R", `80:localhost:${targetPort}`, "nokey@localhost.run"], { shell: true });
          ssh.stdout.on("data", (data) => {
            const output = data.toString();
            const match = output.match(/https:\/\/[a-z0-9-]+\.lhr\.life/i) || output.match(/https:\/\/[a-z0-9-]+\.localhost\.run/i);
            if (match) {
              globalUrl = match[0];
              log(`[Intelligence] SSH Tunnel Ready: ${globalUrl}\n`);
              updateDoc(doc(db, "projects", projectId), { globalUrl });
            }
          });
          ssh.on("close", () => {
            log(`[Warning] SSH Tunnel closed. Restarting...\n`);
            setTimeout(() => setupSSHTunnel(targetPort), 5000);
          });
        };

        await setupTunnel(port);

        const framework = detectFramework(realRoot);
        log(`[Intelligence] Detected Framework: ${framework.type}\n`);
        
        const args = framework.args.map(arg => arg.replace("$PORT", port.toString()));
        runCommand(framework.cmd, args, {}, realRoot);

        // Update status to running
        await updateDoc(doc(db, "projects", projectId), {
          status: "running",
          framework: framework.type,
          url: `/app/${projectId}/`,
          publicIp,
          globalUrl
        });

      } catch (err: any) {
        log(`[Error] Deployment failed: ${err.message}\n`);
        try {
          await updateDoc(doc(db, "projects", projectId), { status: "error" });
        } catch (e) {
          handleFirestoreError(e, OperationType.UPDATE, `projects/${projectId}`);
        }
      } finally {
        startingProjects.delete(projectId);
      }
    };

    startSequence();

    return port;
  };

  // Socket.io command handling
  io.on("connection", (socket) => {
    socket.on("join", (room) => socket.join(room));
    
    socket.on("command", ({ projectId, command }) => {
      const project = activeProjects.get(projectId);
      if (project && project.process) {
        // Send command to the shell
        project.process.stdin.write(command + "\n");
      }
    });
  });

  // API to upload ZIP
  app.post("/api/upload", async (req, res) => {
    try {
      const { name, zipBase64, ownerId } = req.body;
      if (!name || !zipBase64 || !ownerId) {
        return res.status(400).json({ error: "Name, ZIP data and Owner ID required" });
      }

      const projectId = name.replace(/\s+/g, "-").toLowerCase() + "-" + Date.now();
      const projectPath = path.join(PROJECTS_DIR, projectId);
      fs.mkdirSync(projectPath);

      const zipBuffer = Buffer.from(zipBase64, "base64");
      const zip = new AdmZip(zipBuffer);
      zip.extractAllTo(projectPath, true);

      // Save to Firestore
      try {
        await setDoc(doc(db, "projects", projectId), {
          id: projectId,
          name,
          status: "idle",
          ownerId,
          createdAt: new Date().toISOString()
        });
      } catch (e) {
        throw handleFirestoreError(e, OperationType.CREATE, `projects/${projectId}`);
      }

      // Automatically start the interactive shell upon upload
      await startProject(projectId);

      res.json({ projectId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API to export ZIP
  app.get("/api/export/:projectId", (req, res) => {
    const { projectId } = req.params;
    const projectPath = path.join(PROJECTS_DIR, projectId);

    if (!fs.existsSync(projectPath)) {
      return res.status(404).send("Project not found");
    }

    const zip = new AdmZip();
    zip.addLocalFolder(projectPath);
    const buffer = zip.toBuffer();

    res.set("Content-Type", "application/zip");
    res.set("Content-Disposition", `attachment; filename=${projectId}.zip`);
    res.send(buffer);
  });

  // API to start project (manual trigger)
  app.post("/api/start/:projectId", async (req, res) => {
    try {
      const { projectId } = req.params;
      await startProject(projectId);
      res.json({ status: "shell_ready" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API to stop project
  app.post("/api/stop/:projectId", async (req, res) => {
    try {
      const { projectId } = req.params;
      await stopProject(projectId);
      res.json({ status: "stopped" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API to restart project
  app.post("/api/restart/:projectId", async (req, res) => {
    try {
      const { projectId } = req.params;
      await stopProject(projectId);
      await startProject(projectId);
      res.json({ status: "restarted" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Eternal Persistence Watchdog
  setInterval(async () => {
    // 1. Check active projects in memory
    for (const [projectId, project] of activeProjects.entries()) {
      // Check if process is still alive
      try {
        if (project.process && project.process.exitCode !== null) {
          console.log(`[Watchdog] Project ${projectId} process died. Restarting...`);
          startProject(projectId);
        }
      } catch (e) {
        console.error(`[Watchdog] Error checking project ${projectId}`, e);
      }
    }
  }, 30000); // Every 30 seconds

  // Auto-Resume on Startup
  const resumeProjects = async () => {
    console.log("[Intelligence] Checking for projects to resume...");
    try {
      // We list the projects directory to see what we have
      if (fs.existsSync(PROJECTS_DIR)) {
        const folders = fs.readdirSync(PROJECTS_DIR);
        for (const projectId of folders) {
          // We only resume if it's a directory
          if (fs.statSync(path.join(PROJECTS_DIR, projectId)).isDirectory()) {
            console.log(`[Intelligence] Resuming project: ${projectId}`);
            startProject(projectId);
          }
        }
      }
    } catch (e) {
      console.error("[Error] Failed to resume projects", e);
    }
  };

  await resumeProjects();

  // Proxy for sub-apps
  app.use("/app/:projectId", (req, res, next) => {
    const { projectId } = req.params;
    const project = activeProjects.get(projectId);
    const target = proxyTargets.get(projectId) || (project ? `http://localhost:${project.port}` : null);
    
    if (target) {
      // Ensure trailing slash for the base path
      if (req.originalUrl === `/app/${projectId}` && !req.originalUrl.endsWith("/")) {
        return res.redirect(301, `/app/${projectId}/`);
      }

      return createProxyMiddleware({
        target,
        changeOrigin: true,
        ws: true,
        pathRewrite: { [`^/app/${projectId}/`]: "" },
      })(req, res, next);
    }
    res.status(404).send("Project not running or not found. Please start it first.");
  });

  // Vite middleware for main app
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  io.on("connection", (socket) => {
    socket.on("join", (terminalId) => {
      socket.join(terminalId);
    });
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
