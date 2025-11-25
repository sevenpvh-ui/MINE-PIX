let currentUser = null;
let isPlaying = false;

const gridEl = document.getElementById('grid');
const balanceEl = document.getElementById('balance');
const msgEl = document.getElementById('message-display');
const multEl = document.getElementById('multiplier-display');
const btn = document.getElementById('action-btn');
const authMsg = document.getElementById('auth-msg');

startLiveFeed();

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
        } else { showAuthError(data.error || "Erro ao logar"); }
    } catch (error) { showAuthError("Erro de conexão"); }
}

async function register() {
    const cpf = document.getElementById('auth-cpf').value;
    const password = document.getElementById('auth-pass').value;
    if(!cpf || !password) return showAuthError("Preencha campos");
    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cpf, password })
        });
        const data = await res.json();
        if(res.ok) { alert("Conta criada!"); login(); } else { showAuthError(data.error); }
    } catch (error) { showAuthError("Erro ao registrar"); }
}

function showAuthError(msg) { authMsg.innerText = msg; setTimeout(() => authMsg.innerText = "", 3000); }

async function claimBonus() {
    if(!currentUser) return;
    try {
        const res = await fetch('/api/bonus/daily', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.userId })
        });
        const data = await res.json();
        if(res.ok) { alert("🎁 " + data.message); updateBalance(); confetti(); } else { alert("⏳ " + data.error); }
    } catch(e) {}
}

function startLiveFeed() {
    const names = ["João", "Pedro", "Maria", "Lucas", "Ana", "Carlos", "Bia", "Felipe"];
    const feedEl = document.getElementById('live-feed-content');
    setInterval(() => {
        const name = names[Math.floor(Math.random() * names.length)] + "***";
        const amount = (Math.random() * 100 + 10).toFixed(2);
        const item = document.createElement('span');
        item.style.marginRight = "40px";
        item.innerHTML = `🔥 ${name} ganhou <span class="feed-money">R$ ${amount}</span>`;
        feedEl.appendChild(item);
        if(feedEl.children.length > 10) feedEl.removeChild(feedEl.firstChild);
    }, 3000);
}

function openModal(id) { 
    document.getElementById(id).classList.remove('hidden'); 
    if(id === 'profile-modal') loadTransactions();
}
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

async function loadTransactions() {
    const tbody = document.getElementById('transaction-list');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center">Carregando...</td></tr>';
    const res = await fetch(`/api/me/transactions/${currentUser.userId}`);
    const data = await res.json();
    tbody.innerHTML = '';
    if(data.length === 0) { tbody.innerHTML = '<tr><td colspan="4">Nenhuma transação.</td></tr>'; return; }
    data.forEach(t => {
        const date = new Date(t.createdAt).toLocaleDateString('pt-BR');
        let typeHTML = t.type === 'deposit' ? '<span style="color:#00e701">Depósito</span>' : (t.type === 'bonus' ? '<span style="color:#ff00aa">Bônus</span>' : '<span style="color:orange">Saque</span>');
        let stColor = t.status === 'approved' ? '#00e701' : 'orange';
        const row = `<tr style="border-bottom: 1px solid #333;"><td style="padding: 8px;">${typeHTML}</td><td>R$ ${t.amount.toFixed(2)}</td><td style="color: ${stColor}">${t.status}</td><td style="color: #777">${date}</td></tr>`;
        tbody.innerHTML += row;
    });
}

