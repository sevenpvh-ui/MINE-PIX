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

// --- IMPORTANTE PARA O RENDER ---
// Isso permite que o rate-limit funcione e que os afiliados sejam contabilizados corretamente
app.set('trust proxy', 1);

// Configuração Anti-Spam (Limite de requisições)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 200, // limite de 200 requisições por IP
    message: { error: "Muitas tentativas. Aguarde um pouco." }
});
app.use('/api/', limiter);

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- CONFIGURAÇÕES GERAIS ---
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const SITE_URL = process.env.SITE_URL; 

// Conexão com Banco de Dados
mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log("✅ MongoDB Conectado");
        // Garante que existe uma configuração inicial
        const settings = await Settings.findOne();
        if (!settings) {
            await Settings.create({ dailyBonus: 1.00 });
            console.log("⚙️ Configurações padrões criadas.");
        }
    })
    .catch(err => console.error("❌ Erro Mongo:", err));

// Configuração Mercado Pago
const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });
const payment = new Payment(client);

// --- FUNÇÃO AUXILIAR: VALIDAÇÃO DE CPF ---
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

// ==================================================================
// 🔐 AUTENTICAÇÃO & USUÁRIO
// ==================================================================

// Registro de Usuário
app.post('/api/auth/register', async (req, res) => {
    const { name, cpf, phone, password, refCode } = req.body;
    
    try {
        // 1. Valida se preencheu tudo
        if (!name || !cpf || !phone || !password) {
            return res.status(400).json({ error: "Preencha todos os campos!" });
        }
        
        // 2. Valida CPF matemático
        if (!validateCPF(cpf)) {
            return res.status(400).json({ error: "CPF Inválido!" });
        }

        const cleanCpf = cpf.replace(/\D/g, ''); 
        
        // 3. Verifica se já existe
        if (await User.findOne({ cpf: cleanCpf })) {
            return res.status(400).json({ error: "CPF já cadastrado" });
        }
        
        // 4. Lógica de Afiliado (Quem indicou?)
        let referrerId = null;
        if (refCode && refCode.trim() !== "") {
            const referrer = await User.findOne({ affiliateCode: refCode.trim() });
            if (referrer) {
                referrerId = referrer._id;
                referrer.referralCount += 1;
                await referrer.save();
            }
        }

        // 5. Cria código de afiliado e senha
        const newAffiliateCode = 'mina-' + Math.random().toString(36).substring(2, 7);
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // 6. Salva no Banco
        const user = await User.create({ 
            name, phone, cpf: cleanCpf, 
            password: hashedPassword, 
            affiliateCode: newAffiliateCode, 
            referredBy: referrerId 
        });
        
        res.json({ message: "Criado", userId: user._id, name: user.name, cpf: user.cpf, balance: user.balance });

    } catch (e) { 
        console.error("Erro Registro:", e);
        res.status(500).json({ error: "Erro ao registrar" }); 
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    const { cpf, password } = req.body;
    try {
        const cleanCpf = cpf.replace(/\D/g, '');
        const user = await User.findOne({ cpf: cleanCpf });
        
        if (!user) return res.status(400).json({ error: "CPF não encontrado" });
        
        // Verifica Banimento
        if (user.isBanned) return res.status(403).json({ error: "Conta bloqueada pelo suporte." });

        if (!await bcrypt.compare(password, user.password)) {
            return res.status(400).json({ error: "Senha incorreta" });
        }

        res.json({ message: "Logado", userId: user._id, name: user.name, cpf: user.cpf, balance: user.balance });
    } catch (e) { res.status(500).json({ error: "Erro ao logar" }); }
});

// Recuperar Senha
app.post('/api/auth/reset-password', async (req, res) => {
    const { cpf, name, phone, newPassword } = req.body;
    try {
        const cleanCpf = cpf.replace(/\D/g, '');
        const user = await User.findOne({ cpf: cleanCpf });

        if (!user) return res.status(404).json({ error: "Usuário não encontrado" });

        // Validação de Segurança (Dados devem bater)
        if (user.phone !== phone || user.name.trim().toLowerCase() !== name.trim().toLowerCase()) {
            return res.status(400).json({ error: "Dados de confirmação incorretos!" });
        }

        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();

        res.json({ message: "Senha alterada com sucesso!" });
    } catch (e) { res.status(500).json({ error: "Erro ao resetar senha" }); }
});

// Obter Dados do Usuário
app.get('/api/me/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if(!user) return res.status(404).json({error: "User not found"});
        
        if (user.isBanned) return res.status(403).json({ error: "Banido" });
        
        res.json({ balance: user.balance, name: user.name, cpf: user.cpf });
    } catch (e) { res.status(500).json({ error: "Erro" }); }
});

