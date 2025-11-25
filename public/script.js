let currentUser = null;
let isPlaying = false;

const gridEl = document.getElementById('grid');
const balanceEl = document.getElementById('balance');
const msgEl = document.getElementById('message-display');
const multEl = document.getElementById('multiplier-display');
const btn = document.getElementById('action-btn');

const sounds = { click: new Audio('click.mp3'), diamond: new Audio('diamond.mp3'), bomb: new Audio('bomb.mp3'), win: new Audio('win.mp3') };
function playSound(name) { try { const s = sounds[name].cloneNode(); s.volume=0.5; s.play().catch(()=>{}); } catch(e){} }

const urlParams = new URLSearchParams(window.location.search);
const refCodeFromUrl = urlParams.get('ref');
if(refCodeFromUrl) { document.getElementById('reg-ref').value = refCodeFromUrl; showRegister(); }

startLiveFeed();

// --- LÓGICA DE BOAS VINDAS ---
// Se não tiver usuário logado, mostra o modal Blaze
setTimeout(() => {
    if (!currentUser) {
        document.getElementById('welcome-modal').classList.remove('hidden');
    }
}, 500); // Pequeno delay para carregar a página

function showRegisterFromWelcome() {
    document.getElementById('welcome-modal').classList.add('hidden');
    showRegister();
}

function showLoginFromWelcome() {
    document.getElementById('welcome-modal').classList.add('hidden');
    showLogin();
}

// --- TOAST ---
function showToast(msg, type='success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<div style="font-size:20px">${type === 'success' ? '✅' : '❌'}</div><div class="toast-msg">${msg}</div>`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.animation = 'fadeOut 0.5s forwards'; setTimeout(() => toast.remove(), 500); }, 3000);
}

// --- TELAS ---
function showRegister() { document.getElementById('auth-screen').classList.add('hidden'); document.getElementById('register-modal').classList.remove('hidden'); }
function showLogin() { document.getElementById('register-modal').classList.add('hidden'); document.getElementById('recover-modal').classList.add('hidden'); document.getElementById('auth-screen').classList.remove('hidden'); }
function showRecover() { document.getElementById('auth-screen').classList.add('hidden'); document.getElementById('recover-modal').classList.remove('hidden'); }

function openModal(id) { 
    playSound('click');
    document.getElementById(id).classList.remove('hidden'); 
    if(id==='profile-modal') loadTransactions();
    if(id==='affiliate-modal') loadAffiliateStats();
    if(id==='ranking-modal') loadRanking();
}
function closeModal(id) { playSound('click'); document.getElementById(id).classList.add('hidden'); }

// --- AUTH ---
async function login() {
    const cpf = document.getElementById('login-cpf').value;
    const password = document.getElementById('login-pass').value;
    if(!cpf || !password) return showToast("Preencha CPF e Senha", 'error');
    playSound('click');
    try {
        const res = await fetch('/api/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({cpf, password}) });
        const data = await res.json();
        if(res.ok) {
            currentUser = data;
            document.getElementById('auth-screen').classList.add('hidden');
            document.getElementById('welcome-modal').classList.add('hidden'); // Garante que fecha o welcome
            document.getElementById('user-cpf-display').innerText = data.cpf;
            if(data.name) document.getElementById('user-name-display').innerText = data.name.split(' ')[0];
            updateBalance();
            initGame();
            showToast(`Bem-vindo, ${data.name.split(' ')[0]}!`);
        } else { showToast(data.error, 'error'); }
    } catch (error) { showToast("Erro de conexão", 'error'); }
}

async function register() {
    const name = document.getElementById('reg-name').value;
    const cpf = document.getElementById('reg-cpf').value;
    const phone = document.getElementById('reg-phone').value;
    const password = document.getElementById('reg-pass').value;
    const refCode = document.getElementById('reg-ref').value;
    if(!name || !cpf || !phone || !password) return showToast("Preencha tudo", 'error');
    playSound('click');
    try {
        const res = await fetch('/api/auth/register', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({name, cpf, phone, password, refCode}) });
        const data = await res.json();
        if(res.ok) {
            showToast("Conta criada!");
            currentUser = data;
            document.getElementById('register-modal').classList.add('hidden');
            document.getElementById('welcome-modal').classList.add('hidden');
            document.getElementById('user-cpf-display').innerText = data.cpf;
            if(data.name) document.getElementById('user-name-display').innerText = data.name.split(' ')[0];
            updateBalance();
            initGame();
        } else { showToast(data.error, 'error'); }
    } catch (error) { showToast("Erro registro", 'error'); }
}