async function generatePix() {
    const amount = document.getElementById('dep-amount').value;
    const res = await fetch('/api/payment/deposit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: currentUser.userId, amount }) });
    const data = await res.json();
    if(res.ok) {
        document.getElementById('pix-area').classList.remove('hidden');
        document.getElementById('qr-img').src = `data:image/jpeg;base64,${data.qrCodeBase64}`;
        document.getElementById('copy-paste').value = data.copyPaste;
        setInterval(async () => { await updateBalance(); }, 5000);
    } else { alert(data.error); }
}

async function simulateDeposit() {
    const amount = document.getElementById('dep-amount').value;
    const res = await fetch('/api/debug/deposit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: currentUser.userId, amount }) });
    if(res.ok) { alert("✅ Simulado!"); updateBalance(); closeModal('deposit-modal'); }
}

function copyPix() { const c=document.getElementById("copy-paste"); c.select(); document.execCommand("copy"); alert("Copiado!"); }

async function requestWithdraw() {
    const amount = document.getElementById('with-amount').value;
    const pixKey = document.getElementById('pix-key').value;
    const pixKeyType = document.getElementById('pix-type').value;
    const res = await fetch('/api/payment/withdraw', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: currentUser.userId, amount, pixKey, pixKeyType }) });
    const data = await res.json();
    if(res.ok) { alert("Solicitado!"); closeModal('withdraw-modal'); updateBalance(); } else { alert(data.error); }
}

function initGame() { renderGrid(true); btn.onclick = handleAction; }

async function updateBalance() {
    if(!currentUser) return;
    try { const res = await fetch(`/api/me/${currentUser.userId}`); const data = await res.json(); balanceEl.innerText = parseFloat(data.balance).toFixed(2); } catch(e) {}
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
        const bet = document.getElementById('betAmount').value;
        const mines = document.getElementById('minesCount').value;
        const res = await fetch('/api/game/start', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({userId: currentUser.userId, betAmount: bet, minesCount: mines}) });
        const data = await res.json();
        if(data.error) return alert(data.error);
        isPlaying = true; updateBalance(); renderGrid(false); btn.innerText = "RETIRAR (Cashout)"; btn.classList.add('cashout-mode'); multEl.innerText = "1.00x";
    } else {
        const res = await fetch('/api/game/cashout', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({userId: currentUser.userId}) });
        const data = await res.json();
        finishGame(true, data.winAmount, data.grid);
    }
}

async function playRound(index, cellBtn) {
    const res = await fetch('/api/game/play', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({userId: currentUser.userId, index}) });
    const data = await res.json();
    if(data.status === 'safe') {
        cellBtn.innerHTML = '<img src="diamond.png" style="width:95%; drop-shadow: 0 0 5px #00e701;" onerror="this.parentNode.innerText=\'💎\'">';
        cellBtn.classList.add('revealed', 'safe'); cellBtn.disabled = true; multEl.innerText = `${data.multiplier}x`; btn.innerText = `RETIRAR R$ ${data.potentialWin}`;
    } else if(data.status === 'boom') {
        cellBtn.innerHTML = '<img src="bomb.png" style="width:95%;" onerror="this.parentNode.innerText=\'💣\'">';
        cellBtn.classList.add('boom'); document.getElementById('grid-container').classList.add('shake-anim');
        setTimeout(()=> document.getElementById('grid-container').classList.remove('shake-anim'), 400);
        finishGame(false, 0, data.grid);
    }
}

function finishGame(win, amount, fullGrid) {
    isPlaying = false; btn.innerText = "COMEÇAR"; btn.classList.remove('cashout-mode'); updateBalance();
    const cells = document.querySelectorAll('.cell');
    fullGrid.forEach((type, i) => {
        cells[i].disabled = true; cells[i].classList.add('revealed');
        if(type === 'mine') if(!cells[i].innerHTML) cells[i].innerHTML = '<img src="bomb.png" style="width:95%; opacity:0.5">';
        if(type === 'diamond') if(!cells[i].innerHTML) cells[i].innerHTML = '<img src="diamond.png" style="width:95%; opacity:0.5">';
    });
    if(win) { msgEl.innerHTML = `<span style="color:#00e701">GANHOU R$ ${amount}</span>`; confetti(); } else { msgEl.innerHTML = `<span style="color:red">PERDEU!</span>`; }
}

function adjustBet(m) { const i = document.getElementById('betAmount'); i.value = (parseFloat(i.value) * m).toFixed(2); }
