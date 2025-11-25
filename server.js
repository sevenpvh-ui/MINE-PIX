require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { MercadoPagoConfig, Payment } = require('mercadopago');

const { createGrid, calculateMultiplier } = require('./gameEngine');
const User = require('./models/User');
const Settings = require('./models/Settings');

const app = express();
app.set('trust proxy', 1);

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, message: { error: "Muitas tentativas." } });
app.use('/api/', limiter);

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const SITE_URL = process.env.SITE_URL; 

mongoose.connect(MONGO_URI).then(async () => {
    console.log("✅ MongoDB Conectado");
    const settings = await Settings.findOne();
    if (!settings) await Settings.create({ dailyBonus: 1.00, houseEdge: 0.95 });
}).catch(err => console.error("❌ Erro Mongo:", err));

const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });
const payment = new Payment(client);

// --- FUNÇÕES AUXILIARES ---
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
            referrer.transactions.push({ type: 'commission', amount: commission, status: 'approved', mpPaymentId: `COM_${Date.now()}`, createdAt: Date.now() });
            await referrer.save();
        }
    } catch (e) { console.error(e); }
}

// --- ROTAS DE CONFIGURAÇÃO (ADMIN) ---
app.get('/api/admin/settings', async (req, res) => {
    const { secret } = req.headers;
    if(secret !== 'admin123') return res.status(403).json({ error: "Negado" });
    const settings = await Settings.findOne();
    res.json(settings);
});

app.post('/api/admin/settings', async (req, res) => {
    const { secret, dailyBonus, houseEdge } = req.body;
    if(secret !== 'admin123') return res.status(403).json({ error: "Negado" });
    
    const settings = await Settings.findOne();
    if(settings) {
        if(dailyBonus !== undefined) settings.dailyBonus = parseFloat(dailyBonus);
        if(houseEdge !== undefined) settings.houseEdge = parseFloat(houseEdge);
        await settings.save();
    }
    res.json({ message: "Configurações salvas!" });
});

// --- AUTH ---
app.post('/api/auth/register', async (req, res) => {
    const { name, cpf, phone, password, refCode } = req.body;
    try {
        if (!name || !cpf || !phone || !password) return res.status(400).json({ error: "Preencha tudo" });
        if (!validateCPF(cpf)) return res.status(400).json({ error: "CPF Inválido!" });
        const cleanCpf = cpf.replace(/\D/g, ''); 
        if (await User.findOne({ cpf: cleanCpf })) return res.status(400).json({ error: "CPF já cadastrado" });
        
        let referrerId = null;
        if (refCode && refCode.trim() !== "") {
            const referrer = await User.findOne({ affiliateCode: refCode.trim() });
            if (referrer) { referrerId = referrer._id; referrer.referralCount += 1; await referrer.save(); }
        }

        const newAffiliateCode = 'mina-' + Math.random().toString(36).substring(2, 7);
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({ name, phone, cpf: cleanCpf, password: hashedPassword, affiliateCode: newAffiliateCode, referredBy: referrerId });
        
        res.json({ message: "Criado", userId: user._id, name: user.name, cpf: user.cpf, balance: user.balance });
    } catch (e) { res.status(500).json({ error: "Erro registro" }); }
});

app.post('/api/auth/login', async (req, res) => {
    const { cpf, password } = req.body;
    try {
        const cleanCpf = cpf.replace(/\D/g, '');
        const user = await User.findOne({ cpf: cleanCpf });
        if (!user) return res.status(400).json({ error: "CPF não encontrado" });
        if (user.isBanned) return res.status(403).json({ error: "Conta bloqueada" });
        if (!await bcrypt.compare(password, user.password)) return res.status(400).json({ error: "Senha incorreta" });
        res.json({ message: "Logado", userId: user._id, name: user.name, cpf: user.cpf, balance: user.balance });
    } catch (e) { res.status(500).json({ error: "Erro login" }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
    const { cpf, name, phone, newPassword } = req.body;
    try {
        const cleanCpf = cpf.replace(/\D/g, '');
        const user = await User.findOne({ cpf: cleanCpf });
        if (!user) return res.status(404).json({ error: "Não encontrado" });
        if (user.phone !== phone || user.name.trim().toLowerCase() !== name.trim().toLowerCase()) return res.status(400).json({ error: "Dados incorretos" });
        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();
        res.json({ message: "Senha alterada!" });
    } catch (e) { res.status(500).json({ error: "Erro reset" }); }
});

app.get('/api/me/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if(!user) return res.status(404).json({error: "User not found"});
        if (user.isBanned) return res.status(403).json({ error: "Banido" });
        res.json({ balance: user.balance, name: user.name, cpf: user.cpf });
    } catch (e) { res.status(500).json({ error: "Erro" }); }
});

