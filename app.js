const DBKEY='ordemtech_data_v1'; // Mantido para preservar os dados já cadastrados no navegador.
const $=s=>document.querySelector(s);
const brl=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const today=()=>new Date().toISOString().slice(0,10);
const uid=()=>Math.random().toString(36).slice(2,9).toUpperCase();
let db=load(), page='dashboard', quoteLines=[];

let cashSession=null,cashMovements=[];
async function loadRemoteCashSales(){
 const branch=currentBranchId();if(!branch)return;
 const {data:session,error}=await window.supabaseClient.from('cash_sessions').select('*').eq('branch_id',branch).eq('status','open').order('opened_at',{ascending:false}).limit(1).maybeSingle();
 if(error){toast('Erro ao consultar caixa: '+error.message);return;}
 cashSession=session||null;cashMovements=[];
 if(cashSession){const r=await window.supabaseClient.from('cash_movements').select('*').eq('cash_session_id',cashSession.id).order('created_at',{ascending:false});if(r.error){toast('Erro ao consultar movimentações: '+r.error.message);return;}cashMovements=r.data||[];}
 const s=await window.supabaseClient.from('sales').select('id,sale_number,total,status,created_at').eq('branch_id',branch).order('created_at',{ascending:false}).limit(100);
 if(s.error){toast('Erro ao consultar vendas: '+s.error.message);return;}
 db.sales=(s.data||[]).map(x=>({id:x.id,number:x.sale_number,total:Number(x.total||0),status:x.status||'',date:(x.created_at||'').slice(0,10)}));
}
function cashExpected(){
 if(!cashSession)return 0;
 return Number(cashSession.opening_amount||0)+cashMovements.reduce((sum,m)=>{
  if(m.authorization_status!=='approved')return sum;
  if(['sale','supply','adjustment'].includes(m.movement_type))return sum+Number(m.amount||0);
  if(m.movement_type==='withdrawal')return sum-Number(m.amount||0);
  return sum;
 },0);
}
function cashPage(){
 const role=window.currentProfile?.role||'';
 const rows=cashMovements.map(m=>'<tr><td>'+dateBR((m.created_at||'').slice(0,10))+'</td><td>'+esc(m.description||'—')+'</td><td>'+esc(({sale:'Dinheiro',pix:'Pix',debit:'Débito',credit:'Crédito',withdrawal:'Sangria',supply:'Reforço',adjustment:'Ajuste'})[m.movement_type]||m.movement_type)+'</td><td>'+brl(m.amount)+'</td><td>'+esc(m.authorization_status||'—')+'</td><td>'+(m.movement_type==='withdrawal'&&m.authorization_status==='pending'&&['admin','manager'].includes(role)?'<button class="small-btn" data-approve="'+m.id+'">Autorizar</button>':'—')+'</td></tr>').join('');
 const top=cashSession?'<div class="stats">'+stat('Saldo inicial',brl(cashSession.opening_amount),'R$')+stat('Saldo esperado',brl(cashExpected()),'R$')+'</div><div class="panel"><button class="secondary" id="withdrawCash">Solicitar sangria</button> <button class="danger" id="closeCash">Fechar caixa</button></div>':'<div class="panel"><p>Nenhum caixa aberto nesta filial.</p><button class="primary" id="openCash">Abrir caixa</button></div>';
 $('#page').innerHTML='<div class="section-title"><div><h2>Controle de caixa</h2><p>Acompanhe abertura, movimentações e fechamento.</p></div></div>'+top+'<div class="table-card"><div class="table-head"><h3>Movimentações do caixa</h3></div>'+table(['Data','Descrição','Tipo','Valor','Situação','Ação'],rows||'<tr><td colspan="6" class="empty">Nenhuma movimentação registrada.</td></tr>')+'</div>';
 const open=$('#openCash');if(open)open.onclick=openCashForm;
 const withdraw=$('#withdrawCash');if(withdraw)withdraw.onclick=withdrawalCashForm;
 const close=$('#closeCash');if(close)close.onclick=closeCashForm;
 document.querySelectorAll('[data-approve]').forEach(b=>b.onclick=()=>approveWithdrawal(b.dataset.approve));
}
function openCashForm(){
 openModal('Abrir caixa','<form id="openCashForm">'+formField('Saldo inicial em dinheiro (R$)','amount','number','0','min="0" step="0.01" required')+'<div class="form-actions"><button type="button" class="secondary" id="cancelCashForm">Cancelar</button><button class="primary">Confirmar abertura</button></div></form>');
 $('#cancelCashForm').onclick=closeModal;
 $('#openCashForm').onsubmit=async e=>{e.preventDefault();const amount=Number(new FormData(e.currentTarget).get('amount'));const {error}=await window.supabaseClient.rpc('open_cash_session',{p_opening_amount:amount});if(error){toast(error.message);return;}await loadRemoteCashSales();closeModal();render();toast('Caixa aberto com sucesso.');};
}
function closeCashForm(){
 openModal('Fechar caixa','<form id="closeCashForm"><p>Saldo esperado pelo sistema: <b>'+brl(cashExpected())+'</b></p>'+formField('Dinheiro contado (R$)','counted','number',cashExpected().toFixed(2),'min="0" step="0.01" required')+'<div class="form-actions"><button type="button" class="secondary" id="cancelCashForm">Cancelar</button><button class="primary">Confirmar fechamento</button></div></form>');
 $('#cancelCashForm').onclick=closeModal;
 $('#closeCashForm').onsubmit=async e=>{e.preventDefault();const amount=Number(new FormData(e.currentTarget).get('counted'));const {data,error}=await window.supabaseClient.rpc('close_cash_session',{p_cash_session_id:cashSession.id,p_counted_amount:amount});if(error){toast(error.message);return;}const result=Array.isArray(data)?data[0]:data;await loadRemoteCashSales();closeModal();render();toast('Caixa fechado. Diferença: '+brl(result?.difference||0));};
}
function withdrawalCashForm(){
 openModal('Solicitar sangria','<form id="withdrawCashForm">'+formField('Valor da retirada (R$)','amount','number','','min="0.01" step="0.01" required')+formField('Motivo','description','text','','required')+'<div class="form-actions"><button type="button" class="secondary" id="cancelCashForm">Cancelar</button><button class="primary">Solicitar autorização</button></div></form>');
 $('#cancelCashForm').onclick=closeModal;
 $('#withdrawCashForm').onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.currentTarget));const {error}=await window.supabaseClient.rpc('request_cash_withdrawal',{p_cash_session_id:cashSession.id,p_amount:Number(f.amount),p_description:f.description});if(error){toast(error.message);return;}await loadRemoteCashSales();closeModal();render();toast('Solicitação enviada para autorização.');};
}
async function approveWithdrawal(id){
 if(!confirm('Autorizar esta sangria?'))return;
 const {error}=await window.supabaseClient.rpc('approve_cash_withdrawal',{p_movement_id:id});
 if(error){toast(error.message);return;}await loadRemoteCashSales();render();toast('Sangria autorizada.');
}

