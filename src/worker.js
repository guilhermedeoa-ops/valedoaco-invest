// Cloudflare Worker: serve static assets and securely forward lead submissions to Supabase.
// Required secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
// Never expose the service-role key in client code.
export default {
 async fetch(request, env, ctx) {
  const url = new URL(request.url);
  if(url.pathname.startsWith('/api/admin/')) return handleAdmin(request,env,url.pathname);
  if (url.pathname !== '/api/leads') return env.ASSETS.fetch(request);
  if (request.method !== 'POST') return new Response('Method Not Allowed',{status:405,headers:{Allow:'POST'}});
  if (!request.headers.get('content-type')?.includes('application/json')) return new Response('Unsupported Media Type',{status:415});
  const raw=await request.text();
  if(raw.length>6000)return new Response('Payload too large',{status:413});
  let d;try{d=JSON.parse(raw)}catch{return new Response('Invalid JSON',{status:400})}
  const clean=(v,max)=>typeof v==='string'?v.trim().slice(0,max):'';
  const nome=clean(d.nome,120),telefone=clean(d.telefone,20),modalidade=clean(d.modalidade,30);
  if(nome.length<2||!/^\+?[\d\s()-]{10,20}$/.test(telefone)||!['imovel','veiculo','carta','outros'].includes(modalidade)||d.consentimento!==true)return new Response('Invalid input',{status:400});
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return new Response('Service unavailable',{status:503});
  const payload={nome,telefone,modalidade,faixa_credito:clean(d.faixa_credito,80),mensagem:clean(d.mensagem,1000),origem:'site',consentimento:true};
  const key=env.SUPABASE_SERVICE_ROLE_KEY.trim();
  const headers={apikey:key,'Content-Type':'application/json',Prefer:'return=minimal'};
  // New sb_secret_ keys are opaque API keys, not JWTs: do not send them as Bearer tokens.
  if(!key.startsWith('sb_secret_')) headers.Authorization='Bearer '+key;
  const upstream=await fetch(env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/leads',{method:'POST',headers,body:JSON.stringify(payload)});
  if(!upstream.ok) console.error(JSON.stringify({event:'lead_insert_failed',upstream_status:upstream.status}));
  if(upstream.ok && env.EMAIL_WEBHOOK_URL && env.EMAIL_WEBHOOK_SECRET){
   ctx.waitUntil(notifyNewLead(env,payload).catch(error=>console.error('lead_email_notification_failed',String(error))));
  }
  return upstream.ok?new Response(JSON.stringify({ok:true}),{status:201,headers:{'content-type':'application/json'}}):new Response('Unable to save lead',{status:502});
 }
};
async function notifyNewLead(env,lead){
 const url=String(env.EMAIL_WEBHOOK_URL).trim();
 if(!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url)){
  console.error('lead_email_invalid_webhook_url');return;
 }
 const response=await fetch(url,{
  method:'POST',
  headers:{'Content-Type':'text/plain;charset=utf-8'},
  body:JSON.stringify({...lead,secret:String(env.EMAIL_WEBHOOK_SECRET)}),
  redirect:'follow'
 });
 if(!response.ok){console.error('lead_email_http_error',response.status);return;}
 const result=await response.text();
 if(!result.includes('"ok":true'))console.error('lead_email_unconfirmed_response',result.slice(0,160));
}
const json=(obj,status=200)=>Response.json(obj,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function handleAdmin(request,env,path){
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY||!env.ADMIN_EMAIL)return json({error:'Painel não configurado: ADMIN_EMAIL ausente.'},503);
 const base=env.SUPABASE_URL.replace(/\/$/,'');
 const key=env.SUPABASE_SERVICE_ROLE_KEY.trim();
 const headers={apikey:key,'Content-Type':'application/json'};
 if(!key.startsWith('sb_secret_'))headers.Authorization='Bearer '+key;
 if(path==='/api/admin/login'){
  if(request.method!=='POST')return json({error:'Método inválido'},405);
  let credentials;try{credentials=await request.json()}catch{return json({error:'Dados inválidos'},400)}
  if(typeof credentials.email!=='string'||typeof credentials.password!=='string'||credentials.password.length>200||credentials.email.length>250)return json({error:'Dados inválidos'},400);
  if(credentials.email.trim().toLowerCase()!==env.ADMIN_EMAIL.trim().toLowerCase())return json({error:'Credenciais inválidas'},401);
  const login=await fetch(base+'/auth/v1/token?grant_type=password',{method:'POST',headers,body:JSON.stringify({email:credentials.email,password:credentials.password})});
  if(!login.ok)return json({error:'Credenciais inválidas'},401);
  const session=await login.json();
  if(!session.access_token)return json({error:'Falha de autenticação'},502);
  return json({access_token:session.access_token,expires_in:session.expires_in});
 }
 if(!['/api/admin/leads','/api/admin/lead'].includes(path))return json({error:'Rota não encontrada'},404);
 const authorization=request.headers.get('Authorization')||'';
 if(!authorization.startsWith('Bearer '))return json({error:'Login necessário'},401);
 const verify=await fetch(base+'/auth/v1/user',{headers:{apikey:key,Authorization:authorization}});
 if(!verify.ok)return json({error:'Sessão inválida ou expirada'},401);
 const user=await verify.json();
 if(!user.id||user.email?.toLowerCase()!==env.ADMIN_EMAIL.trim().toLowerCase())return json({error:'Acesso negado'},403);
 if(path==='/api/admin/lead'){
  if(request.method!=='PATCH')return json({error:'Método inválido'},405);
  let data;try{data=await request.json()}catch{return json({error:'Dados inválidos'},400)}
  if(!data||typeof data.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(data.id))return json({error:'ID inválido'},400);
  const changes={};
  if(Object.hasOwn(data,'status')){
   if(!['novo','contatado','qualificado','convertido','descartado'].includes(data.status))return json({error:'Status inválido'},400);
   changes.status=data.status;
  }
  if(Object.hasOwn(data,'observacoes')){
   if(typeof data.observacoes!=='string'||data.observacoes.length>3000)return json({error:'Observação inválida (máximo 3000 caracteres)'},400);
   changes.observacoes=data.observacoes;
  }
  if(!Object.keys(changes).length)return json({error:'Nenhuma alteração'},400);
  const update=await fetch(base+'/rest/v1/leads?id=eq.'+encodeURIComponent(data.id),{method:'PATCH',headers:{...headers,Prefer:'return=representation'},body:JSON.stringify(changes)});
  if(!update.ok){console.error('crm_update_failed',update.status);return json({error:'Não foi possível salvar'},502)}
  const updated=await update.json();return updated.length?json({ok:true,lead:updated[0]}):json({error:'Lead não encontrado'},404);
 }
 if(request.method!=='GET')return json({error:'Método inválido'},405);
 const params=new URL(request.url).searchParams;
 const search=(params.get('search')||'').trim();
 const status=params.get('status')||'';
 const modalidade=params.get('modalidade')||'';
 if(search.length>80||status&&!['novo','contatado','qualificado','convertido','descartado'].includes(status)||modalidade&&!['imovel','veiculo','carta','outros'].includes(modalidade))return json({error:'Filtro inválido'},400);
 const pageRaw=new URL(request.url).searchParams.get('page')||'1';
 if(!/^[1-9]\d{0,5}$/.test(pageRaw))return json({error:'Página inválida'},400);
 const page=Number(pageRaw),size=50,offset=(page-1)*size;
 const filters=new URLSearchParams({select:'id,created_at,nome,telefone,modalidade,faixa_credito,mensagem,status,observacoes',order:'created_at.desc',limit:String(size+1),offset:String(offset)});
 if(status)filters.set('status','eq.'+status);
 if(modalidade)filters.set('modalidade','eq.'+modalidade);
 if(search){const safe=search.replace(/[,%().*\\]/g,' ').trim();if(safe)filters.set('or','(nome.ilike.*'+safe+'*,telefone.ilike.*'+safe+'*)');}
 const list=await fetch(base+'/rest/v1/leads?'+filters.toString(),{headers});
 if(!list.ok){console.error('admin_leads_fetch_failed',list.status);return json({error:'Não foi possível carregar contatos'},502)}
 const leads=await list.json();return json({leads:leads.slice(0,size),page,has_more:leads.length>size});
}
