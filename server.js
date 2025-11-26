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
// 🔒 TRAVA DE DOMÍNIO (ANTI-PIRATARIA)
// ==================================================================
const DOMINIO_AUTORIZADO = "mine-pix.onrender.com"; 

app.use((req, res, next) => {
    const host = req.get('host');
    // Verifica se é o domínio autorizado ou localhost (para testes)
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
    max: 1000, // Limite alto para não atrapalhar o jogo
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

// ==================================================================
// 🗄️ CONEXÃO MONGODB (COM AUTO-REPARO DE SENHA ADMIN)
// ==================================================================
mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log("✅ MongoDB Conectado");
        
        let settings = await Settings.findOne();
        
        // Se não existir nenhuma configuração, cria do zero
        if (!settings) {
            await Settings.create({ 
                dailyBonus: 1.00, 
                houseEdge: 0.95, 
                adminPassword: 'admin123', // Senha Padrão
                minDeposit: 5.00, 
                minWithdraw: 20.00 
            });
            console.log("⚙️ Configurações iniciais criadas.");
        } else {
            // CORREÇÃO: Se a configuração existe mas a senha sumiu/está vazia
            let precisaSalvar = false;

            if (!settings.adminPassword) {
                settings.adminPassword = 'admin123';
                console.log("🔐 Senha de Admin restaurada para padrão: admin123");
                precisaSalvar = true;
            }
            // Garante que os limites novos também existam
            if (!settings.minDeposit) { settings.minDeposit = 5.00; precisaSalvar = true; }
            if (!settings.minWithdraw) { settings.minWithdraw = 20.00; precisaSalvar = true; }

            if(precisaSalvar) await settings.save();
        }
    })
    .catch(err => console.error("❌ Erro Mongo:", err));

// Configuração Mercado Pago
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
    } catch (e) { console.error("Erro ao pagar comissão", e); }
}

async function isAdmin(secret) {
    const settings = await Settings.findOne();
    const valid = settings ? settings.adminPassword : 'admin123';
    return secret === valid;
}

// ==================================================================
// 🔐 ROTAS DE AUTENTICAÇÃO
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
            if (referrer) {
                referrerId = referrer._id;
                referrer.referralCount += 1;
                await referrer.save();
            }
        }

        const newAffiliateCode = 'mina-' + Math.random().toString(36).substring(2, 7);
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const user = await User.create({ 
            name, phone, cpf: cleanCpf, 
            password: hashedPassword, 
            affiliateCode: newAffiliateCode, 
            referredBy: referrerId 
        });
        
        res.json({ message: "Criado", userId: user._id, name: user.name, cpf: user.cpf, balance: user.balance });
    } catch (e) { res.status(500).json({ error: "Erro ao registrar" }); }
});

app.post('/api/auth/login', async (req, res) => {
    const { cpf, password } = req.body;
    try {
        const cleanCpf = cpf.replace(/\D/g, '');
        const user = await User.findOne({ cpf: cleanCpf });
        
        if (!user) return res.status(400).json({ error: "CPF não encontrado" });
        if (user.isBanned) return res.status(403).json({ error: "Conta bloqueada pelo suporte." });
        if (!await bcrypt.compare(password, user.password)) return res.status(400).json({ error: "Senha incorreta" });

        res.json({ message: "Logado", userId: user._id, name: user.name, cpf: user.cpf, balance: user.balance, history: user.gameHistory || [] });
    } catch (e) { res.status(500).json({ error: "Erro ao logar" }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
    const { cpf, name, phone, newPassword } = req.body;
    try {
        const cleanCpf = cpf.replace(/\D/g, '');
        const user = await User.findOne({ cpf: cleanCpf });
        
        if (!user) return res.status(404).json({ error: "Não encontrado" });
        if (user.phone !== phone || user.name.trim().toLowerCase() !== name.trim().toLowerCase()) {
            return res.status(400).json({ error: "Dados não conferem!" });
        }
        
        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();
        res.json({ message: "Senha alterada com sucesso!" });
    } catch (e) { res.status(500).json({ error: "Erro ao alterar senha" }); }
});

app.get('/api/me/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if(!user) return res.status(404).json({error: "User not found"});
        if (user.isBanned) return res.status(403).json({ error: "Banido" });
        
        res.json({ 
            balance: user.balance, 
            name: user.name, 
            cpf: user.cpf, 
            history: user.gameHistory ? user.gameHistory.slice(-15) : [] 
        });
    } catch (e) { res.status(500).json({ error: "Erro" }); }
});

// ==================================================================
// 💰 FINANCEIRO (PIX + LIMITES + ROLLOVER)
// ==================================================================

