const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    cpf: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 0.00 },
    
    // NOVO: Controle de Bônus Diário
    lastDailyBonus: { type: Date, default: null },

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
        type: { type: String, enum: ['deposit', 'withdraw', 'bonus'] }, // Adicionado 'bonus'
        amount: Number,
        status: { type: String, enum: ['pending', 'approved', 'rejected'] },
        mpPaymentId: String,
        qrCodeBase64: String,
        createdAt: { type: Date, default: Date.now }
    }]
});

module.exports = mongoose.model('User', UserSchema);
