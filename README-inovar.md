# Notificações InovarSIGE

## Variáveis de ambiente (Vercel → Settings → Environment Variables)

| Variável | Valor |
|---|---|
| `INOVAR_USER` | O teu Nº de processo (Encarregado de Educação) |
| `INOVAR_PASSWORD` | O teu PIN |
| `INOVAR_STUDENT_ID` | `1838300` (visto no payload do pedido GetHistoryByUtilizador) |
| `SUPABASE_URL` | URL do teu projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (não a anon key — esta rota corre no servidor) |
| `RESEND_API_KEY` | A tua chave da Resend |
| `NOTIFY_FROM_EMAIL` | Email verificado na Resend, ex: `alertas@teudominio.pt` |
| `NOTIFY_TO_EMAIL` | O teu email pessoal |
| `CRON_SECRET` | Uma string aleatória à tua escolha, para proteger o endpoint |

## Antes de ligar tudo

1. Corre o `supabase-schema.sql` no SQL editor da Supabase.
2. Confirma que `Type: "1"` está mesmo certo — é o valor do campo escondido quando escolhes o separador "Enc. educação" no login. Se normalmente usas o separador "Utilizador", muda para `"0"`.
3. Testa o endpoint manualmente primeiro (com o servidor de dev a correr):
   ```
   curl -H "Authorization: Bearer O_TEU_CRON_SECRET" http://localhost:3000/api/check-inovar
   ```
   Deve devolver algo como `{"checked":3,"new":0}` na segunda vez que corres (a primeira vez todos os 3 registos existentes vão contar como "novos" — é normal).

## Sobre logins repetidos e risco de bloqueio da conta

O endpoint guarda o cookie de sessão na tabela `inovar_session` e reutiliza-o em todas as verificações. Só faz login de novo quando essa sessão deixa de funcionar (normalmente só por inatividade prolongada — e como estamos a usá-la constantemente, isso deve ser raro). Na prática, isto significa que o login real deve acontecer talvez uma vez por dia, não a cada verificação.

Ainda assim, não sabemos ao certo qual é a política de bloqueio do InovarSIGE, por isso vale a pena começar com um intervalo mais conservador (ex: 15 minutos) e só reduzir se tudo continuar a correr bem.

## Agendamento (correr o endpoint periodicamente)

**Importante:** o plano Hobby (grátis) da Vercel só permite Cron Jobs uma vez por dia — não chega para "tempo real". Tens duas opções:

**Opção A — Vercel Pro:** cria um `vercel.json` na raiz do projeto:
```json
{
  "crons": [
    { "path": "/api/check-inovar", "schedule": "*/10 * * * *" }
  ]
}
```
Isto corre a cada 10 minutos. (Nota: a Vercel não envia o header `Authorization` nos crons nativos — terás de adaptar a verificação para usar o header `x-vercel-cron` que a Vercel envia automaticamente, ou usar a Opção B.)

**Opção B — Serviço externo gratuito (recomendado para já):**
Usa o [cron-job.org](https://cron-job.org) ou uma GitHub Action agendada para fazer um pedido GET a cada 5-10 min:
```
GET https://o-teu-dominio.vercel.app/api/check-inovar
Header: Authorization: Bearer O_TEU_CRON_SECRET
```
Isto funciona em qualquer plano da Vercel, sem custos extra.

## Sobre o campo "Tipo"

Ainda não sabemos ao certo se `Tipo: 1` é entrada e `Tipo: 9` é saída (ou o oposto). O email de notificação inclui sempre o valor de `Tipo` e `Motivo` em bruto — depois de receberes algumas notificações reais, dá para confirmar o padrão comparando com as horas que sabes que ele entrou/saiu, e ajustamos o código para dizer explicitamente "Entrada" ou "Saída".
