# CONTRATO — parar de criar lead que não é lead

> Guilherme, 09/08/2026: *"isso está muito ruim. Mesmo com o botão de auditoria
> está péssimo. Como podemos resolver sem perder as funções que usam essa
> parte?"*
>
> O problema não é a tela de auditoria. É o que enche ela.

---

## O defeito, medido

**Toda análise cria um lead.** `api_whatsapp_analisar` (`app.py:23718`): se não
encontrou lead pelo telefone nem pelo nome, insere um novo com
`origem='WhatsApp (extensão)'` e a observação *"Criado automaticamente pela
extensão de WhatsApp"*.

E a **varredura** da extensão analisa conversas sozinha, de 5 em 5 minutos,
pegando tudo o que teve movimento nas últimas horas.

O resultado é aritmética simples: **toda conversa que teve mensagem vira lead.**
Fornecedor, contador, colega, grupo, o técnico do ar-condicionado. Depois tudo
isso aparece em `/crm/leads-da-extensao` esperando alguém dizer, um por um, que
não é lead.

A tela de auditoria está funcionando exatamente como projetada. O que está
errado é precisar dela nesse volume.

**Limpar na saída não escala. Tem que filtrar na porta.**

## Por que estava assim

Não foi descuido: foi pedido explícito na época — *"a análise não pode ficar só
solta no painel da extensão, tem que virar lead no CRM"*. O comentário está no
código. A regra estava certa para o uso de então (o consultor abria uma
conversa e mandava analisar). Ela ficou errada quando a **varredura automática**
passou a analisar tudo sozinha — aí "toda análise vira lead" deixou de
significar "toda conversa que eu escolhi" e passou a significar "toda conversa
que existe".

## O que fazer

**Criar o lead só quando a análise encontrou sinal de lead.** O servidor já tem
tudo o que precisa no momento da decisão — não é preciso dado novo:

- `extracao`: idades, vidas, cidade, CNPJ, operadora de interesse, plano atual,
  urgência, objeções;
- `score` e `fase_funil`;
- quantidade de mensagens.

**Regra sugerida — cria o lead se QUALQUER uma for verdadeira:**

1. a extração trouxe **pelo menos um** campo de intenção (vidas, idades,
   operadora de interesse, plano preferido, urgência, CNPJ ou cidade **com**
   algum outro campo);
2. o `score` ficou **acima do piso** (sugiro 200 — confirme com o Guilherme);
3. a análise foi disparada **à mão** pelo consultor (botão "Analisar este
   lead"), e não pela varredura.

O item 3 é o mais importante: **quando ele escolhe analisar, ele já decidiu que
é lead.** A extensão precisa mandar isso — hoje a rota não distingue varredura
de clique. Adicione `origem_analise: 'manual' | 'varredura'` no corpo, com
padrão `manual` (assim uma extensão antiga não muda de comportamento).

Eu mando esse campo na extensão assim que a rota aceitar.

## O que NÃO pode se perder

Isto é o cerne do pedido dele. Conferir um por um antes de subir:

- **A análise continua salva e visível** mesmo sem lead. `whatsapp_analises`
  aceita `lead_id` nulo? Se não aceitar, é isso que precisa mudar primeiro.
- **`/api/whatsapp/estado` continua achando a análise pelo telefone**, sem
  depender de `lead_id`.
- **O botão de cadastrar continua existindo** no painel: quando a análise
  aparecer sem lead, o consultor cria com um clique e o vínculo acontece na
  hora (a extensão já tem esse caminho — é o `_cotCriarLead`).
- **Nada retroativo.** Os leads já criados ficam como estão; esta mudança só
  vale daqui pra frente. Mexer no que já existe é outro assunto e exige o
  cuidado do contrato 4.
- **A atividade no CRM** ("Lead criado automaticamente…") só é gravada quando o
  lead for de fato criado.

## Teste

1. Varredura numa conversa sem nada de plano (combinar almoço) → **não cria
   lead**, e a análise fica visível no painel.
2. Mesma conversa, análise disparada **à mão** → cria lead, como hoje.
3. Varredura numa conversa que fala de plano/vidas/cidade → cria lead.
4. Conversa cujo lead já existe → continua vinculando, nunca duplica.
5. `/api/whatsapp/estado` devolve a análise nos quatro casos.

## Quanto isso vale

O contador de `/crm/leads-da-extensao/pendentes` é a medida. Anote quanto está
hoje, aplique, e compare depois de uma semana. **Se não cair, a regra está
errada e precisa de outro corte** — não adianta declarar resolvido.

## Prioridade

Depois do `contrato-rede-de-seguranca.md` (item 0). Antes do resto.
