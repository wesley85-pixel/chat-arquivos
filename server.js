const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 5 * 1024 * 1024 * 1024
});

const PORT = process.env.PORT || 3000;
const DATA_DIR = __dirname;
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const FILES_DB = path.join(DATA_DIR, "files.json");

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(FILES_DB)) fs.writeFileSync(FILES_DB, "[]", "utf8");

function loadFiles() {
  try {
    const raw = fs.readFileSync(FILES_DB, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveFiles(list) {
  fs.writeFileSync(FILES_DB, JSON.stringify(list, null, 2), "utf8");
}

function sanitizeFilename(name) {
  return name.replace(/[^\w.\- ]+/g, "_");
}

function createId(len = 10) {
  return crypto.randomBytes(len).toString("base64url").slice(0, len);
}

const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (_req, file, cb) {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    const safe = sanitizeFilename(base);
    cb(null, `${Date.now()}-${createId(8)}-${safe}${ext}`);
  }
});

const upload = multer({ storage });

app.use(express.json());
app.use("/uploads", express.static(UPLOAD_DIR));

const connectedUsers = new Map();

function broadcastUsers() {
  io.emit("users list", Array.from(connectedUsers.values()));
}

function htmlPage(content, title = "ChatShare") {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    :root{
      --bg:#313338;
      --sidebar:#2b2d31;
      --panel:#1e1f22;
      --card:#232428;
      --message:#2f3136;
      --text:#f2f3f5;
      --muted:#b5bac1;
      --line:#3f4147;
      --brand:#5865f2;
      --brand-2:#4752c4;
      --green:#23a559;
      --danger:#da373c;
    }
    *{box-sizing:border-box}
    body{
      margin:0;
      font-family:Inter,Arial,sans-serif;
      background:var(--bg);
      color:var(--text);
    }
    a{color:#9ab8ff;text-decoration:none}
    a:hover{text-decoration:underline}
    .center-wrap{
      min-height:100vh;
      display:flex;
      align-items:center;
      justify-content:center;
      padding:24px;
    }
    .download-card{
      width:min(700px,100%);
      background:var(--panel);
      border:1px solid var(--line);
      border-radius:20px;
      box-shadow:0 14px 40px rgba(0,0,0,.35);
      padding:28px;
    }
    .badge{
      display:inline-block;
      background:rgba(88,101,242,.15);
      color:#cdd3ff;
      border:1px solid rgba(88,101,242,.35);
      padding:6px 10px;
      border-radius:999px;
      font-size:12px;
      margin-bottom:14px;
    }
    .title{font-size:28px;font-weight:800;margin:0 0 10px}
    .muted{color:var(--muted)}
    .meta{
      margin:18px 0;
      padding:16px;
      border-radius:16px;
      background:var(--card);
      border:1px solid var(--line);
      line-height:1.8;
    }
    .btn{
      display:inline-block;
      background:var(--brand);
      color:white;
      border:none;
      border-radius:12px;
      padding:12px 18px;
      cursor:pointer;
      font-weight:700;
    }
    .btn:hover{background:var(--brand-2); text-decoration:none}
    .btn.secondary{
      background:#3f4147;
    }
    .btn.secondary:hover{background:#4a4d55}
    .stack{display:flex;gap:10px;flex-wrap:wrap}
    .home-link{margin-top:18px;display:inline-block}
  </style>
</head>
<body>${content}</body>
</html>`;
}

app.get("/", (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>ChatShare Discord Style</title>
  <style>
    :root{
      --bg:#313338;
      --sidebar:#2b2d31;
      --channel:#1e1f22;
      --card:#232428;
      --composer:#383a40;
      --message:#2b2d31;
      --text:#f2f3f5;
      --muted:#b5bac1;
      --line:#3f4147;
      --brand:#5865f2;
      --brand-2:#4752c4;
      --green:#23a559;
      --warn:#faa81a;
    }
    *{box-sizing:border-box}
    body{
      margin:0;
      background:var(--bg);
      color:var(--text);
      font-family:Inter, Arial, sans-serif;
      height:100vh;
      overflow:hidden;
    }
    .layout{
      display:grid;
      grid-template-columns: 88px 260px 1fr 320px;
      height:100vh;
    }
    .servers{
      background:#1e1f22;
      border-right:1px solid #202225;
      padding:12px 10px;
      display:flex;
      flex-direction:column;
      gap:12px;
      align-items:center;
    }
    .server-icon,.plus-icon{
      width:52px;height:52px;border-radius:18px;
      display:grid;place-items:center;
      font-weight:800;font-size:18px;
      background:#313338;color:white;
      transition:.2s;
      cursor:default;
      user-select:none;
    }
    .server-icon.active{background:var(--brand);border-radius:16px}
    .plus-icon{background:#233026;color:#3ba55d}
    .side{
      background:var(--sidebar);
      border-right:1px solid #202225;
      display:flex;
      flex-direction:column;
      min-width:0;
    }
    .side-header{
      padding:16px;
      border-bottom:1px solid var(--line);
      font-weight:800;
      letter-spacing:.2px;
    }
    .side-scroll{
      padding:14px;
      overflow:auto;
      display:flex;
      flex-direction:column;
      gap:18px;
    }
    .section-title{
      color:#949ba4;
      text-transform:uppercase;
      font-size:12px;
      font-weight:800;
      letter-spacing:.5px;
      margin-bottom:8px;
    }
    .channel{
      background:#35373c;
      color:#dbdee1;
      border-radius:10px;
      padding:10px 12px;
      font-weight:600;
    }
    .side-card{
      background:var(--card);
      border:1px solid var(--line);
      border-radius:16px;
      padding:12px;
    }
    .main{
      display:flex;
      flex-direction:column;
      min-width:0;
      background:var(--channel);
    }
    .topbar{
      height:57px;
      border-bottom:1px solid var(--line);
      display:flex;
      align-items:center;
      justify-content:space-between;
      padding:0 18px;
      gap:16px;
      background:#313338;
    }
    .topbar .title{
      font-weight:800;
      font-size:18px;
    }
    .topbar .sub{
      color:var(--muted);
      font-size:13px;
    }
    .nickname-box{
      display:flex;
      gap:8px;
      flex-wrap:wrap;
      align-items:center;
      justify-content:flex-end;
    }
    input, button {
      font:inherit;
    }
    .input, .composer input{
      background:#1e1f22;
      color:var(--text);
      border:1px solid var(--line);
      border-radius:10px;
      outline:none;
      padding:10px 12px;
    }
    .input:focus, .composer input:focus{
      border-color:var(--brand);
    }
    .btn{
      border:none;
      border-radius:10px;
      padding:10px 14px;
      background:var(--brand);
      color:white;
      font-weight:700;
      cursor:pointer;
    }
    .btn:hover{background:var(--brand-2)}
    .btn.alt{background:#3f4147}
    .btn.green{background:var(--green)}
    .content{
      display:grid;
      grid-template-rows: 1fr auto;
      min-height:0;
      flex:1;
    }
    #messages{
      overflow:auto;
      padding:20px;
      display:flex;
      flex-direction:column;
      gap:12px;
    }
    .welcome{
      background:var(--card);
      border:1px solid var(--line);
      border-radius:18px;
      padding:18px;
      margin-bottom:6px;
    }
    .welcome h2{
      margin:0 0 8px;
      font-size:24px;
    }
    .welcome p{
      margin:0;
      color:var(--muted);
      line-height:1.5;
    }
    .message{
      display:flex;
      gap:12px;
      align-items:flex-start;
      padding:8px 10px;
      border-radius:12px;
    }
    .message:hover{background:rgba(255,255,255,.03)}
    .avatar{
      width:42px;height:42px;border-radius:50%;
      display:grid;place-items:center;
      background:#5865f2;
      font-weight:800;
      flex:0 0 auto;
    }
    .bubble{
      min-width:0;
      width:100%;
    }
    .meta{
      display:flex;
      gap:10px;
      align-items:center;
      flex-wrap:wrap;
      margin-bottom:5px;
    }
    .name{font-weight:800}
    .time{font-size:12px;color:var(--muted)}
    .text{
      color:#dbdee1;
      line-height:1.5;
      word-break:break-word;
      white-space:pre-wrap;
    }
    .file-card{
      margin-top:9px;
      background:#2b2d31;
      border:1px solid var(--line);
      border-radius:14px;
      padding:14px;
    }
    .file-title{
      font-weight:800;
      margin-bottom:6px;
      word-break:break-word;
    }
    .file-actions{
      display:flex;
      gap:8px;
      flex-wrap:wrap;
      margin-top:10px;
    }
    .small-btn{
      border:none;
      border-radius:10px;
      padding:9px 12px;
      background:var(--brand);
      color:#fff;
      cursor:pointer;
      font-weight:700;
    }
    .small-btn.secondary{
      background:#3f4147;
    }
    .system{
      align-self:center;
      background:#232428;
      border:1px solid var(--line);
      color:var(--muted);
      border-radius:999px;
      padding:8px 12px;
      font-size:12px;
    }
    .composer-wrap{
      padding:16px;
      border-top:1px solid var(--line);
      background:#313338;
    }
    .composer{
      background:var(--composer);
      border-radius:18px;
      padding:12px;
      display:flex;
      flex-direction:column;
      gap:12px;
    }
    .composer-top{
      display:grid;
      grid-template-columns: 1fr auto auto auto;
      gap:10px;
      align-items:center;
    }
    .composer .file-name{
      color:var(--muted);
      font-size:13px;
    }
    .right{
      background:var(--sidebar);
      border-left:1px solid #202225;
      display:flex;
      flex-direction:column;
      min-width:0;
    }
    .right-header{
      padding:16px;
      border-bottom:1px solid var(--line);
      font-weight:800;
    }
    .right-scroll{
      padding:14px;
      overflow:auto;
      display:flex;
      flex-direction:column;
      gap:14px;
    }
    .user-list{
      display:flex;
      flex-direction:column;
      gap:8px;
    }
    .user{
      background:#35373c;
      border-radius:12px;
      padding:10px 12px;
      color:#dbdee1;
      font-weight:600;
      word-break:break-word;
    }
    .share-box{
      background:var(--card);
      border:1px solid var(--line);
      border-radius:16px;
      padding:14px;
    }
    .share-link{
      display:block;
      width:100%;
      margin:10px 0;
      background:#1e1f22;
      border:1px solid var(--line);
      border-radius:10px;
      padding:10px 12px;
      color:#cdd6f4;
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
    }
    .hint{
      color:var(--muted);
      font-size:13px;
      line-height:1.5;
    }
    .upload-label{
      display:inline-flex;
      align-items:center;
      gap:8px;
      background:#3f4147;
      padding:10px 12px;
      border-radius:10px;
      cursor:pointer;
      font-weight:700;
    }
    .upload-label input{display:none}
    @media (max-width: 1200px){
      .layout{grid-template-columns: 78px 230px 1fr;}
      .right{display:none}
    }
    @media (max-width: 860px){
      .layout{grid-template-columns: 1fr;}
      .servers,.side,.right{display:none}
      .composer-top{grid-template-columns:1fr}
      .topbar{height:auto;padding:12px;align-items:flex-start;flex-direction:column}
      .nickname-box{justify-content:flex-start}
    }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="servers">
      <div class="server-icon active">CS</div>
      <div class="plus-icon">+</div>
    </aside>

    <aside class="side">
      <div class="side-header">ChatShare</div>
      <div class="side-scroll">
        <div>
          <div class="section-title">Canais de texto</div>
          <div class="channel"># compartilhamento</div>
          <div style="height:8px"></div>
          <div class="channel"># bate-papo</div>
        </div>

        <div>
          <div class="section-title">Como usar</div>
          <div class="side-card">
            <div style="font-weight:800;margin-bottom:8px">Link tipo WeTransfer</div>
            <div style="color:#b5bac1;line-height:1.5;font-size:14px">
              Envie um arquivo e o site cria um link próprio para compartilhar.
            </div>
          </div>
        </div>
      </div>
    </aside>

    <main class="main">
      <div class="topbar">
        <div>
          <div class="title"># compartilhamento</div>
          <div class="sub">Chat + geração de link para download</div>
        </div>

        <div class="nickname-box">
          <input id="nickname" class="input" type="text" maxlength="24" placeholder="Seu nome" />
          <button id="saveNick" class="btn">Entrar</button>
        </div>
      </div>

      <div class="content">
        <div id="messages">
          <div class="welcome">
            <h2>Bem-vindo ao ChatShare</h2>
            <p>
              Este chat tem visual inspirado no Discord e também gera links próprios de download para os arquivos.
              Você pode mandar mensagem, enviar arquivo e copiar o link para compartilhar com seus amigos.
            </p>
          </div>
        </div>

        <div class="composer-wrap">
          <div class="composer">
            <div class="composer-top">
              <input id="messageInput" type="text" placeholder="Mandar mensagem em #compartilhamento" />
              <label class="upload-label">
                📎 Escolher arquivo
                <input id="fileInput" type="file" />
              </label>
              <button id="sendBtn" class="btn alt">Enviar mensagem</button>
              <button id="uploadBtn" class="btn green">Enviar arquivo</button>
            </div>
            <div id="selectedFile" class="file-name">Nenhum arquivo selecionado.</div>
          </div>
        </div>
      </div>
    </main>

    <aside class="right">
      <div class="right-header">Painel</div>
      <div class="right-scroll">
        <div class="share-box">
          <div style="font-weight:800">Último link gerado</div>
          <a id="lastLink" class="share-link" href="#" target="_blank">Ainda não há link.</a>
          <button id="copyLastLink" class="small-btn secondary" style="width:100%">Copiar último link</button>
        </div>

        <div class="share-box">
          <div style="font-weight:800;margin-bottom:10px">Usuários online</div>
          <div id="users" class="user-list"></div>
        </div>

        <div class="share-box">
          <div style="font-weight:800;margin-bottom:8px">Dica</div>
          <div class="hint">
            No Render grátis, o site pode demorar alguns segundos para acordar quando ficar parado.
          </div>
        </div>
      </div>
    </aside>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const messages = document.getElementById("messages");
    const usersEl = document.getElementById("users");
    const nicknameEl = document.getElementById("nickname");
    const saveNickBtn = document.getElementById("saveNick");
    const messageInput = document.getElementById("messageInput");
    const fileInput = document.getElementById("fileInput");
    const sendBtn = document.getElementById("sendBtn");
    const uploadBtn = document.getElementById("uploadBtn");
    const selectedFile = document.getElementById("selectedFile");
    const lastLink = document.getElementById("lastLink");
    const copyLastLink = document.getElementById("copyLastLink");

    let myId = "";
    let myNickname = localStorage.getItem("chatshare_nickname") || "";

    nicknameEl.value = myNickname;

    function escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    }

    function initials(name) {
      return (name || "?").trim().slice(0, 2).toUpperCase();
    }

    function scrollBottom() {
      messages.scrollTop = messages.scrollHeight;
    }

    function addSystem(text) {
      const div = document.createElement("div");
      div.className = "system";
      div.textContent = text;
      messages.appendChild(div);
      scrollBottom();
    }

    function addMessage(msg) {
      const wrap = document.createElement("div");
      wrap.className = "message";

      const date = new Date(msg.createdAt || Date.now());
      const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

      let fileHtml = "";
      if (msg.shareUrl) {
        fileHtml = \`
          <div class="file-card">
            <div class="file-title">📎 \${escapeHtml(msg.fileName || "arquivo")}</div>
            <div class="hint">Arquivo enviado com link próprio para download.</div>
            <div class="file-actions">
              <a class="small-btn" href="\${msg.shareUrl}" target="_blank">Abrir página</a>
              <a class="small-btn secondary" href="\${msg.directUrl}" target="_blank" download>Baixar direto</a>
              <button class="small-btn secondary" data-copy="\${msg.shareUrl}">Copiar link</button>
            </div>
          </div>
        \`;
      }

      wrap.innerHTML = \`
        <div class="avatar">\${escapeHtml(initials(msg.nickname))}</div>
        <div class="bubble">
          <div class="meta">
            <div class="name">\${escapeHtml(msg.nickname || "Anônimo")}</div>
            <div class="time">\${time}</div>
          </div>
          \${msg.text ? '<div class="text">' + escapeHtml(msg.text) + '</div>' : ""}
          \${fileHtml}
        </div>
      \`;

      messages.appendChild(wrap);
      scrollBottom();
    }

    function renderUsers(list) {
      usersEl.innerHTML = "";
      if (!list.length) {
        usersEl.innerHTML = '<div class="hint">Ninguém online.</div>';
        return;
      }
      list.forEach(name => {
        const div = document.createElement("div");
        div.className = "user";
        div.textContent = name;
        usersEl.appendChild(div);
      });
    }

    function applyNick() {
      const nick = nicknameEl.value.trim().slice(0, 24);
      if (!nick) {
        alert("Digite um nome.");
        return;
      }
      myNickname = nick;
      localStorage.setItem("chatshare_nickname", nick);
      socket.emit("set nickname", nick);
    }

    saveNickBtn.addEventListener("click", applyNick);
    nicknameEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") applyNick();
    });

    sendBtn.addEventListener("click", sendMessage);
    messageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendMessage();
    });

    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      selectedFile.textContent = file ? "Arquivo selecionado: " + file.name : "Nenhum arquivo selecionado.";
    });

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
        addSystem("Link copiado.");
      } catch {
        alert("Não foi possível copiar automaticamente.");
      }
    }

    copyLastLink.addEventListener("click", async () => {
      const url = lastLink.getAttribute("href");
      if (url && url !== "#") await copyText(url);
    });

    messages.addEventListener("click", async (e) => {
      const copy = e.target.closest("[data-copy]");
      if (copy) {
        await copyText(copy.getAttribute("data-copy"));
      }
    });

    function sendMessage() {
      const text = messageInput.value.trim();
      if (!text) return;
      if (!myNickname) {
        alert("Escolha um nome antes.");
        return;
      }
      socket.emit("chat message", { text });
      messageInput.value = "";
    }

    uploadBtn.addEventListener("click", async () => {
      const file = fileInput.files[0];
      if (!file) {
        alert("Escolha um arquivo primeiro.");
        return;
      }
      if (!myNickname) {
        alert("Escolha um nome antes.");
        return;
      }

      const form = new FormData();
      form.append("file", file);
      form.append("nickname", myNickname);

      uploadBtn.disabled = true;
      uploadBtn.textContent = "Enviando...";

      try {
        const response = await fetch("/upload", { method: "POST", body: form });
        const data = await response.json();

        if (!response.ok) throw new Error(data.error || "Erro no upload.");

        fileInput.value = "";
        selectedFile.textContent = "Nenhum arquivo selecionado.";
        lastLink.href = data.shareUrl;
        lastLink.textContent = data.shareUrl;
      } catch (err) {
        alert(err.message || "Falha ao enviar.");
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = "Enviar arquivo";
      }
    });

    socket.on("connect", () => {
      myId = socket.id;
      if (myNickname) socket.emit("set nickname", myNickname);
    });

    socket.on("users list", renderUsers);
    socket.on("system message", addSystem);
    socket.on("chat message", addMessage);
  </script>
</body>
</html>`);
});

app.post("/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo enviado." });
    }

    const nickname = (req.body.nickname || "Anônimo").toString().trim().slice(0, 24) || "Anônimo";
    const id = createId(12);

    const files = loadFiles();
    const item = {
      id,
      originalName: req.file.originalname,
      storedName: req.file.filename,
      mimetype: req.file.mimetype,
      size: req.file.size,
      uploadedAt: Date.now(),
      nickname
    };
    files.unshift(item);
    saveFiles(files);

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const shareUrl = `${baseUrl}/file/${id}`;
    const directUrl = `${baseUrl}/download/${id}`;

    const payload = {
      nickname,
      fileName: req.file.originalname,
      shareUrl,
      directUrl,
      createdAt: Date.now()
    };

    io.emit("chat message", payload);

    res.json({
      ok: true,
      id,
      fileName: req.file.originalname,
      shareUrl,
      directUrl
    });
  } catch (err) {
    res.status(500).json({ error: "Erro ao salvar o arquivo." });
  }
});

