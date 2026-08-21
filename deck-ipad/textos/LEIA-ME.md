# Textos do deck

Cada arquivo `.txt` daqui é o conteúdo de um botão de colar. O git ignora tudo
menos este aviso: são dados do dono (chave PIX, assinatura, endereço), não do
projeto, e chave de recebimento não vai para commit.

Para criar um botão novo: escreva o texto num arquivo aqui e aponte para ele no
`botoes.json`, com `"acao": {"tipo": "texto", "arquivo": "nome-do-arquivo.txt"}`.

Se o arquivo não existir, o botão não quebra em silêncio: ele diz na tela do
iPad qual arquivo está faltando.
