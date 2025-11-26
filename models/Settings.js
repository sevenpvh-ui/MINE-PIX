const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
    dailyBonus: { type: Number, default: 1.00 },
    
    // Margem da casa (0.01 a 0.99)
    houseEdge: { type: Number, default: 0.95 },

    // SENHA DO ADMIN (Padrão inicial: admin123)
    adminPassword: { type: String, default: 'admin123' }
});

module.exports = mongoose.model('Settings', SettingsSchema);
