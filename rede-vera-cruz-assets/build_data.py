# -*- coding: utf-8 -*-
"""
Gera rede_vera_cruz_data.json a partir dos PDFs oficiais:
  - "Vera Prata - Material de Apoio - 10.25" (rede própria)
  - "Vera Ouro - Material de Apoio - 10.25" (rede própria + credenciada)
Fonte: transcrição manual dos PDFs enviados pelo usuário (versão 10/2025).
Dados válidos até 31/10/2025 conforme os próprios documentos.
"""
import json

# ---------- HOSPITAIS (comuns aos dois planos) ----------
HOSPITAIS = [
    {"n": "Casa de Saúde", "t": "Pronto socorro adulto, hospital, hospital-dia isolado.",
     "e": "Praça Doutor Toffoli, nº 28. Centro - Campinas/SP", "f": ["(19) 3736-3400"]},
    {"n": "Centro Médico São Camilo", "t": "Pronto atendimento adulto, infantil e ortopédico.",
     "e": "Rua Miguel Fernandes Garcia Filho, nº 540. Chácara Areal - Indaiatuba/SP",
     "f": ["(19) 3834-4877", "(19) 3751-3770"]},
    {"n": "Hospital Vera Cruz",
     "t": "Pronto socorro adulto e infantil, hospital, hospital-dia isolado, pronto atendimento ginecológico e maternidade.",
     "e": "Av. Andrade Neves, nº 402. Centro - Campinas/SP", "f": ["(19) 3734-3000"]},
    {"n": "HAOC - Hospital Augusto de Oliveira Camargo", "t": "Pronto socorro adulto e infantil, serviços de urgência/emergência 24 horas",
     "e": "Av. Francisco de Paula Leite, nº 399. Jardim Santa Cruz - Indaiatuba/SP", "f": ["(19) 3801-8200"]},
    {"n": "Associação Americanense de Saúde", "t": "Urgência/Emergência PS Adulto e Infantil",
     "e": "Praça, Francisco Matarazzo, 60, Vila Gallo - Americana/SP", "f": ["(19) 3475-9900"]},
    {"n": "Associação da Santa Casa de Misericordia de Serra Negra", "t": "Urgência/Emergência PS Adulto e Infantil",
     "e": "Avenida Santos Pinto, 351, Centro - Serra Negra/SP", "f": ["(19) 3892-1888"]},
    {"n": "Fundação Beneficente de Pedreira - FUNBEPE", "t": "Urgência/Emergência PS Adulto e Infantil",
     "e": "Rua Henrique Rondello Canesso, 161, Vila Canesso - Pedreira/SP", "f": ["(19) 3893-2046"]},
    {"n": "Fundação Espírita Américo Bairral (Psiquiátrico)", "t": "Internação Psiquiátrica. Atendimento a partir de 18 anos",
     "e": "Rua Doutor Hortêncio Pereira da Silva, 313, Centro - Itapira/SP", "f": ["(19) 3863-9400"]},
    {"n": "Hospital Itatiba Ltda", "t": "Urgência/Emergência PS Adulto e Infantil",
     "e": "Rodovia das Estancias, sn, Km 92, Bairro da Ponte - Itatiba/SP", "f": ["(11) 3408-7002"]},
    {"n": "Hospital São Lucas", "t": "Urgência/Emergência PS Adulto e Infantil",
     "e": "Av. Brasil, 263 - Vila Medon, Americana - SP, 13465-240", "f": ["(19) 3475-7400"]},
    {"n": "Medical Medicina Cooperativa Assistencial de Limeira", "t": "Urgência/Emergência PS Adulto e Infantil",
     "e": "Avenida, Ana Carolina de Barros Levy, 124, Vl Paraiso - Limeira/SP", "f": ["(19) 3446-4646"]},
    {"n": "Sanatório Ismael - Fazenda Palmeiras (Psiquiátrico)", "t": "Internação Psiquiátrica. Atendimento a partir de 18 anos",
     "e": "Avenida, Allan Kardec, 1100, Jardim Santo Antonio - Amparo/SP", "f": ["(19) 3808-7466"]},
    {"n": "Santa Casa de Misericordia de Jacutinga", "t": "Urgência/Emergência PS Adulto e Infantil",
     "e": "Rua Barão do Rio Branco, 324, Centro - Jacutinga/MG", "f": ["(35) 3443-3115"]},
    {"n": "Unimed de Capivari Cooperativa", "t": "Urgência/Emergência PS Adulto e Infantil",
     "e": "Rua Regente Feijo, 778, Centro - Capivari/SP", "f": ["(19) 3492-9777"]},
]

# ---------- ESPECIALIDADES DISPONÍVEIS POR ESPAÇO/AMBULATÓRIO PRÓPRIO ----------
def unidade(nome, sub, esp, endereco, fones, extra=None, entre_outras=False):
    d = {"n": nome, "sub": sub, "esp": esp, "e": endereco, "f": fones, "entre_outras": entre_outras}
    if extra:
        d["extra"] = extra
    return d

UNIDADES_PRATA = [
    unidade("Ambulatório Casa de Saúde", None, [
        "Anestesia", "Cardiologia", "Angiologia", "Cirurgia Bariátrica", "Cirurgia Bucomaxilo",
        "Cirurgia Cabeça e Pescoço", "Cirurgia Aparelho Digestivo", "Cirurgia Geral", "Cirurgia Plástica",
        "Cirurgia Torácica", "Cirurgia Vascular", "Coloproctologia", "Dermatologia", "Gastroenterologia",
        "Ginecologia", "Infectologia", "Neurologia", "Cirúrgica/Coluna", "Neurologia Clinica",
        "Nutricionista", "Ortopedia", "Otorrinolaringologia", "Urologia",
    ], "Praça Doutor Toffoli, nº 28. Centro - Campinas/SP", ["(19) 3751-3770", "(19) 97162-7147"]),
    unidade("Vera Cruz Centro Clínico", "Unidade Nova Campinas", [
        "Cardiologia", "Cirurgia Mão", "Nefrologia", "Ortopedia",
    ], "Av Doutor Jesuíno Marcondes Machado, nº 394. Nova Campinas - Campinas/SP",
        ["(19) 3751-3770"], entre_outras=True),
    unidade("Vera Cruz Cuidado Integrado", None, [
        "Geriatria", "Médica de família e comunidade", "Nutricionista", "Pediatria", "Psicologia", "Psiquiatria",
    ], "Rua Luzitana, nº 681. Centro - Campinas/SP", ["0800 000 0023", "(19) 98396-0705"]),
    unidade("Vera Cruz Centro Clínico", "Unidade Guanabara", [
        "Alergologia e Imunologia pediátrica", "Angiologia e Cirurgia Vascular", "Cirurgia Aparelho Digestivo",
        "Cirurgia Bariátrica", "Cirurgia Geral", "Cirurgia Oncológica Digestiva", "Cirurgia Pediátrica",
        "Cirurgia Robótica Pediátrica", "Clínica Geral", "Dermatologia", "Endometriose e Cirurgia Ginecológica",
        "Esportiva Funcional", "Fertilidade", "Gastroenterologia", "Geriatria", "Gestação de Alto Risco",
        "Ginecologia e Obstetrícia", "Histeroscopia", "Mastologia", "Medicina Fetal", "Nutrição Clínica",
        "Patologia do Trato Genital Inferior Feminino", "Pediatria", "Pneumologia", "Psicologia", "Psiquiatria",
        "Reumatologia Pediátrica", "Uroginecologia",
    ], "Rua Gonçalves César, nº 158. Jardim Guanabara - Campinas/SP", ["(19) 3751-3770"]),
    unidade("Espaço Vera Cruz", None, [
        "Pediatria geral", "Neuropediatria", "Cardiopediatria", "Nefropediatria", "Imunopediatria",
        "Pneumopediatria", "Gastropediatria",
    ], "Av. Iguatemi, nº 777.– 2º Piso. Vila Brandina - Campinas - SP", ["(19) 3751-3770"]),
    unidade("Vera Cruz Oftalmologia", None, [
        "Cirurgia refrativa", "Oftalmopediatria", "Oncologia ocular", "Catarata", "Lente de contato",
        "Visão subnormal", "Córnea", "Estrabismo", "Plástica ocular", "Glaucoma", "Retina",
    ], "Avenida Iguatemi, nº 354. Vila Brandina - Campinas/SP", ["(19) 3751-3770"], extra="Exames e Cirurgias"),
    unidade("Vera Cruz Oncologia", None, [
        "Oncodermatologia", "Oncologia Bucomaxilar", "Oncologia Cutânea", "Mastologia", "Cirurgia Oncológica",
        "Oncologia Ortopédica", "Oncardiologia", "Hematologia", "Oncologia Clínica",
    ], "Av. Doutor Jesuíno Marcondes Machado, nº 329. Nova Campinas - Campinas/SP",
        ["(19) 3751-3960", "(19) 3751-3770"]),
    unidade("Centro Médico Vera Cruz", "Especialidades Eletivas", [
        "Alergologista", "Ambulatório", "Bucomaxilofacial", "Cardiologista", "Cirurgia Bariátrica",
        "Cirurgia de Cabeça e Pescoço", "Cirurgia do Aparelho Digestivo", "Cirurgia Geral", "Cirurgia Oncológica",
        "Cirurgia Pediátrica", "Cirurgia Torácica", "Cirurgia Vascular", "Cirurgia Plástica", "Clínico Geral",
        "Coloproctologista", "Curativos e Feridas Complexas", "Endocrinologista", "Gastroenterologista",
        "Geriatra", "Ginecologista", "Hematologista", "Neurologia Clínica", "Neurologia Cirúrgica Coluna",
        "Obstetrícia", "Oncologista", "Ortopedia e Traumatologia Cirurgia da Mão",
        "Ortopedia e Traumatologia Coluna", "Ortopedia e Traumatologia Joelho",
        "Ortopedia e Traumatologia Ombro e Cotovelo", "Ortopedia e Traumatologia Pé e Tornozelo",
        "Ortopedia Geral", "Otorrinolaringologista", "Pediatria", "Pneumologista", "Psiquiatra",
        "Reumatologista", "Uroginecologista", "Urologista",
    ], "Av. Eng. Fábio Roberto Barnabé, nº 1870. Vila Sfeir- Indaiatuba/SP", ["(19) 3834-4877", "(19) 3751-3770"]),
    unidade("Centro Médico São Camilo", "Especialidades Eletivas", [
        "Cardiologia", "Cirurgia Bariátrica", "Cirurgia Geral", "Cirurgia Pediátrica",
        "Cirurgia Plástica Reparadora", "Cirurgia Robótica", "Clínico Geral", "Dermatologia", "Gastrocirurgia",
        "Gastroenterologia", "Ginecologia e Obstetrícia", "Hematologia", "Mastologia", "Nefrologia",
        "Neuro Cirurgia Coluna", "Oncologista", "Ortopedia do Esporte", "Ortopedia e Traumatologia",
        "Otorrinolaringologia", "Pediatria", "Psiquiatria", "Reumatologia", "Urologia", "Vascular",
    ], "Rua Miguel Fernandes Garcia Filho, nº 540. Chácara Areal - Indaiatuba/SP",
        ["(19) 3834-4877", "(19) 3751-3770"]),
    unidade("Vera Cruz Medicina Diagnóstica", "Unidade Hospital Vera Cruz", [], "Av Doutor Jesuíno Marcondes Machado, nº 394. Nova Campinas - Campinas/SP", ["(19) 3739-3700"]),
    unidade("Vera Cruz Medicina Diagnóstica", "Unidade Casarão do Café", [], "Av. Andrade Neves, nº 402. Centro - Campinas/SP", ["(19) 3739-3700"]),
    unidade("Vera Cruz Medicina Diagnóstica", "Unidade Castelo", ["Imagem / Radiologia"],
        "Av. Francisco José de Camargo Andrade, nº 216. Jd. Chapadão - Campinas/SP", ["(19) 3739-3700"]),
    unidade("Vera Cruz Medicina Diagnóstica", "Unidade São Camilo", ["Imagem / Radiologia"],
        "Rua Miguel Fernandes Garcia Filho, nº 540. Chácara Areal - Indaiatuba/SP", ["(19) 3834-4877", "(19) 3751-3770"]),
    unidade("Vera Cruz Medicina Laboratorial", "Unidade Nova Campinas", [], "Av Doutor Jesuíno Marcondes Machado, nº 394. Nova Campinas - Campinas/SP", ["(19) 3751-3770"]),
    unidade("Vera Cruz Medicina Laboratorial", "Unidade Centro", [], "Rua Onze de Agosto, nº 400. Centro - Campinas/SP", ["(19) 3751-3770"]),
    unidade("Vera Cruz Medicina Laboratorial", "Unidade São Camilo", [], "Rua Miguel Fernandes Garcia Filho, nº 540. Chácara Areal - Indaiatuba/SP", ["(19) 3834-4877", "(19) 3751-3770"]),
]

