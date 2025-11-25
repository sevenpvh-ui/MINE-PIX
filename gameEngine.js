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

function calculateMultiplier(mines, openedSpots) {
    const totalSpots = 25;
    const remainingSpots = totalSpots - openedSpots;
    const remainingSafe = remainingSpots - mines;

    if (remainingSafe <= 0) return 0;

    const probability = remainingSafe / remainingSpots;
    const houseEdge = 0.85; // 15% de margem da casa
    return houseEdge / probability;
}

module.exports = { createGrid, calculateMultiplier };
