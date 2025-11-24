// server.js
const express = require('express');
const cors = require('cors');
const { createGrid, calculateMultiplier } = require('./gameEngine'); // Importa a lógica
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Simulação de Banco de Dados na Memória
const sessions = {}; 

// Rota para obter saldo
app.get('/api/me/:userId', (req, res) => {
    const { userId } = req.params;
    if (!sessions[userId]) sessions[userId] = { balance: 1000.00 }; // Saldo inicial
    res.json({ balance: sessions[userId].balance });
});

// Rota: Iniciar Jogo
app.post('/api/start', (req, res) => {
    const { userId, betAmount, minesCount } = req.body;

    if (!sessions[userId]) sessions[userId] = { balance: 1000.00 };
    const user = sessions[userId];

    if (user.activeGame) return res.status(400).json({ error: "Jogo em andamento!" });
    if (betAmount <= 0 || isNaN(betAmount)) return res.status(400).json({ error: "Aposta inválida" });
    if (user.balance < betAmount) return res.status(400).json({ error: "Saldo insuficiente" });

    // Desconta aposta
    user.balance -= parseFloat(betAmount);

    // Cria estado do jogo
    user.activeGame = {
        grid: createGrid(minesCount),
        revealed: Array(25).fill(false),
        minesCount: parseInt(minesCount),
        betAmount: parseFloat(betAmount),
        currentMultiplier: 1.0,
        diamondsFound: 0,
        isGameOver: false
    };

    res.json({
        balance: user.balance,
        multiplier: 1.0
    });
});

// Rota: Jogar (Clicar)
app.post('/api/play', (req, res) => {
    const { userId, index } = req.body;
    const user = sessions[userId];

    if (!user || !user.activeGame || user.activeGame.isGameOver) {
        return res.status(400).json({ error: "Nenhum jogo ativo." });
    }

    const game = user.activeGame;
    if (game.revealed[index]) return res.status(400).json({ error: "Campo já revelado" });

    game.revealed[index] = true;

    // BOOM!
    if (game.grid[index] === 'mine') {
        game.isGameOver = true;
        const lostGrid = game.grid;
        user.activeGame = null; // Reseta
        return res.json({ status: 'boom', grid: lostGrid });
    }

    // DIAMANTE!
    game.diamondsFound++;
    
    // Atualiza multiplicador acumulado
    let nextMult = game.currentMultiplier * calculateMultiplier(game.minesCount, game.diamondsFound - 1);
    if(game.diamondsFound === 1) nextMult = calculateMultiplier(game.minesCount, 0); // Correção para o primeiro clique
    
    game.currentMultiplier = nextMult;

    res.json({
        status: 'safe',
        multiplier: game.currentMultiplier.toFixed(2),
        potentialWin: (game.betAmount * game.currentMultiplier).toFixed(2)
    });
});

// Rota: Cashout
app.post('/api/cashout', (req, res) => {
    const { userId } = req.body;
    const user = sessions[userId];

    if (!user || !user.activeGame) return res.status(400).json({ error: "Sem jogo ativo." });

    const game = user.activeGame;
    const winAmount = game.betAmount * game.currentMultiplier;
    
    user.balance += winAmount;
    
    const fullGrid = game.grid;
    user.activeGame = null;

    res.json({
        status: 'cashout',
        winAmount: winAmount.toFixed(2),
        balance: user.balance,
        grid: fullGrid
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔥 Server rodando na porta ${PORT}`));