# No Ouro, o Ambulatório Casa de Saúde ganha "Medicina da Família" e "Pediatria" a mais,
# e o Centro Clínico Nova Campinas troca a lista de especialidades (mais completa).
UNIDADES_OURO_EXTRA = [
    unidade("Laboratório Confiance", "Unidade Tuiuti", [], "Rua Tuiuti, nº 21. Jardim Rossignatti, Indaiatuba/SP", ["(19) 3727-3393"]),
    unidade("Laboratório Confiance", "Unidade Cambuí", [], "Av. Orosimbo Maia, nº 1000. Cambuí Campinas/SP", ["(19) 3727-3393"]),
    unidade("Laboratório Confiance", "Unidade Taquaral", [], "Av. Dr. Heitor Penteado, nº 1080. Jardim Nossa Sra. Auxiliadora, Campinas/SP", ["(19) 3727-3393"]),
    unidade("Laboratório Confiance", "Unidade Castelo", [], "Av. Francisco José de Camargo Andrade, nº 275. Castelo, Campinas/SP", ["(19) 3727-3393"]),
    unidade("Laboratório Confiance", "Unidade Parque Prado", [], "Av. Washington Luiz, nº 1823. Vila Marieta, Campinas/SP", ["(19) 3727-3393"]),
    unidade("Laboratório Confiance", "Unidade Hortolândia", [], "Rua Carvalho Brasileiro, nº 665. Jardim do Jatobá, Hortolândia/SP", ["(19) 3727-3393"]),
    unidade("Laboratório Sabin", "Unidade Taquaral", [], "Av. Heitor Penteado, nº 1334. Jardim Nossa Sra. Auxiliador, Campinas/SP", ["(19) 3733-6577"]),
    unidade("Laboratório Sabin", "Unidade Matriz", [], "Av. Brasil, nº 868. Jardim Guanabara, Campinas/SP", ["(19) 3733-6577"]),
    unidade("Laboratório Sabin", "Unidade Barão Geraldo", [], "Av. Doutor Romeu Tortima, nº 235. Barão Geraldo, Campinas/SP", ["(19) 3733-6577"]),
]

UNIDADES_OURO = list(UNIDADES_PRATA) + UNIDADES_OURO_EXTRA

# ---------- REDE CREDENCIADA (só no Vera Ouro), por cidade > especialidade > profissional ----------
def prof(nome, crm=None, endereco=None, fones=None):
    d = {"n": nome}
    if crm:
        d["crm"] = crm
    if endereco:
        d["e"] = endereco
    if fones:
        d["f"] = fones
    return d

