// Cloudflare Worker: serve static assets and securely forward lead submissions to Supabase.
// Required secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
// Never expose the service-role key in client code.
export default {
 async fetch(request, env) {
  const url = new URL(request.url);
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
  return upstream.ok?new Response(JSON.stringify({ok:true}),{status:201,headers:{'content-type':'application/json'}}):new Response('Unable to save lead',{status:502});
 }
};