async function resetPassword() {
    const cpf = document.getElementById('rec-cpf').value;
    const name = document.getElementById('rec-name').value;
    const phone = document.getElementById('rec-phone').value;
    const newPassword = document.getElementById('rec-newpass').value;
    if(!cpf || !name || !phone || !newPassword) return showToast("Preencha tudo!", 'error');
    playSound('click');
    try {
        const res = await fetch('/api/auth/reset-password', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({cpf, name, phone, newPassword}) });
        const data = await res.json();
        if(res.ok) { showToast(data.message); showLogin(); } else { showToast(data.error, 'error'); }
    } catch(e) { showToast("Erro reset", 'error'); }
}

// --- EXTRAS ---
async function loadRanking() {
    const tbody = document.getElementById('ranking-list');
    tbody.innerHTML = '<tr><td colspan="3">Carregando...</td></tr>';
    try {
        const res = await fetch('/api/leaderboard');
        const data = await res.json();
        tbody.innerHTML = '';
        data.forEach((u, index) => {
            let emoji = index === 0 ? '🥇' : (index === 1 ? '🥈' : (index === 2 ? '🥉' : '•'));
            tbody.innerHTML += `<tr style="border-bottom:1px solid #333; height:30px"><td>${emoji}</td><td>${u.name}</td><td style="color:#00e701;font-weight:bold">R$ ${u.balance.toFixed(2)}</td></tr>`;
        });
    } catch(e) { tbody.innerHTML = '<tr><td colspan="3">Erro</td></tr>'; }
}

async function loadAffiliateStats() {
    try {
        const res = await fetch(`/api/affiliates/stats/${currentUser.userId}`);
        const data = await res.json();
        document.getElementById('aff-earnings').innerText = `R$ ${data.earnings.toFixed(2)}`;
        document.getElementById('aff-count').innerText = data.count;
        document.getElementById('aff-link').value = data.link;
    } catch(e) {}
}
function copyAffiliateLink() { playSound('click'); const c=document.getElementById("aff-link"); c.select(); document.execCommand("copy"); showToast("Link copiado!"); }

async function claimBonus() {
    if(!currentUser) return;
    playSound('click');
    try {
        const res = await fetch('/api/bonus/daily', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({userId: currentUser.userId}) });
        const data = await res.json();
        if(res.ok) { playSound('win'); showToast(data.message); updateBalance(); confetti(); } else { showToast(data.error, 'error'); }
    } catch(e) {}
}

function startLiveFeed() {
    const names = ["João", "Pedro", "Maria", "Lucas", "Ana", "Carlos", "Bia"];
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

async function loadTransactions() {
    const tbody = document.getElementById('transaction-list');
    tbody.innerHTML = '<tr><td colspan="4">Carregando...</td></tr>';
    const res = await fetch(`/api/me/transactions/${currentUser.userId}`);
    const data = await res.json();
    tbody.innerHTML = '';
    if(data.length===0) { tbody.innerHTML = '<tr><td colspan="4">Vazio.</td></tr>'; return; }
    data.forEach(t => {
        const date = new Date(t.createdAt).toLocaleDateString('pt-BR');
        let color = t.status === 'approved' ? '#00e701' : 'orange';
        let typeShow = t.type === 'commission' ? 'Comissão' : (t.type === 'bonus' ? 'Bônus' : t.type);
        tbody.innerHTML += `<tr style="border-bottom:1px solid #333"><td style="padding:8px">${typeShow}</td><td>R$ ${t.amount.toFixed(2)}</td><td style="color:${color}">${t.status}</td><td style="color:#777">${date}</td></tr>`;
    });
}

async function generatePix() {
    playSound('click');
    const amount = document.getElementById('dep-amount').value;
    const res = await fetch('/api/payment/deposit', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ userId: currentUser.userId, amount }) });
    const data = await res.json();
    if(res.ok) {
        document.getElementById('pix-area').classList.remove('hidden');
        document.getElementById('qr-img').src = `data:image/jpeg;base64,${data.qrCodeBase64}`;
        document.getElementById('copy-paste').value = data.copyPaste;
        setInterval(async () => { await updateBalance(); }, 5000);
    } else { showToast(data.error, 'error'); }
}

