const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true },
    cpf: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 0.00 },
    lastDailyBonus: { type: Date, default: null },

    // --- SISTEMA DE AFILIADOS ---
    affiliateCode: { type: String, unique: true }, // Código único do usuário (ex: JOAO123)
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Quem indicou esse usuário
    affiliateEarnings: { type: Number, default: 0.00 }, // Total ganho com indicações
    referralCount: { type: Number, default: 0 }, // Quantas pessoas indicou

    pixKey: { type: String, default: '' },
    pixKeyType: { type: String, default: '' },

    activeGame: {
        grid: [String],
        revealed: [Boolean],
        minesCount: Number,
        betAmount: Number,
        currentMultiplier: Number,
        diamondsFound: Number,
        isGameOver: { type: Boolean, default: true }
    },

    transactions: [{
        type: { type: String, enum: ['deposit', 'withdraw', 'bonus', 'commission'] }, // Adicionado 'commission'
        amount: Number,
        status: { type: String, enum: ['pending', 'approved', 'rejected'] },
        mpPaymentId: String,
        qrCodeBase64: String,
        createdAt: { type: Date, default: Date.now }
    }]
});

module.exports = mongoose.model('User', UserSchema);