// --- ROTAS FINANCEIRAS ---
app.post('/api/payment/deposit', async (req, res) => {
    const { userId, amount } = req.body;
    try {
        const user = await User.findById(userId);
        const fakeEmail = `${user.cpf}@minespix.com`;
        const body = { transaction_amount: parseFloat(amount), description: 'Creditos Mines', payment_method_id: 'pix', payer: { email: fakeEmail }, notification_url: `${SITE_URL}/api/webhook` };
        const result = await payment.create({ body });
        user.transactions.push({ type: 'deposit', amount: parseFloat(amount), status: 'pending', mpPaymentId: result.id.toString(), qrCodeBase64: result.point_of_interaction.transaction_data.qr_code_base64 });
        await user.save();
        res.json({ copyPaste: result.point_of_interaction.transaction_data.qr_code, qrCodeBase64: result.point_of_interaction.transaction_data.qr_code_base64, paymentId: result.id });
    } catch (e) { res.status(500).json({ error: "Erro PIX" }); }
});

// ** ATENÇÃO: ROTA DE DEBUG MANTIDA PARA TESTES, REMOVA EM PRODUÇÃO **
app.post('/api/debug/deposit', async (req, res) => {
    const { userId, amount } = req.body;
    try {
        const user = await User.findById(userId);
        const valor = parseFloat(amount);
        user.balance += valor;
        user.transactions.push({ type: 'deposit', amount: valor, status: 'approved', mpPaymentId: 'SIM_' + Date.now() });
        await user.save();
        await payCommission(userId, valor); 
        res.json({ message: "Simulado!", balance: user.balance });
    } catch (e) { res.status(500).json({ error: "Erro simulação" }); }
});

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
                        await payCommission(user._id, trans.amount);
                    }
                }
            }
        } catch (e) {}
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
        res.json({ message: "Solicitado!", balance: user.balance });
    } catch (e) { res.status(500).json({ error: "Erro saque" }); }
});

// --- EXTRAS ---
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
        user.lastDailyBonus = now;
        user.transactions.push({ type: 'bonus', amount: bonusAmount, status: 'approved', mpPaymentId: 'BONUS_' + Date.now() });
        await user.save();
        res.json({ message: `Bônus de R$ ${bonusAmount.toFixed(2)} resgatado!`, balance: user.balance });
    } catch (e) { res.status(500).json({ error: "Erro bônus" }); }
});

app.get('/api/me/transactions/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        const history = user.transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 20);
        res.json(history);
    } catch (e) { res.status(500).json({ error: "Erro histórico" }); }
});

app.get('/api/affiliates/stats/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        res.json({ code: user.affiliateCode, earnings: user.affiliateEarnings || 0, count: user.referralCount || 0, link: `${SITE_URL}?ref=${user.affiliateCode}` });
    } catch(e) { res.status(500).json({error: "Erro stats"}); }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const topUsers = await User.find({}, 'name balance').sort({ balance: -1 }).limit(5);
        const maskedUsers = topUsers.map(u => ({ name: u.name.substring(0, 3) + '***', balance: u.balance }));
        res.json(maskedUsers);
    } catch (e) { res.status(500).json({ error: "Erro ranking" }); }
});

