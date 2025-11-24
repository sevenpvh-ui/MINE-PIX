require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { MercadoPagoConfig, Payment } = require('mercadopago');

// Importa lógica do jogo e modelo
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

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Conectado"))
    .catch(err => console.error("❌ Erro Mongo:", err));

const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });
const payment = new Payment(client);

// ==================================================================
// 🔐 AUTENTICAÇÃO (CPF)
// ==================================================================

app.post('/api/auth/register', async (req, res) => {
    const { cpf, password } = req.body;
    try {
        if (!cpf || !password) return res.status(400).json({ error: "CPF e senha obrigatórios" });
        
        const cleanCpf = cpf.replace(/\D/g, ''); 
        if (await User.findOne({ cpf: cleanCpf })) return res.status(400).json({ error: "CPF já cadastrado" });
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({ cpf: cleanCpf, password: hashedPassword });
        
        res.json({ message: "Criado", userId: user._id, cpf: user.cpf, balance: user.balance });
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: "Erro ao registrar: " + e.message }); 
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { cpf, password } = req.body;
    try {
        const cleanCpf = cpf.replace(/\D/g, '');
        const user = await User.findOne({ cpf: cleanCpf });
        
        if (!user) return res.status(400).json({ error: "CPF não encontrado" });
        if (!await bcrypt.compare(password, user.password)) return res.status(400).json({ error: "Senha incorreta" });

        res.json({ message: "Logado", userId: user._id, cpf: user.cpf, balance: user.balance });
    } catch (e) { res.status(500).json({ error: "Erro ao logar" }); }
});

app.get('/api/me/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if(!user) return res.status(404).json({error: "User not found"});
        res.json({ balance: user.balance, cpf: user.cpf });
    } catch (e) { res.status(500).json({ error: "Erro" }); }
});

// ==================================================================
// 💰 PAGAMENTOS
// ==================================================================

// 1. Gerar PIX (Mercado Pago)
app.post('/api/payment/deposit', async (req, res) => {
    const { userId, amount } = req.body;
    try {
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: "User not found" });

        const fakeEmail = `${user.cpf}@minespro.com`; // Email técnico para API
        const body = {
            transaction_amount: parseFloat(amount),
            description: 'Creditos Mines',
            payment_method_id: 'pix',
            payer: { email: fakeEmail },
            notification_url: `${SITE_URL}/api/webhook`
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
        res.status(500).json({ error: "Erro ao gerar PIX" }); 
    }
});

// 2. Depósito Simulado (Debug)
app.post('/api/debug/deposit', async (req, res) => {
    const { userId, amount } = req.body;
    try {
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: "Usuário não encontrado" });
        
        const valor = parseFloat(amount);
        if (valor <= 0) return res.status(400).json({ error: "Valor inválido" });

        user.balance += valor;
        user.transactions.push({
            type: 'deposit',
            amount: valor,
            status: 'approved',
            mpPaymentId: 'SIMULADO_' + Date.now(),
            createdAt: Date.now()
        });

        await user.save();
        res.json({ message: "Saldo adicionado!", balance: user.balance });
    } catch (e) { res.status(500).json({ error: "Erro ao simular" }); }
});

// 3. Webhook
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
                    }
                }
            }
        } catch (e) { console.error("Webhook Error", e); }
    }
    res.status(200).send("OK");
});

// 4. Saque
app.post('/api/payment/withdraw', async (req, res) => {
    const { userId, amount, pixKey, pixKeyType } = req.body;
    try {
        const user = await User.findById(userId);
        if (user.balance < amount) return res.status(400).json({ error: "Saldo insuficiente" });
        
        user.balance -= parseFloat(amount);
        user.pixKey = pixKey;
        user.pixKeyType = pixKeyType;
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

// 5. NOVO: Histórico de Transações
app.get('/api/me/transactions/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ error: "User not found" });

        // Pega as últimas 20 transações
        const history = user.transactions
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 20);

        res.json(history);
    } catch (e) { res.status(500).json({ error: "Erro ao buscar histórico" }); }
});