CAMPINAS_CREDENCIADA = {
    "Acupuntura": [
        prof("Daniel Fumagalli", "CRM 101854", "Rua Rocha Camargo, nº 159. Jd. Guanabara - Campinas/SP", ["(19) 3213-6510"]),
        prof("Maria Valéria Pires D'avilla", "CRM 48795", "Rua Vasco Fernandes Coutinho, nº 483. Taquaral - Campinas/SP", ["(19) 99236-6663"]),
    ],
    "Alergia e Imunologia": [
        prof("Celso Henrique De Oliveira", "CRM 79471", "Rua Visconde de Taunay, nº 421 - Sala 32. Vila Itapura - Campinas/SP", ["(19) 3236-6797"]),
        prof("José Caetano de Thyenne Abreu Filho", "CRM 28680", "Rua Sacramento, 900 - Sala 02. Vila Itapura - Campinas/SP", ["(19) 3232-0737", "(19) 3232-5097"]),
    ],
    "Alergia e Imunologia Pediátrica": [
        prof("Ana Karina Labbate Cury Costa", "CRM 121673", "Rua Camargo Paes, nº 279. Jd. Guanabara - Campinas/SP", ["(19) 3242-8460"]),
    ],
    "Anestesiologia": [
        prof("Anescamp", None, "Av. Andrade Neves, nº 402. Centro Campinas/SP.", ["(19) 3751-3770"]),
    ],
    "Cardiologia": [
        prof("Antenor Bauch Junior", "CRM 37216", "Av. Andrade Neves, nº 707 - 7º andar - Sala 706. Centro - Campinas/SP", ["(19) 3232-9166", "(19) 2512-5649"]),
        prof("Danielle Cristina Salaomi Franca de Resende", "CRM 121434", "Rua Vasco Fernandes Coutinho, nº 483. Taquaral - Campinas/SP", ["(19) 99236-6663"]),
        prof("Fernanda Rafful Kanawaty Lima", "CRM 104098", "Rua Paulo Cezar Fidelis, nº 39 - 1º andar. Loteamento Residencial Vila Bella - Campinas/SP", ["(19) 3775-8300", "(19) 99927-0764"]),
        prof("Guilherme Chiariello Verri", "CRM 74480", "Rua Doutor Emilio Ribas, nº 1058. Cambuí - Campinas/SP", ["(19) 3294-1470", "(19) 98143-9524"]),
        prof("Luisa Carolina Borges Keiralla", "CRM 121029", "Rua Doutor Hermas Braga, nº 265. Nova Campinas - Campinas/SP", ["(19) 3255-0757", "(19) 3255-5503"]),
        prof("Mayara Brunheroto Lourenço", "CRM 102767", "Rua Campo de Pouso, nº 1313 - A. Centro - Holambra/SP", ["(19) 3802-4025"]),
        prof("Mayara Pacheco Goncalves Martins", "CRM 177065", "Av. Andrade Neves, nº 707 - 7º andar - Sala 706. Centro - Campinas/SP", ["(19) 3232-9166", "(19) 2512-5649"]),
        prof("Nathalia dos Reis de Moraes", "CRM 146729", "Av. Orosimbo Maia, 360 - Sala 208/209. Centro - Campinas/SP", ["(19) 3234-2257", "(19) 99483-3171"]),
        prof("Silvio Luiz Pollini Gonçalves", "CRM 55327", "Av. Andrade Neves, nº 707 - 7º andar - Sala 706. Centro - Campinas/SP", ["(19) 3232-9166", "(19) 2512-5649"]),
        prof("Vitorio Verri", "CRM 11480", "Rua Avelino Silveira Franco, nº 149 - Bloco 1 - Sala 309 Ville Sainte Helene - Sousas/SP", ["(19) 99979-2609"]),
    ],
    "Cardiologia Pediátrica": [
        prof("Ana Paula Damiano", "CRM 87883", "Rua Barão Geraldo de Resende, nº 97 - Sala 609 e 610. Botafogo - Campinas/SP", ["(19) 3231-1101", "(19) 99865-1198"]),
        prof("Verônica Cecilia Hodar Luengo", "CRM 83003", "Rua Sebastião de Souza, nº 205 - 8º andar - Sala 84 Centro - Campinas/SP", ["(19) 3739-8890"]),
    ],
    "Cirurgia Bucomaxilofacial": [
        prof("Cecilia Regina Gonzaga Frazatto", "CRO 39469", "Av. José Bonifácio, nº 2122. Jd das Paineiras - Campinas/SP", ["(19) 3255-6826", "(19) 3294-0588"]),
        prof("Laura Helena Aparecida Aguirre D'Ottaviano", "CRO 28217", "Av. Andrade Neves, nº 402 - Hospital Vera Cruz Centro - Campinas/SP", ["(19) 3734-3357"]),
        prof("Veraodonto", None, "Av. Andrade Neves, nº 402 - Hospital Vera Cruz - Centro - Campinas/SP", ["(19) 3734-3357"]),
    ],
    "Cirurgia Cardíaca": [
        prof("Cledicyon Eloy da Costa", "CRM 73464", "Av. Orosimbo Maia, 360 - 7ºandar - Sala 714. Centro - Campinas/SP", ["(19) 3232-3856", "(19) 3253-0074"]),
        prof("Gustavo Calado de Aguiar Ribeiro", "CRM 77345", "Av. Orosimbo Maia, 360 - 7ºandar - Sala 714. Centro - Campinas/SP", ["(19) 3232-3856", "(19) 3253-0074"]),
        prof("Maurício Marson Lopes", "CRM 78686", "Av. Orosimbo Maia, 360 - 7ºandar - Sala 714. Centro - Campinas/SP", ["(19) 3232-3856", "(19) 3253-0074"]),
        prof("G.A.C - Grupo de Arritmia Campinas", None, "Av. Doutor Hermas Braga, 265. Nova Campinas - Campinas/SP", ["(19) 3255-5503", "(19) 97417-1247"]),
    ],
    "Cirurgia Cardíaca Pediátrica": [
        prof("Fernando Antonialli", "CRM 87929", "Av. Orosimbo Maia, 360 - 7ºandar - Sala 714. Centro - Campinas/SP", ["(19) 3232-3856", "(19) 3253-0074"]),
        prof("G.A.C - Grupo de Arritmia Campinas", None, "Av. Doutor Hermas Braga, 265. Nova Campinas - Campinas/SP", ["(19) 3255-5503", "(19) 97417-1247"]),
    ],
    "Cirurgia da Mão": [
        prof("Marisa de Souza Silva Morelli Girondo", "CRM 61273", "Rua Duque de Caxias, nº 780 - 10º andar - Sala 102. Centro - Campinas/SP", ["(19) 3203-0806", "(19) 3233-6828"]),
    ],
    "Cirurgia de Cabeça e Pescoço": [
        prof("Daniel Guarda Manso", "CRM 114755", "Av. Orosimbo Maia, 430 - Edifício Easy Office 11º andar - Sala 1116", ["(19) 3234-6641", "(19) 97118-7836"]),
        prof("Flavio Mignone Gripp", "CRM 54859", "Rua Barão de Itapura, nº 708. Botafogo - Campinas/SP", ["(19) 3232-2999", "(19) 99752-7474"]),
        prof("Maurício Marson Lopes", "CRM 78686", "Av. Orosimbo Maia, 360 - 7º andar - Sala 714. Centro - Campinas/SP", ["(19) 3232-3856", "(19) 3253-0074"]),
        prof("G.A.C - Grupo de Arritmia Campinas", None, "Av. Doutor Hermas Braga, 265. Nova Campinas - Campinas/SP", ["(19) 3255-5503", "(19) 97417-1247"]),
    ],
    "Cirurgia e Traumatologia Bucomaxilofacial": [
        prof("Veraodonto", None, "Av. Andrade Neves, nº 402 - Hospital Vera Cruz Centro - Campinas/SP", ["(19) 3734-3357"]),
    ],
    "Cirurgia Geral": [
        prof("Alcindo Cortelazzi Junior", "CRM 24527", "Av. Andrade Neves, nº 784 - 5ºandar - Sala A. Centro - Campinas/SP", ["(19) 3231-0800", "(19) 3234-7788"]),
        prof("Alessio Simões Junior", "CRM 30460", "Av. Andrade Neves, nº 389. Centro - Campinas/SP", ["(19) 3232-1112", "(19) 3234-4804"]),
        prof("Anaisa Portes Ramos", "CRM 124581", "Rua Tiradentes, nº 293 - 2º andar - Conj. 24. Vila Itapura - Campinas/SP", ["(19) 2117-3336", "(19) 2117-2220", "(19) 98930-3006"]),
        prof("Carlos Francisco Gonzaga Frazatto", "CRM 61455", "Rua Orlando Fagnani, nº 488. Jd. Planalto - Campinas/SP", ["(19) 3232-1112", "(19) 3234-4804"]),
        prof("Gustavo José Seiffert", "CRM 74733", "Rua Barão de Jaguará, nº 1481 - 16º andar - Sala 165. Centro - Campinas/SP", ["(19) 3237-9410"]),
        prof("Hercio Azevedo de Vasconcelos Cunha", "CRM 89105", "Rua Américo de Moura, nº 5. Jd Dom Bosco - Campinas/SP", ["(19) 3579-1515"]),
        prof("João de Souza Coelho Neto", "CRM 77716", "Av. Doutor Heitor Penteado, nº 522 - Jd. Nossa Senhora Auxiliadora - Campinas/SP", ["(19) 3212-3330", "(19) 97410-3214"]),
        prof("Wilson Roberto Gouveia Martinuzzo", "CRM 67163", "Rua Tiradentes, 293 - 2º andar - Conj. 24. Vila Itapura - Campinas/SP", ["(19) 3579-1770"]),
    ],
    "Cirurgia Pediátrica": [
        prof("Ana Paula Campos Melro", "CRM 82303", "Av. Andrade Neves, nº 295 - 10º andar - Sala 103. Centro - Campinas/SP", ["(19) 3512-5080", "(19) 3512-5164"]),
        prof("Rodrigo Maselli Thome Garcia", "CRM 105550", "Rua Doutor Hermas Braga, nº 777. Nova Campinas - Campinas/SP", ["(19) 3251-3747", "(19) 3251-3467", "(19) 9992-2146"]),
    ],
    "Cirurgia Plástica": [
        prof("Cassio Mauricio Iannuzzi Amancio", "CRM 74381", "Av. Dr. Hermas Braga, nº 777. Nova Campinas - Campinas/SP", ["(19) 3251-3747", "(19) 3251-3467"]),
        prof("Gilberto Mariano de Rezende", "CRM 31087", "Av. Doutor Heitor Penteado, nº 1105. Parque Taquaral - Campinas/SP", ["(19) 3212-3015", "(19) 3212-1754"]),
        prof("Regina Maura do Nascimento", "CRM 107914", "Rua Barreto Leme, nº 2486. Cambuí - Campinas/SP", ["(19) 3253-2033", "(19) 3253-4040", "(19) 99134-3833"]),
    ],
    "Cirurgia Torácica": [
        prof("José Claudio Teixeira Seabra", "CRM 51521", "Rua Paulo Castro Pupo Nogueira, nº 125 Nova Campinas - Campinas/SP", ["(19) 3294-6318", "(19) 3252-4105"]),
        prof("Marcelo Manzano Said", "CRM 67655", "Av. Andrade Neves, nº 389 Centro - Campinas/SP", ["(19) 3232-1112", "(19) 3254-7482"]),
    ],
    "Cirurgia Vascular": [
        prof("Alexandre Clabunde dos Santos", "CRM 97664", "Rua Barata Ribeiro, nº 530 - 5º andar - Sala 51 A. Vila Itapura - Campinas/SP", ["(19) 3231-3555", "(19) 3232-7104"]),
        prof("Caroline Baschirotto Orbem", "CRM 202477", "Rua Campo de Pouso, nº 1313 - A. Centro - Holambra/SP", ["(19) 3802-4025"]),
        prof("João Henrique Botto de Oliveira", "CRM 174228", "Rua Barata Ribeiro, nº 530 - 2º andar - Sala 23. Vila Itapura - Campinas/SP", ["(19) 3231-1516", "(19) 3232-5115", "(19) 99762-0096"]),
        prof("Fernando Daiggi", "CRM 117092", "Rua Barata Ribeiro 530 5ª Sala 51. Campinas/SP", ["(19) 32562798"]),
        prof("Juliana Sander Suguita", "CRM 111454", "Av. Orosimbo Maia, nº 430 - Sala 214. Centro - Campinas/SP", ["(19) 3235-2609", "(19) 99996-2002"]),
        prof("Leticia Scolfaro Celegão", "CRM 113257", "Rua Conceição, nº 233 - 14º andar - Sala 1402. Centro - Campinas/SP", ["(19) 3234-4238", "(19) 98963-6380"]),
        prof("Lucas Botossi Trindade", "CRM 135016", "Rua Barata Ribeiro, nº 530 - Salas 51 e 53. Vila Itapura - Campinas/SP", ["(19) 3232-7104", "(19) 3231-3555", "(19) 99974-4848"]),
        prof("Lucas Marcelo Dias Freire", "CRM 104118", "Rua Barata Ribeiro, nº 531 - Sala 51. Vila Itapura - Campinas/SP", ["(19) 3232-7104", "(19) 3231-3555", "(19) 99974-4848"]),
        prof("Stefano Prado Russo Marques", "CRM 149142", "Av. Major Alfredo Camargo Fonseca, nº 138. Cidade Nova I - Indaiatuba/SP", ["(19) 99873-5247"]),
    ],
    "Clínica Médica": [
        prof("Antenor Bauch Junior", "CRM 37216", "Av. Andrade Neves, nº 707 - 7º andar - Sala 706. Centro - Campinas/SP", ["(19) 3232-9166", "(19) 2512-5649"]),
        prof("Carla Adriane Roballo Bertelli", "CRM 146243", "Av. Barão de Itapura, nº 610 - 5º andar - Sala 502. Botafogo - Campinas/SP", ["(19) 99186-8662"]),
        prof("Luciane Gottardo Nunes", "CRM 94138", "Consultório I: Av. Engenheiro Fabio Roberto Barnabé, nº 1980. Jd. Esplanada - Indaiatuba/SP", ["(19) 3825-7800", "(19) 3825-3894", "(19) 99408-2570"]),
        prof("Mayara Brunheroto Lourenço", "CRM 102767", "Rua Campo de Pouso, nº 1313 - A. Centro - Holambra/SP", ["(19) 3802-4025"]),
        prof("Silvio Luiz Pollini Gonçalves", "CRM 55327", "Av Andrade Neves, nº 707 - 7º andar - Sala 706. Centro - Campinas/SP", ["(19) 3232-9166", "(19) 2512-5649"]),
    ],
    "Coloproctologia": [
        prof("Gustavo José Seiffert", "CRM 74733", "Rua Barão de Jaguará, nº 1481 - 16º andar - Sala 165. Centro - Campinas/SP", ["(19) 3237-9410"]),
        prof("João de Souza Coelho Neto", "CRM 77716", "Av. Doutor Heitor Penteado, nº 522. Jd. Nossa Senhora Auxiliadora - Campinas/SP", ["(19) 3212-3330", "(19) 974-103217"]),
        prof("Jose Humberto Soares Teles", "CRM 17711", "Av. Barão de Itapura, nº 1100 - 3º andar - Sala 33. Jd. Guanabara - Campinas/SP", ["(19) 3234-3581", "(19) 3239-0621"]),
        prof("Priscilla de Sene Portel Oliveira", "CRM 120008", "Rua Barão Geraldo de Resende, nº 282 - 4º andar - Cj 44. Botafogo - Campinas/SP", ["(19) 3232-3199", "(19) 3132-0003"]),
        prof("Wilson Roberto Gouveia Martinuzzo", "CRM 67163", "Rua Tiradentes, nº 293 - 2º andar - Sala 24. Vila Itapura - Campinas/SP", ["(19) 3579-1770", "(19) 3579-1771"]),
    ],
    "Dermatologia": [
        prof("Adriana Chaib Ferreira Jorge", "CRM 160923", "Rua Barão de Atibaia, nº 200. Guanabara - Campinas/SP", ["(19) 3231-1211", "(19) 3231-1012"]),
        prof("Ana Josefina Da Costa Brandao Prota", "CRM 49355", "Rua Padra Almeida, nº 515 - 7º andar - Cj. 71. Cambuí - Campinas/SP", ["(19) 3294-1933", "(19) 3295-7471"]),
        prof("Ana Paula Giovannetti", "CRM 82181", "Av. Andrade Neves, nº 295 - 7º andar - Sala 71. Centro - Campinas/SP", ["(19) 3236-2330", "(19) 3512-5083", "(19) 98966-1760"]),
        prof("Antonio Francisco Bastos Filho", "CRM 95321", "Rua dos Bandeirantes, nº 600. Cambuí - Campinas/SP", ["(19) 3251-9606", "(19) 3307-9886", "(19) 97404-9390"]),
        prof("Carlos Alberto Ferreira Jorge", "CRM 32436", "Rua Barão de Atibaia, nº 200. Guanabara - Campinas/SP", ["(19) 3231-1211", "(19) 3231-1012"]),
        prof("Juliana Chaib Ferreira Jorge Padilla", "CRM 129756", "Rua Barão de Atibaia, nº 200. Guanabara - Campinas/SP", ["(19) 3231-1211", "(19) 3231-1012"]),
        prof("Maura Simões Bressan Hausen", "CRM 92982", "Av. José de Sousa Campos, nº 1073 - Sala 08. Cambuí - Campinas/SP", ["(19) 3254-0017", "(19) 99824-0017"]),
        prof("Theodoro Habermann", "CRM 70488", "Rua Barato Ribeiro, nº 552 - 3º andar - Sala 3. Vila Itapura - Campinas/SP", ["(19) 3235-1660", "99629-6900"]),
        prof("Vivian Zulian Fernandes", "CRM 95935", "Rua Joaquim Pinto de Moraes, nº 127. Jd. das Paineiras - Campinas/SP", ["(19) 3294-9481", "(19) 3295-9007", "(19) 98184-7105"]),
    ],
    "Endocrinologia": [
        prof("Elizabeth Cristina Del Cistia Baccili", "CRM 86788", "Av. Andrade Neves, nº707 - Sala 405. Centro - Campinas/SP", ["(19) 97145-8464"]),
        prof("Fernanda Maria Possidonio Filgueira Hirsch", "CRM 126421", "Rua Doutor Manoel Afonso Ferreira, nº 222. Jd. Paraíso - Campinas/SP", ["(19) 3254-7620"]),
        prof("Isabella Fagian Pansani", "CRM 176932", "Rua Visconde de Taunay, nº 305. Vila Itapura - Campinas/SP", ["(19) 3236-5915", "(19) 3231-9542", "(19) 99442-0597"]),
        prof("João Paulo Iazigi", "CRM 82669", "Av. Andrade Neves, nº 707 - 4º andar. Centro - Campinas/SP", ["(19) 3234-2793", "(19) 99103-3807"]),
        prof("José Carlos Morelli", "CRM 42699", "Rua Sebastião de Souza, nº 205 - 3º andar - Cj 32. Centro - Campinas/SP", ["(19) 3231-9597", "(19) 3739-6655"]),
        prof("Juliana Barella", "CRM 112397", "Rua Barão Geraldo de Resende, nº 97 - Térreo - Sala 03. Botafogo - Campinas/SP", ["(19) 3291-8538", "(19) 98309-2827"]),
        prof("Marcelo Miranda de Oliveira Lima", "CRM 105722", "Rua Paulo Cezar Fidelis, nº 39 - 1º andar. Loteamento Residencial Vila Bella - Campinas/SP", ["(19) 3775-8300", "(19) 99927-0764"]),
        prof("Natasha Bertani Milani Trindade", "CRM 130908", "Rua Barata Ribeiro, nº 530 - sala 51. Vila Itapura - Campinas SP", ["(19) 3232-7104", "(19) 3231-3555", "(19) 99974-4848"]),
        prof("Sylka D Oliveira Rodovalho Geloneze", "CRM 66009", "Rua Engenheiro Carlos Stevenson, nº 560. Nova Campinas - Campinas/SP", ["(19) 3253-4200", "(19) 99231-5910"]),
    ],
    "Endocrinologia Pediátrica": [
        prof("Isabella Fagian Pansani", "CRM 176932", "Rua Visconde de Taunay, nº 305. Vila Itapura - Campinas/SP", ["(19) 3236-5915", "(19) 3231-9542", "(19) 99442-0597"]),
        prof("Juliana Barella", "CRM 112397", "Rua Barão Geraldo de Resende, nº 97 - Térreo - Sala 03. Botafogo - Campinas/SP", ["(19) 3291-8538", "(19) 98309-2827"]),
    ],
    "Fisiatra": [
        prof("Affonso Carneiro Filho", "CRM 23132", "Rua Delfino Cintra, nº 991. Botafogo - Campinas/SP", ["(19) 3733-4733"]),
        prof("Guilherme Marostegan e Carneiro", "CRM 121474", "Rua Delfino Cintra, nº 991. Botafogo - Campinas/SP", ["(19) 3733-4733"]),
    ],
    "Fisioterapeuta": [
        prof("Sabrina Daniela Freitas Da Silva", "CRM 67040 (Uroginecológica)", "Av. Princesa D'Oeste, nº 615 - Sala 2 e 3. Jd. Proença - Campinas/SP", ["(19) 99945-1465"]),
        prof("Fisio Clínica", None, "Rua Delfino Cintra, nº 991. Botafogo - Campinas/SP", ["(19) 3733-4733"]),
        prof("Instituto Patrícia Lacombe", None, "Rua Doutor Antônio Galízia, nº 25. Cambuí - Campinas/SP", ["(19) 3751-4000"]),
        prof("One Fisio", None, "Doutor Albano de Almeida Lima, 284. Jardim Guanabara - Campinas/SP", ["(19) 3305-7077", "(19) 97811-7846"]),
    ],
    "Fisioterapia Respiratória": [
        prof("Carlos José Gonzaga Frazatto", "CRM 13145", "Rua Antonio Lapa, nº 510. Cambuí - Campinas/SP", ["(19) 3252-3648"]),
    ],
    "Fonoaudiologia": [
        prof("Atilio Laudemir do Prado", "CRFA 219787", "Av. Andrade Neves, nº707 - Sala 405. Centro - Campinas/SP", ["(19) 97145-8464"]),
        prof("Bianca Caroline de Morais Mello Martins", "CRFA 2-21722", "Rua Claudino Lopes, nº 311 - Casa Frente. Jd. Londres - Campinas/SP", ["(19) 99586-9323"]),
        prof("Milene Erika Faneco", "CRFA 2-19786", "Rua Jacareí, nº 50 - Sala 04. Vila Carlito - Campinas/SP", ["(19) 99152-9411"]),
        prof("Patrícia Montagna Vianna", "CRFA 7384", "Av. Doutor Jesuíno Marcondes Machado, nº 2358. Chácara da Barra - Campinas/SP", ["(19) 99123-4318"]),
        prof("Priscila Leme", "CRFA 215156", "Rua Frei António de Pádua, nº 1263. Jd. Guanabara - Campinas/SP", ["(19) 3243-5917", "(19) 99790-5344"]),
    ],
    "Gastroenterologia": [
        prof("Aldo Jose Serafini de Araújo", "CRM 43398", "Rua Tiradentes, nº 289 - 3º andar - Sala 34. Vila Itapura - Campinas/SP", ["(19) 3234-8611", "(19) 3236-4266"]),
        prof("Antônio Frederico Novais de Magalhães", "CRM 11296", "Rua Coronel Francisco Andrade Coutinho, nº 9. Cambuí - Campinas/SP", ["(19) 3397-5424"]),
        prof("João De Souza Coelho Neto", "CRM 77716", "Av. Doutor Heitor Penteado, nº 522. Jd. Nossa Senhora Auxiliadora - Campinas/SP", ["(19) 3212-3330", "(19) 97410-3217"]),
        prof("Nelson De Camargo Lima Junior", "CRM 41935", "Av. Andrade Neves, nº 784 - 5º andar - Sala A. Centro - Campinas/SP", ["(19) 3234-7788", "(19) 3233-7797"]),
        prof("Stefano Gonçalves Jorge", "CRM 88173", "Av Andrade Neves, nº 2412 - Sala 41. Jd. Chapadão - Campinas/SP", ["(19) 3212-1513", "(19) 99247-7679"]),
    ],
    "Gastroenterologia Pediátrica": [
        prof("Giselle Braga Jara", "CRM 119967", "Rua Camargo Paes, nº 776. Jd. Guanabara - Campinas/SP", ["(19) 2512-6989", "(19) 99810-1822"]),
        prof("Vanessa de Souza", "CRM 113557", "Av. Orosimbo Maia, nº 430 - 7º andar - Sala 710, Ed. Easy Office - Centro - Campinas/SP", ["(19) 4141-1088"]),
    ],
    "Geneticista": [
        prof("Walter Pinto Junior", "CRM 15411", "Av. Tenente Haraldo Egídio de Souza Santo, nº 672. Jd. Chapadão - Campinas/SP", ["(19) 3243-2544", "(19) 99204-8460"]),
    ],
    "Geriatria": [
        prof("Giuliana Lopes Fantinelli", "CRM 155084",
             "Consultório I: Rua Crescencio da Silveira Pupo, nº 75 - 9º andar. Ed. Inside Corporate - Vila Cassaro - Itatiba/SP",
             ["(11) 4534-0175", "(11) 99796-0175"]),
        prof("Julio Cesar do Pinho Moreira", "CRM 125312", "Rua Salvador Lombardi Neto, nº 260. Nova Paulínia - Paulínia/SP", ["(19) 3844-8515"]),
    ],
    "Ginecologia e Obstetrícia": [
        prof("Ana Rita de Tullio Gomes Garrido", "CRM 115304", "Rua Oscar Alves Costa, nº 91. Jd. Santa Genebra - Campinas/SP", ["(19) 3325-0628", "(19) 99863-1366"]),
        prof("Andre Arruda", "CRM 70382", "Av. Andrade Neves, nº 699 - 6º andar. Centro - Campinas/SP", ["(19) 3232-4255"]),
        prof("Caio Augusto Hartman", "CRM 112531", "Rua Barão Geraldo de Resende, nº 97 - Sala 508. Vila Itapura - Campinas/SP", ["(19) 3367-2282", "(19) 98904-2000"]),
        prof("Edilson Benedito de Castro", "CRM 83108", "Av. José Bonifácio, nº 2296. Jd. das Paineiras - Campinas/SP", ["(19) 3255-6711", "(19) 98135-9345"]),
        prof("Eiji Kashimoto", "CRM 91192", "Rua Barão de Itapura, nº 610 - Sala 203 e 204 - Edifício Medplex - Botafogo - Campinas/SP", ["(19) 3251-8399", "(19) 3294-1655"]),
        prof("Fabio Aiello Padilla", "CRM 112036", "Rua Barão de Atibaia, nº 200. Vila Itapura - Campinas/SP", ["(19) 3231-1012", "(19) 3231-1211"]),
        prof("Francisco Eduardo Prota", "CRM 33256", "Av. Andrade Neves, nº 707 - 5º andar - Sala 503. Centro - Campinas/SP", ["(19) 3231-0811", "(19) 99655-8008"]),
        prof("José Alberto Barbosa Lima", "CRM 38297", "Rua Onze de Agosto, nº 458. Centro - Campinas/SP", ["(19) 3233-8845", "(19) 3235-1848"]),
        prof("Magda Loureiro Motta Chinaglia", "CRM 61520", "Rua Braúna, nº 16. Jd. Presidente Wenceslau - Campinas/SP", ["(19) 3294-8975", "(19) 98345-8397"]),
        prof("Marco Antonio Rocha Palhares", "CRM 80533", "Av. Orosimbo Maia, nº 360 - 13º andar - Sala 1302. Centro - Campinas/SP", ["(19) 3324-7288", "(19) 3324-7215", "(19) 99789-0871"]),
        prof("Marcos Ferreira de Carvalho", "CRM 61065", "Rua Conceição, nº 233 - 5º andar - Sala 515 e 516. Centro - Campinas/SP", ["(19) 3232-0101", "(19) 99610-0777"]),
        prof("Maria Gabriela Loffredo D'Ottaviano", "CRM 80538", "Rua Braúna, nº 16. Jd. Presidente Wenceslau - Campinas/SP", ["(19) 3294-8975", "(19) 98345-8397"]),
        prof("Mariana Patelli Juliani de Souza Lima", "CRM 111810", "Rua Braúna, nº 16. Jd. Presidente Wenceslau - Campinas/SP", ["(19) 3294-8975", "(19) 98345-8397"]),
        prof("Micaela Villoni Sperlescu", "CRM 86021", "Av. Andrade Neves, nº 784 - 6º andar - Sala 6B. Centro - Campinas/SP", ["(19) 3231-5829", "(19) 3237-9425"]),
        prof("Patrícia Leone Campos Nicastro", "CRM 89133", "Av. Andrade Neves, nº 707 - 7º andar - Sala 703. Centro - Campinas/SP", ["(19) 3512-5016", "(19) 3342-8777"]),
        prof("Vanessa de Souza Santos Machado", "CRM 119917", "Rua Braúna, nº 16. Jd. Presidente Wenceslau - Campinas/SP", ["(19) 3294-8975", "(19) 98345-8397"]),
    ],
    "Hematologia": [
        prof("Afonso Celso Vigorito", "CRM 55970", "Av. Doutor Jesuíno Marcondes Machado, nº 329. Nova Campinas - Campinas/SP", ["(19) 3751-3960", "(19) 3751-3770"]),
        prof("Francisco José Penteado Aranha", "CRM 51191", "Av. Doutor Jesuíno Marcondes Machado, nº 329. Nova Campinas - Campinas/SP", ["(19) 3751-3960", "(19) 3751-3770"]),
        prof("José Francisco Comanelli Marques Junior", "CRM 51093", "Av. Doutor Jesuíno Marcondes Machado, nº 329. Nova Campinas - Campinas/SP", ["(19) 3751-3960", "(19) 3751-3770"]),
        prof("Melina Veiga Rodrigues", "CRM 153877", "Av. Doutor Jesuíno Marcondes Machado, nº 329. Nova Campinas - Campinas/SP", ["(19) 3751-3960", "(19) 3751-3770"]),
    ],
    "Hepatologia": [
        prof("Stefano Gonçalves Jorge", "CRM 88173", "Av. Andrade Neves, nº 2412 - Sala 41. Jd. Chapadão - Campinas/SP", ["(19) 3212-1513", "(19) 99247-7679"]),
    ],
    "Homeopatia": [
        prof("Gabriel Travaini", "CRM 20796", "Rua Doutor Vieira Bueno, nº 142. Cambuí - Campinas/SP", ["(19) 3254-0747", "(19) 3254-4012"]),
        prof("Juarez Martins De Souza", "CRM 35268", "Rua Américo Brasiliense, nº 232. Cambuí - Campinas/SP", ["(19) 2514-1029", "(19) 98137-6681"]),
        prof("Paulo de Tarso Seixas", "CRM 60922", "Rua Gonçalves Cesar, nº 383. Jd. Guanabara - Campinas/SP", ["(19) 3242-2625"]),
    ],
    "Infectologia": [
        prof("Marcelo Nardi Pedro", "CRM 93159", "Rua Padre Almeida, nº 330. Cambuí - Campinas/SP", ["(19) 3252-3175", "(19) 3252-4624"]),
        prof("Rogerio De Jesus Pedro", "CRM 13373", "Rua Padre Almeida, nº 330. Cambuí - Campinas/SP", ["(19) 3252-3175", "(19) 3252-4624"]),
        prof("Vera Marcia Souza Lima Rufeisen", "CRM 77381", "Av. Orosimbo Maia, nº 430 - 8º andar - Sala 817. Cambuí - Campinas/SP", ["(19) 3295-8304"]),
    ],
    "Mastologia": [
        prof("André Arruda", "CRM 70382", "Av. Andrade Neves, nº 699 - 6º andar. Centro - Campinas/SP", ["(19) 3232-4255"]),
        prof("Maria Gabriela Loffredo D'Ottaviano", "CRM 80538", "Rua Braúna, nº 16. Jd. Presidente Wenceslau - Campinas/SP", ["(19) 3294-8975", "(19) 98345-8397"]),
    ],
    "Nefrologia": [
        prof("Alessandro Munhoz Parmigiani", "CRM 84883", "Av. Doutor Heitor Penteado, nº1887. Jd. Nossa Senhora Auxiliadora - Campinas/SP", ["(19) 3741-4180", "(19) 3242-2326"]),
        prof("Gabriel Giollo Rivelli", "CRM 125882", "Av. Doutor Heitor Penteado, nº 2041. Parque Taquaral - Campinas/SP", ["(19) 3796-2800", "(19) 99946-7661"]),
        prof("Janaina Oliveira Gondim", "CRM 98622", "Av. Doutor Jesuíno Marcondes Machado, nº 1065. Jd. Planalto - Campinas/SP", ["(19) 2513-1717", "(19) 2513-6888"]),
        prof("Jean Carlo Tibes Hachmann", "CRM 80576", "Av. Doutor Heitor Penteado, nº 509. Jd. Nossa Senhora Auxiliadora - Campinas/SP", ["(19) 3741-4180", "(19) 3242-2326"]),
        prof("Milton Huehara", "CRM 37842", "Rua Duque de Caxias, nº 642 - 5º andar - Sala 51. Centro - Campinas/SP", ["(19) 3231-0437", "(19) 3231-1253", "(19) 99401-5338"]),
        prof("Davita Serviços de Nefrologia", None, "Av. Doutor Jesuíno Marcondes Machado, nº 1065. Jd Planalto - Campinas/SP", ["(19) 3342-2326"]),
        prof("Davita Serviços de Nefrologia - Unidade Taquaral", None, "Doutor Heitor Penteado, nº 509. Jardim Nossa Senhora Auxiliadora - Campinas/SP", ["(19) 3741-4180"]),
        prof("Nefrocamp", None, "Rua Barbosa da Cunha, nº 603 Jd Guanabara - Campinas/SP", ["(19) 3212-0379", "(19) 99401-5338"]),
    ],
    "Neurocirurgia": [
        prof("Carlos Alberto Morassi Melro", "CRM 61176", "Av. Andrade Neves, nº 295 - 10º andar - Sala 103. Centro - Campinas/SP", ["(19) 3512-5080", "(19) 3512-5164"]),
        prof("João Flávio de Mattos Araújo", "CRM 58204", "Rua Amazonas, nº 62. Fundação Casa Popular - Campinas/SP", ["(19) 3273-4004"]),
        prof("José Paulo Montemor", "CRM 29348", "Rua Tiradentes, nº 827. Vila Itapura - Campinas/SP", ["(19) 3232-2004"]),
        prof("Juliana Rebechi Zuiani", "CRM 129532", "Av. José Bonifácio Coutinho Nogueira, nº 214 - Sala 412 - Jd. Madalena - Campinas/SP", ["(19) 3206-1114", "(19) 3207-4485", "(19) 99889-2251"]),
        prof("Leonardo de Deus Silva", "CRM 95975", "Rua Doutor Clemente Ferreira, nº 44. Botafogo - Campinas/SP", ["(19) 3397-5186", "(19) 2512-6212"]),
        prof("Luís Otavio Carneiro Pontelli", "CRM 151727", "Rua Dona Elidia Ana de Campos, nº 715. Jd Dom Bosco - Campinas/SP", ["(19) 3236-8812", "(19) 3326-8813", "(19) 99998-7166"]),
        prof("Raphael Martinelli Anson Sangenis", "CRM 131131", "Rua Doutor Clemente Ferreira, nº 44. Botafogo - Campinas/SP", ["(19) 3397-5186", "(19) 2512-6212"]),
    ],
    "Neuropediatria": [
        prof("Cynthia Bonilha da Silva", "CRM 115793", "Av. Doutor Heitor Penteado, nº 610. Jd. Nossa Senhora Auxiliadora - Campinas/SP", ["(19) 3254-2945", "(19) 99994-6055"]),
        prof("José Henrique Figueiredo Rached", "CRM 64247", "Av. Barão de Itapura, nº 385. Botafogo - Campinas/SP", ["(19) 3231-4110", "(19) 3234-9498"]),
        prof("Silvyo David Araújo Giffoni", "CRM 80464", "Rua Paulo Cezar Fidelis, nº 39 - 1º andar. Alto Taquaral - Campinas/SP", ["(19) 3756-1080", "(19) 3775-8300"]),
    ],
    "Neurologia": [
        prof("Claudia Veiga De Castro", "CRM 68052", "Av. Andrade Neves, nº 295 - 8º andar - Sala 81. Centro - Campinas/SP", ["(19) 3512-5083"]),
        prof("Leonardo de Deus Silva", "CRM 95975", "Rua Doutor Clemente Ferreira, nº 44. Botafogo - Campinas/SP", ["(19) 3397-5186", "(19) 2512-6212"]),
        prof("Lívia de Oliveira Gomes de Matos", "CRM 115833", "Rua Doutor Clemente Ferreira, nº 44. Botafogo - Campinas/SP", ["(19) 3397-5186", "(19) 2512-6212"]),
        prof("Luiza Gonzaga Piovesana", "CRM 129543", "Av. Doutor José Bonifácio Coutinho Nogueira, nº 214 - Sala 412. Jd Madalena - Campinas/SP", ["(19) 3206-1114", "(19) 3207-4485", "(19) 99889-2251"]),
        prof("Maria Cristina Albertin", "CRM 61153", "Av. Andrade Neves, nº 707 - Sala 306. Centro - Campinas/SP", ["(19) 3232-6807"]),
        prof("Marina Koutsodontis Machado Alvim", "CRM 144737", "Av. Doutor José Bonifácio Coutinho Nogueira, nº 214 - Sala 412. Jd Madalena - Campinas/SP", ["(19) 3206-1114", "(19) 3207-4485", "(19) 99889-2251"]),
        prof("Centro Integrado Neurologia de Campinas", None, "Rua Doutor Clemente Ferreira, nº 44. Botafogo - Campinas/SP", ["(19) 3397-5186", "(19) 2512-6212"]),
    ],
    "Nutricionista": [
        prof("Cristiane Bottcher Evangelista Martins", "CRN 16956", "Rua Frei António de Pádua, nº 1227. Jd. Guanabara - Campinas/SP", ["(19) 3203-0550", "(19) 99673-7203"]),
        prof("Fernanda Carvalho Rocha Mangabeira", "CRN 20391", "Av. Doutor Manoel Afonso Ferreira, nº 222. Jd. Paraíso - Campinas/SP", ["(19) 3254-7620", "(19) 99217-6502"]),
        prof("Roberta Villas Boas Carvalho", "CRM 13589", "Av. Jose de Sousa Campos, nº 1073 - Sala 210 - Edifício Helbor Offices. Cambuí - Campinas/SP", ["(19) 99477-7296"]),
        prof("Tereza Raquel Poubel Azevedo de Oliveira Coimbra", "CRM 63015", "Rua Frei António de Pádua, nº 1122 - Sala 19. Jd. Guanabara - Campinas/SP", ["(19) 99666-9961"]),
        prof("Essencial Nutri", None, "Praça Doutor Toffoli, nº 28 - Ambulatório Casa de Saúde. Centro - Campinas/SP", ["(19) 3751-3770", "(19) 99753-2107"]),
    ],
    "Nutrologia": [
        prof("Renata Rosella Capelloza", "CRM 125389", "Rua Doutor Jose Teodoro de Lima, nº 32. Centro - Campinas/SP", ["(19) 3395-0754", "(19) 3395-0756", "(19) 98265-6660"]),
        prof("Rita de Cassia Almeida Bottcher", "CRM 87644",
             "Consultório I: Rua Doutor António da Costa Carvalho, nº 287. Cambuí - Campinas/SP",
             ["(19) 3294-5115", "(19) 3871-1012", "(19) 98945-3003", "(19) 99571-2525"]),
    ],
    "Ortopedia e Traumatologia": [
        prof("Daniel Fumagalli", "CRM 101854", "Rua Rocha Camargo, nº 159. Jd. Guanabara - Campinas/SP", ["(19) 3213-6510"]),
        prof("Denis Kiyoshi Fukumothi", "CRM 151873", "Rua Camargo Pimentel, nº 106. Jd. Guanabara - Campinas/SP", ["(19) 3241-3324"]),
        prof("Felipe Bighetti Jorge Ferreira", "CRM 117397", "Rua Aguaçu, nº 171 - Sala T-15 Bloco D - Alphaville Empresarial Campinas/SP", ["(19) 3262-1486", "(19) 97112-2527"]),
        prof("Hallan Douglas Bertelli", "CRM 160948", "Av. Barão de Itapura, nº 610 - 5º andar - Sala 502. Botafogo - Campinas/SP", ["(19) 99186-8662"]),
        prof("Luis Felipe Moyses Elias", "CRM 113474", "Rua Pero Lopes, nº 820. Jd. Bela Vista - Campinas/SP", ["(19) 3254-0225", "(19) 3112-4600"]),
        prof("Marcio Alves Cruz", "CRM 83241", "Rua Duque de Caxias, nº 780 - Conj. 24. Círculo Médico Campinas/SP", ["(19) 3231-1331", "(19) 99563-1265"]),
        prof("Murilo Gottardello", "CRM 83967", "Rua Camargo Pimentel, nº 106. Jd. Guanabara - Campinas/SP", ["(19) 3241-3822", "(19) 3241-3324"]),
        prof("Olavo Masakazu Hirashima", "CRM 49721", "Rua Camargo Pimentel, nº 106. Jd. Guanabara - Campinas/SP", ["(19) 3241-3822", "(19) 3241-3324"]),
        prof("Renato Mendes Morelli", "CRM 75629", "Av. Andrade Neves, nº 389. Centro - Campinas", ["(19) 3243-7566"]),
        prof("Rogerio Eduardo de Almeida Filipe", "CRM 109776", "Rua Dona Rosa de Gusmão, nº 731. Jd. Guanabara - Campinas/SP", ["(19) 3243-2693", "(19) 98401-8500"]),
    ],
    "Ortopedia Pediátrica": [
        prof("Daniel Fumagalli", "CRM 101854", "Rua Rocha Camargo, nº 159. Jd. Guanabara - Campinas/SP", ["(19) 3213-6510"]),
        prof("Ana Maria Ferreira Paccola", "CRM 130769", "Rua Aguaçu, nº 171 - Sala T-15 Bloco D - Alphaville Empresarial Campinas/SP", ["(19) 3262-1486", "(19) 97112-2527"]),
    ],
    "Otorrinolaringologia": [
        prof("Andressa Brunheroto", "CRM 177244", "Rua Campo de Pouso, nº 1313 - A. Centro - Holambra/SP", ["(19) 3802-4025", "(19) 99715-1514"]),
        prof("Beatriz Mangabeira Albernaz de Queiroz", "CRM 29386", "Av. Andrade Neves, nº 707 - 3º andar - Sala 302. Botafogo - Campinas/SP", ["(19) 3251-6865", "(19) 3254-4011"]),
        prof("Janaina Carneiro de Resende", "CRM 152687", "Av. Andrade Neves, nº 707 - 3º andar - Sala 302. Botafogo - Campinas/SP", ["(19) 3251-6865", "(19) 3254-4011"]),
        prof("Centro de Otorrinolaringologia Campinas", None, "Av. Andrade Neves, nº 699 - 1º andar. Centro - Campinas/SP", ["(19) 3231-1799"]),
        prof("Clinica Gobbo", None, "Av. Andrade Neves, nº 699 - 1º andar. Centro - Campinas/SP", ["(19) 3231-1799"]),
        prof("Otoclinica", None, "Av. Doutor Manoel Afonso Ferreira, nº 222. Jd. Paraíso - Campinas/SP", ["(19) 3254-7620"]),
    ],
    "Pediatria": [
        prof("Ana Flavia Diogo Hartman", "CRM 112509", "Rua Barão Geraldo de Resende, nº 97 - Sala 508. Botafogo - Campinas/SP", ["(19) 3367-2282", "(19) 98904-2000"]),
        prof("Ana Karina Labbate Cury Costa", "CRM 121673", "Rua Camargo Paes, nº 279. Jd. Guanabara - Campinas/SP", ["(19) 3242-8460", "(19) 3242-6742"]),
        prof("Carla de Oliveira Parra Duarte", "CRM 146245", "Rua Campo de Pouso, nº 1313 - A. Centro - Holambra/SP", ["(19) 3802-4025", "(19) 99715-1514"]),
        prof("Cesar de Carvalho Tonello", "CRM 65909", "Av Doutor Moraes Salles, nº 1136 - 10º andar - Sala 102. Centro - Campinas SP", ["(19) 3231-5992", "(19) 3308-5992", "(19) 99204-4262"]),
        prof("João Luis Martins", "CRM 25998", "Rua Camargo Paes, nº 279. Jd. Guanabara- Campinas/SP", ["(19) 3242-8460", "(19) 3242-6742"]),
        prof("Lourdes Josefina Ramirez Cogo", "CRM 26492", "Rua Camargo Paes, nº 279 Jd. Guanabara- Campinas/SP", ["(19) 3242-8460", "(19) 3242-6742"]),
        prof("Luciana Sabbatini", "CRM 191232", "Rua Lazara da Cruz Barbosa, nº148 - Sala 02. Vila Nova - Valinhos/SP", ["(19) 3869-4680", "(19) 99925-4680"]),
        prof("Luis Alberto Verri", "CRM 51162", "Rua Camargo Paes, nº 279. Jd. Guanabara- Campinas/SP", ["(19) 3242-8460", "(19) 3242-6742"]),
        prof("Rita de Cassia Almeida Bottcher", "CRM 87644",
             "Consultório I: Rua Doutor António da Costa Carvalho, nº 287. Cambuí - Campinas/SP",
             ["(19) 3294-5115", "(19) 3871-1013", "(19) 98945-3003", "(19) 99571-2525"]),
        prof("Silvia Regina Pedro Arruda", "CRM 76339", "Av. Andrade Neves, nº 699 - 6º andar. Centro - Campinas/SP", ["(19) 3232-4255"]),
        prof("Thiara Aparecida Ricci da Silva Fogaça", "CRM 112479", "Av. Andrade Neves, nº 707 - 9º andar - Sala 906. Centro - Campinas/SP", ["(19) 3239-3554", "(19) 99970-3579"]),
        prof("Vanessa Pereira de Souza", "CRM 113557", "Av. Orosimbo Maia, nº 430 - 7º andar - Sala 710. Centro - Campinas/SP", ["(19) 4141-1088"]),
        prof("Wagner Feltrin Junior", "CRM 120036", "Av. Barão de Itapura, nº 610 - Sala 719. Botafogo - Campinas/SP", ["(19) 99747-2030"]),
    ],
    "Pneumologia": [
        prof("José Claudio Teixeira Seabra", "CRM 51521", "Rua Paulo Castro Pupo Nogueira, nº 125. Nova Campinas - Campinas/SP", ["(19) 3294-6318", "(19) 3252-4105"]),
        prof("Luciane Gottardo Nunes", "CRM 94138", "Consultório I: Av. Engenheiro Fabio Roberto Barnabé, nº 1980. Jd. Esplanada - Indaiatuba/SP", ["(19) 3825-7800", "(19) 3825-3894", "(19) 99408-2570"]),
        prof("Paulo Sergio Lima Correa Silva", "CRM 24644", "Rua Onze de Agosto, nº 458. Centro - Campinas/SP", ["(19) 3233-8845", "(19) 3235-1848"]),
        prof("Ronaldo Ferreira Macedo", "CRM 111829", "Av. Barão de Paranapanema, nº146 - Sala 54 - Bloco B. Bosque - Campinas/SP", ["(19) 3324-6994", "(19) 99505-8703"]),
        prof("Telma Helena Amadi Fagundes", "CRM 31467", "Rua Barão Geraldo de Resende, nº 282 - 4º andar - Sala 44. Botafogo - Campinas/SP", ["(19) 3231-0003", "(19) 3232-3199"]),
    ],
    "Pneumologia Pediátrica": [
        prof("Antônio Mário Tassinari", "CRM 169492", "Rua Paulo Cezar Fidelis, nº 39 - 4º andar - Sala 419. Loteamento Residencial Vila Bella - Campinas/SP", ["(19) 3256-5020", "(19) 99714-4533"]),
        prof("Camila Benatti Galceran de Canopo", "CRM 125809", "Rua Vita Brasil, nº 228. Vila Embaré - Valinhos/SP", ["(19) 3871-1013", "(19) 99789-1202"]),
        prof("Luciana Sabbatini", "CRM 191232", "Rua Lazara da Cruz Barbosa, nº 148 - Sala 02. Vila Nova - Valinhos/SP", ["(19) 3869-4680", "(19) 99925-4680"]),
    ],
    "Psicologia": [
        prof("Adriana de Souza Bueno", "CRP 99874", "Rua Barbosa da Cunha, nº 437. Jd. Guanabara - Campinas/SP", ["(19) 3213-1700", "(19) 99979-4476"]),
        prof("Alba Ryane da Silva Stephaneli", "CRP 06/175719", "Rua Luiz Gama, nº 1293. Bonfim - Campinas/SP", ["(19) 3384-5696", "(19) 98136-4243"]),
        prof("Aline Maria Corsi Maccire", "CRP 7107706", "Rua Place Des Vosges, nº 77 - Sala 38. Ville Sainte Helene - Campinas/SP", ["(19) 99255-6570"]),
        prof("Andreia Cristina Furlanetto Cardoso", "CRP 64447", "Rua Frei António de Pádua, nº 1045. Jd. Guanabara - Campinas/SP", ["(19) 3365-6730", "(19) 99287-3797"]),
        prof("Claudia Regina Martins Berenguel", "CRP 70141", "Av. Doutor Moraes Salles, nº 1136 - 9º andar - Sala 91. Jd. Guarani - Campinas/SP", ["(19) 2513-3374", "(19) 99741-8370"]),
        prof("Denise Piasa", "CRP 06/185652", "Rua Luiz Gama, nº 1293. Bonfim - Campinas/SP", ["(19) 3384-5696", "(19) 98136-4243"]),
        prof("Elenise Maldonado Bertacco Queiroz", "CRP 175306/06", "Rua Luiz Gama, nº 1293. Bonfim - Campinas/SP", ["(19) 3384-5696", "(19) 98136-4243"]),
        prof("Fabiana de Oliveira Lara", "CRP 159435", "Rua Luiz Gama, nº 1293. Bonfim - Campinas/SP", ["(19) 3384-5696", "(19) 98136-4243"]),
        prof("Fabiana Paiva Souto Fogaça", "CRP 06/71431", "Rua Doutor Miguel Penteado, nº 295. Jd. Chapadão - Campinas/SP", ["(19) 99182-6605"]),
        prof("Gustavo Burigo Marcondes Godoy", "CRP 48213", "Rua General Osorio, nº 1031 - Sala 191. Centro - Campinas/SP", ["(19) 99233-1057"]),
        prof("Haide Bortolin Grilo", "CRP 58707/06", "Rua Luiz Gama, nº 1293. Bonfim - Campinas/SP", ["(19) 3384-5696", "(19) 98136-4243"]),
        prof("Leonardo Rebello Costa", "CRP 100490/06", "Rua Luiz Gama, nº 1293. Bonfim - Campinas/SP", ["(19) 3384-5696", "(19) 98136-4243"]),
        prof("Ligia Grilo de Paiva", "CRP 82658", "Rua Luiz Gama, nº 1293. Bonfim - Campinas/SP", ["(19) 3384-5696", "(19) 98136-4243"]),
        prof("Maíra Fernanda Marcatti Soga", "CRP 98795", "Rua Frei António de Pádua, nº 1227. Jd. Guanabara - Campinas/SP", ["(19) 3203-0550", "(19) 99673-7203"]),
        prof("Marco Aurélio Rodrigues da Costa Meirelles", "CRP 142702", "Rua Barata Ribeiro, nº 530. Vila Itapura - Campinas/SP", ["(19) 99340-7787"]),
        prof("Maria Ester Rodrigues Esteves", "CRP 0600600", "Atendimento somente online.", ["(19) 99788-2575"]),
        prof("Roberta Von Zuben", "CRP 57845", "Av. Andrade Neves, nº 784 - 1º andar - Sala A. Centro - Campinas/SP", ["(19) 3231-7722", "(19) 98165-9777"]),
        prof("Thatiane Perez da Silva Sena", "CRP 06/151089", "Rua Doutor Miguel Penteado, nº 295. Jd. Chapadão - Campinas/SP", ["(19) 991892-6605"]),
    ],
    "Psiquiatria": [
        prof("Aldo Prado de Rosa", "CRM 24969", "Rua Camargo Paes, nº 568. Jd. Guanabara - Campinas/SP", ["(19) 3234-3173", "(19) 99944-3173"]),
        prof("Celso Luis Piovesana", "CRM 30845", "Rua Conceição, nº 233 - Cj. 2309. Centro - Campinas/SP", ["(19) 3237-0238", "(19) 98189-2816"]),
        prof("Estelle Vanesca dos Santos", "CRM 113656", "Rua Luiz Gama, nº 1293. Bonfim - Campinas/SP", ["(19) 3384-5696", "(19) 98136-4243"]),
        prof("Gabriel Miguel Costa Monteiro", "CRM 230667", "Rua Luiz Gama, nº 1293. Bonfim - Campinas/SP", ["(19) 3384-5696", "(19) 98136-4243"]),
        prof("Guilherme Mahfuz Valentim", "CRM 104859", "Rua Doutor Sampaio Peixoto, nº 345 - Sala 06. Cambuí - Campinas/SP", ["(19) 99586-5790"]),
        prof("Igor Henrique Pereira Dal Bom", "CRM 227046", "Rua Luiz Gama, nº 1293. Bonfim - Campinas/SP", ["(19) 3384-5696", "(19) 98136-4243"]),
        prof("Juliana Souto Grando", "CRM 98712", "Rua Sacramento, nº 900. Vila Itapura - Campinas/SP", ["(19) 3232-5097", "(19) 3232-0737", "(19) 99126-3947"]),
        prof("Karina Borgonovi Silva Barbi", "CRM 114641", "Rua Avelino Silveira Franco, nº 149 - Sala 406. Jd Conceição - Sousas/SP", ["(19) 3258-8630", "(19) 99886-8630"]),
        prof("Lucas Coser Giraldelli", "CRM 183221", "Rua Luiz Gama, nº 1293. Bonfim - Campinas/SP", ["(19) 3384-5696", "(19) 98136-4243"]),
        prof("Mario Fernando de Oliveira Rocha", "CRM 47776", "Rua Barata Ribeiro, nº 530 - Sala 32. Jd. Guanabara - Campinas/SP", ["(19) 3236-2635", "(19) 3579-2930"]),
        prof("Ronaldo Scott Bruno", "CRM 22078", "Av. Barão de Itapura, nº 3436. Jd. Guanabara - Campinas/SP", ["(19) 3251-5898"]),
        prof("Viviane Midori Fugimoto Stonoga", "CRM 230389", "Rua Luiz Gama, nº 1293. Bonfim - Campinas/SP", ["(19) 3384-5696", "(19) 98136-4243"]),
        prof("Centro de Atenção Psiquiátrica de Campinas", None, "Rua Maria Monteiro, nº 786 - Cj. 63. Cambuí - Campinas/SP", ["(19) 3252-0996"]),
    ],
    "Reumatologia": [
        prof("Leila Fátima De Oliveira Barros Langen", "CRM 37561", "Rua Camargo Paes, nº 311. Jd. Guanabara - Campinas/SP", ["(19) 3242-4077", "(19) 3241-9351"]),
        prof("Marco Antonio Pinotti Ribeiro", "CRM 67876", "Rua Sebastião de Souza, nº 205 - Sala 103. Centro- Campinas/SP", ["(19) 3234-1304"]),
        prof("Rosemeire Midore Yamada", "CRM 77451", "Rua Duque de Caxias, nº 780 - 10º andar - Sala 102. Centro - Campinas/SP", ["(19) 3233-6828"]),
        prof("Samara da Silva Gavinier", "CRM 170064", "Av Barão de Itapura, nº 610 - 7º andar - Sala 703. Jd. Guanabara - Campinas/SP", ["(19) 3236-8005", "(19) 99551-9366"]),
    ],
    "Reumatologia Pediátrica": [
        prof("Barbara Sugui Longhi Barreiro", "CRM 125218", "Rua Bernardo Jose Sampaio, nº 339 - 2º andar - Sala 13. Botafogo - Campinas/SP", ["(19) 3231-1954", "(19) 97405-8790"]),
    ],
    "Terapia Ocupacional": [
        prof("Elizabete Fedosse", "CREFITO 3/1943", "Rua Luiz Gama, nº 1293. Bonfim - Campinas/SP", ["(19) 3384-5696", "(19) 98136-4243"]),
        prof("Jessica Ferreira do Prado", "CREFITO 17830", "Rua Doutor Hermas, Braga, nº 235. Nova Campinas - Campinas/SP", ["(19) 98235-8653"]),
        prof("Raquel Villela Amatte", "CREFITO 7232", "Rua Dona Ana Eufrosina, nº 110. Jd Brasil - Campinas/SP", ["(19) 97576-7623"]),
    ],
    "Urologia": [
        prof("Bruno Franca de Resende", "CRM 120227", "Rua Oriente, nº 55 - 3º andar - Sala 310. Chácara da Barra - Campinas/SP", ["(19) 3295-4807", "(19) 99105-7201"]),
        prof("Hamilton José Borges", "CRM 11011", "Rua Barreto Leme, nº 214. Centro - Campinas/SP", ["(19) 3231-3000", "(19) 99669-2419"]),
        prof("Pablo Leonardo Traete", "CRM 163354", "Rua Campo de Pouso, nº 1313 - A. Centro - Holambra/SP", ["(19) 3802-4025", "(19) 99715-1514"]),
        prof("Ricardo Destro Saade", "CRM 68881", "Rua Duque de Caxias, nº 780 - 10º andar - Salas 102/104. Centro - Campinas/SP", ["(19) 3233-6828"]),
        prof("Roberto Rocha Brito Bresler", "CRM 65401", "Rua Barreto Leme, nº 214. Centro - Campinas/SP", ["(19) 3231-3000", "(19) 99733-7904"]),
        prof("Ronaldo de Aguiar Souza Zulian", "CRM 12520", "Rua Barreto Leme, nº 214. Centro - Campinas/SP", ["(19) 3231-3000", "(19) 99669-2419"]),
        prof("Thiago Fagundes Nunes", "CRM 105396", "Rua Barreto Leme, nº 214. Centro - Campinas/SP", ["(19) 3231-3000", "(19) 99733-7904"]),
    ],
}

