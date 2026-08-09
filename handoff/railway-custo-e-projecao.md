# Railway — preço, custo e projeção

> Guilherme, 09/08/2026: *"quero tudo sobre o preço, custo e as projeções de
> uso no Railway para já."*
>
> Escrito pelo Claude. **Leia a seção 0 antes de tudo:** parte disto é conta
> fechada, parte depende de três números que só o painel dele tem. Está
> marcado o que é qual.

---

## 0. O que é conta e o que é modelo

| | |
|---|---|
| **Preço unitário do Railway** | público. Confira na página de preços antes de decidir — muda. |
| **Consumo do JOB** | é o que eu **não** consigo ver. Depende de RAM e CPU medidos, e do tamanho real do banco. |

**Os três números que fecham a conta**, todos no painel do Railway:

1. **Usage → o total do mês** e a divisão por serviço.
2. **Serviço web → Metrics:** memória média e pico dos últimos 30 dias.
3. **Postgres → Metrics:** tamanho do banco e memória usada.

Com esses três, o modelo abaixo vira fatura. Sem eles, é ordem de grandeza —
que já é suficiente para decidir se existe problema.

---

## 1. Como o Railway cobra

Não é plano fixo com franquia de servidor: é **consumo medido por minuto**, em
quatro linhas.

| linha | preço publicado | como pensar |
|---|---|---|
| Memória | ~US$ 10 por GB por mês | o que mais pesa aqui |
| CPU | ~US$ 20 por vCPU por mês | só conta o que é usado de fato |
| Volume (disco) | ~US$ 0,15 por GB por mês | **cobrado pelo tamanho provisionado, não pelo usado** |
| Tráfego de saída | ~US$ 0,05 por GB | irrelevante neste sistema |

Mais a assinatura do plano (Hobby ~US$ 5/mês, Pro ~US$ 20/mês por assento), que
já vem com esse valor de consumo incluído.

**A linha do volume é a que merece atenção agora.** O `railway.json` provisiona
**10 GB por instância**. Se o `/data` está usando 500 MB de anexos, os outros
9,5 GB estão sendo pagos vazios — em toda instância, todo mês. São ~US$ 1,50 por
corretora por mês de nada.

---

## 2. Ordem de grandeza, por corretora

Um serviço web pequeno + um Postgres pequeno, com uso típico de corretora
(poucos usuários simultâneos, picos curtos):

| item | consumo estimado | por mês |
|---|---|---|
| Web — memória | ~0,5 GB | ~US$ 5 |
| Web — CPU | ~0,2 vCPU médio | ~US$ 4 |
| Web — volume 10 GB | provisionado | ~US$ 1,50 |
| Postgres — memória | ~0,5 GB | ~US$ 5 |
| Postgres — CPU + disco | ~0,1 vCPU + 5 GB | ~US$ 2,75 |
| **Total por corretora** | | **~US$ 18** (~R$ 100) |

Isso bate com a faixa de US$ 10–25 que eu disse antes. **Confirme com a fatura**
antes de repetir esse número para alguém.

### Projeção, mantendo tudo como está

| corretoras | por mês | por ano |
|---|---|---|
| 1 (hoje) | ~US$ 18 | ~US$ 216 |
| 5 | ~US$ 90 | ~US$ 1.080 |
| 10 | ~US$ 180 | ~US$ 2.160 |
| 20 | ~US$ 360 | ~US$ 4.320 |

Cresce em **linha reta** com o número de clientes, porque é uma instância por
corretora. Não cresce com o número de usuários dentro de cada uma — dez
consultoras na mesma corretora custam praticamente o mesmo que duas.

---

## 3. Uma correção na minha recomendação do gunicorn

Eu disse que trocar para `gunicorn -w 3` seria "usar melhor a máquina que você
já paga". **Metade disso está errado e eu preciso corrigir.**

Cada worker carrega o app inteiro na memória. Um processo que hoje ocupa ~0,5 GB
vira ~1,2–1,5 GB com três. Pelo preço da memória, isso é **US$ 7 a 10 a mais por
mês, por instância** — cerca de 40% de aumento no custo de infraestrutura.

Não é motivo para não fazer: hoje uma leitura de PDF trava todo mundo, e isso
custa venda. Mas o número honesto é:

- **`-w 2`** já resolve o pior do problema (deixa de ter caixa único) e custa
  bem menos que três.
- **`-w 3`** só se as métricas mostrarem fila de verdade.

**Minha recomendação corrigida: comece com `-w 2`,** olhe a memória por uma
semana, e só suba para 3 se houver motivo medido. Vou avisar o Antigravity.

---

## 4. Onde há dinheiro parado, sem trocar de fornecedor

Em ordem de facilidade:

1. **Reduzir o volume de 10 GB** para o que o `/data` realmente usa, com folga.
   Economia direta em toda instância. Confira o tamanho antes.
2. **`-w 2` em vez de `-w 3`** (seção 3).
3. **Dormir o que não precisa estar acordado.** Se existir instância de teste ou
   de cliente sem uso, o Railway cobra por ela parada do mesmo jeito.
4. **Postgres pequeno.** O banco de uma corretora nova é minúsculo; não precisa
   nascer grande.

Nenhuma dessas exige migração, código novo ou risco.

---

## 5. A pergunta que decide, e não é sobre o Railway

**Quanto uma corretora paga por mês?**

- Se a assinatura for R$ 300 e a infraestrutura R$ 100, o custo é 33% e **cai**
  com escala (o código, o deploy e a extensão não custam mais por cliente). Não
  há problema a resolver.
- Se for R$ 150 contra R$ 100, aí sim vale mudar de fornecedor — e o ganho seria
  real.

**Enquanto o preço da assinatura não existir, não dá para dizer se o Railway é
caro.** Ele só é caro em relação a alguma coisa.

---

## 6. Quando trocar faria sentido

| clientes | recomendação |
|---|---|
| 1–5 | **Fique.** A economia possível é de dezenas de dólares por mês; a migração custa dias de trabalho e reintroduz risco. |
| 5–20 | Continua servindo. O que muda é automatizar o provisionamento — hoje é manual. **Render** e **Fly.io** custam parecido. **Hetzner + Coolify** corta 3–4× (uma máquina de ~€ 15 aguenta várias instâncias), e cobra de volta em administração de sistema: atualização de sistema operacional, backup, TLS, monitoramento. |
| 20+ | O gargalo deixa de ser hospedagem e vira operação: quem migra vinte bancos, quem faz rollback, quem é acordado às 3h. Aí a conta de fornecedor é a menor das contas. |

**O que o Railway vende não é servidor — é não ter administrador de sistema.**
Deploy no push, Postgres gerenciado, TLS, logs, backup. Com uma corretora isso é
conforto. Com dez, é o que impede o Guilherme de virar suporte de
infraestrutura em vez de vender.

---

## 7. O que eu preciso para fechar

Os três números da seção 0. Com eles eu troco cada "~" desta página por um
número real, em dez minutos.
