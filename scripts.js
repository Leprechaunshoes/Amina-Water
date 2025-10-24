// ===== CONFIG =====
const ASA_ID = 1107424865; // Amina Coin ASA
const DONATION_ADDRESS = "PZBPPJUHZ3UMENQHZO2HJKPCPTCYCAWY4FPW44XBOKSYIKPILJN76WMIBA";

// Public endpoints (no key needed for Algonode)
const INDEXER_URL = "https://mainnet-idx.algonode.cloud";
const ALGOD_URL   = "https://mainnet-api.algonode.cloud";

// Tinyman pool address for Amina/ALGO v2 (from you)
const POOL_ADDRESSES = [
  "XSKED5VKZZCSYNDWXZJI65JM2HP7HZFJWCOBIMOONKHTK5UVKENBNVDEYM"
];

// Donation assets
const USDC_ASA_ID   = 31566704; // USDC (Algorand mainnet)
const USDC_DECIMALS = 6;

// ===== UI =====
const connectBtn     = document.getElementById("connectBtn");
const refreshBtn     = document.getElementById("refreshBtn");
const totalSwapsEl   = document.getElementById("totalSwaps");
const donationsEl    = document.getElementById("donations");
const toNextEl       = document.getElementById("toNext");
const pctEl          = document.getElementById("pct");
const barEl          = document.getElementById("bar");
const copyAddrBtn    = document.getElementById("copyAddr");
const donateBtn      = document.getElementById("donateBtn");
const donateAmtInput = document.getElementById("donateAmt");
const assetSelect    = document.getElementById("assetSelect");

let pera;
let connectedAccounts = [];

// ===== Helpers =====
function toBase64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

// ===== Wallet Connect =====
function initPera(){
  pera = new peraWalletConnect.PeraWalletConnect();

  pera.reconnectSession()
    .then(accs => {
      if (accs.length) {
        connectedAccounts = accs;
        setConnectedUI(true);
      }
    })
    .catch(()=>{});

  pera.connector?.on("disconnect", () => {
    connectedAccounts = [];
    setConnectedUI(false);
  });
}

async function onConnect(){
  try{
    connectedAccounts = await pera.connect();
    setConnectedUI(true);
  }catch(e){
    console.error(e);
    alert("Wallet connect canceled or failed.");
  }
}

function setConnectedUI(connected){
  if(connected){
    connectBtn.textContent = "Wallet Connected";
    connectBtn.disabled = true;
  }else{
    connectBtn.textContent = "Connect Pera Wallet";
    connectBtn.disabled = false;
  }
}

// ===== Swap Counter (POC) =====
async function fetchSwapCount(limit=5000){
  if(!POOL_ADDRESSES.length){
    return { total: 0, note: "No pool addresses configured yet." };
  }
  let total=0, next=null, pages=0, maxPages=10;
  do{
    const url = new URL(`${INDEXER_URL}/v2/assets/${ASA_ID}/transactions`);
    url.searchParams.set("tx-type","axfer");
    url.searchParams.set("limit","1000");
    if(next) url.searchParams.set("next", next);

    const res = await fetch(url.toString());
    if(!res.ok) throw new Error("Indexer error: "+res.status);
    const data = await res.json();

    for(const tx of (data.transactions || [])){
      const sender = tx.sender;
      const recv = tx["asset-transfer-transaction"]?.receiver;
      if(POOL_ADDRESSES.includes(sender) || POOL_ADDRESSES.includes(recv)){
        total++;
        if(total>=limit) break;
      }
    }
    next = data["next-token"] || null;
    pages++;
    if(total>=limit) break;
  }while(next && pages<maxPages);

  return { total };
}

function updateProgressUI(totalSwaps){
  const donations = Math.floor(totalSwaps/1000)*100;
  const toNext = 1000 - (totalSwaps % 1000 || 0);
  const pct = Math.round(((totalSwaps % 1000)/1000)*100);

  totalSwapsEl.textContent = totalSwaps.toLocaleString();
  donationsEl.textContent = `$${donations.toLocaleString()}`;
  toNextEl.textContent = `${toNext===1000?0:toNext} swaps`;
  pctEl.textContent = `${pct}%`;
  barEl.style.width = `${pct}%`;
}

async function refresh(){
  try{
    refreshBtn.disabled = true;
    const { total } = await fetchSwapCount();
    updateProgressUI(total);
  }catch(e){
    console.error(e);
    alert("Could not fetch swap count. Check pool address config.");
  }finally{
    refreshBtn.disabled = false;
  }
}

// ===== Donate (ALGO or USDC) =====
async function donate(){
  if(!connectedAccounts.length){
    alert("Please connect Pera Wallet first.");
    return;
  }
  const fromAddr = connectedAccounts[0];
  const amt = parseFloat(donateAmtInput.value);
  if(!amt || amt <= 0){
    alert("Enter an amount greater than 0.");
    return;
  }
  const asset = assetSelect.value; // "ALGO" or "USDC"

  try{
    // suggested params
    const paramsRes = await fetch(`${ALGOD_URL}/v2/transactions/params`);
    if(!paramsRes.ok) throw new Error("Algod params error");
    const params = await paramsRes.json();
    const sp = algosdk.SuggestedParams.from_obj_for_encoding(params);

    let txn;
    if(asset === "ALGO"){
      const amountMicro = Math.round(amt * 1e6);
      txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: fromAddr, to: DONATION_ADDRESS, amount: amountMicro,
        note: new TextEncoder().encode("Amina Water Donation (ALGO)"),
        suggestedParams: sp
      });
    }else{
      const amount = Math.round(amt * Math.pow(10, USDC_DECIMALS));
      txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        from: fromAddr, to: DONATION_ADDRESS, assetIndex: USDC_ASA_ID, amount,
        note: new TextEncoder().encode("Amina Water Donation (USDC)"),
        suggestedParams: sp
      });
    }

    const unsignedBytes = algosdk.encodeUnsignedTransaction(txn);
    const encodedB64   = toBase64(unsignedBytes);

    const signed = await pera.signTransaction([{ txn: encodedB64 }]); // returns Uint8Array[]

    const sendRes = await fetch(`${ALGOD_URL}/v2/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/x-binary" },
      body: signed[0] // Uint8Array
    });
    if(!sendRes.ok) throw new Error("Algod send error");
    const result = await sendRes.json();
    alert(`Thank you! TxID: ${result.txId}`);
  }catch(e){
    console.error(e);
    alert("Donation failed. If donating USDC, make sure your wallet is opted-in to USDC (ASA 31566704).");
  }
}

// ===== Utilities =====
async function copyAddr(){
  try{
    const el = document.getElementById("donationAddr");
    await navigator.clipboard.writeText(el.textContent.trim());
    copyAddrBtn.textContent = "Copied!";
    setTimeout(()=>copyAddrBtn.textContent="Copy", 1100);
  }catch{}
}

// ===== Wire up =====
function boot(){
  initPera();
  connectBtn.addEventListener("click", onConnect);
  refreshBtn.addEventListener("click", refresh);
  donateBtn.addEventListener("click", donate);
  copyAddrBtn.addEventListener("click", copyAddr);
  updateProgressUI(0);
}
boot();