function saleItemOptions(){
 const products=db.products.map(p=>'<option value="product:'+p.id+'">'+esc(p.name)+' · Produto · '+brl(p.price)+' · estoque '+p.stock+'</option>');
 const services=db.services.map(s=>'<option value="service:'+s.id+'">'+esc(s.name)+' · Serviço · '+brl(s.price)+'</option>');
 return '<option value="">Selecione um produto ou serviço</option>'+products.join('')+services.join('');
}
function saleForm(){
 if(!cashSession){toast('Abra o caixa antes de registrar uma venda.');return;}
 if(!db.products.length&&!db.services.length){toast('Cadastre ao menos um produto ou serviço antes de vender.');return;}
 const customers='<option value="">Cliente não identificado</option>'+db.customers.map(c=>'<option value="'+c.id+'">'+esc(c.name)+'</option>').join('');
 const line='<div class="sale-line" data-sale-line><label class="sale-product-field">Produto ou serviço<select class="sale-item" required>'+saleItemOptions()+'</select></label><label class="sale-mini-field">Qtd.<input class="sale-qty" type="number" min="1" step="1" value="1" aria-label="Quantidade"></label><label class="sale-mini-field">Desconto (R$)<input class="sale-discount" type="number" min="0" step=".01" value="0" aria-label="Desconto do item"></label><button type="button" class="small-btn remove-sale-line">Remover</button></div>';
 const paymentLine='<div class="payment-line" data-payment-line><label class="sale-payment-method">Forma de pagamento<select class="payment-method" aria-label="Forma de pagamento"><option value="cash">Dinheiro</option><option value="pix">Pix</option><option value="debit">Cartão de débito</option><option value="credit">Cartão de crédito</option><option value="other">Outro</option></select></label><label class="sale-payment-amount">Valor recebido (R$)<input class="payment-amount" type="number" min="0.01" step=".01" placeholder="0,00" required></label><label class="sale-mini-field">Parcelas<input class="payment-installments" type="number" min="1" step="1" value="1" title="Parcelas no crédito"></label><button type="button" class="small-btn remove-payment-line">Remover</button></div>';
 openModal('Nova venda · PDV','<form id="saleForm" class="sale-pdv"><section class="sale-client-card"><div class="sale-kicker">IDENTIFICAÇÃO</div><label class="sale-wide-field">Cliente<select name="customer_id">'+customers+'</select></label></section><section class="sale-section"><div class="sale-section-head"><div><span class="sale-step">01</span><div><h3>Itens da venda</h3><p>Adicione os produtos e serviços desta compra.</p></div></div><button type="button" class="secondary" id="addSaleLine">＋ Adicionar item</button></div><div id="saleLines" class="sale-lines">'+line+'</div><div class="sale-general-discount"><label>Desconto geral (R$)<input name="general_discount" type="number" min="0" step=".01" value="0"></label></div></section><section class="sale-section"><div class="sale-section-head"><div><span class="sale-step">02</span><div><h3>Pagamento</h3><p>Escolha uma ou mais formas de pagamento.</p></div></div><button type="button" class="secondary" id="addPaymentLine">＋ Adicionar pagamento</button></div><div id="paymentLines" class="sale-lines">'+paymentLine+'</div><label class="sale-notes">Observações<textarea name="notes" rows="2" placeholder="Informações adicionais sobre a venda..."></textarea></label></section><section class="sale-summary-card"><div class="sale-summary-top"><span>RESUMO DA VENDA</span><span class="sale-summary-dot">●</span></div><p id="saleSummary">Subtotal: R$ 0,00 · Descontos: R$ 0,00 · Total: R$ 0,00</p><p id="paymentSummary">Total pago: R$ 0,00 · Pagamento conferido</p><small>Você pode dividir o pagamento entre dinheiro, Pix e cartões. O sistema confere se a soma corresponde ao total da venda.</small></section><div class="form-actions sale-actions"><button type="button" class="secondary" id="cancelSale">Cancelar</button><button class="primary" type="submit">Registrar venda</button></div></form>');
 const form=$('#saleForm'),lines=$('#saleLines'),paymentLines=$('#paymentLines');
 const priceOf=value=>{const [type,id]=String(value||'').split(':');const item=(type==='product'?db.products:db.services).find(x=>x.id===id);return item?Number(item.price||0):0;};
 const calc=()=>{
  let subtotal=0,itemDiscount=0;
  lines.querySelectorAll('[data-sale-line]').forEach(row=>{subtotal+=priceOf(row.querySelector('.sale-item').value)*Number(row.querySelector('.sale-qty').value||0);itemDiscount+=Number(row.querySelector('.sale-discount').value||0);});
  const general=Number(form.elements.general_discount.value||0),total=Math.max(0,subtotal-itemDiscount-general);
  const paid=[...paymentLines.querySelectorAll('.payment-amount')].reduce((sum,input)=>sum+Number(input.value||0),0);
  $('#saleSummary').textContent='Subtotal: '+brl(subtotal)+' · Descontos: '+brl(itemDiscount+general)+' · Total: '+brl(total);
  $('#paymentSummary').textContent='Total pago: '+brl(paid)+' · '+(Math.abs(paid-total)<0.005?'Pagamento conferido':'Falta/passa: '+brl(Math.abs(total-paid)));
  return {subtotal,itemDiscount,general,total,paid};
 };
 form.addEventListener('input',calc);form.addEventListener('change',calc);
 $('#addSaleLine').onclick=()=>{lines.insertAdjacentHTML('beforeend',line);calc();};
 $('#addPaymentLine').onclick=()=>{paymentLines.insertAdjacentHTML('beforeend',paymentLine);calc();};
 form.addEventListener('click',e=>{
  const removeItem=e.target.closest('.remove-sale-line');
  if(removeItem){if(lines.querySelectorAll('[data-sale-line]').length===1){toast('A venda precisa ter ao menos um item.');return;}removeItem.closest('[data-sale-line]').remove();calc();}
  const removePayment=e.target.closest('.remove-payment-line');
  if(removePayment){if(paymentLines.querySelectorAll('[data-payment-line]').length===1){toast('Mantenha ao menos uma forma de pagamento.');return;}removePayment.closest('[data-payment-line]').remove();calc();}
 });
 $('#cancelSale').onclick=closeModal;calc();
 form.onsubmit=async e=>{
  e.preventDefault();const items=[];
  for(const row of lines.querySelectorAll('[data-sale-line]')){
   const value=row.querySelector('.sale-item').value,[type,id]=String(value||'').split(':');
   const qty=Number(row.querySelector('.sale-qty').value),discount=Number(row.querySelector('.sale-discount').value||0);
   if(!id||!['product','service'].includes(type)||!Number.isInteger(qty)||qty<1){toast('Confira os itens e as quantidades.');return;}
   const gross=priceOf(value)*qty;if(discount<0||discount>gross){toast('Há desconto inválido em um item.');return;}
   items.push({product_id:type==='product'?id:null,service_id:type==='service'?id:null,quantity:qty,discount_amount:discount});
  }
  const totals=calc();
  if(totals.general<0||totals.general>totals.subtotal-totals.itemDiscount){toast('Desconto geral inválido.');return;}
  const payments=[];
  for(const row of paymentLines.querySelectorAll('[data-payment-line]')){
   const method=row.querySelector('.payment-method').value,amount=Number(row.querySelector('.payment-amount').value),installments=Number(row.querySelector('.payment-installments').value||1);
   if(!['cash','pix','debit','credit','other'].includes(method)||!Number.isFinite(amount)||amount<=0||!Number.isInteger(installments)||installments<1){toast('Confira os valores e as formas de pagamento.');return;}
   payments.push({payment_method:method,amount:Number(amount.toFixed(2)),installments:method==='credit'?installments:1,notes:null});
  }
  if(totals.total>0&&Math.abs(totals.paid-totals.total)>=0.005){toast('A soma dos pagamentos precisa ser igual ao total da venda.');return;}
  if(totals.total===0&&totals.paid>0){toast('Uma venda com total zero não pode ter pagamento.');return;}
  const fd=new FormData(form);
  const payload={p_cash_session_id:cashSession.id,p_items:items,p_payments:totals.total>0?payments:[],p_general_discount:totals.general,p_customer_id:fd.get('customer_id')||null,p_notes:fd.get('notes')||null};
  const button=form.querySelector('button[type="submit"]');button.disabled=true;button.textContent='Registrando...';
  const {data,error}=await window.supabaseClient.rpc('create_sale',payload);
  if(error){button.disabled=false;button.textContent='Registrar venda';toast('Não foi possível registrar: '+error.message);return;}
  await loadRemoteCashSales();closeModal();render();const result=Array.isArray(data)?data[0]:data;toast('Venda nº '+(result?.sale_number||'')+' registrada com sucesso.');
 };
}
function salesPage(){
 const rows=db.sales.map(s=>'<tr><td>'+esc(s.number||'—')+'</td><td>'+dateBR(s.date)+'</td><td>'+brl(s.total)+'</td><td>'+esc(s.status||'—')+'</td></tr>').join('');
 $('#page').innerHTML='<div class="section-title"><div><h2>Vendas · PDV</h2><p>Histórico de vendas registradas.</p></div><button class="primary" id="newSale" '+(cashSession?'':'disabled')+'>＋ Nova venda</button></div><div class="panel"><p>'+(cashSession?'Caixa aberto. Você já pode registrar vendas.':'Para realizar vendas, primeiro abra o caixa.')+'</p><button class="secondary" id="goCash">Ir para o caixa</button></div><div class="table-card">'+table(['Nº venda','Data','Total','Status'],rows||'<tr><td colspan="4" class="empty">Nenhuma venda registrada.</td></tr>')+'</div>';
 $('#goCash').onclick=()=>setPage('cash');
 const newSale=$('#newSale');if(newSale)newSale.onclick=saleForm;
}