app.post('/api/payment/deposit', async (req, res) => {
    const { userId, amount } = req.body;
    try {
        // Verifica Depósito Mínimo
        const settings = await Settings.findOne();
        const minDep = settings ? settings.minDeposit : 5;
        if (parseFloat(amount) < minDep) return res.status(400).json({ error: `Mínimo R$ ${minDep.toFixed(2)}` });

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: "Usuário não encontrado" });

        const fakeEmail = `user_${user.cpf}@minespix.com`;
        
        // Define URL de notificação (apenas se estiver em HTTPS/Produção)
        let notificationUrl = undefined;
        if (SITE_URL && SITE_URL.includes('https://')) {
            notificationUrl = `${SITE_URL}/api/webhook`;
        }
        
        const body = { 
            transaction_amount: parseFloat(amount), 
            description: 'Creditos Mines Pix', 
            payment_method_id: 'pix', 
            payer: { 
                email: fakeEmail, 
                first_name: user.name.split(' ')[0] || 'User',
                identification: { type: 'CPF', number: user.cpf }
            }, 
            notification_url: notificationUrl 
        };

        const result = await payment.create({ body });
        
        const copyPaste = result.point_of_interaction?.transaction_data?.qr_code;
        const base64 = result.point_of_interaction?.transaction_data?.qr_code_base64;
        const paymentId = result.id ? result.id.toString() : null;

        if(!copyPaste || !paymentId) {
            throw new Error("Mercado Pago não retornou o PIX. Verifique credenciais.");
        }

        user.transactions.push({ 
            type: 'deposit', 
            amount: parseFloat(amount), 
            status: 'pending', 
            mpPaymentId: paymentId, 
            qrCodeBase64: base64 
        });
        
        await user.save();
        res.json({ copyPaste: copyPaste, qrCodeBase64: base64, paymentId: paymentId });
    } catch (e) { 
        console.error("Erro MP:", e);
        res.status(500).json({ error: "Erro ao gerar PIX: " + (e.message || "Interno") }); 
    }
});

app.post('/api/webhook', async (req, res) => {
    const paymentId = req.query.id || req.query['data.id'] || req.body.data?.id;
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
        } catch (e) { console.error("Erro Webhook:", e); }
    }
});

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
        user.transactions.push({ 
            type: 'withdraw', 
            amount: parseFloat(amount), 
            status: 'pending', 
            createdAt: Date.now(), 
            pixKey: pixKey, 
            pixKeyType: pixKeyType 
        });
        
        await user.save();
        res.json({ message: "Solicitado com sucesso!", balance: user.balance });
    } catch (e) { res.status(500).json({ error: "Erro no saque" }); }
});

// ==================================================================
// 🤝 AFILIADOS E EXTRAS
// ==================================================================

app.get('/api/affiliates/stats/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        res.json({ 
            code: user.affiliateCode, 
            earnings: user.affiliateEarnings || 0, 
            count: user.referralCount || 0, 
            link: `${SITE_URL}?ref=${user.affiliateCode}` 
        });
    } catch(e) { res.status(500).json({error: "Erro stats"}); }
});

// BÔNUS DIÁRIO COM ROLLOVER
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
        const history = user.transactions
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 20);
        res.json(history);
    } catch (e) { res.status(500).json({ error: "Erro histórico" }); }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const topUsers = await User.find({}, 'name balance').sort({ balance: -1 }).limit(5);
        const maskedUsers = topUsers.map(u => ({ 
            name: u.name.substring(0, 3) + '***', 
            balance: u.balance 
        }));
        res.json(maskedUsers);
    } catch (e) { res.status(500).json({ error: "Erro ranking" }); }
});

// ==================================================================
// 🕵️ ADMIN
// ==================================================================

app.post('/api/admin/login', async (req, res) => {
    const { password } = req.body;
    if(await isAdmin(password)) res.json({ success: true });
    else res.status(403).json({ error: "Senha incorreta" });
});

app.get('/api/admin/dashboard', async (req, res) => {
    const { secret } = req.headers;
    if(!await isAdmin(secret)) return res.status(403).json({ error: "Acesso Negado" });
    
    try {
        const users = await User.find();
        let totalUsers = users.length, totalBalance = 0, totalDeposited = 0, totalWithdrawn = 0, pendingWithdrawals = [], topAffiliates = [];
        
        users.forEach(u => {
            totalBalance += u.balance;
            if(u.referralCount > 0) topAffiliates.push({ name: u.name, count: u.referralCount, earnings: u.affiliateEarnings });
            
            u.transactions.forEach(t => {
                if (t.type === 'deposit' && t.status === 'approved') totalDeposited += t.amount;
                if (t.type === 'withdraw' && t.status === 'approved') totalWithdrawn += t.amount;
                if (t.type === 'withdraw' && t.status === 'pending') {
                    pendingWithdrawals.push({ userId: u._id, cpf: u.cpf, amount: t.amount, pixKey: t.pixKey, pixType: t.pixKeyType, date: t.createdAt, transId: t._id });
                }
            });
        });
        
        topAffiliates.sort((a,b) => b.earnings - a.earnings);
        res.json({ 
            totalUsers, totalBalance, pendingWithdrawals,
            financials: { deposited: totalDeposited, withdrawn: totalWithdrawn, profit: totalDeposited - totalWithdrawn },
            topAffiliates: topAffiliates.slice(0, 10) 
        });
    } catch(e) { res.status(500).json({ error: "Erro admin" }); }
});

