require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { MercadoPagoConfig, Payment } = require('mercadopago');

// Importa lógica do jogo e modelos
const { createGrid, calculateMultiplier } = require('./gameEngine');
const User = require('./models/User');
const Settings = require('./models/Settings');

const app = express();

// ==================================================================
// 🔒 TRAVA DE DOMÍNIO
// ==================================================================
const DOMINIO_AUTORIZADO = "mine-pix.onrender.com"; 

app.use((req, res, next) => {
    const host = req.get('host');
    if (!host.includes(DOMINIO_AUTORIZADO) && !host.includes("localhost")) {
        return res.status(403).send("<h1>Licença Inválida.</h1>");
    }
    next();
});

// ==================================================================
// ⚙️ CONFIGURAÇÕES GERAIS
// ==================================================================

app.set('trust proxy', 1);

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 1000, 
    message: { error: "Muitas tentativas. Aguarde um pouco." }
});
app.use('/api/', limiter);

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const SITE_URL = process.env.SITE_URL; 

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log("✅ MongoDB Conectado");
        const settings = await Settings.findOne();
        if (!settings) {
            await Settings.create({ dailyBonus: 1.00, houseEdge: 0.95, adminPassword: 'admin123', minDeposit: 5.00, minWithdraw: 20.00 });
            console.log("⚙️ Configurações iniciais criadas.");
        }
    })
    .catch(err => console.error("❌ Erro Mongo:", err));

const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });
const payment = new Payment(client);

// ==================================================================
// 🛠️ FUNÇÕES AUXILIARES
// ==================================================================

function validateCPF(cpf) {
    cpf = cpf.replace(/[^\d]+/g, '');
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    let sum = 0, remainder;
    for (let i = 1; i <= 9; i++) sum += parseInt(cpf.substring(i-1, i)) * (11 - i);
    remainder = (sum * 10) % 11;
    if ((remainder === 10) || (remainder === 11)) remainder = 0;
    if (remainder !== parseInt(cpf.substring(9, 10))) return false;
    sum = 0;
    for (let i = 1; i <= 10; i++) sum += parseInt(cpf.substring(i-1, i)) * (12 - i);
    remainder = (sum * 10) % 11;
    if ((remainder === 10) || (remainder === 11)) remainder = 0;
    if (remainder !== parseInt(cpf.substring(10, 11))) return false;
    return true;
}

async function payCommission(userId, amount) {
    try {
        const user = await User.findById(userId).populate('referredBy');
        if (user && user.referredBy) {
            const referrer = user.referredBy;
            const commission = amount * 0.10; 
            referrer.balance += commission;
            referrer.affiliateEarnings = (referrer.affiliateEarnings || 0) + commission;
            referrer.transactions.push({
                type: 'commission',
                amount: commission,
                status: 'approved',
                mpPaymentId: `COM_${Date.now()}`,
                createdAt: Date.now()
            });
            await referrer.save();
        }
    } catch (e) { console.error("Erro comissão", e); }
}

async function isAdmin(secret) {
    const settings = await Settings.findOne();
    const valid = settings ? settings.adminPassword : 'admin123';
    return secret === valid;
}

// ==================================================================
// 🔐 ROTAS
// ==================================================================

app.post('/api/auth/register', async (req, res) => {
    const { name, cpf, phone, password, refCode } = req.body;
    try {
        if (!name || !cpf || !phone || !password) return res.status(400).json({ error: "Preencha todos os campos!" });
        if (!validateCPF(cpf)) return res.status(400).json({ error: "CPF Inválido!" });
        const cleanCpf = cpf.replace(/\D/g, ''); 
        if (await User.findOne({ cpf: cleanCpf })) return res.status(400).json({ error: "CPF já cadastrado" });
        let referrerId = null;
        if (refCode && refCode.trim() !== "") {
            const referrer = await User.findOne({ affiliateCode: refCode.trim() });
            if (referrer) { referrerId = referrer._id; referrer.referralCount += 1; await referrer.save(); }
        }
        const user = await User.create({ 
            name, phone, cpf: cleanCpf, 
            password: await bcrypt.hash(password, 10), 
            affiliateCode: 'mina-' + Math.random().toString(36).substring(2, 7), 
            referredBy: referrerId 
        });
        res.json({ message: "Criado", userId: user._id, name: user.name, cpf: user.cpf, balance: user.balance });
    } catch (e) { res.status(500).json({ error: "Erro ao registrar" }); }
});

