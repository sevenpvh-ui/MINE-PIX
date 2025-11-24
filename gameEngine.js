// gameEngine.js

// Gera o tabuleiro com as minas escondidas
function createGrid(minesCount) {
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

// Calcula o próximo multiplicador baseado no risco
function calculateMultiplier(mines, openedSpots) {
    // Lógica simplificada de Probabilidade Inversa
    const totalSpots = 25;
    const remainingSpots = totalSpots - openedSpots;
    const remainingSafe = remainingSpots - mines;

    if (remainingSafe <= 0) return 0;

    const probability = remainingSafe / remainingSpots;
    const houseEdge = 0.97; // 3% de vantagem para a casa
    const multiplier = houseEdge / probability;
    
    return multiplier;
}

module.exports = { createGrid, calculateMultiplier };