async function simulateDeposit() {
    playSound('click');
    const amount = document.getElementById('dep-amount').value;
    const res = await fetch('/api/debug/deposit', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ userId: currentUser.userId, amount }) });
    if(res.ok) { playSound('win'); showToast("✅ Simulado!"); updateBalance(); closeModal('deposit-modal'); } else { showToast("Erro", 'error'); }
}

function copyPix() { playSound('click'); const c=document.getElementById("copy-paste"); c.select(); document.execCommand("copy"); showToast("Copiado!"); }

async function requestWithdraw() {
    playSound('click');
    const amount = document.getElementById('with-amount').value;
    const pixKey = document.getElementById('pix-key').value;
    const pixKeyType = document.getElementById('pix-type').value;
    const res = await fetch('/api/payment/withdraw', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ userId: currentUser.userId, amount, pixKey, pixKeyType }) });
    const data = await res.json();
    if(res.ok) { showToast("Solicitado!"); closeModal('withdraw-modal'); updateBalance(); } else { showToast(data.error, 'error'); }
}

// --- JOGO ---
function initGame() { renderGrid(true); btn.onclick = handleAction; }

async function updateBalance() {
    if(!currentUser) return;
    try { const res = await fetch(`/api/me/${currentUser.userId}`); const data = await res.json(); balanceEl.innerText = parseFloat(data.balance).toFixed(2); if(data.name) document.getElementById('user-name-display').innerText = data.name.split(' ')[0]; } catch(e) {}
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
    playSound('click');
    if (!isPlaying) {
        const bet = document.getElementById('betAmount').value;
        const mines = document.getElementById('minesCount').value;
        const res = await fetch('/api/game/start', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({userId: currentUser.userId, betAmount: bet, minesCount: mines}) });
        const data = await res.json();
        if(data.error) return showToast(data.error, 'error');
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
        playSound('diamond');
        multEl.innerText = `${data.multiplier}x`;
        multEl.classList.remove('pulse-effect');
        void multEl.offsetWidth; 
        multEl.classList.add('pulse-effect');

        cellBtn.innerHTML = '<img src="diamond.png" style="width:95%; transform:scale(1.8); drop-shadow: 0 0 5px #00e701;" onerror="this.parentNode.innerText=\'💎\'">';
        cellBtn.classList.add('revealed', 'safe'); cellBtn.disabled = true; 
        btn.innerText = `RETIRAR R$ ${data.potentialWin}`;
    } else if(data.status === 'boom') {
        playSound('bomb');
        cellBtn.innerHTML = '<img src="bomb.png" style="width:95%; transform:scale(1.8);" onerror="this.parentNode.innerText=\'💣\'">';
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
        if(type === 'mine') if(!cells[i].innerHTML) cells[i].innerHTML = '<img src="bomb.png" style="width:95%; transform:scale(1.8); opacity:0.5">';
        if(type === 'diamond') if(!cells[i].innerHTML) cells[i].innerHTML = '<img src="diamond.png" style="width:95%; transform:scale(1.8); opacity:0.5">';
    });
    if(win) { playSound('win'); showToast(`GANHOU R$ ${amount}!`); confetti(); } else { showToast("Você perdeu!", 'error'); }
}

function adjustBet(m) { playSound('click'); const i = document.getElementById('betAmount'); i.value = (parseFloat(i.value) * m).toFixed(2); }
