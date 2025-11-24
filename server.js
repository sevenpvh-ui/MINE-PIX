const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ARMAZENAMENTO NA MEMÓRIA (Se reiniciar o servidor, zera tudo)
// Em produção, isso seria um Banco de Dados (Postgres/MongoDB)
const sessions = {}; 

// Configurações do jogo
const HOUSE_EDGE = 0.03; // 3% de vantagem da casa (opcional, para realismo)

function generateGrid(minesCount) {
    const grid = Array(25).fill('diamond');
    let placed = 0;
    while (placed < minesCount) {
        let idx = Math.floor(Math.random() * 25);
        if (grid[idx] !== 'mine') {
            grid[idx] = 'mine';
            placed++;
        }
    }
    return grid;
}

// Calcula quanto o multiplicador sobe a cada diamante
// Fórmula simplificada baseada na probabilidade
function calculateNextMultiplier(mines, openedSpots) {
    const totalSpots = 25;
    const remainingSpots = totalSpots - openedSpots;
    const remainingSafe = remainingSpots - mines;
    
    // Probabilidade de acertar = seguros / restantes
    // O payout justo seria 1 / probabilidade
    // Aplicamos uma margem de segurança
    if (remainingSafe <= 0) return 0;
    
    const probability = remainingSafe / remainingSpots;
    const multiplier = 0.99 / probability; // 0.99 simula a margem da casa
    return multiplier;
}

// ROTA: Iniciar Jogo (Apostar)
app.post('/api/start', (req, res) => {
    const { userId, betAmount, minesCount } = req.body;

    // Inicializa saldo se usuário novo
    if (!sessions[userId]) sessions[userId] = { balance: 1000.00 }; // Começa com R$ 1000
    
    const user = sessions[userId];

    if (user.activeGame) return res.status(400).json({ error: "Jogo já em andamento!" });
    if (betAmount <= 0) return res.status(400).json({ error: "Aposta inválida" });
    if (user.balance < betAmount) return res.status(400).json({ error: "Saldo insuficiente" });

    // Deduz a aposta
    user.balance -= parseFloat(betAmount);

    // Cria o jogo
    user.activeGame = {
        grid: generateGrid(minesCount),
        revealed: Array(25).fill(false),
        minesCount: minesCount,
        betAmount: parseFloat(betAmount),
        currentMultiplier: 1.0,
        diamondsFound: 0,
        isGameOver: false
    };

    res.json({
        balance: user.balance,
        message: "Aposta feita!",
        currentMultiplier: 1.0
    });
});

// ROTA: Jogar (Clicar no quadrado)
app.post('/api/play', (req, res) => {
    const { userId, index } = req.body;
    const user = sessions[userId];

    if (!user || !user.activeGame || user.activeGame.isGameOver) {
        return res.status(400).json({ error: "Nenhum jogo ativo." });
    }

    const game = user.activeGame;

    if (game.revealed[index]) return res.status(400).json({ error: "Já clicado" });

    game.revealed[index] = true;

    // SE FOR MINA (PERDEU)
    if (game.grid[index] === 'mine') {
        game.isGameOver = true;
        const lostGrid = game.grid; // Guarda o grid para mostrar
        user.activeGame = null; // Reseta jogo
        
        return res.json({
            status: 'boom',
            grid: lostGrid,
            balance: user.balance
        });
    }

    // SE FOR DIAMANTE (CONTINUA)
    game.diamondsFound++;
    
    // Atualiza multiplicador acumulado
    // Lógica simplificada: Multiplicador atual * novo fator
    const riskFactor = 1 + (game.minesCount / 25); // Simples fator de crescimento
    game.currentMultiplier = game.currentMultiplier * (1 + (game.minesCount / (25 - game.diamondsFound)));
    
    res.json({
        status: 'safe',
        multiplier: game.currentMultiplier.toFixed(2),
        potentialWin: (game.betAmount * game.currentMultiplier).toFixed(2)
    });
});

// ROTA: Cashout (Retirar Dinheiro)
app.post('/api/cashout', (req, res) => {
    const { userId } = req.body;
    const user = sessions[userId];

    if (!user || !user.activeGame) return res.status(400).json({ error: "Sem jogo para retirar." });

    const game = user.activeGame;
    
    // Calcula ganho
    const winAmount = game.betAmount * game.currentMultiplier;
    user.balance += winAmount;

    // Encerra o jogo
    const fullGrid = game.grid;
    user.activeGame = null;

    res.json({
        status: 'cashout',
        winAmount: winAmount.toFixed(2),
        balance: user.balance,
        grid: fullGrid
    });
});

// ROTA: Pegar Saldo
app.get('/api/me/:userId', (req, res) => {
    const { userId } = req.params;
    if (!sessions[userId]) sessions[userId] = { balance: 1000.00 };
    res.json({ balance: sessions[userId].balance });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor Casino rodando na porta ${PORT}`));