// ==================================================================
// 🤝 AFILIADOS E BÔNUS
// ==================================================================

// Estatísticas de Afiliado
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

// Bônus Diário
app.post('/api/bonus/daily', async (req, res) => {
    const { userId } = req.body;
    try {
        const user = await User.findById(userId);
        const now = new Date();
        const last = user.lastDailyBonus ? new Date(user.lastDailyBonus) : null;
        
        // Verifica 24h
        if (last && (now - last) < 86400000) {
            return res.status(400).json({ error: "Volte amanhã para mais bônus!" });
        }
        
        // Pega valor da configuração
        const settings = await Settings.findOne();
        const bonusAmount = settings ? settings.dailyBonus : 1.00;

        user.balance += bonusAmount;
        user.lastDailyBonus = now;
        
        user.transactions.push({ 
            type: 'bonus', 
            amount: bonusAmount, 
            status: 'approved', 
            mpPaymentId: 'BONUS_' + Date.now() 
        });
        
        await user.save();
        res.json({ message: `Bônus de R$ ${bonusAmount.toFixed(2)} resgatado!`, balance: user.balance });
    } catch (e) { res.status(500).json({ error: "Erro bônus" }); }
});

// Função Interna: Pagar Comissão (10%)
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
            console.log(`💰 Comissão paga: R$ ${commission} para ${referrer.name}`);
        }
    } catch (e) { console.error("Erro comissão", e); }
}

// ==================================================================
// 💰 PAGAMENTOS (MERCADO PAGO)
// ==================================================================

// Criar PIX
app.post('/api/payment/deposit', async (req, res) => {
    const { userId, amount } = req.body;
    try {
        const user = await User.findById(userId);
        const fakeEmail = `${user.cpf}@minespix.com`;
        
        const body = { 
            transaction_amount: parseFloat(amount), 
            description: 'Creditos Mines Pix', 
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
    } catch (e) { res.status(500).json({ error: "Erro ao gerar PIX" }); }
});

// Webhook (Confirmação Automática)
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
                        // Paga comissão
                        await payCommission(user._id, trans.amount);
                    }
                }
            }
        } catch (e) { console.error(e); }
    }
    res.status(200).send("OK");
});

// Pedido de Saque
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
        res.json({ message: "Saque solicitado com sucesso!", balance: user.balance });
    } catch (e) { res.status(500).json({ error: "Erro no saque" }); }
});

// Rota de Simulação (REMOVER EM PRODUÇÃO SE QUISER)
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

// ==================================================================
// 🕵️ PAINEL ADMINISTRATIVO
// ==================================================================

