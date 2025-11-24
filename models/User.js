const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    // Mudamos de ID aleatório para E-mail único
    email: { type: String, unique: true, required: true }, 
    userId: { type: String, required: true }, // Mantemos para uso interno
    balance: { type: Number, default: 0.00 }, // Começa com zero
    
    // Para onde ele quer sacar
    pixKey: { type: String, default: '' },
    pixKeyType: { type: String, default: '' }, // CPF, Email, Aleatória

    activeGame: {
        grid: [String],
        revealed: [Boolean],
        minesCount: Number,
        betAmount: Number,
        currentMultiplier: Number,
        diamondsFound: Number,
        isGameOver: { type: Boolean, default: true }
    },
    
    // Histórico de Depósitos e Saques
    transactions: [{
        type: { type: String, enum: ['deposit', 'withdraw'] },
        amount: Number,
        status: { type: String, enum: ['pending', 'approved', 'rejected'] },
        mpPaymentId: String, // ID do Mercado Pago
        date: { type: Date, default: Date.now }
    }]
});

module.exports = mongoose.model('User', UserSchema);
