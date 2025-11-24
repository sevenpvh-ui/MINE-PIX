require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { MercadoPagoConfig, Payment } = require('mercadopago');

// Importa a lógica do jogo e o Modelo de Usuário
const { createGrid, calculateMultiplier } = require('./gameEngine');
const User = require('./models/User');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- CONFIGURAÇÕES ---
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const SITE_URL = process.env.SITE_URL; 

// Conexão com Banco de Dados (MongoDB)
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Conectado"))
    .catch(err => console.error("❌ Erro Mongo:", err));

// Configuração Mercado Pago
const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });
const payment = new Payment(client);

// ==================================================================
// 🔐 AUTENTICAÇÃO (CPF)
// ==================================================================

// Registro
app.post('/api/auth/register', async (req, res) => {
    const { cpf, password } = req.body;
    try {
        if (!cpf || !password) return res.status(400).json({ error: "CPF e senha obrigatórios" });
        
        // Remove pontos e traços do CPF
        const cleanCpf = cpf.replace(/\D/g, ''); 
        
        if (await User.findOne({ cpf: cleanCpf })) {
            return res.status(400).json({ error: "CPF já cadastrado" });
        }
        
        // Criptografa a senha
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Cria usuário
        const user = await User.create({ cpf: cleanCpf, password: hashedPassword });
        
        res.json({ message: "Criado", userId: user._id, cpf: user.cpf, balance: user.balance });
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: "Erro ao registrar: " + e.message }); 
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    const { cpf, password } = req.body;
    try {
        const cleanCpf = cpf.replace(/\D/g, '');
        const user = await User.findOne({ cpf: cleanCpf });
        
        if (!user) return res.status(400).json({ error: "CPF não encontrado" });

        // Verifica senha
        if (!await bcrypt.compare(password, user.password)) {
            return res.status(400).json({ error: "Senha incorreta" });
        }

        res.json({ message: "Logado", userId: user._id, cpf: user.cpf, balance: user.balance });
    } catch (e) { res.status(500).json({ error: "Erro ao logar" }); }
});

// Pegar saldo e info
app.get('/api/me/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if(!user) return res.status(404).json({error: "User not found"});
        res.json({ balance: user.balance, cpf: user.cpf });
    } catch (e) { res.status(500).json({ error: "Erro" }); }
});


// ==================================================================
// 💰 PAGAMENTOS (PIX & SALDO)
// ==================================================================

// 1. Gerar PIX Real (Mercado Pago)
app.post('/api/payment/deposit', async (req, res) => {
    const { userId, amount } = req.body;
    try {
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: "User not found" });

        // O Mercado Pago exige um email, criamos um falso com o CPF
        const fakeEmail = `${user.cpf}@minespro.com`;

        const body = {
            transaction_amount: parseFloat(amount),
            description: 'Creditos Mines',
            payment_method_id: 'pix',
            payer: { email: fakeEmail },
            notification_url: `${SITE_URL}/api/webhook` // URL para receber confirmação
        };

        const result = await payment.create({ body });
        
        user.transactions.push({
            type: 'deposit',
            amount: parseFloat(amount),
            status: 'pending',
            mpPaymentId: result.id.toString(),
            qrCodeBase64: result.point_of_interaction.transaction_data.qr_code_base64
        });
        await user.save();

        res.json({
            copyPaste: result.point_of_interaction.transaction_data.qr_code,
            qrCodeBase64: result.point_of_interaction.transaction_data.qr_code_base64,
            paymentId: result.id
        });

    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: "Erro ao gerar PIX. Verifique Token MP." }); 
    }
});

// 2. SIMULAÇÃO DE DEPÓSITO (Botão Azul - Debug)
app.post('/api/debug/deposit', async (req, res) => {
    const { userId, amount } = req.body;
    
    try {
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: "Usuário não encontrado" });
        
        const valor = parseFloat(amount);
        if (valor <= 0) return res.status(400).json({ error: "Valor inválido" });

        // Adiciona saldo
        user.balance += valor;

        // Registra histórico aprovado
        user.transactions.push({
            type: 'deposit',
            amount: valor,
            status: 'approved',
            mpPaymentId: 'SIMULADO_' + Date.now(),
            createdAt: Date.now()
        });

        await user.save();
        console.log(`⚡ Depósito Simulado: CPF ${user.cpf} + R$ ${valor}`);
        res.json({ message: "Saldo adicionado!", balance: user.balance });

    } catch (e) {
        res.status(500).json({ error: "Erro ao simular" });
    }
});

// 3. Webhook (Confirmação Automática do Mercado Pago)
app.post('/api/webhook', async (req, res) => {
    const { action, data } = req.body;
    if (action === 'payment.created' || action === 'payment.updated') {
        try {
            const payInfo = await payment.get({ id: data.id });
            if (payInfo.status === 'approved') {
                const user = await User.findOne({ "transactions.mpPaymentId": data.id });
                if (user) {
                    const trans = user.transactions.find(t => t.mpPaymentId == data.id);
                    if (trans && trans.status === 'pending') {
                        trans.status = 'approved';
                        user.balance += trans.amount;
                        await user.save();
                        console.log(`✅ PIX Confirmado: CPF ${user.cpf} + R$ ${trans.amount}`);
                    }
                }
            }
        } catch (e) { console.error("Webhook Error", e); }
    }
    res.status(200).send("OK");
});

