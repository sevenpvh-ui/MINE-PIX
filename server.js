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
// ⚙️ CONFIGURAÇÕES GERAIS E SEGURANÇA
// ==================================================================

// 1. Permite que o servidor entenda o Proxy do Render (Essencial para não travar)
app.set('trust proxy', 1);

// 2. Proteção Anti-Spam (Rate Limit)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 500, // Aumentei para 500 para evitar bloqueio falso em testes
    message: { error: "Muitas tentativas vindo do seu IP. Aguarde um pouco." }
});
app.use('/api/', limiter);

// 3. Cors e JSON
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 4. Variáveis de Ambiente
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const SITE_URL = process.env.SITE_URL; 

// ==================================================================
// 🔒 TRAVA DE DOMÍNIO (ANTI-PIRATARIA)
// ==================================================================
const DOMINIO_AUTORIZADO = "mine-pix.onrender.com"; 

app.use((req, res, next) => {
    const host = req.get('host');
    // Libera localhost para você testar, bloqueia outros domínios em produção
    if (!host.includes(DOMINIO_AUTORIZADO) && !host.includes("localhost")) {
        console.error(`🚫 BLOQUEIO: Tentativa de acesso não autorizada via ${host}`);
        return res.status(403).send(`
            <body style="background-color:#000; color:red; display:flex; justify-content:center; align-items:center; height:100vh; font-family:sans-serif;">
                <h1>🚫 LICENÇA INVÁLIDA PARA: ${host}</h1>
            </body>
        `);
    }
    next();
});

// ==================================================================
// 💾 CONEXÃO COM BANCO DE DADOS
// ==================================================================
mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log("✅ MongoDB Conectado com Sucesso!");
        // Garante configuração inicial do sistema
        const settings = await Settings.findOne();
        if (!settings) {
            await Settings.create({ dailyBonus: 1.00, houseEdge: 0.95, adminPassword: 'admin123' });
            console.log("⚙️ Configurações iniciais criadas no Banco.");
        }
    })
    .catch(err => console.error("❌ Erro Fatal no Mongo:", err));

// Configuração Mercado Pago
const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });
const payment = new Payment(client);

// ==================================================================
// 🛠️ FUNÇÕES AUXILIARES
// ==================================================================

// Validação Matemática de CPF
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

// Pagamento de Comissão (Afiliados)
async function payCommission(userId, amount) {
    try {
        const user = await User.findById(userId).populate('referredBy');
        if (user && user.referredBy) {
            const referrer = user.referredBy;
            const commission = parseFloat(amount) * 0.10; // 10%
            
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
            console.log(`💰 Comissão de R$${commission} paga para ${referrer.name}`);
        }
    } catch (e) { console.error("Erro ao pagar comissão:", e); }
}

// Função para verificar Admin
async function isAdmin(secret) {
    const settings = await Settings.findOne();
    const valid = settings ? settings.adminPassword : 'admin123';
    return secret === valid;
}

// ==================================================================
// 👤 ROTAS DE USUÁRIO (AUTH)
// ==================================================================

app.post('/api/auth/register', async (req, res) => {
    const { name, cpf, phone, password, refCode } = req.body;
    try {
        if (!name || !cpf || !phone || !password) return res.status(400).json({ error: "Preencha todos os campos!" });
        if (!validateCPF(cpf)) return res.status(400).json({ error: "CPF Inválido! Verifique os números." });
        
        const cleanCpf = cpf.replace(/\D/g, ''); 
        
        // Verifica duplicidade
        const existingUser = await User.findOne({ cpf: cleanCpf });
        if (existingUser) return res.status(400).json({ error: "Este CPF já possui conta!" });
        
        // Verifica Afiliado
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
            referredBy: referrerId,
            balance: 0.00
        });
        
        console.log(`🆕 Novo usuário: ${name} (${cleanCpf})`);
        res.json({ message: "Criado", userId: user._id, name: user.name, cpf: user.cpf, balance: user.balance });

    } catch (e) { 
        console.error("Erro Registro:", e);
        res.status(500).json({ error: "Erro interno no registro." }); 
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { cpf, password } = req.body;
    try {
        const cleanCpf = cpf.replace(/\D/g, '');
        const user = await User.findOne({ cpf: cleanCpf });
        
        if (!user) return res.status(400).json({ error: "CPF não encontrado." });
        if (user.isBanned) return res.status(403).json({ error: "Esta conta foi suspensa." });
        
        const validPass = await bcrypt.compare(password, user.password);
        if (!validPass) return res.status(400).json({ error: "Senha incorreta." });

        res.json({ message: "Logado", userId: user._id, name: user.name, cpf: user.cpf, balance: user.balance });
    } catch (e) { res.status(500).json({ error: "Erro no login." }); }
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
    } catch (e) { res.status(500).json({ error: "Erro ao buscar dados" }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
    const { cpf, name, phone, newPassword } = req.body;
    try {
        const cleanCpf = cpf.replace(/\D/g, '');
        const user = await User.findOne({ cpf: cleanCpf });
        
        if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
        
        // Validação frouxa de strings (remove espaços e deixa minúsculo para comparar)
        const dbName = user.name.trim().toLowerCase();
        const inputName = name.trim().toLowerCase();
        
        if (user.phone !== phone || dbName !== inputName) {
            return res.status(400).json({ error: "Os dados informados não conferem com o cadastro." });
        }
        
        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();
        res.json({ message: "Senha alterada com sucesso!" });
    } catch (e) { res.status(500).json({ error: "Erro ao resetar senha." }); }
});