function load(){try{return JSON.parse(localStorage.getItem(DBKEY))||{products:[],services:[],customers:[],quotes:[],sales:[]}}catch{return {products:[],services:[],customers:[],quotes:[],sales:[]}}}
function save(){
  // Guarda uma cópia dos dados antigos antes da primeira gravação após a integração.
  const legacy=localStorage.getItem(DBKEY);
  const backupKey=DBKEY+'_backup_before_supabase';
  if(legacy && !localStorage.getItem(backupKey)) localStorage.setItem(backupKey,legacy);
  localStorage.setItem(DBKEY,JSON.stringify(db));
}
function currentBranchId(){return window.currentProfile?.branch_id||null}
function mapProductFromSupabase(p){return {id:p.id,name:p.name,sku:p.sku||'',category:p.category||'',supplier:p.supplier||'',cost:Number(p.cost_price||0),price:Number(p.sale_price||0),stock:Number(p.stock||0),min:Number(p.minimum_stock||0),warranty:p.warranty||'',description:p.description||''}}
function mapProductToSupabase(p){return {branch_id:currentBranchId(),name:p.name,sku:p.sku||null,category:p.category||null,supplier:p.supplier||null,cost_price:Number(p.cost||0),sale_price:Number(p.price||0),stock:Number(p.stock||0),minimum_stock:Number(p.min||0),warranty:p.warranty||null,description:p.description||null,active:true}}
async function loadRemoteProducts(){
  const branchId=currentBranchId();
  if(!branchId)return;
  const {data,error}=await window.supabaseClient.from('products').select('*').eq('branch_id',branchId).eq('active',true).order('created_at',{ascending:false});
  if(error){toast('Não foi possível carregar os produtos do Supabase: '+error.message);return;}
  db.products=(data||[]).map(mapProductFromSupabase);
}
function mapServiceFromSupabase(s){return {id:s.id,name:s.name,category:s.category||'',cost:Number(s.cost_price||0),price:Number(s.sale_price||0),time:s.time||'',warranty:s.warranty||'',description:s.description||''}}
function mapServiceToSupabase(s){return {branch_id:currentBranchId(),name:s.name,category:s.category||null,description:s.description||null,cost_price:Number(s.cost||0),sale_price:Number(s.price||0),time:s.time||null,warranty:s.warranty||null,active:true}}
async function loadRemoteServices(){
  const branchId=currentBranchId();
  if(!branchId)return;
  const {data,error}=await window.supabaseClient.from('services').select('*').eq('branch_id',branchId).eq('active',true).order('created_at',{ascending:false});
  if(error){toast('Não foi possível carregar os serviços do Supabase: '+error.message);return;}
  db.services=(data||[]).map(mapServiceFromSupabase);
}
function mapCustomerFromSupabase(c){return {id:c.id,name:c.name,phone:c.phone||'',email:c.email||'',cpf:c.document||'',birth:c.birth||'',address:c.address||'',notes:c.notes||'',created:(c.created_at||'').slice(0,10)}}
function mapCustomerToSupabase(c){return {branch_id:currentBranchId(),name:c.name,phone:c.phone||null,email:c.email||null,document:c.cpf||null,birth:c.birth||null,address:c.address||null,notes:c.notes||null}}
async function loadRemoteCustomers(){
  const branchId=currentBranchId();
  if(!branchId)return;
  const {data,error}=await window.supabaseClient.from('customers').select('*').eq('branch_id',branchId).order('created_at',{ascending:false});
  if(error){toast('Não foi possível carregar os clientes do Supabase: '+error.message);return;}
  db.customers=(data||[]).map(mapCustomerFromSupabase);
}

