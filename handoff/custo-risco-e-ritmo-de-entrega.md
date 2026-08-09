# Custo, risco operacional e ritmo de entrega — contexto para o Antigravity opinar

> Guilherme, 09/08/2026, três preocupações no mesmo dia:
>
> 1. *"Temos que pensar em não prejudicar as operações enquanto estamos
>    fazendo testes de melhoria."*
> 2. *"Nem ficar perturbando o usuário para atualizar toda hora — atualizações
>    para o usuário final só após consolidações importantes e grandes."*
> 3. *"Isso me preocupa muito, o custo do Railway. Veja como está, qual é a
>    projeção se seguirmos assim e qual é a melhor solução."*
>
> Escrito pelo Claude. **Antigravity: leia e discorde onde achar que devo
> discordar.** Este documento é para receber a sua opinião, não para você
> executar. Complementa `auditoria-base-para-escalar.md`.

---

## 1. Testar sem derrubar quem está vendendo

### O que estava acontecendo, medido

A rota `/api/whatsapp/versao` lia o número **direto do `manifest.json` do
deploy**. Como eu bumpo a versão a cada commit, hoje foram **17 versões**
(4.16 → 4.33) — e cada uma disparava um "atualize agora" na tela de **todas as
consultoras**, no meio do atendimento, por mudança que ninguém pediu para
testar.

O consultor não tem como saber que a 4.29 era um experimento meu e a 4.32 é
uma correção de verdade. Para ele são 17 interrupções iguais.

### O que eu já mudei

`extensao-whatsapp/VERSAO_ESTAVEL` — arquivo de uma linha. É ele que a rota
devolve agora, e ele **só muda quando a versão é de fato publicada na Chrome
Web Store**. O manifesto continua andando a cada commit; ninguém é incomodado.

A rota passou a devolver as duas: `versao` (a que gera aviso) e `versao_dev`
(a do repositório, para diagnóstico).

**Está em 4.16.0 e precisa de confirmação do Guilherme:** qual versão está
publicada na loja hoje? Se for outra, é essa que vai no arquivo.

### Os três anéis que isso cria

| anel | quem usa | quando muda |
|---|---|---|
| **repositório** | eu e o Antigravity | a cada commit |
| **Guilherme** | extensão descompactada em `~/Documents` | a cada sincronização minha |
| **consultoras** | Chrome Web Store | só quando o `VERSAO_ESTAVEL` mudar |

O do meio é o que faz o Guilherme ser o nosso ambiente de teste. Isso hoje é
bom — ele pega defeito que ferramenta nenhuma pegaria. **Deixa de ser bom no
dia em que houver corretora cliente**, porque aí o anel do meio precisa ser
alguém que não perde venda quando quebra.

### O que falta (opinião pedida)

A Chrome Web Store tem **canal de teste** e **liberação percentual**, de graça.
Isso permitiria publicar para 10% e observar antes de ir para todos. Hoje é
tudo ou nada, e à mão.

No servidor não existe nada equivalente: o deploy do `main` vai para produção
inteiro, na hora. Para o Serenus isso é aceitável — o Guilherme está junto.
Com dez corretoras, não é.

**Antigravity: o que você faria aqui?** Ambiente de homologação separado no
Railway custa outra instância. Talvez baste um `SEED_DADOS_SERENUS=0` num
projeto de teste e o hábito de subir lá primeiro. Quero a sua leitura.

---

## 2. Custo do Railway — o que dá para afirmar e o que não dá

### O que eu NÃO consigo ver

**Não tenho acesso ao painel do Railway.** Qualquer número que eu desse sobre a
fatura atual seria chute. Para responder de verdade preciso de três coisas do
Guilherme:

1. A **fatura do mês** (total e a divisão por serviço).
2. O gráfico de **memória e CPU** do serviço web nos últimos 30 dias.
3. O **tamanho real do banco** hoje (Postgres → Metrics).

Com isso a projeção deixa de ser modelo e vira conta.

### O que dá para afirmar, porque está no repositório

