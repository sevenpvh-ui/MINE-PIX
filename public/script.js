let currentUser = null;
let isPlaying = false;

const gridEl = document.getElementById('grid');
const balanceEl = document.getElementById('balance');
const msgEl = document.getElementById('message-display');
const multEl = document.getElementById('multiplier-display');
const btn = document.getElementById('action-btn');
const authMsg = document.getElementById('auth-msg');

// --- SISTEMA DE SOM ---
const sounds = {
    click: new Audio('click.mp3'),
    diamond: new Audio('diamond.mp3'),
    bomb: new Audio('bomb.mp3'),
    win: new Audio('win.mp3')
};

// Função para tocar som (com tratamento de erro se o arquivo não existir)
function playSound(name) {
    try {
        const sound = sounds[name].cloneNode(); // Permite tocar sons sobrepostos
        sound.volume = 0.5; // 50% de volume
        sound.play().catch(e => console.log("Áudio não carregado ou bloqueado: ", e));
    } catch (e) {
        console.log("Arquivo de som não encontrado: " + name);
    }
}

// Inicia feed falso
startLiveFeed();

// --- TELAS ---
function showRegister() { document.getElementById('auth-screen').classList.add('hidden'); document.getElementById('register-modal').classList.remove('hidden'); }
function showLogin() { 
    document.getElementById('register-modal').classList.add('hidden'); 
    document.getElementById('recover-modal').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden'); 
}
function showRecover() { document.getElementById('auth-screen').classList.add('hidden'); document.getElementById('recover-modal').classList.remove('hidden'); }
function showMsg(id, msg) { const el = document.getElementById(id); el.innerText = msg; setTimeout(()=>el.innerText="", 3000); }

// --- AUTENTICAÇÃO ---
async function login() {
    const cpf = document.getElementById('login-cpf').value;
    const password = document.getElementById('login-pass').value;
    if(!cpf || !password) return showMsg('login-msg', "Preencha CPF e Senha");

    playSound('click'); // Som de clique

    try {
        const res = await fetch('/api/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({cpf, password}) });
        const data = await res.json();
        if(res.ok) {
            currentUser = data;
            document.getElementById('auth-screen').classList.add('hidden');
            document.getElementById('user-cpf-display').innerText = data.cpf;
            updateBalance();
            initGame();
        } else { showMsg('login-msg', data.error || "Erro ao entrar"); }
    } catch (error) { showMsg('login-msg', "Erro de conexão"); }
}

async function register() {
    const name = document.getElementById('reg-name').value;
    const cpf = document.getElementById('reg-cpf').value;
    const phone = document.getElementById('reg-phone').value;
    const password = document.getElementById('reg-pass').value;
    const refCode = document.getElementById('reg-ref').value;

    if(!name || !cpf || !phone || !password) return showMsg('reg-msg', "Preencha tudo!");
    
    playSound('click');

    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, cpf, phone, password, refCode })
        });
        const data = await res.json();
        if(res.ok) {
            alert("✅ Conta criada! Bem-vindo " + name);
            currentUser = data;
            document.getElementById('register-modal').classList.add('hidden');
            document.getElementById('user-cpf-display').innerText = data.cpf;
            updateBalance();
            initGame();
        } else { showMsg('reg-msg', data.error); }
    } catch (error) { showMsg('reg-msg', "Erro ao registrar"); }
}

// --- RECUPERAR SENHA ---
async function resetPassword() {
    const cpf = document.getElementById('rec-cpf').value;
    const name = document.getElementById('rec-name').value;
    const phone = document.getElementById('rec-phone').value;
    const newPassword = document.getElementById('rec-newpass').value;

    if(!cpf || !name || !phone || !newPassword) return showMsg('rec-msg', "Preencha tudo!");
    playSound('click');

    try {
        const res = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cpf, name, phone, newPassword })
        });
        const data = await res.json();
        if(res.ok) { alert("✅ " + data.message); showLogin(); } else { showMsg('rec-msg', data.error); }
    } catch(e) { showMsg('rec-msg', "Erro ao alterar senha"); }
}

// --- AFILIADOS ---
function openModal(id) { 
    playSound('click');
    document.getElementById(id).classList.remove('hidden'); 
    if(id==='profile-modal') loadTransactions();
    if(id==='affiliate-modal') loadAffiliateStats();
}
function closeModal(id) { 
    playSound('click');
    document.getElementById(id).classList.add('hidden'); 
}

