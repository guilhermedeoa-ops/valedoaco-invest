# Vale do Aço Invest — site de Guilherme

Landing page de captação de leads para consórcios de imóveis, veículos e cartas de crédito.

## Arquitetura
- GitHub: código fonte.
- Cloudflare Workers + Static Assets: hospedagem do site e endpoint POST /api/leads.
- Supabase: tabela public.leads com RLS ativada, sem permissões diretas para visitantes.

## Implantação
1. Configurar Worker com diretório de assets contendo index.html e módulo src/worker.js.
2. Cadastrar segredos SUPABASE_URL (https://brabcgkawqxrpuiwqzth.supabase.co) e SUPABASE_SERVICE_ROLE_KEY no ambiente Cloudflare, nunca no GitHub.
3. Configurar rate limiting e Cloudflare Turnstile com validação server-side antes de abrir a campanha para tráfego pago.
4. Configurar domínio, HTTPS e revisar política de privacidade/LGPD.
5. Validar envio de teste e armazenamento no Supabase antes de divulgar o formulário.

WhatsApp provisório: +55 31 98884-1221. Domínio desejado: guilhermevaledoacoinvest.com.br (registro não confirmado).

**Atenção:** enquanto a infraestrutura não for publicada com a API, o formulário mostra mensagem de indisponibilidade e oferece WhatsApp. Não anunciar como captação operacional antes dos testes.
