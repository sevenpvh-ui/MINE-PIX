let currentUser = null; // Guarda ID e Email
let isPlaying = false;

// ELEMENTOS
const gridEl = document.getElementById('grid');
const balanceEl = document.getElementById('balance');
const msgEl = document.getElementById('message-display');
const btn = document.getElementById('action-btn');

// --- AUTENTICAÇÃO ---
async function login() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-pass').value;
    const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if(res.ok) {
        currentUser = data;
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('user-email-display').innerText = data.email;
        updateBalance();
        initGame();
    } else {
        document.getElementById('auth-msg').innerText = data.error;
    }
}

async function register() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-pass').value;
    const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if(res.ok) {
        login(); // Auto login
    } else {
        document.getElementById('auth-msg').innerText = data.error;
    }
}

// --- FINANCEIRO ---
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

async function generatePix() {
    const amount = document.getElementById('dep-amount').value;
    const res = await fetch('/api/payment/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.userId, amount })
    });
    const data = await res.json();
    
    if(res.ok) {
        document.getElementById('pix-area').classList.remove('hidden');
        document.getElementById('qr-img').src = `data:image/jpeg;base64,${data.qrCodeBase64}`;
        document.getElementById('copy-paste').value = data.copyPaste;
        
        // Loop simples para checar saldo a cada 5 segundos
        const checkInterval = setInterval(async () => {
            await updateBalance();
            // Se o saldo aumentou (lógica simplificada), fecha o modal
            // Ideal seria verificar status do PIX especificamente
        }, 5000);
    } else {
        alert(data.error);
    }
}

function copyPix() {
    const copyText = document.getElementById("copy-paste");
    copyText.select();
    document.execCommand("copy");
    alert("Código PIX Copiado!");
}

async function requestWithdraw() {
    const amount = document.getElementById('with-amount').value;
    const pixKey = document.getElementById('pix-key').value;
    const pixKeyType = document.getElementById('pix-type').value;

    const res = await fetch('/api/payment/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.userId, amount, pixKey, pixKeyType })
    });
    const data = await res.json();
    alert(data.message || data.error);
    if(res.ok) {
        closeModal('withdraw-modal');
        updateBalance();
    }
}

// --- JOGO ---
function initGame() {
    renderGrid(true);
    btn.onclick = handleAction;
}

async function updateBalance() {
    if(!currentUser) return;
    const res = await fetch(`/api/me/${currentUser.userId}`);
    const data = await res.json();
    balanceEl.innerText = parseFloat(data.balance).toFixed(2);
}

function renderGrid(disabled) {
    gridEl.innerHTML = '';
    for(let i=0; i<25; i++) {
        const b = document.createElement('button');
        b.className = 'cell';
        b.disabled = disabled;
        if(!disabled) b.onclick = () => playRound(i, b);
        gridEl.appendChild(b);
    }
}

async function handleAction() {
    if (!isPlaying) {
        // INICIAR
        const bet = document.getElementById('betAmount').value;
        const mines = document.getElementById('minesCount').value;
        
        const res = await fetch('/api/game/start', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({userId: currentUser.userId, betAmount: bet, minesCount: mines})
        });
        const data = await res.json();
        
        if(data.error) return alert(data.error);
        
        isPlaying = true;
        updateBalance();
        renderGrid(false);
        btn.innerText = "RETIRAR";
        btn.classList.add('cashout-mode');
        
    } else {
        // CASHOUT
        const res = await fetch('/api/game/cashout', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({userId: currentUser.userId})
        });
        const data = await res.json();
        finishGame(true, data.winAmount, data.grid);
    }
}

async function playRound(index, cellBtn) {
    const res = await fetch('/api/game/play', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({userId: currentUser.userId, index})
    });
    const data = await res.json();
    
    if(data.status === 'safe') {
        cellBtn.innerHTML = '<img src="assets/diamond.png" style="width:70%">';
        cellBtn.classList.add('revealed', 'safe');
        cellBtn.disabled = true;
        btn.innerText = `RETIRAR R$ ${data.potentialWin}`;
    } else if(data.status === 'boom') {
        cellBtn.innerHTML = '<img src="assets/bomb.png" style="width:70%">';
        cellBtn.classList.add('boom');
        finishGame(false, 0, data.grid);
    }
}

function finishGame(win, amount, fullGrid) {
    isPlaying = false;
    btn.innerText = "COMEÇAR";
    btn.classList.remove('cashout-mode');
    updateBalance();
    
    // Revelar tudo
    const cells = document.querySelectorAll('.cell');
    fullGrid.forEach((type, i) => {
        cells[i].disabled = true;
        cells[i].classList.add('revealed');
        if(type === 'mine') cells[i].innerHTML = '<img src="assets/bomb.png" style="width:70%">';
        if(type === 'diamond') {
            if(!cells[i].innerHTML) cells[i].innerHTML = '<img src="assets/diamond.png" style="width:70%; opacity: 0.5">';
        }
    });

    if(win) {
        msgEl.innerHTML = `<span style="color:#00e701">Ganhou R$ ${amount}</span>`;
        confetti();
    } else {
        msgEl.innerHTML = `<span style="color:red">Boooocê perdeu!</span>`;
    }
}

function adjustBet(m) { document.getElementById('betAmount').value *= m; }
