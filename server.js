require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const { createGrid, calculateMultiplier } = require('./gameEngine');
const User = require('./models/User');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const SITE_URL = process.env.SITE_URL; 

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Conectado"))
    .catch(err => console.error("❌ Erro Mongo:", err));

const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });
const payment = new Payment(client);

// --- ROTA DE REGISTRO (CPF) ---
app.post('/api/auth/register', async (req, res) => {
    const { cpf, password } = req.body; // AGORA RECEBE CPF
    try {
        if (!cpf || !password) return res.status(400).json({ error: "CPF e senha obrigatórios" });
        
        // Verifica se CPF já existe (limpa pontos e traços se tiver)
        const cleanCpf = cpf.replace(/\D/g, ''); 
        if (await User.findOne({ cpf: cleanCpf })) return res.status(400).json({ error: "CPF já cadastrado" });
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({ cpf: cleanCpf, password: hashedPassword });
        
        res.json({ message: "Criado", userId: user._id, cpf: user.cpf, balance: user.balance });
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: "Erro ao registrar" }); 
    }
});

// --- ROTA DE LOGIN (CPF) ---
app.post('/api/auth/login', async (req, res) => {
    const { cpf, password } = req.body;
    try {
        const cleanCpf = cpf.replace(/\D/g, '');
        const user = await User.findOne({ cpf: cleanCpf });
        if (!user) return res.status(400).json({ error: "CPF não encontrado" });

        if (!await bcrypt.compare(password, user.password)) {
            return res.status(400).json({ error: "Senha incorreta" });
        }

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

// --- PAGAMENTO (PIX) ---
app.post('/api/payment/deposit', async (req, res) => {
    const { userId, amount } = req.body;
    try {
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: "User not found" });

        // Mercado Pago EXIGE email. Geramos um falso baseado no CPF.
        const fakeEmail = `${user.cpf}@minespro.com`;

        const body = {
            transaction_amount: parseFloat(amount),
            description: 'Creditos Mines',
            payment_method_id: 'pix',
            payer: { email: fakeEmail }, // Email falso para passar na API
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

// ... (MANTENHA AS OUTRAS ROTAS IGUAIS: webhook, withdraw, game/start, game/play, game/cashout) ...
// Copie o resto do arquivo server.js anterior a partir da linha do Webhook, pois a lógica do jogo não muda.

// --- MANTENHA O RESTO DO CÓDIGO (WEBHOOK E JOGO) IGUAL AO ANTERIOR ---
// Só vou reenviar o finalzinho para garantir que você tenha o arquivo fechado corretamente:

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

app.post('/api/payment/withdraw', async (req, res) => {
    const { userId, amount, pixKey, pixKeyType } = req.body;
    try {
        const user = await User.findById(userId);
        if (user.balance < amount) return res.status(400).json({ error: "Saldo insuficiente" });
        user.balance -= parseFloat(amount);
        user.pixKey = pixKey;
        user.pixKeyType = pixKeyType;
        user.transactions.push({ type: 'withdraw', amount: parseFloat(amount), status: 'pending', createdAt: Date.now() });
        await user.save();
        res.json({ message: "Saque solicitado!", balance: user.balance });
    } catch (e) { res.status(500).json({ error: "Erro saque" }); }
});

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
