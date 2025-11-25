const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    // Dados Pessoais
    name: { type: String, required: true },
    phone: { type: String, required: true },
    cpf: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    
    // Financeiro
    balance: { type: Number, default: 0.00 },
    pixKey: { type: String, default: '' },
    pixKeyType: { type: String, default: '' },

    // Controle de Acesso (NOVO)
    isBanned: { type: Boolean, default: false }, // True = Bloqueado
    lastDailyBonus: { type: Date, default: null },

    // Sistema de Afiliados
    affiliateCode: { type: String, unique: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    affiliateEarnings: { type: Number, default: 0.00 },
    referralCount: { type: Number, default: 0 },

    // Estado do Jogo
    activeGame: {
        grid: [String],
        revealed: [Boolean],
        minesCount: Number,
        betAmount: Number,
        currentMultiplier: Number,
        diamondsFound: Number,
        isGameOver: { type: Boolean, default: true }
    },

    // Histórico
    transactions: [{
        type: { type: String, enum: ['deposit', 'withdraw', 'bonus', 'commission', 'admin_adjustment'] },
        amount: Number,
        status: { type: String, enum: ['pending', 'approved', 'rejected'] },
        mpPaymentId: String,
        qrCodeBase64: String,
        createdAt: { type: Date, default: Date.now }
    }]
});

module.exports = mongoose.model('User', UserSchema);