app.post('/api/admin/users', async (req, res) => {
    const { secret, search } = req.body;
    if(!await isAdmin(secret)) return res.status(403).json({ error: "Negado" });
    try {
        let query = {};
        if(search) query = { cpf: { $regex: search, $options: 'i' } };
        const users = await User.find(query, 'name cpf balance isBanned phone').limit(50);
        res.json(users);
    } catch(e) { res.status(500).json({ error: "Erro lista users" }); }
});

app.post('/api/admin/action', async (req, res) => {
    const { userId, transId, action, secret } = req.body;
    if(!await isAdmin(secret)) return res.status(403).json({ error: "Negado" });
    const user = await User.findById(userId);
    const trans = user.transactions.id(transId);
    if (action === 'approve') trans.status = 'approved';
    else if (action === 'reject') { trans.status = 'rejected'; user.balance += trans.amount; }
    await user.save();
    res.json({ message: "Sucesso!" });
});

app.get('/api/admin/settings', async (req, res) => {
    const { secret } = req.headers;
    if(!await isAdmin(secret)) return res.status(403).json({ error: "Negado" });
    const settings = await Settings.findOne();
    res.json(settings);
});

app.post('/api/admin/settings', async (req, res) => {
    const { secret, dailyBonus, houseEdge, newAdminPass, minDeposit, minWithdraw } = req.body;
    if(!await isAdmin(secret)) return res.status(403).json({ error: "Negado" });
    const settings = await Settings.findOne();
    if(settings) {
        if(dailyBonus !== undefined) settings.dailyBonus = parseFloat(dailyBonus);
        if(houseEdge !== undefined) settings.houseEdge = parseFloat(houseEdge);
        if(minDeposit !== undefined) settings.minDeposit = parseFloat(minDeposit);
        if(minWithdraw !== undefined) settings.minWithdraw = parseFloat(minWithdraw);
        if(newAdminPass && newAdminPass.trim()!=="") settings.adminPassword = newAdminPass.trim();
        await settings.save();
    }
    res.json({ message: "Atualizado!" });
});

app.post('/api/admin/user/update', async (req, res) => {
    const { userId, newBalance, isBanned, secret } = req.body;
    if(!await isAdmin(secret)) return res.status(403).json({ error: "Negado" });
    try {
        const user = await User.findById(userId);
        if(!user) return res.status(404).json({ error: "User not found" });
        if(newBalance !== undefined) {
            user.transactions.push({ type: 'admin_adjustment', amount: parseFloat(newBalance) - user.balance, status: 'approved', mpPaymentId: 'ADMIN', createdAt: Date.now() });
            user.balance = parseFloat(newBalance);
        }
        if(isBanned !== undefined) user.isBanned = isBanned;
        await user.save();
        res.json({ message: "Atualizado!" });
    } catch(e) { res.status(500).json({ error: "Erro update" }); }
});

// ==================================================================
// 💣 JOGO (MINES) - COM DEDUÇÃO DE ROLLOVER
// ==================================================================

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
        
        if (!game || game.isGameOver) return res.status(400).json({ error: "Sem jogo" });
        if (game.revealed[index]) return res.status(400).json({ error: "Clicado" });
        
        game.revealed[index] = true;
        user.markModified('activeGame.revealed');
        
        // DERROTA
        if (game.grid[index] === 'mine') {
            game.isGameOver = true;
            if(!user.gameHistory) user.gameHistory = [];
            user.gameHistory.push('loss');
            if(user.gameHistory.length > 20) user.gameHistory.shift();

            await user.save();
            return res.json({ status: 'boom', grid: game.grid });
        }
        
        // VITÓRIA
        game.diamondsFound++;
        
        const settings = await Settings.findOne();
        const currentEdge = settings ? settings.houseEdge : 0.95;
        
        let nextMult = game.currentMultiplier * calculateMultiplier(game.minesCount, game.diamondsFound - 1, currentEdge);
        if(game.diamondsFound === 1 && nextMult < 1.01) nextMult = 1.01;
        
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
        if (!game || game.isGameOver) return res.status(400).json({ error: "Erro" });
        
        const win = game.betAmount * game.currentMultiplier;
        user.balance += win;
        game.isGameOver = true;
        
        if(!user.gameHistory) user.gameHistory = [];
        user.gameHistory.push('win');
        if(user.gameHistory.length > 20) user.gameHistory.shift();

        await user.save();
        res.json({ status: 'cashout', winAmount: win.toFixed(2), balance: user.balance, grid: game.grid });
    } catch (e) { res.status(500).json({ error: "Erro cashout" }); }
});

app.listen(PORT, () => console.log(`🔥 Online na porta ${PORT}`));