**`railway.json` provisiona um volume de 10 GB por instância.** Volume no
Railway é cobrado pelo tamanho **provisionado**, não pelo usado. Se o volume
está com 500 MB de anexos, os outros 9,5 GB estão sendo pagos vazios — e isso
se multiplica por corretora.

Vale conferir quanto do `/data` está de fato ocupado. Se sobrar muito, reduzir
o volume é economia direta e imediata, em todas as instâncias.

**O serviço web roda em um processo só** (`app.run()` do Flask, ver a outra
auditoria). Isso tem um efeito de custo contraintuitivo: como não há workers, a
tentação natural quando "fica lento" é **aumentar a máquina** — pagar mais por
um problema que é de configuração. Trocar para gunicorn com 3 workers usa
melhor a máquina que já está paga.

### O modelo da projeção

Com instância por corretora, o custo cresce **linear com o número de clientes**,
não com o número de usuários:

```
custo por corretora = serviço web + Postgres + volume
custo total         = custo por corretora × N   (+ o Serenus)
```

O que **não** cresce: o preço do código, do deploy, da extensão. O que cresce:
infraestrutura e, principalmente, **atenção humana**.

Ordem de grandeza para um serviço web pequeno + Postgres pequeno + volume
enxuto: algo entre US$ 10 e 25 por corretora por mês, se o volume não estiver
superdimensionado. **Confirmar com a fatura antes de repetir esse número para
alguém.**

### A pergunta que realmente decide

Não é "Railway é caro?". É **"quanto custa uma corretora por mês e quanto ela
paga?"**. Se a assinatura for R$ 300 e a infraestrutura R$ 80, a discussão
acabou — o custo é 27% e cai com escala. Se for R$ 150 contra R$ 80, aí sim
vale mudar de fornecedor.

**Antes de trocar de infraestrutura, defina o preço da assinatura.** É ele que
diz se existe problema.

### Quando trocar faria sentido

| clientes | recomendação |
|---|---|
| 1 a 5 | **Fique.** A economia é de dezenas de dólares e o custo da migração é tempo que não sobra. |
| 5 a 20 | Continua servindo, mas automatize o provisionamento — hoje é manual (`PROVISIONAMENTO.md`). Render e Fly.io são equivalentes em preço. Hetzner + Coolify corta 3–4×, e cobra de volta em administração de sistema. |
| 20+ | O problema deixa de ser hospedagem e vira operação: quem migra vinte bancos, quem monitora, quem faz rollback. |

**O que o Railway vende de verdade não é servidor — é não ter administrador de
sistema.** Deploy no push, Postgres gerenciado, TLS, logs, backup. Com um
cliente isso é conforto. Com dez, é o que impede o Guilherme de virar suporte
de infraestrutura em vez de vender.

**Antigravity: aqui eu quero discordância se você tiver.** Se você acha que
Hetzner + Coolify já vale no terceiro cliente, diga por quê, com número.

---

## 3. O que eu já disse ao Guilherme, para você não repetir nem contradizer sem querer

- A arquitetura de **instância por corretora está certa** e não deve mudar:
  isolamento físico é o que elimina "cliente A vê dado do cliente B".
- **Trocar Flask/Postgres/Railway não resolve nenhum** dos sete itens da outra
  auditoria — todos são falta de prática, não de tecnologia.
- A prioridade é: **gunicorn → CI de fumaça → Sentry**. Nessa ordem.
- Existem **oito formas** de decidir "esta pessoa pode?" no `main`, e o
  `@requer` (que deveria unificar) está só na sua branch.

## 4. O que eu quero de você neste documento

1. Onde eu estou errado.
2. Sua estimativa de custo do Railway, se você tiver visto o painel.
3. Como você faria o ambiente de homologação sem dobrar a conta.
4. Se concorda que o `VERSAO_ESTAVEL` resolve o problema do aviso, ou se falta
   algo do lado do servidor.

Escreva na `conversa.md`. O Guilherme lê os dois.
