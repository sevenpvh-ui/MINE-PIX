# 💎 Mines Pix - Plataforma de iGaming Full-Stack

> Uma plataforma completa de cassino online (estilo Blaze/Stake) focada no jogo "Mines", com sistema financeiro real (PIX), painel administrativo e sistema de afiliados.

![Status](https://img.shields.io/badge/Status-Concluído-brightgreen)
![Tech](https://img.shields.io/badge/Stack-NodeJS%20|%20Express%20|%20MongoDB-blue)

---

## 🚀 Funcionalidades

### 🎮 Para o Jogador
* **Jogo Mines:** Lógica segura no servidor (Backend) para evitar trapaças.
* **Interface Premium:** Design Dark Mode, responsivo (Mobile First) e sons imersivos.
* **Financeiro:** Depósito automático via **PIX** (API Mercado Pago) e Solicitação de Saque.
* **Sistema de Contas:** Login e Cadastro com CPF, Nome e Telefone.
* **Afiliados:** Sistema "Indique e Ganhe" com link único e comissão de 10%.
* **Engajamento:** Bônus Diário, Ranking de Ganhadores (Leaderboard) e Feed de Apostas em tempo real.
* **PWA:** Pode ser instalado como aplicativo no celular.

### 🛡️ Para o Administrador (Painel de Controle)
* **Dashboard:** Visão geral de lucro, depósitos e saques.
* **Gestão Financeira:** Aprovar ou Rejeitar solicitações de saque.
* **Gestão de Usuários:** Ver lista de usuários, editar saldo e **banir** contas.
* **Configurações do Sistema:**
    * Alterar valor do Bônus Diário.
    * **Controle de Lucro (House Edge):** Ajustar a dificuldade do jogo em tempo real.

---

## 🛠️ Tecnologias Utilizadas

* **Back-end:** Node.js, Express.js
* **Banco de Dados:** MongoDB (Mongoose)
* **Pagamentos:** SDK Mercado Pago
* **Segurança:** Bcrypt.js (Hash de senhas), Express-Rate-Limit (Anti-DDoS)
* **Front-end:** HTML5, CSS3 (Animações), JavaScript Vanilla

---

## ⚙️ Instalação e Configuração

Siga os passos abaixo para rodar o projeto na sua máquina:

### 1. Pré-requisitos
* Node.js instalado.
* Conta no MongoDB Atlas (para o banco de dados).
* Conta de Desenvolvedor no Mercado Pago (para o Token).

### 2. Clonar o Repositório
```bash
git clone [https://github.com/SEU-USUARIO/mines-pix-pro.git](https://github.com/SEU-USUARIO/mines-pix-pro.git)
cd mines-pix-pro
