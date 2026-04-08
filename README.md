# ChatShare Discord Style

Projeto com:
- chat em tempo real
- visual inspirado no Discord
- envio de arquivos
- geração de link próprio para download (`/file/:id`)
- download direto (`/download/:id`)

## Rodar localmente

```bash
npm install
npm start
```

## No Render

Build Command:
```bash
npm install
```

Start Command:
```bash
node server.js
```

## Observação

No Render grátis, arquivos enviados ficam no disco temporário da instância.
Se o serviço reiniciar ou for redeployado, uploads antigos podem sumir.
Para algo mais robusto, o ideal depois é usar armazenamento externo.