async function loadAffiliateStats() {
    try {
        const res = await fetch(`/api/affiliates/stats/${currentUser.userId}`);
        const data = await res.json();
        document.getElementById('aff-earnings').innerText = `R$ ${data.earnings.toFixed(2)}`;
        document.getElementById('aff-count').innerText = data.count;
        document.getElementById('aff-link').value = data.link;
    } catch(e) { console.error(e); }
}

function copyAffiliateLink() {
    playSound('click');
    const copyText = document.getElementById("aff-link");
    copyText.select();
    document.execCommand("copy");
    alert("Link copiado!");
}

// --- EXTRAS E FINANCEIRO ---
async function claimBonus() {
    if(!currentUser) return;
    playSound('click');
    try {
        const res = await fetch('/api/bonus/daily', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({userId: currentUser.userId}) });
        const data = await res.json();
        if(res.ok) { 
            playSound('win');
            alert("🎁 " + data.message); 
            updateBalance(); 
            confetti(); 
        } else { alert("⏳ " + data.error); }
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
    if(data.length === 0) { tbody.innerHTML = '<tr><td colspan="4">Vazio.</td></tr>'; return; }
    data.forEach(t => {
        const date = new Date(t.createdAt).toLocaleDateString('pt-BR');
        let color = t.status === 'approved' ? '#00e701' : 'orange';
        let typeShow = t.type === 'commission' ? 'Comissão' : t.type;
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
    } else { alert(data.error); }
}

async function simulateDeposit() {
    playSound('click');
    const amount = document.getElementById('dep-amount').value;
    const res = await fetch('/api/debug/deposit', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ userId: currentUser.userId, amount }) });
    if(res.ok) { 
        playSound('win');
        alert("✅ Simulado!"); 
        updateBalance(); 
        closeModal('deposit-modal'); 
    } else { alert("Erro: " + data.error); }
}

function copyPix() { playSound('click'); const c=document.getElementById("copy-paste"); c.select(); document.execCommand("copy"); alert("Copiado!"); }

async function requestWithdraw() {
    playSound('click');
    const amount = document.getElementById('with-amount').value;
    const pixKey = document.getElementById('pix-key').value;
    const pixKeyType = document.getElementById('pix-type').value;
    const res = await fetch('/api/payment/withdraw', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ userId: currentUser.userId, amount, pixKey, pixKeyType }) });
    const data = await res.json();
    if(res.ok) { alert("Solicitado!"); closeModal('withdraw-modal'); updateBalance(); } else { alert(data.error); }
}

// --- JOGO ---
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
    playSound('click');
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
        playSound('diamond'); // SOM DE DIAMANTE
        // 180% DE TAMANHO (scale 1.8)
        cellBtn.innerHTML = '<img src="diamond.png" style="width:100%; transform: scale(1.8); drop-shadow: 0 0 10px #00e701;" onerror="this.parentNode.innerText=\'💎\'">';
        cellBtn.classList.add('revealed', 'safe'); cellBtn.disabled = true; multEl.innerText = `${data.multiplier}x`; btn.innerText = `RETIRAR R$ ${data.potentialWin}`;
    } else if(data.status === 'boom') {
        playSound('bomb'); // SOM DE BOMBA
        // 180% DE TAMANHO (scale 1.8)
        cellBtn.innerHTML = '<img src="bomb.png" style="width:100%; transform: scale(1.8);" onerror="this.parentNode.innerText=\'💣\'">';
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
        // 180% TAMBÉM NO REVEAL FINAL
        if(type === 'mine') if(!cells[i].innerHTML) cells[i].innerHTML = '<img src="bomb.png" style="width:100%; transform: scale(1.8); opacity:0.5">';
        if(type === 'diamond') if(!cells[i].innerHTML) cells[i].innerHTML = '<img src="diamond.png" style="width:100%; transform: scale(1.8); opacity:0.5">';
    });
    if(win) { 
        playSound('win'); // SOM DE VITÓRIA
        msgEl.innerHTML = `<span style="color:#00e701">GANHOU R$ ${amount}</span>`; 
        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } }); 
    } else { 
        msgEl.innerHTML = `<span style="color:red">PERDEU!</span>`; 
    }
}

function adjustBet(m) { 
    playSound('click');
    const i = document.getElementById('betAmount'); 
    i.value = (parseFloat(i.value) * m).toFixed(2); 
}