app.post('/api/auth/login', async (req, res) => {
    const { cpf, password } = req.body;
    try {
        const user = await User.findOne({ cpf: cpf.replace(/\D/g, '') });
        if (!user) return res.status(400).json({ error: "CPF não encontrado" });
        if (user.isBanned) return res.status(403).json({ error: "Banido" });
        if (!await bcrypt.compare(password, user.password)) return res.status(400).json({ error: "Senha incorreta" });
        res.json({ message: "Logado", userId: user._id, name: user.name, cpf: user.cpf, balance: user.balance, history: user.gameHistory || [] });
    } catch (e) { res.status(500).json({ error: "Erro ao logar" }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
    const { cpf, name, phone, newPassword } = req.body;
    try {
        const user = await User.findOne({ cpf: cpf.replace(/\D/g, '') });
        if (!user || user.phone !== phone || user.name.trim().toLowerCase() !== name.trim().toLowerCase()) return res.status(400).json({ error: "Dados incorretos" });
        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();
        res.json({ message: "Senha alterada!" });
    } catch (e) { res.status(500).json({ error: "Erro reset" }); }
});

app.get('/api/me/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if(!user) return res.status(404).json({error: "User not found"});
        res.json({ balance: user.balance, name: user.name, cpf: user.cpf, history: user.gameHistory ? user.gameHistory.slice(-15) : [] });
    } catch (e) { res.status(500).json({ error: "Erro" }); }
});

// FINANCEIRO (COM DEPÓSITO MÍNIMO)
app.post('/api/payment/deposit', async (req, res) => {
    const { userId, amount } = req.body;
    try {
        const settings = await Settings.findOne();
        const minDep = settings ? settings.minDeposit : 5;
        if (parseFloat(amount) < minDep) return res.status(400).json({ error: `Mínimo R$ ${minDep.toFixed(2)}` });

        const user = await User.findById(userId);
        let notificationUrl = (SITE_URL && SITE_URL.includes('https://')) ? `${SITE_URL}/api/webhook` : undefined;
        
        const body = { 
            transaction_amount: parseFloat(amount), description: 'Creditos Mines', payment_method_id: 'pix', 
            payer: { email: `user_${user.cpf}@minespix.com`, first_name: user.name.split(' ')[0], identification: { type: 'CPF', number: user.cpf } }, 
            notification_url: notificationUrl 
        };

        const result = await payment.create({ body });
        const copyPaste = result.point_of_interaction?.transaction_data?.qr_code;
        const base64 = result.point_of_interaction?.transaction_data?.qr_code_base64;
        const paymentId = result.id?.toString();

        if(!copyPaste) throw new Error("Sem QR Code");

        user.transactions.push({ type: 'deposit', amount: parseFloat(amount), status: 'pending', mpPaymentId: paymentId, qrCodeBase64: base64 });
        await user.save();
        res.json({ copyPaste, qrCodeBase64: base64, paymentId });
    } catch (e) { res.status(500).json({ error: "Erro PIX: " + (e.message || "Interno") }); }
});

app.post('/api/webhook', async (req, res) => {
    const paymentId = req.query.id || req.body.data?.id;
    const type = req.body.type;
    res.sendStatus(200);
    if (paymentId && (type === 'payment' || req.body.action === 'payment.updated')) {
        try {
            const payInfo = await payment.get({ id: paymentId });
            if (payInfo.status === 'approved') {
                const user = await User.findOne({ "transactions.mpPaymentId": paymentId.toString() });
                if (user) {
                    const trans = user.transactions.find(t => t.mpPaymentId === paymentId.toString());
                    if (trans && trans.status === 'pending') {
                        trans.status = 'approved';
                        user.balance += trans.amount;
                        await user.save();
                        await payCommission(user._id, trans.amount);
                    }
                }
            }
        } catch (e) {}
    }
});

