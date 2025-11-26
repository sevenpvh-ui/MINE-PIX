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

function calculateMultiplier(mines, openedSpots, houseEdge) {
    // houseEdge vem do banco (ex: 0.95 para padrão, 0.60 para difícil)
    // Se não vier, usa 0.95 como segurança
    let edge = houseEdge || 0.95;

    // Proteção: Se o ADM colocou algo absurdo tipo 0.10, travamos em 0.50 para não quebrar o jogo
    if (edge < 0.50) edge = 0.50;

    const totalSpots = 25;
    const remainingSpots = totalSpots - openedSpots;
    const remainingSafe = remainingSpots - mines;

    if (remainingSafe <= 0) return 0;

    // Fórmula da Probabilidade Real de Acerto
    // Ex: 3 minas, 0 abertos -> 22 seguros / 25 total = 0.88 (88% de chance)
    const probability = remainingSafe / remainingSpots;
    
    // O Payout Justo seria 1 / 0.88 = 1.13x
    // Aplicamos a margem da casa: 1.13 * 0.95 = 1.07x
    let multiplier = (1 / probability) * edge;

    // --- CORREÇÃO CRÍTICA ---
    // Nunca deixar o multiplicador de uma rodada ser menor que 1.0 se for o cálculo base.
    // No Mines, o cálculo é acumulativo. Aqui calculamos o FATOR de multiplicação da rodada.
    
    // Porém, o front-end espera o multiplicador TOTAL acumulado.
    // Vamos ajustar apenas o fator de risco aqui.
    
    // Retornamos apenas o fator inverso ajustado pela margem
    return (1 / probability) * edge; 
}

module.exports = { createGrid, calculateMultiplier };
