"""Deduz o sexo pelo primeiro nome. Sempre editavel com 1 clique na tela -
a heuristica so evita ter que marcar na maioria dos casos."""
import unicodedata

# Nomes femininos que NAO terminam em "A".
FEMININOS = {
    'BEATRIZ', 'RAQUEL', 'ISABEL', 'ESTER', 'ESTHER', 'RUTE', 'RUTH', 'ELIZABETH',
    'KAREN', 'KAREM', 'CAREN', 'NICOLE', 'MICHELE', 'MICHELLE', 'DENISE', 'SUELI',
    'SOLANGE', 'MARLENE', 'DARLENE', 'JAQUELINE', 'JACQUELINE', 'CAROLINE', 'EVELYN',
    'MIRIAM', 'MYRIAM', 'IRIS', 'DORIS', 'LAIS', 'THAIS', 'TAIS', 'INES', 'MERCEDES',
    'SIMONE', 'IVONE', 'ELIANE', 'ADRIANE', 'CRISTIANE', 'CRISTIANI', 'ROSANE',
    'LUCIANE', 'JULIANE', 'VIVIANE', 'DAIANE', 'TATIANE', 'JOSIANE', 'FABIANE',
    'MARIANE', 'SUZANE', 'ROSELI', 'ROSELY', 'NOEMI', 'NOEMY', 'MARLI', 'NEUSELI',
    'CLEUSE', 'IRACI', 'IVANI', 'ELOI', 'KELLY', 'KELY', 'SHIRLEY', 'WESLEY',
    'HELEN', 'ELLEN', 'GLEICE', 'JOYCE', 'GRACE', 'ALICE', 'ELIS', 'ELISE',
    'YASMIN', 'JASMIN', 'CARMEN', 'CARMEM', 'LILIAN', 'LILIANE', 'GISELE', 'GISELLE',
    'RACHEL', 'MABEL', 'MARIBEL', 'CRIS', 'BEL', 'MERI', 'MERY', 'NARA', 'NAIR',
    'ESTELA', 'LOURDES', 'PIEDADE', 'SOCORRO', 'CONCEICAO', 'ASSUNCAO', 'APARECIDA',
}

# Nomes masculinos que TERMINAM em "A".
MASCULINOS = {
    'LUCA', 'NICOLA', 'NOA', 'JOSHUA', 'AKIRA', 'AGRIPA', 'BARNABA', 'ANDREA',
    'SACHA', 'SASHA', 'ATTILA', 'ATILA', 'GARCIA', 'COSTA', 'SILVA',
}

# Sufixos que indicam feminino mesmo sem terminar em "A".
SUFIXOS_FEM = ('YN', 'LYN', 'INE', 'ANE', 'ENE', 'ONE', 'ETE', 'ETTE', 'ELLE')


def _limpar(nome):
    s = unicodedata.normalize('NFKD', str(nome or ''))
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return s.strip().upper()


def deduzir_sexo(nome_completo):
    """Devolve 'M', 'F' ou '' (quando nao da pra afirmar)."""
    nome = _limpar(nome_completo)
    if not nome:
        return ''
    primeiro = nome.split()[0]
    if primeiro in FEMININOS:
        return 'F'
    if primeiro in MASCULINOS:
        return 'M'
    if primeiro.endswith('A'):
        return 'F'
    if primeiro.endswith(SUFIXOS_FEM):
        return 'F'
    if primeiro.endswith(('O', 'OS', 'AO', 'IM', 'UM', 'ER', 'OR', 'AL', 'IL', 'UL')):
        return 'M'
    return 'M'
