# Análise do Projeto e Guia de Implementação de Faturamento

## 1. Análise do Projeto Atual: Push to Talk

O projeto é uma aplicação desktop desenvolvida com **Electron**, focada em privacidade e funcionamento local.

### Arquitetura

- **Monorepo:** Organizado em dois diretórios principais:
  - `application/`: O código-fonte da aplicação Electron.
  - `website/`: A landing page promocional.
- **Core (Backend Local):**
  - Utiliza o **whisper.cpp** (implementação C++ do modelo Whisper da OpenAI) para realizar a transcrição de áudio.
  - Isso garante performance nativa e que nenhum áudio saia da máquina do usuário (Privacidade 100%).
- **Interface e UX:**
  - Funciona como um aplicativo de barra de menu (Tray App).
  - Possui janelas flutuantes ("Overlay") para feedback visual.
  - Usa **Global Hotkeys** (atalhos globais) para iniciar/parar a gravação, interceptados pela biblioteca `uiohook-napi`.
- **Fluxo de Dados:**
  1.  Usuário aperta o atalho.
  2.  Renderer (Frontend) captura o áudio do microfone.
  3.  Áudio é salvo temporariamente (`recording.wav`).
  4.  Main Process invoca o binário `whisper-cli` localmente.
  5.  Texto transcrito é inserido diretamente no campo de texto ativo do usuário (simulando digitação via scripts de SO), sem usar a área de transferência para não sobrescrever dados do usuário.

## 2. Implementando um Sistema de Assinatura/Cobrança

Para transformar este aplicativo local em um serviço pago (SaaS), você precisará de três pilares principais: **Provedor de Pagamento**, **Backend de Controle** e **Integração no Cliente**.

### A. Provedor de Pagamento (Payment Gateway)

Você precisa de um serviço para processar cartões e gerenciar assinaturas.

- **Lemon Squeezy (Recomendado):** Atua como "Merchant of Record". Eles lidam com todos os impostos globais, faturas e conformidade. Muito fácil de integrar com apps software.
- **Stripe:** Padrão da indústria. Mais flexível, mas exige que você lide com algumas questões fiscais.
- **Paddle:** Similar ao Lemon Squeezy, excelente para vendas globais de software.

### B. Backend de Controle (API)

Como o Whisper roda localmente, o app "funciona" sem internet. Para cobrar, você precisa validar se o usuário tem permissão para usar.

- **Função:** Validar chaves de licença ou logins de usuário.
- **Tecnologias:** Pode ser simples. Um banco de dados (Supabase, Firebase) e uma API pequena (Node.js/Express, Python/FastAPI ou Serverless Functions no Vercel/Cloudflare).
- **O que armazenar:**
  - `user_id`
  - `subscription_status` (active, past_due, canceled)
  - `expiration_date`
  - `license_key` (opcional, se não usar login/senha)

### C. Mudanças Necessárias no Electron (Application)

1.  **Mecanismo de Bloqueio:**

    - Ao iniciar, o app deve verificar se existe uma licença válida salva (`electron-store`).
    - Se não houver, deve bloquear as funcionalidades principais (transcrição) e mostrar apenas uma tela de "Login" ou "Inserir Licença".

2.  **Verificação de Licença (Online Check):**

    - **Login:** O usuário digita email/chave.
    - **Validação:** O app envia isso para seu Backend.
    - **Resposta:** O backend consulta o Stripe/LemonSqueezy e responde se está `ativo`.

3.  **Segurança e Offline (Desafio de Apps Locais):**
    - Como bloquear alguém que desliga a internet?
    - **Estratégia Comum:** "Token JWT com validade". Ao logar, você salva um token criptografado localmente que vale por 3 a 7 dias. O app funciona offline com esse token. Quando expira, ele força uma verificação online.
    - **Ofuscação:** O código fonte Electron pode ser lido. Use ofuscação de código (javascript obfuscators) para dificultar que usuários removam a verificação de licença manualmente.

### Roteiro Sugerido (MVP)

1.  **Modelo de Licença (License Key):** É mais simples que sistema de login completo. O usuário compra, recebe uma chave (ex: `KEY-1234`), e insere no app.
2.  **Serviço:** Use **Lemon Squeezy** com o recurso nativo de License Keys. Eles já geram a chave e oferecem uma API para você validar (`GET https://api.lemonsqueezy.com/v1/licenses/validate`).
    - _Vantagem:_ Você **não precisa criar backend próprio** no início. O Electron chama direto a API do Lemon Squeezy.
3.  **Integração:**
    - Crie uma tela de "Ativação".
    - No `main.js`, antes de `transcribe()`, verifique: `if (!isLicenseValid) showUpgradeDialog(); return;`.

### Exemplo de Fluxo com Lemon Squeezy (Sem Backend Próprio)

1.  Usuário compra no seu site -> Lemon Squeezy envia email com Chave de Licença.
2.  Usuário abre o App -> App pede a Chave.
3.  App faz request: `POST https://api.lemonsqueezy.com/v1/licenses/activate`.
4.  Se sucesso, salva a licença e a "instance_id" no `electron-store`.
5.  A cada inicialização (ou a cada X dias), o app revalida a chave silenciosamente.
