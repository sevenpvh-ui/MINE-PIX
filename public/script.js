let currentUser = null;
let isPlaying = false;

// Elementos
const gridEl = document.getElementById('grid');
const balanceEl = document.getElementById('balance');
const msgEl = document.getElementById('message-display');
const multEl = document.getElementById('multiplier-display');
const btn = document.getElementById('action-btn');
const authMsg = document.getElementById('auth-msg');

// --- AUTENTICAÇÃO (CPF) ---
async function login() {
    const cpf = document.getElementById('auth-cpf').value;
    const password = document.getElementById('auth-pass').value;
    
    if(!cpf || !password) return showAuthError("Preencha CPF e Senha");

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cpf, password })
        });
        const data = await res.json();
        
        if(res.ok) {
            currentUser = data;
            document.getElementById('auth-screen').classList.add('hidden');
            document.getElementById('user-cpf-display').innerText = data.cpf;
            updateBalance();
            initGame();
        } else {
            showAuthError(data.error || "Erro ao logar");
        }
    } catch (error) {
        showAuthError("Erro de conexão com servidor");
    }
}

async function register() {
    const cpf = document.getElementById('auth-cpf').value;
    const password = document.getElementById('auth-pass').value;

    if(!cpf || !password) return showAuthError("Preencha todos os campos");

    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cpf, password })
        });
        const data = await res.json();
        
        if(res.ok) {
            alert("Conta criada com sucesso!");
            login(); // Auto login
        } else {
            showAuthError(data.error);
        }
    } catch (error) {
        showAuthError("Erro ao registrar");
    }
}

function showAuthError(msg) {
    authMsg.innerText = msg;
    setTimeout(() => authMsg.innerText = "", 3000);
}

// --- FINANCEIRO (PIX) ---
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

async function generatePix() {
    const amount = document.getElementById('dep-amount').value;
    if(!amount || amount < 1) return alert("Valor mínimo R$ 1,00");

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
        
        // Verifica saldo a cada 5s para ver se caiu
        const checkInterval = setInterval(async () => {
            await updateBalance();
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

// --- LÓGICA DO JOGO ---
function initGame() {
    renderGrid(true);
    btn.onclick = handleAction;
}

async function updateBalance() {
    if(!currentUser) return;
    try {
        const res = await fetch(`/api/me/${currentUser.userId}`);
        const data = await res.json();
        balanceEl.innerText = parseFloat(data.balance).toFixed(2);
    } catch(e) { console.error(e); }
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
        // COMEÇAR JOGO
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
        updateBalance(); // Saldo atualiza (descontou aposta)
        renderGrid(false);
        btn.innerText = "RETIRAR (Cashout)";
        btn.classList.add('cashout-mode');
        msgEl.innerText = "Boa sorte!";
        multEl.innerText = "1.00x";
        
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
        // DIAMANTE (Usa imagem se tiver, senão emoji)
        cellBtn.innerHTML = '<img src="diamond.png" style="width:70%; drop-shadow: 0 0 5px #00e701;" onerror="this.style.display=\'none\';this.parentNode.innerText=\'💎\'">';
        cellBtn.classList.add('revealed', 'safe');
        cellBtn.disabled = true;
        
        multEl.innerText = `${data.multiplier}x`;
        btn.innerText = `RETIRAR R$ ${data.potentialWin}`;
        
    } else if(data.status === 'boom') {
        // BOMBA
        cellBtn.innerHTML = '<img src="bomb.png" style="width:70%;" onerror="this.style.display=\'none\';this.parentNode.innerText=\'💣\'">';
        cellBtn.classList.add('boom');
        
        // Treme a tela
        document.getElementById('grid-container').classList.add('shake-anim');
        setTimeout(()=> document.getElementById('grid-container').classList.remove('shake-anim'), 400);

        finishGame(false, 0, data.grid);
    }
}

function finishGame(win, amount, fullGrid) {
    isPlaying = false;
    btn.innerText = "COMEÇAR";
    btn.classList.remove('cashout-mode');
    updateBalance();
    
    // Revela o tabuleiro todo
    const cells = document.querySelectorAll('.cell');
    fullGrid.forEach((type, i) => {
        cells[i].disabled = true;
        cells[i].classList.add('revealed');
        
        if(type === 'mine') {
             if(!cells[i].innerHTML) cells[i].innerHTML = '<img src="bomb.png" style="width:70%; opacity:0.5" onerror="this.parentNode.innerText=\'💣\'">';
        } else if(type === 'diamond') {
             if(!cells[i].innerHTML) cells[i].innerHTML = '<img src="diamond.png" style="width:70%; opacity:0.5" onerror="this.parentNode.innerText=\'💎\'">';
        }
    });

    if(win) {
        msgEl.innerHTML = `<span style="color:#00e701">GANHOU R$ ${amount}</span>`;
        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
    } else {
        msgEl.innerHTML = `<span style="color:red">VOCÊ PERDEU!</span>`;
    }
}

function adjustBet(m) { 
    const input = document.getElementById('betAmount');
    input.value = (parseFloat(input.value) * m).toFixed(2);
}