function quoteMetaFromNotes(notes){
  try{const value=JSON.parse(notes||'{}');if(value&&value.__nandos_quote_v1)return value;return {notes:notes||''}}catch{return {notes:notes||''}}
}
function mapQuoteFromSupabase(q,items=[]){
  const meta=quoteMetaFromNotes(q.notes);
  const customer=db.customers.find(c=>c.id===q.customer_id)||{};
  const lines=items.map(item=>{
    const product=item.product_id?db.products.find(p=>p.id===item.product_id):null;
    const service=item.service_id?db.services.find(s=>s.id===item.service_id):null;
    const type=item.product_id?'Peça':'Serviço';
    return {id:item.id,ref:item.product_id?'p:'+item.product_id:item.service_id?'s:'+item.service_id:'',type,name:item.description||product?.name||service?.name||'Item',qty:Number(item.quantity||0),price:Number(item.unit_price||0)};
  });
  return {id:q.id,number:meta.number||('ORC-'+String(q.id).slice(0,8).toUpperCase()),date:(q.created_at||'').slice(0,10),validity:q.valid_until||'',customerId:q.customer_id,customerName:customer.name||'Cliente',phone:customer.phone||'',email:customer.email||'',device:meta.device||'',imei:meta.imei||'',issue:meta.issue||'',warranty:meta.warranty||'',lines,subtotal:Number(q.subtotal||0),discount:Number(q.discount||0),total:Number(q.total||0),deadline:meta.deadline||'A combinar',notes:meta.notes||'',status:q.status||'Aguardando aprovação'};
}
async function loadRemoteQuotes(){
  const branchId=currentBranchId();
  if(!branchId)return;
  const {data:quotes,error}=await window.supabaseClient.from('quotes').select('*').eq('branch_id',branchId).order('created_at',{ascending:false});
  if(error){toast('Não foi possível carregar os orçamentos: '+error.message);return;}
  if(!quotes?.length){db.quotes=[];return;}
  const ids=quotes.map(q=>q.id);
  const {data:items,error:itemError}=await window.supabaseClient.from('quote_items').select('*').in('quote_id',ids);
  if(itemError){toast('Não foi possível carregar os itens dos orçamentos: '+itemError.message);return;}
  const grouped={};
  (items||[]).forEach(item=>(grouped[item.quote_id]??=[]).push(item));
  db.quotes=quotes.map(q=>mapQuoteFromSupabase(q,grouped[q.id]||[]));
}
function toast(t){const el=$('#toast');el.textContent=t;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2500)}
function dateBR(d){return d?new Date(d+'T12:00:00').toLocaleDateString('pt-BR'):'—'}
function setPage(p){page=p;document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===p));$('#pageTitle').textContent=({dashboard:'Visão geral',products:'Produtos e peças',services:'Serviços',customers:'Clientes',quotes:'Orçamentos',cash:'Caixa',sales:'Vendas · PDV'})[p]||'Visão geral';render()}
function render(){({dashboard:dashboard,products:productsPage,services:servicesPage,customers:customersPage,quotes:quotesPage,cash:cashPage,sales:salesPage}[page]||dashboard)()}
function stat(label,value,icon,sub=''){return `<div class="stat"><div class="stat-top"><span>${label}</span><span class="stat-icon">${icon}</span></div><strong>${value}</strong><small>${sub}</small></div>`}
function dashboard(){
 const month=today().slice(0,7);
 const sales=db.sales.filter(s=>s.date?.startsWith(month));
 const revenue=sales.reduce((a,s)=>a+s.total,0);
 const low=db.products.filter(p=>Number(p.stock)<=Number(p.min||0));
 const pending=db.quotes.filter(q=>['Enviado','Aguardando aprovação'].includes(q.status)).length;
 const bars=Array.from({length:7},(_,i)=>{let d=new Date();d.setDate(d.getDate()-(6-i));let key=d.toISOString().slice(0,10);return {label:d.toLocaleDateString('pt-BR',{weekday:'short'}).slice(0,3),v:db.sales.filter(s=>s.date===key).reduce((a,s)=>a+s.total,0)}});
 let max=Math.max(1,...bars.map(x=>x.v));
 $('#page').innerHTML=`<div class="welcome"><div><h2>Bem-vindo à Nandos Tech</h2><p>Acompanhe os principais números da sua operação.</p></div><span class="pill green">Sistema ativo</span></div>
 <div class="stats">${stat('Faturamento registrado no mês',brl(revenue),'↗','Somente vendas registradas')}${stat('Produtos cadastrados',db.products.length,'▣','Itens no catálogo')}${stat('Clientes cadastrados',db.customers.length,'♙','Base de relacionamento')}${stat('Orçamentos pendentes',pending,'▤','Aguardando retorno do cliente')}</div>
 <div class="grid-2"><div class="panel"><h3>Vendas registradas · últimos 7 dias</h3><div class="chart-bars">${bars.map(b=>`<div class="bar-col"><div class="bar" title="${brl(b.v)}" style="height:${Math.max(3,b.v/max*145)}px"></div><small>${b.label}</small></div>`).join('')}</div><p class="muted" style="font-size:11px;margin:12px 0 0">O gráfico considera vendas lançadas no módulo de vendas. A inclusão de vendas será ampliada nas próximas etapas.</p></div>
 <div class="panel"><h3>Pontos de atenção</h3>${low.length?`<p><span class="pill orange">${low.length} item(ns) com estoque baixo</span></p><ul>${low.slice(0,5).map(p=>`<li style="font-size:12px;margin:10px 0">${esc(p.name)} — ${p.stock} un.</li>`).join('')}</ul>`:'<div class="empty">Nenhum alerta de estoque no momento.</div>'}<hr style="border:0;border-top:1px solid var(--line);margin:17px 0"><p style="font-size:12px;color:var(--muted)">Orçamentos cadastrados: <b>${db.quotes.length}</b></p><p style="font-size:12px;color:var(--muted)">Serviços cadastrados: <b>${db.services.length}</b></p></div></div>
 <div class="table-card"><div class="table-head"><h3>Orçamentos recentes</h3><button class="secondary" onclick="setPage('quotes')">Ver todos</button></div>${quoteTable(db.quotes.slice().reverse().slice(0,5))}</div>`;
}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function table(headers,rows){return `<table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows||''}</tbody></table>`}
function productsPage(){const rows=db.products.map(p=>`<tr><td><b>${esc(p.name)}</b><br><small class="muted">${esc(p.category||'')}</small></td><td>${esc(p.sku||'—')}</td><td>${brl(p.cost)}</td><td class="money">${brl(p.price)}</td><td>${p.stock}</td><td>${esc(p.warranty||'—')}</td><td><span class="pill ${Number(p.stock)<=Number(p.min||0)?'orange':'green'}">${Number(p.stock)<=Number(p.min||0)?'Estoque baixo':'Disponível'}</span></td><td><button class="small-btn" onclick="editItem('products','${p.id}')">Editar</button><button class="small-btn danger" onclick="deleteItem('products','${p.id}')">Excluir</button></td></tr>`).join('');$('#page').innerHTML=`<div class="section-title"><div><h2>Produtos e peças</h2><p>Cadastre custos, preços de venda e controle de estoque.</p></div><button class="primary" onclick="productForm()">＋ Novo produto</button></div><div class="table-card"><div class="table-head"><h3>Catálogo (${db.products.length})</h3><input class="search" placeholder="Buscar produto..." oninput="filterTable(this)"></div><div id="tableWrap">${table(['Produto','Código','Custo','Venda','Estoque','Garantia','Situação','Ações'],rows||'<tr><td colspan="8" class="empty">Nenhum produto cadastrado.</td></tr>')}</div></div>`}
function servicesPage(){const rows=db.services.map(s=>`<tr><td><b>${esc(s.name)}</b><br><small class="muted">${esc(s.category||'')}</small></td><td>${brl(s.cost)}</td><td class="money">${brl(s.price)}</td><td>${Number(s.price)-Number(s.cost)>=0?brl(Number(s.price)-Number(s.cost)):brl(0)}</td><td>${esc(s.warranty||'—')}</td><td><button class="small-btn" onclick="editItem('services','${s.id}')">Editar</button><button class="small-btn danger" onclick="deleteItem('services','${s.id}')">Excluir</button></td></tr>`).join('');$('#page').innerHTML=`<div class="section-title"><div><h2>Serviços</h2><p>Defina preço de venda e custo estimado de cada serviço.</p></div><button class="primary" onclick="serviceForm()">＋ Novo serviço</button></div><div class="table-card"><div class="table-head"><h3>Serviços cadastrados (${db.services.length})</h3><input class="search" placeholder="Buscar serviço..." oninput="filterTable(this)"></div><div id="tableWrap">${table(['Serviço','Custo estimado','Preço de venda','Lucro bruto','Garantia','Ações'],rows||'<tr><td colspan="6" class="empty">Nenhum serviço cadastrado.</td></tr>')}</div></div>`}
function customersPage(){const rows=db.customers.map(c=>`<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.phone||'—')}</td><td>${esc(c.email||'—')}</td><td>${dateBR(c.created)}</td><td><button class="small-btn" onclick="editItem('customers','${c.id}')">Editar</button><button class="small-btn danger" onclick="deleteItem('customers','${c.id}')">Excluir</button></td></tr>`).join('');$('#page').innerHTML=`<div class="section-title"><div><h2>Clientes</h2><p>Organize os contatos e construa o histórico de relacionamento.</p></div><button class="primary" onclick="customerForm()">＋ Novo cliente</button></div><div class="table-card"><div class="table-head"><h3>Base de clientes (${db.customers.length})</h3><input class="search" placeholder="Buscar cliente..." oninput="filterTable(this)"></div><div id="tableWrap">${table(['Nome','Telefone','E-mail','Cadastro','Ações'],rows||'<tr><td colspan="5" class="empty">Nenhum cliente cadastrado.</td></tr>')}</div></div>`}
function quoteTable(list){const rows=list.map(q=>`<tr><td><b>${q.number}</b></td><td>${esc(q.customerName)}</td><td>${dateBR(q.date)}</td><td class="money">${brl(q.total)}</td><td><span class="pill ${q.status==='Aprovado'?'green':q.status==='Recusado'?'red':'orange'}">${q.status}</span></td><td><div class="actions"><button class="small-btn" onclick="viewQuote('${q.id}')">Visualizar</button><button class="small-btn" onclick="printQuote('${q.id}')">PDF / Imprimir</button><button class="small-btn" onclick="shareQuote('${q.id}')">WhatsApp</button></div></td></tr>`).join('');return table(['Nº','Cliente','Data','Total','Status','Ações'],rows||'<tr><td colspan="6" class="empty">Nenhum orçamento cadastrado.</td></tr>')}
function viewQuote(id){
  const q=db.quotes.find(item=>item.id===id);
  if(!q)return;
  const lines=(q.lines||[]).map(line=>`<tr><td>${esc(line.name||'Item')}<br><small class="muted">${esc(line.type||'')}</small></td><td>${Number(line.qty||0)}</td><td>${brl(line.price)}</td><td class="money">${brl(Number(line.qty||0)*Number(line.price||0))}</td></tr>`).join('');
  openModal('Visualizar orçamento',`<div class="quote-preview">
    <div class="table-head"><div><h2 style="margin:0">${esc(q.number)}</h2><p class="muted" style="margin:4px 0">Orçamento · ${dateBR(q.date)}</p></div><span class="pill ${q.status==='Aprovado'?'green':q.status==='Recusado'?'red':'orange'}">${esc(q.status)}</span></div>
    <div class="box"><h3>Cliente e aparelho</h3><p><b>Cliente:</b> ${esc(q.customerName)}</p><p><b>Telefone:</b> ${esc(q.phone||'—')}</p><p><b>Aparelho:</b> ${esc(q.device||'Não informado')}</p><p><b>IMEI / Série:</b> ${esc(q.imei||'Não informado')}</p><p><b>Defeito relatado:</b> ${esc(q.issue||'Não informado')}</p><p><b>Validade:</b> ${dateBR(q.validity)}</p></div>
    <h3>Itens do orçamento</h3>
    <div class="table-card">${table(['Descrição','Qtd.','Valor unitário','Total'],lines||'<tr><td colspan="4">Nenhum item informado.</td></tr>')}</div>
    <div class="box"><p><b>Subtotal:</b> ${brl(q.subtotal)}</p><p><b>Desconto:</b> ${brl(q.discount)}</p><p style="font-size:18px"><b>Total: ${brl(q.total)}</b></p></div>
    <div class="box"><h3>Prazo, garantia e observações</h3><p><b>Prazo estimado:</b> ${esc(q.deadline||'A combinar')}</p><p><b>Garantia oferecida:</b> ${esc(q.warranty||'Não informada')}</p><p><b>Observações:</b> ${esc(q.notes||'Nenhuma')}</p></div>
    <div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">Fechar</button><button type="button" class="secondary" onclick="closeModal();printQuote('${q.id}')">PDF / Imprimir</button><button type="button" class="primary" onclick="closeModal();shareQuote('${q.id}')">WhatsApp</button></div>
  </div>`);
}
function quotesPage(){$('#page').innerHTML=`<div class="section-title"><div><h2>Orçamentos</h2><p>Monte propostas, gere documentos e acompanhe a aprovação.</p></div><button class="primary" onclick="quoteForm()">＋ Novo orçamento</button></div><div class="table-card"><div class="table-head"><h3>Todos os orçamentos (${db.quotes.length})</h3><input class="search" placeholder="Buscar número ou cliente..." oninput="filterTable(this)"></div><div id="tableWrap">${quoteTable(db.quotes.slice().reverse())}</div></div>`}
function filterTable(input){let q=input.value.toLowerCase();document.querySelectorAll('#tableWrap tbody tr').forEach(r=>r.style.display=r.innerText.toLowerCase().includes(q)?'':'none')}
function openModal(title,html){$('#modalTitle').textContent=title;$('#modalBody').innerHTML=html;$('#modal').showModal()}
function closeModal(){$('#modal').close()}
function formField(label,name,type='text',value='',extra=''){return `<div class="field"><label>${label}</label><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`}
function productForm(p={}){openModal(p.id?'Editar produto':'Novo produto',`<form id="itemForm" class="form-grid">${formField('Nome do produto *','name','text',p.name||'','required')}${formField('Código / SKU','sku','text',p.sku||'')}${formField('Categoria','category','text',p.category||'')}${formField('Fornecedor','supplier','text',p.supplier||'')}${formField('Preço de custo (R$) *','cost','number',p.cost??'','step="0.01" min="0" required')}${formField('Preço de venda (R$) *','price','number',p.price??'','step="0.01" min="0" required')}${formField('Quantidade em estoque','stock','number',p.stock??0,'min="0"')}${formField('Estoque mínimo','min','number',p.min??0,'min="0"')}${formField('Garantia do produto','warranty','text',p.warranty||'','placeholder="Ex.: 90 dias, 1 ano ou sem garantia"')}<div class="field full"><label>Descrição / compatibilidade</label><textarea name="description">${esc(p.description||'')}</textarea></div><div class="field full form-actions"><button type="button" class="secondary" onclick="closeModal()">Cancelar</button><button class="primary">Salvar produto</button></div></form>`);$('#itemForm').onsubmit=async e=>{e.preventDefault();let d=Object.fromEntries(new FormData(e.target));['cost','price','stock','min'].forEach(k=>d[k]=Number(d[k]||0));const button=e.target.querySelector('button.primary');button.disabled=true;try{const payload=mapProductToSupabase(d);let result;if(p.id){result=await window.supabaseClient.from('products').update(payload).eq('id',p.id).eq('branch_id',currentBranchId()).select().single()}else{result=await window.supabaseClient.from('products').insert(payload).select().single()}if(result.error)throw result.error;const saved=mapProductFromSupabase(result.data);if(p.id)db.products=db.products.map(x=>x.id===p.id?saved:x);else db.products.unshift(saved);closeModal();render();toast('Produto salvo no Supabase com sucesso.')}catch(error){button.disabled=false;toast('Erro ao salvar produto: '+(error.message||'verifique sua permissão.'))}}}
function serviceForm(s={}){openModal(s.id?'Editar serviço':'Novo serviço',`<form id="itemForm" class="form-grid">${formField('Nome do serviço *','name','text',s.name||'','required')}${formField('Categoria','category','text',s.category||'')}${formField('Custo estimado (R$)','cost','number',s.cost??0,'step="0.01" min="0"')}${formField('Preço de venda (R$) *','price','number',s.price??'','step="0.01" min="0" required')}${formField('Tempo médio','time','text',s.time||'')}${formField('Garantia','warranty','text',s.warranty||'') }<div class="field full"><label>Descrição</label><textarea name="description">${esc(s.description||'')}</textarea></div><div class="field full form-actions"><button type="button" class="secondary" onclick="closeModal()">Cancelar</button><button class="primary">Salvar serviço</button></div></form>`);$('#itemForm').onsubmit=async e=>{e.preventDefault();let d=Object.fromEntries(new FormData(e.target));d.cost=Number(d.cost||0);d.price=Number(d.price||0);const button=e.target.querySelector('button.primary');button.disabled=true;try{const payload=mapServiceToSupabase(d);let result;if(s.id){result=await window.supabaseClient.from('services').update(payload).eq('id',s.id).eq('branch_id',currentBranchId()).select().single()}else{result=await window.supabaseClient.from('services').insert(payload).select().single()}if(result.error)throw result.error;const saved=mapServiceFromSupabase(result.data);if(s.id)db.services=db.services.map(x=>x.id===s.id?saved:x);else db.services.unshift(saved);closeModal();render();toast('Serviço salvo no Supabase com sucesso.')}catch(error){button.disabled=false;toast('Erro ao salvar serviço: '+(error.message||'verifique sua permissão.'))}}}
function customerForm(c={}){openModal(c.id?'Editar cliente':'Novo cliente',`<form id="itemForm" class="form-grid">${formField('Nome completo *','name','text',c.name||'','required')}${formField('Telefone / WhatsApp *','phone','tel',c.phone||'','required')}${formField('E-mail','email','email',c.email||'')}${formField('CPF','cpf','text',c.cpf||'')}${formField('Data de nascimento','birth','date',c.birth||'')}<div class="field full"><label>Endereço / observações</label><textarea name="notes">${esc(c.notes||'')}</textarea></div><div class="field full form-actions"><button type="button" class="secondary" onclick="closeModal()">Cancelar</button><button class="primary">Salvar cliente</button></div></form>`);$('#itemForm').onsubmit=async e=>{e.preventDefault();let d=Object.fromEntries(new FormData(e.target));const button=e.target.querySelector('button.primary');button.disabled=true;try{const payload=mapCustomerToSupabase(d);let result;if(c.id){result=await window.supabaseClient.from('customers').update(payload).eq('id',c.id).eq('branch_id',currentBranchId()).select().single()}else{result=await window.supabaseClient.from('customers').insert(payload).select().single()}if(result.error)throw result.error;const saved=mapCustomerFromSupabase(result.data);if(c.id)db.customers=db.customers.map(x=>x.id===c.id?saved:x);else db.customers.unshift(saved);closeModal();render();toast('Cliente salvo no Supabase com sucesso.')}catch(error){button.disabled=false;toast('Erro ao salvar cliente: '+(error.message||'verifique sua permissão.'))}}}
async function deleteItem(type,id){const labels={products:'produto',services:'serviço',customers:'cliente'};const item=db[type].find(x=>x.id===id);if(!item)return;const label=labels[type]||'registro';if(!confirm(`Tem certeza de que deseja excluir o ${label} "${item.name}"?`))return;if(type==='products'){const {error}=await window.supabaseClient.from('products').delete().eq('id',id).eq('branch_id',currentBranchId());if(error){toast('Não foi possível excluir: '+error.message);return}}db[type]=db[type].filter(x=>x.id!==id);if(type!=='products')save();render();toast(`${label[0].toUpperCase()+label.slice(1)} excluído com sucesso.`)}
function editItem(type,id){let item=db[type].find(x=>x.id===id);({products:productForm,services:serviceForm,customers:customerForm}[type])(item)}
function quoteForm(){
  quoteLines=[];
  let customerOptions=db.customers.map(c=>`<option value="${c.id}">${esc(c.name)} · ${esc(c.phone)}</option>`).join('');
  openModal('Novo orçamento',`<form id="quoteForm"><div class="form-grid"><div class="field"><label>Cliente *</label><select name="customer" required><option value="">Selecione um cliente</option>${customerOptions}</select></div><div class="field"><label>Validade do orçamento</label><input name="validity" type="date" value="${today()}"></div>${formField('Marca e modelo do aparelho','device')}${formField('IMEI / número de série','imei')}<div class="field full"><label>Defeito relatado</label><textarea name="issue"></textarea></div>${formField('Garantia oferecida neste orçamento','warranty','text','','placeholder="Ex.: 90 dias para o serviço realizado"')}</div><div class="quote-lines"><b style="font-size:12px">Itens do orçamento</b><div id="quoteLineWrap"></div><button type="button" class="secondary" style="margin-top:8px" onclick="addQuoteLine()">＋ Adicionar peça ou serviço</button></div><div class="form-grid" style="margin-top:14px">${formField('Desconto (R$)','discount','number',0,'min="0" step="0.01"')}${formField('Prazo estimado','deadline','text','A combinar')}<div class="field full"><label>Observações e condições</label><textarea name="notes"></textarea></div></div><div class="quote-total">Total do orçamento: <strong id="quoteTotal">${brl(0)}</strong></div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">Cancelar</button><button class="primary">Salvar orçamento</button></div></form>`);
  addQuoteLine();
  $('#quoteForm').onsubmit=async e=>{
    e.preventDefault();
    const form=e.currentTarget;
    const f=Object.fromEntries(new FormData(form));
    const customer=db.customers.find(c=>c.id===f.customer);
    if(!customer){toast('Cadastre ou selecione um cliente.');return}
    if(!quoteLines.length||quoteLines.some(l=>!l.ref)){toast('Selecione um produto ou serviço para cada item.');return}
    const lines=quoteLines.map(l=>({...l}));
    const subtotal=lines.reduce((a,l)=>a+l.qty*l.price,0);
    const discount=Math.max(0,Number(f.discount||0));
    if(discount>subtotal){toast('O desconto não pode ser maior que o subtotal.');return}
    const total=Math.max(0,subtotal-discount);
    const number='ORC-'+Date.now().toString().slice(-6);
    const metadata={__nandos_quote_v1:true,number,device:f.device||'',imei:f.imei||'',issue:f.issue||'',warranty:f.warranty||'',deadline:f.deadline||'A combinar',notes:f.notes||''};
    const payload={branch_id:currentBranchId(),customer_id:customer.id,created_by:window.currentProfile?.id,status:'Aguardando aprovação',subtotal,discount,total,notes:JSON.stringify(metadata),valid_until:f.validity||null};
    const button=form.querySelector('button.primary');
    button.disabled=true;
    try{
      const {data:quote,error}=await window.supabaseClient.from('quotes').insert(payload).select().single();
      if(error)throw error;
      const items=lines.map(line=>{
        const isProduct=line.ref.startsWith('p:');
        const refId=line.ref.slice(2);
        return {quote_id:quote.id,product_id:isProduct?refId:null,service_id:isProduct?null:refId,description:line.name,quantity:Number(line.qty),unit_price:Number(line.price),total:Number(line.qty)*Number(line.price)};
      });
      const {error:itemError}=await window.supabaseClient.from('quote_items').insert(items);
      if(itemError){
        await window.supabaseClient.from('quotes').delete().eq('id',quote.id).eq('branch_id',currentBranchId());
        throw itemError;
      }
      const saved=mapQuoteFromSupabase(quote,items.map((item,i)=>({...item,id:'item-'+i})));
      db.quotes.unshift(saved);
      closeModal();render();toast('Orçamento e itens salvos no Supabase com sucesso.');
    }catch(error){
      button.disabled=false;
      toast('Erro ao salvar orçamento: '+(error.message||'verifique as permissões.'));
    }
  };
}
function addQuoteLine(){quoteLines.push({type:'product',ref:'',name:'',qty:1,price:0});drawQuoteLines()}
function drawQuoteLines(){let wrap=$('#quoteLineWrap');if(!wrap)return;wrap.innerHTML=quoteLines.map((l,i)=>`<div class="quote-line"><select onchange="setLine(${i},'ref',this.value)"><option value="">Selecione item</option><optgroup label="Produtos">${db.products.map(p=>`<option value="p:${p.id}" ${l.ref==='p:'+p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</optgroup><optgroup label="Serviços">${db.services.map(s=>`<option value="s:${s.id}" ${l.ref==='s:'+s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</optgroup></select><input type="number" min="1" value="${l.qty}" onchange="setLine(${i},'qty',this.value)" title="Quantidade"><input type="number" min="0" step=".01" value="${l.price}" onchange="setLine(${i},'price',this.value)" title="Preço unitário"><button type="button" class="small-btn" onclick="removeLine(${i})">×</button></div>`).join('');updateQuoteTotal()}
function setLine(i,k,v){let l=quoteLines[i];if(k==='ref'){l.ref=v;if(v){let [t,id]=v.split(':');let item=(t==='p'?db.products:db.services).find(x=>x.id===id);l.name=item.name;l.price=Number(item.price);l.type=t==='p'?'Peça':'Serviço'}}else l[k]=Number(v||0);drawQuoteLines()}
function removeLine(i){quoteLines.splice(i,1);drawQuoteLines()}
function updateQuoteTotal(){let subtotal=quoteLines.reduce((a,l)=>a+l.qty*l.price,0),discount=Number($('#quoteForm [name=discount]')?.value||0);let el=$('#quoteTotal');if(el)el.textContent=brl(Math.max(0,subtotal-discount))}
function printQuote(id){let q=db.quotes.find(x=>x.id===id);if(!q)return;let w=window.open('','_blank');if(!w){toast('Permita pop-ups para gerar o orçamento.');return}const logo=new URL('./Captura%20de%20Tela%202026-11-25%20a%CC%80s%2020.02.40.png',location.href).href;w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${q.number} - Nandos Tech</title><style>*{box-sizing:border-box}body{font:13px Arial,sans-serif;color:#202938;padding:28px;max-width:850px;margin:auto;line-height:1.45}.head{display:flex;align-items:center;gap:16px;border-bottom:3px solid #17243a;padding-bottom:16px}.logo{width:82px;height:82px;object-fit:contain}.company h1{font-size:23px;margin:0;color:#17243a}.company p{margin:3px 0;color:#596579;font-size:11px}.doc-title{margin:22px 0 12px;display:flex;justify-content:space-between;align-items:center}.doc-title h2{font-size:17px;margin:0}.number{font-weight:bold;color:#2459d6}.box{border:1px solid #d9dee7;padding:13px 15px;border-radius:7px;margin:12px 0}.box h3{font-size:12px;text-transform:uppercase;letter-spacing:.5px;margin:0 0 8px;color:#34445d}.grid{display:grid;grid-template-columns:1fr 1fr;gap:7px 20px}.grid p{margin:0}.muted{color:#647084}table{width:100%;border-collapse:collapse;margin-top:16px}th{background:#f0f3f8;color:#34445d}td,th{padding:10px;border:1px solid #dce1e9;text-align:left;font-size:12px}.right{text-align:right}.totals{margin:14px 0 0 auto;width:260px}.totals p{display:flex;justify-content:space-between;margin:5px 0}.grand{font-size:18px;font-weight:bold;border-top:2px solid #17243a;padding-top:9px}.terms{font-size:10.5px;color:#414b5b}.terms h3{font-size:12px;color:#17243a;margin:0 0 6px}.terms ol{padding-left:18px;margin:5px 0}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:42px;text-align:center;font-size:11px}.signatures div{border-top:1px solid #555;padding-top:7px}.foot{border-top:1px solid #dce1e9;margin-top:24px;padding-top:10px;font-size:10px;color:#697386;text-align:center}@media print{body{padding:0}@page{size:A4;margin:14mm}}
</style></head><body><header class="head"><img class="logo" src="${logo}" alt="Logo Nandos Tech"><div class="company"><h1>NANDOS TECH</h1><p>Assistência técnica e acessórios</p><p>CNPJ: 66.687.706/0001-81</p><p>Telefone/WhatsApp: (92) 98152-0399</p><p>Endereço: Rua Joelma Aguiar - União, Coari - AM, CEP 69460-000</p></div></header><div class="doc-title"><h2>ORÇAMENTO DE SERVIÇOS E PRODUTOS</h2><span class="number">${q.number}</span></div><p><b>Emissão:</b> ${dateBR(q.date)} &nbsp; <b>Validade:</b> ${dateBR(q.validity)}</p><div class="box"><h3>Dados do cliente e aparelho</h3><div class="grid"><p><b>Cliente:</b> ${esc(q.customerName)}</p><p><b>Telefone:</b> ${esc(q.phone)}</p><p><b>Aparelho:</b> ${esc(q.device||'Não informado')}</p><p><b>IMEI/Série:</b> ${esc(q.imei||'Não informado')}</p><p style="grid-column:1/-1"><b>Defeito relatado:</b> ${esc(q.issue||'Não informado')}</p></div></div><table><thead><tr><th>Descrição</th><th>Qtd.</th><th>Valor unitário</th><th>Total</th></tr></thead><tbody>${q.lines.map(l=>`<tr><td>${esc(l.name||'Item')}</td><td>${l.qty}</td><td>${brl(l.price)}</td><td>${brl(l.qty*l.price)}</td></tr>`).join('')}</tbody></table><div class="totals"><p><span>Subtotal</span><b>${brl(q.subtotal)}</b></p><p><span>Desconto</span><b>${brl(q.discount)}</b></p><p class="grand"><span>TOTAL</span><span>${brl(q.total)}</span></p></div><div class="box"><h3>Prazo, garantia e observações</h3><p><b>Prazo estimado:</b> ${esc(q.deadline||'A combinar')}</p><p><b>Garantia oferecida:</b> ${esc(q.warranty||'Conforme legislação aplicável e condições do serviço')}</p><p><b>Observações:</b> ${esc(q.notes||'Nenhuma')}</p></div><div class="box terms"><h3>Termos e condições de garantia</h3><ol><li>A garantia cobre exclusivamente o serviço executado e/ou a peça substituída, pelo prazo informado neste orçamento ou documento fiscal, respeitados os direitos previstos no Código de Defesa do Consumidor.</li><li>Não cobre danos decorrentes de quedas, impactos, pressão, esmagamento, quebra, riscos ou outros danos físicos após a entrega.</li><li>Não cobre danos por contato com água ou outros líquidos, umidade, oxidação, corrosão, exposição a calor excessivo, fogo ou descarga elétrica, quando relacionados à causa do defeito reclamado.</li><li>Não cobre defeitos provocados por mau uso, uso em desacordo com as orientações, acidentes, modificações ou instalação inadequada de acessórios.</li><li>Intervenção, abertura, reparo ou alteração por terceiros poderá prejudicar a garantia quando houver relação com o defeito reclamado, mediante avaliação técnica.</li><li>A análise de garantia depende da apresentação deste orçamento ou comprovante de serviço e da avaliação técnica do aparelho.</li><li>Se for identificado dano não relacionado ao serviço executado, o cliente será informado antes de qualquer reparo adicional ou cobrança.</li></ol><p>Estas condições não eliminam nem restringem garantias ou direitos obrigatórios previstos na legislação brasileira.</p></div><p>Ao aprovar o orçamento, o cliente autoriza a execução dos itens descritos e declara estar ciente dos valores, prazo estimado e condições acima.</p><div class="signatures"><div>Assinatura do cliente</div><div>Nandos Tech · Responsável</div></div><div class="foot">Nandos Tech · Assistência técnica e acessórios · Documento gerado pelo sistema de gestão.</div><script>window.onload=()=>window.print()<\/script></body></html>`);w.document.close()}
function shareQuote(id){let q=db.quotes.find(x=>x.id===id);if(!q)return;let msg=`Olá, ${q.customerName}! Segue o orçamento ${q.number} da Nandos Tech, referente ao aparelho ${q.device||'informado'}. Valor total: ${brl(q.total)}. Garantia: ${q.warranty||'não informada'}. Para receber o documento completo em PDF, entre em contato conosco.`;let phone=(q.phone||'').replace(/\D/g,'');window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`,'_blank')}
$('#nav').addEventListener('click',e=>{let b=e.target.closest('[data-page]');if(b){setPage(b.dataset.page);$('#sidebar').classList.remove('open')}});
$('#closeModal').onclick=closeModal;$('#menuBtn').onclick=()=>$('#sidebar').classList.toggle('open');$('#quickQuote').onclick=quoteForm;
$('#today').textContent=new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'});
document.addEventListener('input',e=>{if(e.target.name==='discount')updateQuoteTotal()});

async function initializeAuth(){
  const client = window.supabaseClient;
  const gate = document.querySelector('#authGate');
  const shell = document.querySelector('.app-shell');

  function showLogin(message=''){
    shell.style.display='none';
    gate.hidden=false;
    gate.innerHTML=`<div class="auth-card">
      <div class="auth-brand"><div class="auth-brand-mark">🐵</div><div><h1>Nandos Tech</h1><p style="margin:3px 0 0">GESTÃO INTELIGENTE</p></div></div>
      <h2 style="font:700 17px Manrope;margin:0">Acesse sua conta</h2>
      <p>Entre com seu e-mail e senha cadastrados no sistema.</p>
      ${message?`<div class="auth-error">${esc(message)}</div>`:''}
      <form id="loginForm">
        <label>E-mail<input name="email" type="email" autocomplete="username" required placeholder="seu@email.com"></label>
        <label>Senha<input name="password" type="password" autocomplete="current-password" required placeholder="Sua senha"></label>
        <button class="primary" type="submit">Entrar no sistema</button>
        <div id="loginStatus" class="auth-loading" aria-live="polite"></div>
      </form>
    </div>`;
    gate.querySelector('#loginForm').addEventListener('submit',async e=>{
      e.preventDefault();
      const form=e.currentTarget;
      const button=form.querySelector('button');
      const status=gate.querySelector('#loginStatus');
      button.disabled=true;
      status.textContent='Verificando acesso...';
      const data=Object.fromEntries(new FormData(form));
      const {error}=await client.auth.signInWithPassword({email:data.email.trim(),password:data.password});
      if(error){
        button.disabled=false;
        status.textContent='';
        showLogin('Não foi possível entrar. Confira o e-mail e a senha e tente novamente.');
        return;
      }
      await loadAuthenticatedProfile();
    });
  }

  async function loadAuthenticatedProfile(){
    const {data:{user},error:userError}=await client.auth.getUser();
    if(userError){
      showLogin('Falha ao identificar a conta: '+(userError.message||'erro de autenticação')+' ('+(userError.code||'sem código')+').');
      return;
    }
    if(!user){showLogin('Nenhuma sessão autenticada foi encontrada. Entre novamente.');return;}
    const {data:profile,error}=await client
      .from('profiles')
      .select('id, full_name, role, branch_id, active')
      .eq('id',user.id)
      .maybeSingle();

    if(error){
      showLogin('Erro ao consultar seu perfil no banco: '+(error.message||'erro desconhecido')+' ('+(error.code||'sem código')+').');
      return;
    }
    if(!profile){
      await client.auth.signOut();
      showLogin('O login foi aceito, mas não foi encontrado um perfil para este usuário ('+user.id+').');
      return;
    }
    if(profile.active!==true || !profile.branch_id){
      await client.auth.signOut();
      showLogin('O perfil foi encontrado, mas está inativo ou sem filial vinculada. ID do usuário: '+user.id+'.');
      return;
    }

    window.currentProfile=profile;
    gate.hidden=true;
    shell.style.display='flex';
    const foot=document.querySelector('.sidebar-foot');
    if(foot) foot.innerHTML='<span class="status-dot"></span> Conectado: '+esc(profile.full_name||user.email);
    const actions=document.querySelector('.top-actions');
    if(actions && !document.querySelector('#logoutBtn')){
      const logout=document.createElement('button');
      logout.id='logoutBtn';
      logout.className='logout-btn';
      logout.type='button';
      logout.textContent='Sair';
      logout.addEventListener('click',async()=>{
        logout.disabled=true;
        const {error}=await client.auth.signOut();
        if(error){logout.disabled=false;toast('Não foi possível encerrar a sessão.');}
      });
      actions.appendChild(logout);
    }
    // Mostra o painel imediatamente; uma falha em um módulo não deve bloquear a tela.
    setPage('dashboard');

    async function safeStartupLoad(label, task){
      try{
        await task();
      }catch(loadError){
        console.error('Falha ao carregar '+label+':',loadError);
        toast('Painel aberto. Não foi possível carregar '+label+'. Atualize a página para tentar novamente.');
      }
    }

    // Primeiro os cadastros-base; depois os orçamentos que dependem deles.
    await safeStartupLoad('produtos',loadRemoteProducts);
    await safeStartupLoad('serviços',loadRemoteServices);
    await safeStartupLoad('clientes',loadRemoteCustomers);
    await safeStartupLoad('orçamentos',loadRemoteQuotes);
    await safeStartupLoad('caixa e vendas',loadRemoteCashSales);
    render();
  }

  const {data:{session},error}=await client.auth.getSession();
  if(error){showLogin('Não foi possível verificar sua sessão. Atualize a página.');return;}
  if(session) await loadAuthenticatedProfile();
  else showLogin();

  client.auth.onAuthStateChange((event)=>{
    if(event==='SIGNED_OUT'){
      window.currentProfile=null;
      showLogin();
    }
  });
}
initializeAuth();
