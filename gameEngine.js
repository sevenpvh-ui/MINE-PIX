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

// AGORA RECEBE A MARGEM DA CASA (houseEdge)
function calculateMultiplier(mines, openedSpots, houseEdge = 0.95) {
    const totalSpots = 25;
    const remainingSpots = totalSpots - openedSpots;
    const remainingSafe = remainingSpots - mines;

    if (remainingSafe <= 0) return 0;

    const probability = remainingSafe / remainingSpots;
    
    // O multiplicador é ajustado pelo lucro que você definiu no Admin
    return houseEdge / probability;
}

module.exports = { createGrid, calculateMultiplier };