// SAQUE (COM TRAVA DE ROLLOVER)
app.post('/api/payment/withdraw', async (req, res) => {
    const { userId, amount, pixKey, pixKeyType } = req.body;
    try {
        const user = await User.findById(userId);
        const settings = await Settings.findOne();
        const minWith = settings ? settings.minWithdraw : 20;

        // 1. Verifica Mínimo
        if (parseFloat(amount) < minWith) return res.status(400).json({ error: `Mínimo R$ ${minWith.toFixed(2)}` });
        
        // 2. Verifica Saldo
        if (user.balance < amount) return res.status(400).json({ error: "Saldo insuficiente" });

        // 3. VERIFICA ROLLOVER (META DE APOSTAS)
        if (user.withdrawalRollover > 0.50) {
            return res.status(400).json({ error: `Bloqueado! Você precisa apostar mais R$ ${user.withdrawalRollover.toFixed(2)} para liberar o saque.` });
        }

        user.balance -= parseFloat(amount);
        user.transactions.push({ type: 'withdraw', amount: parseFloat(amount), status: 'pending', createdAt: Date.now(), pixKey, pixKeyType });
        await user.save();
        res.json({ message: "Solicitado com sucesso!", balance: user.balance });
    } catch (e) { res.status(500).json({ error: "Erro saque" }); }
});

// EXTRAS
app.get('/api/affiliates/stats/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        res.json({ code: user.affiliateCode, earnings: user.affiliateEarnings || 0, count: user.referralCount || 0, link: `${SITE_URL}?ref=${user.affiliateCode}` });
    } catch(e) { res.status(500).json({error: "Erro stats"}); }
});

// BÔNUS DIÁRIO (ADICIONA ROLLOVER)
app.post('/api/bonus/daily', async (req, res) => {
    const { userId } = req.body;
    try {
        const user = await User.findById(userId);
        const now = new Date();
        const last = user.lastDailyBonus ? new Date(user.lastDailyBonus) : null;
        if (last && (now - last) < 86400000) return res.status(400).json({ error: "Volte amanhã!" });
        
        const settings = await Settings.findOne();
        const bonusAmount = settings ? settings.dailyBonus : 1.00;

        user.balance += bonusAmount;
        
        // REGRA DE ROLLOVER: Multiplica o bônus por 20x
        const rolloverMultiplier = 20; 
        if(!user.withdrawalRollover) user.withdrawalRollover = 0;
        user.withdrawalRollover += (bonusAmount * rolloverMultiplier);

        user.lastDailyBonus = now;
        user.transactions.push({ type: 'bonus', amount: bonusAmount, status: 'approved', mpPaymentId: 'BONUS_' + Date.now() });
        
        await user.save();
        res.json({ message: `Ganhou R$ ${bonusAmount.toFixed(2)}! Meta de aposta: +R$ ${(bonusAmount*rolloverMultiplier).toFixed(2)}`, balance: user.balance });
    } catch (e) { res.status(500).json({ error: "Erro bônus" }); }
});

app.get('/api/me/transactions/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        res.json(user.transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 20));
    } catch (e) { res.status(500).json({ error: "Erro histórico" }); }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const top = await User.find({}, 'name balance').sort({ balance: -1 }).limit(5);
        res.json(top.map(u => ({ name: u.name.substring(0, 3) + '***', balance: u.balance })));
    } catch (e) { res.status(500).json({ error: "Erro ranking" }); }
});

