const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
    // Valor do Bônus Diário
    dailyBonus: { type: Number, default: 1.00 },
    
    // Podemos adicionar mais coisas no futuro aqui, ex:
    // minDeposit: { type: Number, default: 20.00 },
    // minWithdraw: { type: Number, default: 50.00 }
});

module.exports = mongoose.model('Settings', SettingsSchema);
