
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);

// Buffer grande (5GB) para uploads grandes via socket
const io = new Server(server, {
  maxHttpBufferSize: 5 * 1024 * 1024 * 1024
});

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, "uploads");

// cria pasta uploads se não existir
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}

// armazenamento dos arquivos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + "-" + file.originalname);
  }
});

// MULTER SEM LIMITE DE TAMANHO
const upload = multer({
  storage
});

app.use("/uploads", express.static(UPLOAD_DIR));

app.get("/", (req, res) => {
  res.send(`
  <html>
  <head>
  <title>ChatShare</title>
  <style>
  body{font-family:Arial;background:#111;color:white;margin:0}
  #chat{height:80vh;overflow:auto;padding:10px}
  input,button{padding:10px;margin:5px}
  </style>
  </head>
  <body>

  <h2 style="padding:10px">ChatShare</h2>

  <div id="chat"></div>

  <input id="msg" placeholder="mensagem">
  <button onclick="send()">Enviar</button>

  <br>

  <input type="file" id="file">
  <button onclick="upload()">Enviar arquivo</button>

  <script src="/socket.io/socket.io.js"></script>
  <script>

  const socket = io();
  const chat = document.getElementById("chat");

  socket.on("chat message", msg=>{
      const div = document.createElement("div");
      div.innerHTML = msg;
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
  });

  function send(){
      const input = document.getElementById("msg");
      socket.emit("chat message", input.value);
      input.value="";
  }

  async function upload(){
      const file = document.getElementById("file").files[0];
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/upload", {
          method:"POST",
          body:form
      });

      const data = await res.json();

      socket.emit("chat message",
        '<a href="'+data.url+'" target="_blank">📎 '+data.name+"</a>"
      );
  }

  </script>

  </body>
  </html>
  `);
});

app.post("/upload", upload.single("file"), (req,res)=>{
  res.json({
    name:req.file.originalname,
    url:"/uploads/"+req.file.filename
  });
});

io.on("connection", socket=>{

  socket.on("chat message", msg=>{
    io.emit("chat message", msg);
  });

});

server.listen(PORT, ()=>{
  console.log("Servidor rodando em http://localhost:"+PORT);
});