// ADMIN
app.post('/api/admin/login', async (req, res) => {
    if(await isAdmin(req.body.password)) res.json({ success: true }); else res.status(403).json({ error: "Senha incorreta" });
});
app.get('/api/admin/dashboard', async (req, res) => {
    if(!await isAdmin(req.headers.secret)) return res.status(403).json({ error: "Negado" });
    try {
        const users = await User.find();
        let dep = 0, withDr = 0, pending = [];
        users.forEach(u => u.transactions.forEach(t => {
            if (t.type === 'deposit' && t.status === 'approved') dep += t.amount;
            if (t.type === 'withdraw' && t.status === 'approved') withDr += t.amount;
            if (t.type === 'withdraw' && t.status === 'pending') pending.push({ userId: u._id, cpf: u.cpf, amount: t.amount, pixKey: t.pixKey, date: t.createdAt, transId: t._id });
        }));
        res.json({ totalUsers: users.length, totalBalance: users.reduce((a,b)=>a+b.balance,0), pendingWithdrawals: pending, financials: { deposited: dep, withdrawn: withDr, profit: dep - withDr } });
    } catch(e) { res.status(500).json({ error: "Erro" }); }
});
app.post('/api/admin/action', async (req, res) => {
    const { userId, transId, action, secret } = req.body;
    if(!await isAdmin(secret)) return res.status(403).json({ error: "Negado" });
    const user = await User.findById(userId);
    const trans = user.transactions.id(transId);
    if (action === 'approve') trans.status = 'approved';
    else { trans.status = 'rejected'; user.balance += trans.amount; }
    await user.save();
    res.json({ message: "OK" });
});
app.post('/api/admin/settings', async (req, res) => {
    const { secret, dailyBonus, houseEdge, minDeposit, minWithdraw } = req.body;
    if(!await isAdmin(secret)) return res.status(403).json({ error: "Negado" });
    const s = await Settings.findOne();
    if(dailyBonus) s.dailyBonus = parseFloat(dailyBonus);
    if(houseEdge) s.houseEdge = parseFloat(houseEdge);
    if(minDeposit) s.minDeposit = parseFloat(minDeposit);
    if(minWithdraw) s.minWithdraw = parseFloat(minWithdraw);
    await s.save();
    res.json({ message: "Salvo" });
});

// JOGO (DESCONTA ROLLOVER)
app.post('/api/game/start', async (req, res) => {
    const { userId, betAmount, minesCount } = req.body;
    try {
        const user = await User.findById(userId);
        if (user.balance < betAmount) return res.status(400).json({ error: "Saldo insuficiente" });
        if (user.activeGame && !user.activeGame.isGameOver) return res.status(400).json({ error: "Jogo em andamento" });
        
        user.balance -= parseFloat(betAmount);
        
        // REDUZ ROLLOVER (META) AO APOSTAR
        if (user.withdrawalRollover > 0) {
            user.withdrawalRollover = Math.max(0, user.withdrawalRollover - parseFloat(betAmount));
        }

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
        if (game.revealed[index]) return res.status(400).json({ error: "Clicado" });
        
        game.revealed[index] = true;
        user.markModified('activeGame.revealed');
        
        if (game.grid[index] === 'mine') {
            game.isGameOver = true;
            if(!user.gameHistory) user.gameHistory = [];
            user.gameHistory.push('loss');
            if(user.gameHistory.length > 15) user.gameHistory.shift();
            await user.save();
            return res.json({ status: 'boom', grid: game.grid });
        }
        
        game.diamondsFound++;
        const settings = await Settings.findOne();
        let nextMult = game.currentMultiplier * calculateMultiplier(game.minesCount, game.diamondsFound - 1, settings ? settings.houseEdge : 0.95);
        if(game.diamondsFound === 1 && nextMult < 1.01) nextMult = 1.01;
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
        
        if(!user.gameHistory) user.gameHistory = [];
        user.gameHistory.push('win');
        if(user.gameHistory.length > 15) user.gameHistory.shift();
        
        await user.save();
        res.json({ status: 'cashout', winAmount: win.toFixed(2), balance: user.balance, grid: game.grid });
    } catch (e) { res.status(500).json({ error: "Erro cashout" }); }
});

app.listen(PORT, () => console.log(`🔥 Online na porta ${PORT}`));