// ==================================================================
// 💣 LÓGICA DO JOGO (CORRIGIDA E EXPANDIDA)
// ==================================================================

app.post('/api/game/start', async (req, res) => {
    const { userId, betAmount, minesCount } = req.body;
    
    try {
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: "Usuário não logado." });

        // Converte para número para garantir
        const bet = parseFloat(betAmount);
        const mines = parseInt(minesCount);

        // Validações de Saldo
        if (isNaN(bet) || bet <= 0) return res.status(400).json({ error: "Valor de aposta inválido." });
        if (user.balance < bet) {
            console.log(`❌ Saldo Insuficiente: Tem ${user.balance}, Tentou ${bet}`);
            return res.status(400).json({ error: "Saldo insuficiente. Faça um depósito!" });
        }

        // Verifica jogo em andamento
        if (user.activeGame && !user.activeGame.isGameOver) {
            return res.status(400).json({ error: "Você já tem um jogo aberto. Termine ele primeiro." });
        }
        
        // Debita do saldo
        user.balance -= bet;
        
        // Cria novo jogo
        user.activeGame = { 
            grid: createGrid(mines), 
            revealed: Array(25).fill(false), 
            minesCount: mines, 
            betAmount: bet, 
            currentMultiplier: 1.0, 
            diamondsFound: 0, 
            isGameOver: false 
        };
        
        await user.save();
        console.log(`🎮 Jogo Iniciado: ${user.name} apostou R$${bet} com ${mines} minas.`);
        
        res.json({ balance: user.balance });

    } catch (e) { 
        console.error("Erro no Start Game:", e);
        res.status(500).json({ error: "Erro ao iniciar jogo." }); 
    }
});

app.post('/api/game/play', async (req, res) => {
    const { userId, index } = req.body;
    try {
        const user = await User.findById(userId);
        if (!user || !user.activeGame) return res.status(400).json({ error: "Nenhum jogo ativo." });
        
        const game = user.activeGame;
        
        if (game.isGameOver) return res.status(400).json({ error: "Este jogo já acabou." });
        if (game.revealed[index]) return res.status(400).json({ error: "Campo já clicado." });
        
        // Marca como revelado
        game.revealed[index] = true;
        user.markModified('activeGame.revealed'); // Importante para o Mongoose detectar mudança no array
        
        // --- CASO DE DERROTA (BOMBA) ---
        if (game.grid[index] === 'mine') {
            game.isGameOver = true;
            
            // Atualiza Histórico
            if(!user.gameHistory) user.gameHistory = [];
            user.gameHistory.push('loss');
            if(user.gameHistory.length > 20) user.gameHistory.shift();

            await user.save();
            console.log(`💥 BOOM! ${user.name} perdeu.`);
            return res.json({ status: 'boom', grid: game.grid });
        }
        
        // --- CASO DE VITÓRIA (DIAMANTE) ---
        game.diamondsFound++;
        
        // Busca dificuldade do banco
        const settings = await Settings.findOne();
        const currentEdge = settings ? settings.houseEdge : 0.95;
        
        // Calcula novo multiplicador
        let nextMult = game.currentMultiplier * calculateMultiplier(game.minesCount, game.diamondsFound - 1, currentEdge);
        
        // Proteção matemática: Mínimo 1.01x no primeiro clique
        if(game.diamondsFound === 1 && nextMult < 1.01) nextMult = 1.01;
        
        game.currentMultiplier = nextMult;
        await user.save();
        
        res.json({ 
            status: 'safe', 
            multiplier: game.currentMultiplier.toFixed(2), 
            potentialWin: (game.betAmount * game.currentMultiplier).toFixed(2) 
        });

    } catch (e) { 
        console.error("Erro no Play:", e);
        res.status(500).json({ error: "Erro ao processar jogada." }); 
    }
});

