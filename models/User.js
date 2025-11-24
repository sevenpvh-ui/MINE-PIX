const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    balance: { type: Number, default: 1000.00 },
    activeGame: {
        grid: [String],
        revealed: [Boolean],
        minesCount: Number,
        betAmount: Number,
        currentMultiplier: Number,
        diamondsFound: Number,
        isGameOver: { type: Boolean, default: true }
    }
});

module.exports = mongoose.model('User', UserSchema);