app.get("/file/:id", (req, res) => {
  const files = loadFiles();
  const item = files.find(f => f.id === req.params.id);

  if (!item) {
    return res.status(404).send(htmlPage(`
      <div class="center-wrap">
        <div class="download-card">
          <div class="badge">Arquivo não encontrado</div>
          <h1 class="title">Esse link não existe ou foi removido.</h1>
          <p class="muted">Verifique se o link está certo.</p>
          <a class="home-link btn secondary" href="/">Voltar ao início</a>
        </div>
      </div>
    `, "Arquivo não encontrado"));
  }

  const filePath = path.join(UPLOAD_DIR, item.storedName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send(htmlPage(`
      <div class="center-wrap">
        <div class="download-card">
          <div class="badge">Arquivo indisponível</div>
          <h1 class="title">O arquivo não está mais no servidor.</h1>
          <a class="home-link btn secondary" href="/">Voltar ao início</a>
        </div>
      </div>
    `, "Arquivo indisponível"));
  }

  const sizeMB = (item.size / (1024 * 1024)).toFixed(2);
  const date = new Date(item.uploadedAt).toLocaleString("pt-BR");

  res.send(htmlPage(`
    <div class="center-wrap">
      <div class="download-card">
        <div class="badge">Link de download</div>
        <h1 class="title">${item.originalName}</h1>
        <p class="muted">Arquivo enviado por ${item.nickname || "Anônimo"}.</p>

        <div class="meta">
          <div><strong>Nome:</strong> ${item.originalName}</div>
          <div><strong>Tamanho:</strong> ${sizeMB} MB</div>
          <div><strong>Tipo:</strong> ${item.mimetype || "desconhecido"}</div>
          <div><strong>Enviado em:</strong> ${date}</div>
        </div>

        <div class="stack">
          <a class="btn" href="/download/${item.id}">Baixar arquivo</a>
          <a class="btn secondary" href="/">Abrir chat</a>
        </div>
      </div>
    </div>
  `, item.originalName));
});

app.get("/download/:id", (req, res) => {
  const files = loadFiles();
  const item = files.find(f => f.id === req.params.id);

  if (!item) {
    return res.status(404).send("Arquivo não encontrado.");
  }

  const filePath = path.join(UPLOAD_DIR, item.storedName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("Arquivo não existe mais.");
  }

  res.download(filePath, item.originalName);
});

io.on("connection", (socket) => {
  connectedUsers.set(socket.id, "Anônimo");
  broadcastUsers();
  socket.emit("system message", "Você entrou no servidor.");

  socket.on("set nickname", (nickname) => {
    const clean = (nickname || "").toString().trim().slice(0, 24);
    if (!clean) return;
    connectedUsers.set(socket.id, clean);
    broadcastUsers();
    socket.emit("system message", `Nome definido como ${clean}.`);
  });

  socket.on("chat message", (data) => {
    const text = (data?.text || "").toString().trim().slice(0, 2000);
    if (!text) return;

    const nickname = connectedUsers.get(socket.id) || "Anônimo";
    io.emit("chat message", {
      nickname,
      text,
      createdAt: Date.now()
    });
  });

  socket.on("disconnect", () => {
    connectedUsers.delete(socket.id);
    broadcastUsers();
  });
});

server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});