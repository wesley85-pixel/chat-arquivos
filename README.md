# ChatShare Ultimate

Projeto completo com:

- visual inspirado no Discord
- chat em tempo real
- salas privadas com senha
- histórico de mensagens salvo em JSON
- envio de arquivos
- arrastar e soltar arquivos
- barra de progresso
- preview de imagens e vídeos
- links de compartilhamento
- expiração automática de arquivos
- limpeza automática de arquivos expirados
- lista de usuários online

## Rodar localmente

```bash
npm install
npm start
```

Abra:
```bash
http://localhost:3000
```

## Deploy no Render

Build Command:
```bash
npm install
```

Start Command:
```bash
node server.js
```

## Importante

No Render grátis, os arquivos ficam no disco da instância.
Se o serviço reiniciar, redeployar ou trocar de máquina, uploads antigos podem sumir.

## O que ainda falta para "nível profissional"

Para arquivos muito grandes e persistência melhor, o próximo passo ideal é integrar um storage externo, como:
- Cloudflare R2
- Backblaze B2
- AWS S3
- Supabase Storage

Esse projeto já está pronto para crescer, mas essa parte exige chaves/credenciais da sua conta.