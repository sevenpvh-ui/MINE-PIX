// Gerenciamento de Usuário (Simulação)
let userId = localStorage.getItem('userId');
if (!userId) {
    userId = 'user_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('userId', userId);
}

// Elementos do DOM
const gridEl = document.getElementById('grid');
const actionBtn = document.getElementById('action-btn');
const balanceEl = document.getElementById('balance');
const multEl = document.getElementById('multiplier-display');
const msgEl = document.getElementById('message-display');
const gridContainer = document.getElementById('grid-container');

let isPlaying = false;

// Inicialização
init();

function init() {
    renderGrid(true); // Grid bloqueado
    updateBalance();
    
    // Evento do botão principal
    actionBtn.onclick = handleAction;
}

// Funções de Interface
function renderGrid(disabled = false) {
    gridEl.innerHTML = '';
    for (let i = 0; i < 25; i++) {
        const btn = document.createElement('button');
        btn.className = 'cell';
        if (!disabled) {
            btn.onclick = () => playRound(i, btn);
        } else {
            btn.disabled = true;
        }
        gridEl.appendChild(btn);
    }
}

function adjustBet(factor) {
    const input = document.getElementById('betAmount');
    let val = parseFloat(input.value);
    input.value = (val * factor).toFixed(2);
}

// Funções de API
async function updateBalance() {
    try {
        const res = await fetch(`/api/me/${userId}`);
        const data = await res.json();
        balanceEl.innerText = parseFloat(data.balance).toFixed(2);
    } catch (e) {
        console.error("Erro ao buscar saldo");
    }
}

async function handleAction() {
    if (!isPlaying) {
        // --- INICIAR JOGO ---
        const bet = document.getElementById('betAmount').value;
        const mines = document.getElementById('minesCount').value;

        const res = await fetch('/api/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, betAmount: bet, minesCount: mines })
        });

        const data = await res.json();
        
        if (res.status !== 200) {
            msgEl.innerText = data.error;
            msgEl.style.color = 'red';
            return;
        }

        // Sucesso no início
        isPlaying = true;
        actionBtn.innerText = "RETIRAR (Cashout)";
        actionBtn.classList.add('cashout-mode');
        msgEl.innerText = "Boa sorte!";
        msgEl.style.color = '#b1bad3';
        multEl.style.opacity = '1';
        multEl.innerText = '1.00x';
        
        renderGrid(false); // Libera o grid
        updateBalance();

    } else {
        // --- FAZER CASHOUT ---
        const res = await fetch('/api/cashout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        const data = await res.json();
        
        revealBoard(data.grid);
        finishGame(true, data.winAmount);
    }
}

async function playRound(index, btn) {
    if (!isPlaying) return;

    const res = await fetch('/api/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, index })
    });
    const data = await res.json();

    if (data.status === 'safe') {
        // ACERTOU
        btn.classList.add('revealed', 'safe');
        btn.innerHTML = '💎';
        btn.disabled = true;
        
        multEl.innerText = `${data.multiplier}x`;
        actionBtn.innerText = `RETIRAR R$ ${data.potentialWin}`;
        
    } else if (data.status === 'boom') {
        // PERDEU
        btn.classList.add('boom');
        btn.innerHTML = '💣';
        
        // Efeito de tremor
        gridContainer.classList.add('shake-anim');
        setTimeout(() => gridContainer.classList.remove('shake-anim'), 500);

        revealBoard(data.grid);
        finishGame(false);
    }
}

function revealBoard(fullGrid) {
    const buttons = document.querySelectorAll('.cell');
    fullGrid.forEach((type, idx) => {
        const btn = buttons[idx];
        btn.disabled = true;
        btn.classList.add('revealed');
        if (type === 'mine') {
            btn.innerHTML = '💣';
            if (!btn.classList.contains('boom')) btn.style.opacity = '0.5';
        } else if (type === 'diamond') {
            btn.innerHTML = '💎';
            if (!btn.classList.contains('safe')) btn.style.opacity = '0.3';
        }
    });
}

function finishGame(win, amount) {
    isPlaying = false;
    actionBtn.classList.remove('cashout-mode');
    actionBtn.innerText = "COMEÇAR O JOGO";
    multEl.style.opacity = '0.5';
    updateBalance();

    if (win) {
        msgEl.innerHTML = `VITÓRIA! <span style="color:#00e701">R$ ${amount}</span>`;
        msgEl.style.color = '#fff';
    } else {
        msgEl.innerText = "VOCÊ PERDEU!";
        msgEl.style.color = '#ff4d4d';
    }
}
