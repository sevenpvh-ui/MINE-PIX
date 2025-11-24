const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // Senha criptografada
    balance: { type: Number, default: 0.00 }, // Começa zerado
    
    // Dados para saque (Chave PIX)
    pixKey: { type: String, default: '' },
    pixKeyType: { type: String, default: '' }, // CPF, Email, etc.

    // Estado do jogo (se cair a internet, volta aqui)
    activeGame: {
        grid: [String],
        revealed: [Boolean],
        minesCount: Number,
        betAmount: Number,
        currentMultiplier: Number,
        diamondsFound: Number,
        isGameOver: { type: Boolean, default: true }
    },

    // Extrato Financeiro
    transactions: [{
        type: { type: String, enum: ['deposit', 'withdraw'] }, // Depósito ou Saque
        amount: Number,
        status: { type: String, enum: ['pending', 'approved', 'rejected'] },
        mpPaymentId: String, // ID do Mercado Pago
        qrCodeBase64: String, // Para mostrar de novo se precisar
        createdAt: { type: Date, default: Date.now }
    }]
});

module.exports = mongoose.model('User', UserSchema);