// --- ADMIN ---
app.get('/api/admin/dashboard', async (req, res) => { const { secret } = req.headers; if(secret !== 'admin123') return res.status(403).json({ error: "Negado" }); try { const users = await User.find(); let totalUsers = users.length, totalBalance = 0, totalDeposited = 0, totalWithdrawn = 0, pendingWithdrawals = [], topAffiliates = []; users.forEach(u => { totalBalance += u.balance; if(u.referralCount > 0) topAffiliates.push({ name: u.name, count: u.referralCount, earnings: u.affiliateEarnings }); u.transactions.forEach(t => { if (t.type === 'deposit' && t.status === 'approved') totalDeposited += t.amount; if (t.type === 'withdraw' && t.status === 'approved') totalWithdrawn += t.amount; if (t.type === 'withdraw' && t.status === 'pending') pendingWithdrawals.push({ userId: u._id, cpf: u.cpf, amount: t.amount, pixKey: u.pixKey, pixType: u.pixKeyType, date: t.createdAt, transId: t._id }); }); }); topAffiliates.sort((a,b) => b.earnings - a.earnings); res.json({ totalUsers, totalBalance, pendingWithdrawals, financials: { deposited: totalDeposited, withdrawn: totalWithdrawn, profit: totalDeposited - totalWithdrawn }, topAffiliates: topAffiliates.slice(0, 10) }); } catch(e) { res.status(500).json({ error: "Erro admin" }); } });
app.post('/api/admin/users', async (req, res) => { const { secret, search } = req.body; if(secret !== 'admin123') return res.status(403).json({ error: "Negado" }); try { let query = {}; if(search) query = { cpf: { $regex: search, $options: 'i' } }; const users = await User.find(query, 'name cpf balance isBanned phone').limit(50); res.json(users); } catch(e) { res.status(500).json({ error: "Erro lista users" }); } });
app.post('/api/admin/action', async (req, res) => { const { userId, transId, action, secret } = req.body; if(secret !== 'admin123') return res.status(403).json({ error: "Negado" }); const user = await User.findById(userId); const trans = user.transactions.id(transId); if (action === 'approve') trans.status = 'approved'; else if (action === 'reject') { trans.status = 'rejected'; user.balance += trans.amount; } await user.save(); res.json({ message: "Sucesso!" }); });
app.post('/api/admin/user/update', async (req, res) => { const { userId, newBalance, isBanned, secret } = req.body; if(secret !== 'admin123') return res.status(403).json({ error: "Negado" }); try { const user = await User.findById(userId); if(!user) return res.status(404).json({ error: "User not found" }); if(newBalance !== undefined) { user.transactions.push({ type: 'admin_adjustment', amount: parseFloat(newBalance) - user.balance, status: 'approved', mpPaymentId: 'ADMIN', createdAt: Date.now() }); user.balance = parseFloat(newBalance); } if(isBanned !== undefined) user.isBanned = isBanned; await user.save(); res.json({ message: "Atualizado!" }); } catch(e) { res.status(500).json({ error: "Erro update" }); } });

// --- JOGO (COM HOUSE EDGE DINÂMICO) ---
app.post('/api/game/start', async (req, res) => { const { userId, betAmount, minesCount } = req.body; try { const user = await User.findById(userId); if (user.balance < betAmount) return res.status(400).json({ error: "Saldo insuficiente" }); if (user.activeGame && !user.activeGame.isGameOver) return res.status(400).json({ error: "Jogo em andamento" }); user.balance -= parseFloat(betAmount); user.activeGame = { grid: createGrid(minesCount), revealed: Array(25).fill(false), minesCount, betAmount, currentMultiplier: 1.0, diamondsFound: 0, isGameOver: false }; await user.save(); res.json({ balance: user.balance }); } catch (e) { res.status(500).json({ error: "Erro" }); } });
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
            await user.save(); 
            return res.json({ status: 'boom', grid: game.grid }); 
        } 
        
        game.diamondsFound++; 
        
        // BUSCA DIFICULDADE DO BANCO
        const settings = await Settings.findOne();
        const currentEdge = settings ? settings.houseEdge : 0.95;

        let nextMult = game.currentMultiplier * calculateMultiplier(game.minesCount, game.diamondsFound - 1, currentEdge);
        if(game.diamondsFound === 1) nextMult = calculateMultiplier(game.minesCount, 0, currentEdge); 
        
        game.currentMultiplier = nextMult; 
        await user.save(); 
        res.json({ status: 'safe', multiplier: game.currentMultiplier.toFixed(2), potentialWin: (game.betAmount * game.currentMultiplier).toFixed(2) }); 
    } catch (e) { res.status(500).json({ error: "Erro" }); } 
});
app.post('/api/game/cashout', async (req, res) => { const { userId } = req.body; try { const user = await User.findById(userId); const game = user.activeGame; if (!game || game.isGameOver) return res.status(400).json({ error: "Erro" }); const win = game.betAmount * game.currentMultiplier; user.balance += win; game.isGameOver = true; await user.save(); res.json({ status: 'cashout', winAmount: win.toFixed(2), balance: user.balance, grid: game.grid }); } catch (e) { res.status(500).json({ error: "Erro" }); } });

app.listen(PORT, () => console.log(`🔥 Online na porta ${PORT}`));