// Dados do Dashboard
app.get('/api/admin/dashboard', async (req, res) => {
    const { secret } = req.headers;
    if(secret !== 'admin123') return res.status(403).json({ error: "Acesso Negado" });
    
    try {
        const users = await User.find();
        let totalUsers = users.length;
        let totalBalance = 0;
        let totalDeposited = 0;
        let totalWithdrawn = 0;
        let pendingWithdrawals = [];
        let topAffiliates = [];

        users.forEach(u => {
            totalBalance += u.balance;
            if(u.referralCount > 0) topAffiliates.push({ name: u.name, count: u.referralCount, earnings: u.affiliateEarnings });

            u.transactions.forEach(t => {
                if (t.type === 'deposit' && t.status === 'approved') totalDeposited += t.amount;
                if (t.type === 'withdraw' && t.status === 'approved') totalWithdrawn += t.amount;
                if (t.type === 'withdraw' && t.status === 'pending') {
                    pendingWithdrawals.push({ userId: u._id, cpf: u.cpf, amount: t.amount, pixKey: u.pixKey, pixType: u.pixKeyType, date: t.createdAt, transId: t._id });
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

// Listar Usuários
app.post('/api/admin/users', async (req, res) => {
    const { secret, search } = req.body;
    if(secret !== 'admin123') return res.status(403).json({ error: "Acesso Negado" });
    
    try {
        let query = {};
        if(search) query = { cpf: { $regex: search, $options: 'i' } };
        const users = await User.find(query, 'name cpf balance isBanned phone').limit(50);
        res.json(users);
    } catch(e) { res.status(500).json({ error: "Erro lista" }); }
});

// Ação em Saque (Pagar/Rejeitar)
app.post('/api/admin/action', async (req, res) => {
    const { userId, transId, action, secret } = req.body;
    if(secret !== 'admin123') return res.status(403).json({ error: "Acesso Negado" });
    
    const user = await User.findById(userId);
    const trans = user.transactions.id(transId);
    
    if (action === 'approve') {
        trans.status = 'approved';
    } else if (action === 'reject') {
        trans.status = 'rejected'; 
        user.balance += trans.amount; // Devolve o dinheiro
    }
    await user.save();
    res.json({ message: "Sucesso!" });
});

// Atualizar Usuário (Saldo/Ban)
app.post('/api/admin/user/update', async (req, res) => {
    const { userId, newBalance, isBanned, secret } = req.body;
    if(secret !== 'admin123') return res.status(403).json({ error: "Acesso Negado" });
    
    try {
        const user = await User.findById(userId);
        if(!user) return res.status(404).json({ error: "User not found" });
        
        if(newBalance !== undefined) {
            user.transactions.push({ type: 'admin_adjustment', amount: parseFloat(newBalance) - user.balance, status: 'approved', mpPaymentId: 'ADMIN', createdAt: Date.now() });
            user.balance = parseFloat(newBalance);
        }
        if(isBanned !== undefined) user.isBanned = isBanned;
        
        await user.save();
        res.json({ message: "Usuário atualizado!" });
    } catch(e) { res.status(500).json({ error: "Erro update" }); }
});

// Ler Configurações
app.get('/api/admin/settings', async (req, res) => {
    const { secret } = req.headers;
    if(secret !== 'admin123') return res.status(403).json({ error: "Acesso Negado" });
    const settings = await Settings.findOne();
    res.json(settings);
});

// Salvar Configurações
app.post('/api/admin/settings', async (req, res) => {
    const { secret, dailyBonus } = req.body;
    if(secret !== 'admin123') return res.status(403).json({ error: "Acesso Negado" });
    
    const settings = await Settings.findOne();
    if(settings) {
        settings.dailyBonus = parseFloat(dailyBonus);
        await settings.save();
    }
    res.json({ message: "Configurações salvas!" });
});

// ==================================================================
// 💣 LÓGICA DO JOGO (MINES)
// ==================================================================

app.post('/api/game/start', async (req, res) => {
    const { userId, betAmount, minesCount } = req.body;
    try {
        const user = await User.findById(userId);
        if (user.balance < betAmount) return res.status(400).json({ error: "Saldo insuficiente" });
        if (user.activeGame && !user.activeGame.isGameOver) return res.status(400).json({ error: "Jogo já em andamento" });
        
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
        if (game.revealed[index]) return res.status(400).json({ error: "Campo já clicado" });
        
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
        
        if (!game || game.isGameOver) return res.status(400).json({ error: "Erro no cashout" });
        
        const win = game.betAmount * game.currentMultiplier;
        user.balance += win;
        game.isGameOver = true;
        
        await user.save();
        res.json({ status: 'cashout', winAmount: win.toFixed(2), balance: user.balance, grid: game.grid });
    } catch (e) { res.status(500).json({ error: "Erro cashout" }); }
});

// Ranking Público
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

// Histórico do Usuário
app.get('/api/me/transactions/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        const history = user.transactions
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 20);
        res.json(history);
    } catch (e) { res.status(500).json({ error: "Erro histórico" }); }
});

// INICIA TUDO
app.listen(PORT, () => console.log(`🔥 Server rodando na porta ${PORT}`));