app.post('/api/game/cashout', async (req, res) => {
    const { userId } = req.body;
    try {
        const user = await User.findById(userId);
        const game = user.activeGame;
        
        if (!user || !game || game.isGameOver) return res.status(400).json({ error: "Não é possível sacar agora." });
        
        const winAmount = game.betAmount * game.currentMultiplier;
        user.balance += winAmount;
        game.isGameOver = true;
        
        // Histórico de Vitória
        if(!user.gameHistory) user.gameHistory = [];
        user.gameHistory.push('win');
        if(user.gameHistory.length > 20) user.gameHistory.shift();

        await user.save();
        console.log(`💰 Cashout: ${user.name} ganhou R$${winAmount.toFixed(2)}`);
        
        res.json({ status: 'cashout', winAmount: winAmount.toFixed(2), balance: user.balance, grid: game.grid });
    } catch (e) { res.status(500).json({ error: "Erro no cashout" }); }
});

// ==================================================================
// 💸 FINANCEIRO E EXTRAS
// ==================================================================

app.post('/api/payment/deposit', async (req, res) => {
    const { userId, amount } = req.body;
    try {
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: "User not found" });

        const fakeEmail = `user_${user.cpf}@minespix.com`;
        const notificationUrl = SITE_URL ? `${SITE_URL}/api/webhook` : undefined;
        if (!notificationUrl) console.warn("⚠️ SITE_URL não configurado. Pix sem confirmação automática.");

        const body = { 
            transaction_amount: parseFloat(amount), 
            description: 'Creditos Mines Pix', 
            payment_method_id: 'pix', 
            payer: { email: fakeEmail, first_name: user.name.split(' ')[0] || 'User' }, 
            notification_url: notificationUrl 
        };

        const result = await payment.create({ body });
        
        const copyPaste = result.point_of_interaction?.transaction_data?.qr_code;
        const base64 = result.point_of_interaction?.transaction_data?.qr_code_base64;
        const paymentId = result.id.toString();

        user.transactions.push({ 
            type: 'deposit', 
            amount: parseFloat(amount), 
            status: 'pending', 
            mpPaymentId: paymentId, 
            qrCodeBase64: base64 
        });
        
        await user.save();
        res.json({ copyPaste, qrCodeBase64: base64, paymentId });

    } catch (e) { 
        console.error("Erro PIX:", e);
        res.status(500).json({ error: "Erro ao gerar PIX." }); 
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
                        console.log(`✅ PIX CONFIRMADO: R$${trans.amount} para ${user.name}`);
                    }
                }
            }
        } catch (e) { console.error("Webhook Error:", e); }
    }
});

// ROTA DE SIMULAÇÃO (MANTENHA PARA TESTES, REMOVA PARA VENDA)
app.post('/api/debug/deposit', async (req, res) => {
    const { userId, amount } = req.body;
    try {
        const user = await User.findById(userId);
        const val = parseFloat(amount);
        user.balance += val;
        user.transactions.push({ type: 'deposit', amount: val, status: 'approved', mpPaymentId: 'SIM_'+Date.now() });
        await user.save();
        await payCommission(userId, val);
        res.json({ message: "Simulado!", balance: user.balance });
    } catch (e) { res.status(500).json({ error: "Erro simulação" }); }
});

app.post('/api/payment/withdraw', async (req, res) => {
    const { userId, amount, pixKey, pixKeyType } = req.body;
    try {
        const user = await User.findById(userId);
        if (user.balance < amount) return res.status(400).json({ error: "Saldo insuficiente" });
        
        user.balance -= parseFloat(amount);
        user.transactions.push({ type: 'withdraw', amount: parseFloat(amount), status: 'pending', createdAt: Date.now(), pixKey, pixKeyType });
        await user.save();
        res.json({ message: "Saque solicitado!", balance: user.balance });
    } catch (e) { res.status(500).json({ error: "Erro saque" }); }
});

// --- AFILIADOS & BÔNUS ---
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
        res.json({ message: `Bônus de R$ ${bonusAmount.toFixed(2)} recebido!`, balance: user.balance });
    } catch (e) { res.status(500).json({ error: "Erro bônus" }); }
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