// 4. Solicitar Saque
app.post('/api/payment/withdraw', async (req, res) => {
    const { userId, amount, pixKey, pixKeyType } = req.body;
    try {
        const user = await User.findById(userId);
        if (user.balance < amount) return res.status(400).json({ error: "Saldo insuficiente" });
        
        // Remove saldo na hora
        user.balance -= parseFloat(amount);
        user.pixKey = pixKey;
        user.pixKeyType = pixKeyType;
        
        // Cria transação pendente
        user.transactions.push({ 
            type: 'withdraw', 
            amount: parseFloat(amount), 
            status: 'pending', 
            createdAt: Date.now() 
        });
        
        await user.save();
        res.json({ message: "Saque solicitado! Aguarde aprovação.", balance: user.balance });
    } catch (e) { res.status(500).json({ error: "Erro saque" }); }
});


// ==================================================================
// 🕵️ ÁREA ADMINISTRATIVA (NOVO)
// ==================================================================

// 1. Dashboard (Lista usuários e saques pendentes)
app.get('/api/admin/dashboard', async (req, res) => {
    const { secret } = req.headers;
    if(secret !== 'admin123') return res.status(403).json({ error: "Senha Admin Incorreta" });

    try {
        const users = await User.find();
        
        let totalUsers = users.length;
        let totalBalance = 0;
        let pendingWithdrawals = [];

        users.forEach(user => {
            totalBalance += user.balance;
            
            // Busca saques pendentes deste usuário
            user.transactions.forEach(t => {
                if (t.type === 'withdraw' && t.status === 'pending') {
                    pendingWithdrawals.push({
                        userId: user._id,
                        cpf: user.cpf,
                        amount: t.amount,
                        pixKey: user.pixKey,
                        pixType: user.pixKeyType,
                        date: t.createdAt,
                        transId: t._id
                    });
                }
            });
        });

        res.json({ totalUsers, totalBalance, pendingWithdrawals });
    } catch (e) {
        res.status(500).json({ error: "Erro no dashboard" });
    }
});

// 2. Ação Admin (Aprovar ou Rejeitar Saque)
app.post('/api/admin/action', async (req, res) => {
    const { userId, transId, action, secret } = req.body;
    
    if(secret !== 'admin123') return res.status(403).json({ error: "Senha Admin Incorreta" });

    try {
        const user = await User.findById(userId);
        const transaction = user.transactions.id(transId);

        if (!transaction || transaction.status !== 'pending') {
            return res.status(400).json({ error: "Transação não encontrada" });
        }

        if (action === 'approve') {
            transaction.status = 'approved';
            // O dinheiro já saiu da conta do user, então só confirmamos.
        } else if (action === 'reject') {
            transaction.status = 'rejected';
            user.balance += transaction.amount; // Devolve o dinheiro pro usuário
        }

        await user.save();
        res.json({ message: `Saque ${action === 'approve' ? 'APROVADO' : 'REJEITADO'}!` });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Erro ao processar ação" });
    }
});


// ==================================================================
// 💣 LÓGICA DO JOGO (MINES)
// ==================================================================

app.post('/api/game/start', async (req, res) => {
    const { userId, betAmount, minesCount } = req.body;
    try {
        const user = await User.findById(userId);
        if (user.balance < betAmount) return res.status(400).json({ error: "Saldo insuficiente" });
        if (user.activeGame && !user.activeGame.isGameOver) return res.status(400).json({ error: "Jogo em andamento" });
        
        user.balance -= parseFloat(betAmount);
        
        user.activeGame = { 
            grid: createGrid(minesCount), 
            revealed: Array(25).fill(false), 
            minesCount, 
            betAmount, 
            currentMultiplier: 1.0, 
            diamondsFound: 0, 
            isGameOver: false 
        };
        
        await user.save();
        res.json({ balance: user.balance });
    } catch (e) { res.status(500).json({ error: "Erro start" }); }
});

app.post('/api/game/play', async (req, res) => {
    const { userId, index } = req.body;
    try {
        const user = await User.findById(userId);
        const game = user.activeGame;
        if (!game || game.isGameOver) return res.status(400).json({ error: "Sem jogo ativo" });
        if (game.revealed[index]) return res.status(400).json({ error: "Já clicado" });
        
        game.revealed[index] = true;
        user.markModified('activeGame.revealed');
        
        if (game.grid[index] === 'mine') {
            game.isGameOver = true;
            await user.save();
            return res.json({ status: 'boom', grid: game.grid });
        }
        
        game.diamondsFound++;
        let nextMult = game.currentMultiplier * calculateMultiplier(game.minesCount, game.diamondsFound - 1);
        if(game.diamondsFound === 1) nextMult = calculateMultiplier(game.minesCount, 0);
        
        game.currentMultiplier = nextMult;
        await user.save();
        
        res.json({ 
            status: 'safe', 
            multiplier: game.currentMultiplier.toFixed(2), 
            potentialWin: (game.betAmount * game.currentMultiplier).toFixed(2) 
        });
    } catch (e) { res.status(500).json({ error: "Erro play" }); }
});

app.post('/api/game/cashout', async (req, res) => {
    const { userId } = req.body;
    try {
        const user = await User.findById(userId);
        const game = user.activeGame;
        if (!game || game.isGameOver) return res.status(400).json({ error: "Erro cashout" });
        
        const win = game.betAmount * game.currentMultiplier;
        user.balance += win;
        game.isGameOver = true;
        
        await user.save();
        res.json({ status: 'cashout', winAmount: win.toFixed(2), balance: user.balance, grid: game.grid });
    } catch (e) { res.status(500).json({ error: "Erro cashout" }); }
});

// Inicia o Servidor
app.listen(PORT, () => console.log(`🔥 Server rodando na porta ${PORT}`));