// ==================================================================
// 🕵️ ÁREA ADMINISTRATIVA
// ==================================================================
app.get('/api/admin/dashboard', async (req, res) => {
    const { secret } = req.headers;
    if(secret !== 'admin123') return res.status(403).json({ error: "Acesso Negado" });
    try {
        const users = await User.find();
        let totalUsers = users.length;
        let totalBalance = 0;
        let pendingWithdrawals = [];
        users.forEach(user => {
            totalBalance += user.balance;
            user.transactions.forEach(t => {
                if (t.type === 'withdraw' && t.status === 'pending') {
                    pendingWithdrawals.push({ userId: user._id, cpf: user.cpf, amount: t.amount, pixKey: user.pixKey, pixType: user.pixKeyType, date: t.createdAt, transId: t._id });
                }
            });
        });
        res.json({ totalUsers, totalBalance, pendingWithdrawals });
    } catch (e) { res.status(500).json({ error: "Erro no dashboard" }); }
});

app.post('/api/admin/action', async (req, res) => {
    const { userId, transId, action, secret } = req.body;
    if(secret !== 'admin123') return res.status(403).json({ error: "Acesso Negado" });
    try {
        const user = await User.findById(userId);
        const transaction = user.transactions.id(transId);
        if (!transaction || transaction.status !== 'pending') return res.status(400).json({ error: "Transação inválida" });

        if (action === 'approve') transaction.status = 'approved';
        else if (action === 'reject') {
            transaction.status = 'rejected';
            user.balance += transaction.amount;
        }
        await user.save();
        res.json({ message: `Saque ${action === 'approve' ? 'APROVADO' : 'REJEITADO'}!` });
    } catch (e) { res.status(500).json({ error: "Erro" }); }
});

// ==================================================================
// 💣 LÓGICA DO JOGO
// ==================================================================
app.post('/api/game/start', async (req, res) => {
    const { userId, betAmount, minesCount } = req.body;
    try {
        const user = await User.findById(userId);
        if (user.balance < betAmount) return res.status(400).json({ error: "Saldo insuficiente" });
        if (user.activeGame && !user.activeGame.isGameOver) return res.status(400).json({ error: "Jogo em andamento" });
        
        user.balance -= parseFloat(betAmount);
        user.activeGame = { grid: createGrid(minesCount), revealed: Array(25).fill(false), minesCount, betAmount, currentMultiplier: 1.0, diamondsFound: 0, isGameOver: false };
        
        await user.save();
        res.json({ balance: user.balance });
    } catch (e) { res.status(500).json({ error: "Erro start" }); }
});

app.post('/api/game/play', async (req, res) => {
    const { userId, index } = req.body;
    try {
        const user = await User.findById(userId);
        const game = user.activeGame;
        if (!game || game.isGameOver) return res.status(400).json({ error: "Sem jogo" });
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
        res.json({ status: 'safe', multiplier: game.currentMultiplier.toFixed(2), potentialWin: (game.betAmount * game.currentMultiplier).toFixed(2) });
    } catch (e) { res.status(500).json({ error: "Erro play" }); }
});

app.post('/api/game/cashout', async (req, res) => {
    const { userId } = req.body;
    try {
        const user = await User.findById(userId);
        const game = user.activeGame;
        if (!game || game.isGameOver) return res.status(400).json({ error: "Erro" });
        const win = game.betAmount * game.currentMultiplier;
        user.balance += win;
        game.isGameOver = true;
        await user.save();
        res.json({ status: 'cashout', winAmount: win.toFixed(2), balance: user.balance, grid: game.grid });
    } catch (e) { res.status(500).json({ error: "Erro cashout" }); }
});

app.listen(PORT, () => console.log(`🔥 Server rodando na porta ${PORT}`));