app.get('/api/me/transactions/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        const history = user.transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 20);
        res.json(history);
    } catch (e) { res.status(500).json({ error: "Erro histórico" }); }
});

// --- ADMIN ---
app.post('/api/admin/login', async (req, res) => { const { password } = req.body; if(await isAdmin(password)) res.json({success:true}); else res.status(403).json({error:"Senha incorreta"}); });
app.get('/api/admin/dashboard', async (req, res) => { const { secret } = req.headers; if(!await isAdmin(secret)) return res.status(403).json({ error: "Negado" }); try { const users = await User.find(); let totalUsers = users.length, totalBalance = 0, totalDeposited = 0, totalWithdrawn = 0, pendingWithdrawals = [], topAffiliates = []; users.forEach(u => { totalBalance += u.balance; if(u.referralCount > 0) topAffiliates.push({ name: u.name, count: u.referralCount, earnings: u.affiliateEarnings }); u.transactions.forEach(t => { if (t.type === 'deposit' && t.status === 'approved') totalDeposited += t.amount; if (t.type === 'withdraw' && t.status === 'approved') totalWithdrawn += t.amount; if (t.type === 'withdraw' && t.status === 'pending') pendingWithdrawals.push({ userId: u._id, cpf: u.cpf, amount: t.amount, pixKey: u.pixKey, pixType: u.pixKeyType, date: t.createdAt, transId: t._id }); }); }); topAffiliates.sort((a,b) => b.earnings - a.earnings); res.json({ totalUsers, totalBalance, pendingWithdrawals, financials: { deposited: totalDeposited, withdrawn: totalWithdrawn, profit: totalDeposited - totalWithdrawn }, topAffiliates: topAffiliates.slice(0, 10) }); } catch(e) { res.status(500).json({ error: "Erro admin" }); } });
app.post('/api/admin/users', async (req, res) => { const { secret, search } = req.body; if(!await isAdmin(secret)) return res.status(403).json({ error: "Negado" }); try { let query = {}; if(search) query = { cpf: { $regex: search, $options: 'i' } }; const users = await User.find(query, 'name cpf balance isBanned phone').limit(50); res.json(users); } catch(e) { res.status(500).json({ error: "Erro lista" }); } });
app.post('/api/admin/action', async (req, res) => { const { userId, transId, action, secret } = req.body; if(!await isAdmin(secret)) return res.status(403).json({ error: "Negado" }); const user = await User.findById(userId); const trans = user.transactions.id(transId); if (action === 'approve') trans.status = 'approved'; else if (action === 'reject') { trans.status = 'rejected'; user.balance += trans.amount; } await user.save(); res.json({ message: "Sucesso!" }); });
app.get('/api/admin/settings', async (req, res) => { const { secret } = req.headers; if(!await isAdmin(secret)) return res.status(403).json({ error: "Negado" }); const settings = await Settings.findOne(); res.json(settings); });
app.post('/api/admin/settings', async (req, res) => { const { secret, dailyBonus, houseEdge, newAdminPass } = req.body; if(!await isAdmin(secret)) return res.status(403).json({ error: "Negado" }); const settings = await Settings.findOne(); if(settings) { if(dailyBonus!==undefined) settings.dailyBonus = parseFloat(dailyBonus); if(houseEdge!==undefined) settings.houseEdge = parseFloat(houseEdge); if(newAdminPass && newAdminPass.trim()!=="") settings.adminPassword = newAdminPass.trim(); await settings.save(); } res.json({ message: "Atualizado!" }); });
app.post('/api/admin/user/update', async (req, res) => { const { userId, newBalance, isBanned, secret } = req.body; if(!await isAdmin(secret)) return res.status(403).json({ error: "Negado" }); try { const user = await User.findById(userId); if(!user) return res.status(404).json({ error: "User not found" }); if(newBalance !== undefined) { user.transactions.push({ type: 'admin_adjustment', amount: parseFloat(newBalance) - user.balance, status: 'approved', mpPaymentId: 'ADMIN', createdAt: Date.now() }); user.balance = parseFloat(newBalance); } if(isBanned !== undefined) user.isBanned = isBanned; await user.save(); res.json({ message: "Atualizado!" }); } catch(e) { res.status(500).json({ error: "Erro update" }); } });

app.listen(PORT, () => console.log(`🔥 Online na porta ${PORT}`));