# Indaiatuba: dados mais esparsos no material oficial (a maioria sem CRM/endereço/telefone expostos)
INDAIATUBA_CREDENCIADA = {
    "Cardiologia": [prof("Luciano Rubem Mauro"), prof("Grasiela de Oliveira Lima"), prof("Michel Jorge Cecilio"),
                    prof("Indacor Servicos Medicos Ltda Me", None, None, None)],
    "Centro de Infusões": [prof("Centro Médico São Camilo - Vera Cruz", None, "R. Miguel Fernandes García Filho, 540 - Chácara Areal, Indaiatuba - SP", ["(19) 3115-6600"])],
    "Cirurgia Aparelho Digestivo": [prof("Luis Alvaro Abdala"), prof("Paulo Sergio Chaib")],
    "Cirurgia Bariátrica": [prof("Augusto de Arruda Lira E Cia Limitada")],
    "Cirurgia Geral": [prof("Luiz Alvaro de Oliveira Abdalla"), prof("Paulo Sergio Chaib")],
    "Cirurgia Pediátrica": [prof("Andrea Campos da Silva Santos")],
    "Cirurgia Plástica e Feridas Complexas": [prof("Rodolfo Valdemarin")],
    "Cirurgia Vascular": [prof("Pulsar Medicina Vascular LTDA")],
    "Clínica Médica": [prof("Lgn Consultoria E Assessoria Empresarial Empresarial e Servicos Medicos Ltda")],
    "Clínico Geral": [prof("Luciano Rubem Mauro")],
    "Dermatologia": [prof("Gustavo Bueno"), prof("Roberta Rubem Mauro"), prof("Thais Zolini Lobo")],
    "Ecocardiograma": [prof("Andres Eduardo Vasques")],
    "Exames Cardiológicos": [prof("Indacor Servicos Medicos Ltda Me")],
    "Fisioterapia": [prof("Cliniti Clinica de Fisioterapia E Tratamentos Integrados Ltda"),
                     prof("Instituto de Reabilitacao E Prevencao Em Saude Indaia")],
    "Gastroenterologista": [prof("Aline de Castro Possi")],
    "Geriatria": [prof("Clinica Medica R. J. C Ltda Epp")],
    "Ginecologia e Obstetrícia": [prof("Andrea Laureano"), prof("Flavio Ranzani")],
    "Hematologia": [prof("Jamile Herculani")],
    "Laboratório": [prof("Centro Médico São Camilo - Vera Cruz", None, "R. Miguel Fernandes García Filho, 540 - Chácara Areal, Indaiatuba - SP", ["(19) 3115-6600"])],
    "Mastologia": [prof("Maria Beatriz de Paula Leite")],
    "Nefrologia": [prof("Elizabete Romão Monteiro")],
    "Neurocirurgia": [prof("Fernando Antonio de Melo Filho")],
    "Neurologia Clínica": [],
    "Nutrição": [prof("Igor Gustavo Vieira", None, "R. Itororó, 614 - Centro, Indaiatuba - SP", ["(19) 99204-6898"])],
    "Oftalmologia": [prof("Centro Médico São Camilo - Vera Cruz", None, "R. Miguel Fernandes García Filho, 540 - Chácara Areal, Indaiatuba - SP", ["(19) 3115-6600"])],
    "Oncologia": [prof("Centro Médico São Camilo - Vera Cruz", None, "R. Miguel Fernandes García Filho, 540 - Chácara Areal, Indaiatuba - SP", ["(19) 3115-6600"]),
                  prof("Rafael Luis Moura Lima")],
    "Ortopedia (Joelho)": [prof("Artur Henrique"), prof("Rafael Cruz")],
    "Ortopedia (Mão)": [prof("João Denari")],
    "Ortopedia (Ombro e Cotovelo)": [prof("Juliana Ribeiro"), prof("Luis Roberto")],
    "Ortopedia (Coluna)": [],
    "Ortopedia (Quadril)": [],
    "Ortopedia (Pediátrico)": [],
    "Otorrinolaringologia": [prof("Ana Paula Brandão"), prof("Gabriela Strafacci"), prof("Giovana Scachetti")],
    "Pediatria": [prof("Daniela Mariano Rezende"), prof("Luis Roberto de Castro Bonilha")],
    "Pneumologia": [prof("Lgn Consultoria E Assessoria Empresarial Empresarial e Servicos Medicos Ltda")],
    "Psicologia": [
        prof("Clinica Equiphe Servicos de Psicologia L Psicologia Ltda"),
        prof("Ana Paula Vulf", None, "R. Itororó, 614- Centro, Indaiatuba - SP", ["(19) 3801-3575", "(19) 99204-6898"]),
        prof("Daiana Cunha Lopes Sampaio de Sousa", None, "R. Itororó, 614- Centro, Indaiatuba - SP", ["(19) 3801-3575", "(19) 99204-6898"]),
        prof("Danielle Feitosa Biazi", None, "R. Itororó, 614- Centro, Indaiatuba - SP", ["(19) 3801-3575", "(19) 99204-6898"]),
    ],
    "Psiquiatria": [prof("Renato Carbonari")],
    "Reumatologia": [prof("Maria Veronica Macchi")],
    "Raio X": [prof("Centro Médico São Camilo - Vera Cruz", None, "R. Miguel Fernandes García Filho, 540 - Chácara Areal, Indaiatuba - SP", ["(19) 3115-6600"])],
    "Tomografia Computadorizada": [prof("Centro Médico São Camilo - Vera Cruz", None, "R. Miguel Fernandes García Filho, 540 - Chácara Areal, Indaiatuba - SP", ["(19) 3115-6600"])],
    "Ultrassonografia": [prof("Centro Médico São Camilo - Vera Cruz", None, "R. Miguel Fernandes García Filho, 540 - Chácara Areal, Indaiatuba - SP", ["(19) 3115-6600"])],
    "Urologia": [prof("Dorival Manrique"), prof("Fabio Ortega"), prof("Thiago Moura Rodrigues")],
    "Uropediatria/Urologista": [prof("Edison Daniel Schneider Monteiro")],
}

DATA = {
    "versao": "10/2025",
    "validade": "31/10/2025",
    "central_atendimento": {"horario": "Segunda à sexta-feira, das 08h às 18h", "telefone": "(19) 3790-1200, opção 3"},
    "prata": {
        "nome": "Vera Prata",
        "descricao": "Rede própria de consultas",
        "hospitais": HOSPITAIS,
        "unidades": UNIDADES_PRATA,
    },
    "ouro": {
        "nome": "Vera Ouro",
        "descricao": "Rede própria + rede credenciada",
        "hospitais": HOSPITAIS,
        "unidades": UNIDADES_OURO,
        "credenciada": {
            "Campinas": CAMPINAS_CREDENCIADA,
            "Indaiatuba": INDAIATUBA_CREDENCIADA,
        },
    },
}

if __name__ == "__main__":
    with open("rede_vera_cruz_data.json", "w", encoding="utf-8") as f:
        json.dump(DATA, f, ensure_ascii=False, separators=(",", ":"))
    n_camp = sum(len(v) for v in CAMPINAS_CREDENCIADA.values())
    n_indaia = sum(len(v) for v in INDAIATUBA_CREDENCIADA.values())
    print(f"OK. Campinas credenciada: {n_camp} registros em {len(CAMPINAS_CREDENCIADA)} especialidades.")
    print(f"Indaiatuba credenciada: {n_indaia} registros em {len(INDAIATUBA_CREDENCIADA)} especialidades.")
    print(f"Unidades próprias Prata: {len(UNIDADES_PRATA)} | Ouro: {len(UNIDADES_OURO)} | Hospitais: {len(HOSPITAIS)}")
