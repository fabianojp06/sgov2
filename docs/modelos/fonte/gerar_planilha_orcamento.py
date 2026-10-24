# Gera a planilha-modelo do orçamento da Administração Central (US-120).
# Uso: python gerar_planilha_orcamento.py <plano.txt> <cc.txt> <saida.xlsx>
# plano.txt e cc.txt são as extrações das planilhas oficiais da pasta especificacao (formato "A=... | B=...").
import re, sys
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.comments import Comment
from openpyxl.utils import get_column_letter as L

plano_txt, cc_txt, saida = sys.argv[1:4]
EXERCICIO, LAYOUT = 2027, "ADMC-ORC v1.0"
LINHAS = 300                       # linhas de lançamento por aba
R0 = 5                             # primeira linha de dados
RN = R0 + LINHAS - 1
MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]

def ler(txt):
    out = []
    for ln in open(txt, encoding="utf-8"):
        if not ln.startswith("A="): continue
        out.append(dict(re.findall(r"([A-Z])=([^|]*?)\s*(?:\||$)", ln.strip())))
    return out

contas = [r for r in ler(plano_txt) if r.get("E") == "A"]
for c in contas:  # marca neutra: o nome da instituição não entra no sistema nem nos modelos (GAP-CAD-005)
    c["D"] = re.sub(r"\s*CTCEA\b", " da instituição", c["D"])
permitidas = [c for c in contas if not c["B"].startswith(("4.1.1.1.", "4.1.1.2."))]
ccs = [r for r in ler(cc_txt) if r.get("G") == "Analítico"]
assert len(ccs) == 27 and len(permitidas) > 100, (len(ccs), len(permitidas))

ARIAL = "Arial"
F = lambda **k: Font(name=ARIAL, size=k.pop("size", 10), **k)
AMARELO = PatternFill("solid", fgColor="FFF2CC")
CINZA = PatternFill("solid", fgColor="F2F2F2")
CAB = PatternFill("solid", fgColor="1F3864")
fino = Side(style="thin", color="BFBFBF")
BORDA = Border(left=fino, right=fino, top=fino, bottom=fino)
MOEDA = 'R$ #,##0.00;(R$ #,##0.00);"-"'
PCT = '0.0%;(0.0%);"-"'

wb = Workbook()

def cabecalho(ws, titulo, subtitulo, cols, larguras):
    ws["A1"] = titulo; ws["A1"].font = F(size=14, bold=True, color="1F3864")
    ws["A2"] = subtitulo; ws["A2"].font = F(italic=True, color="595959")
    for i, (txt, w) in enumerate(zip(cols, larguras), 1):
        c = ws.cell(row=4, column=i, value=txt)
        c.font = F(bold=True, color="FFFFFF"); c.fill = CAB; c.border = BORDA
        c.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
        ws.column_dimensions[L(i)].width = w
    ws.row_dimensions[4].height = 42
    ws.freeze_panes = ws.cell(row=R0, column=3)

def faixa(ws, c1, c2, entrada, fmt=None):
    for row in ws.iter_rows(min_row=R0, max_row=RN, min_col=c1, max_col=c2):
        for c in row:
            c.border = BORDA; c.font = F(color="0000FF" if entrada else "000000")
            c.fill = AMARELO if entrada else CINZA
            if fmt: c.number_format = fmt

def lista(ws, ref, rng, c1, c2, msg, allow_blank=True):
    dv = DataValidation(type="list", formula1=ref, allow_blank=allow_blank, showErrorMessage=True,
                        errorTitle="Valor inválido", error=msg)
    dv.add(f"{L(c1)}{R0}:{L(c2)}{RN}" if rng is None else rng); ws.add_data_validation(dv)

# ---------------------------------------------------------------- Listas
li = wb.active; li.title = "Listas"
li["A1"] = "Listas de validação (não editar)"; li["A1"].font = F(size=12, bold=True)
li["A2"] = "Fontes: plano de contas de 5 níveis e minuta Rev23102026 do plano de centros de custo (pasta especificacao)."
li["A2"].font = F(italic=True, color="595959")
for col, h in zip("ABCDEFGHIJ", ["CC analítico", "Descrição do CC", "", "Conta analítica", "Reduzido", "Descrição da conta", "", "Prioridade", "Sim/Não", "Distribuição"]):
    li[f"{col}4"] = h; li[f"{col}4"].font = F(bold=True)
for i, c in enumerate(ccs, 5):
    li[f"A{i}"], li[f"B{i}"] = c["A"], c["D"]
for i, c in enumerate(permitidas, 5):
    li[f"D{i}"], li[f"E{i}"], li[f"F{i}"] = c["B"], int(c["F"]), c["D"]
for i, v in enumerate(["Essencial", "Importante", "Desejável"], 5): li[f"H{i}"] = v
for i, v in enumerate(["Sim", "Não"], 5): li[f"I{i}"] = v
for i, v in enumerate(["Mensal", "Pontual"], 5): li[f"J{i}"] = v
li["K4"] = "Situação"; li["K4"].font = F(bold=True); li["K5"], li["K6"] = "Confirmado", "Previsto"
for i, v in enumerate(range(1, 13), 5): li[f"L{i}"] = v
li["L4"] = "Mês"; li["L4"].font = F(bold=True)
for row in li.iter_rows(min_row=5, max_row=200):
    for c in row: c.font = F()
for col, w in zip("ABCDEFGHIJKL", [12, 58, 3, 14, 10, 58, 3, 12, 9, 12, 12, 6]): li.column_dimensions[col].width = w
CC_A = f"Listas!$A$5:$A${4 + len(ccs)}"; CC_B = f"Listas!$B$5:$B${4 + len(ccs)}"
CT_D = f"Listas!$D$5:$D${4 + len(permitidas)}"; CT_F = f"Listas!$F$5:$F${4 + len(permitidas)}"
PRI, SN, DIST, SIT, MES = "Listas!$H$5:$H$7", "Listas!$I$5:$I$6", "Listas!$J$5:$J$6", "Listas!$K$5:$K$6", "Listas!$L$5:$L$16"

# ---------------------------------------------------------------- Premissas
pr = wb.create_sheet("Premissas", 0)
pr["A1"] = f"Premissas do exercício {EXERCICIO}"; pr["A1"].font = F(size=14, bold=True, color="1F3864")
pr["A2"] = "Preenchidas pela GFIN/GRH. Valores padrão provisórios (spec 6.6, GAP-ORC-003); o sistema usa os parâmetros oficiais do exercício."
pr["A2"].font = F(italic=True, color="595959")
PREM = [  # (rótulo, valor, formato, nota)
    ("Exercício", EXERCICIO, "0", "Ano do orçamento."),
    ("Reajuste salarial na data-base", 0.05, PCT, "Padrão provisório 5% (GAP-ORC-003)."),
    ("Mês da data-base (1 = jan)", 5, "0", "Padrão provisório: maio (GAP-ORC-003)."),
    ("IPCA projetado", 0.04, PCT, "Padrão provisório 4%; aplicado aos pacotes marcados 'Corrigir pelo IPCA'."),
    ("Encargo Social", 0.51, PCT, "C&S V4, RN_CAR_17: 51% sobre massa + férias + 13º."),
    ("Seguro saúde (R$ por pessoa/mês)", None, MOEDA, "Tabela Mestre de Benefícios: a preencher pela GRH."),
    ("Vale-refeição (R$ por pessoa/mês)", None, MOEDA, "Tabela Mestre de Benefícios: a preencher pela GRH."),
    ("Seguro de vida (R$ por pessoa/mês)", None, MOEDA, "Tabela Mestre de Benefícios: a preencher pela GRH."),
    ("Outros benefícios (R$ por pessoa/mês)", None, MOEDA, "Opcional."),
    ("Teto manual do exercício (opcional)", None, MOEDA, "Em branco = teto igual ao rateio líquido confirmado. Teto acima do rateio exige justificativa registrada."),
    ("Semáforo: faixa 1 (até)", 0.70, PCT, "Faixas 70/85/95 do semáforo (C7/RN_PLA_006)."),
    ("Semáforo: faixa 2 (até)", 0.85, PCT, ""),
    ("Semáforo: faixa 3 (até)", 0.95, PCT, ""),
]
for col, h in zip("ABC", ["Premissa", "Valor", "Fonte / observação"]):
    c = pr[f"{col}4"]; c.value = h; c.font = F(bold=True, color="FFFFFF"); c.fill = CAB
NM = {}
for i, (rot, v, fmt, nota) in enumerate(PREM, 5):
    pr[f"A{i}"] = rot; pr[f"B{i}"] = v; pr[f"C{i}"] = nota
    pr[f"A{i}"].font = F(); pr[f"C{i}"].font = F(color="595959")
    pr[f"B{i}"].number_format = fmt; pr[f"B{i}"].font = F(color="0000FF"); pr[f"B{i}"].fill = AMARELO
    for col in "ABC": pr[f"{col}{i}"].border = BORDA
    NM[rot] = f"Premissas!$B${i}"
pr["B5"].fill = CINZA; pr["B5"].font = F()
pr.column_dimensions["A"].width = 40; pr.column_dimensions["B"].width = 16; pr.column_dimensions["C"].width = 90
REAJ, DB, IPCA, ENC = NM["Reajuste salarial na data-base"], NM["Mês da data-base (1 = jan)"], NM["IPCA projetado"], NM["Encargo Social"]
i_ben = 5 + len(PREM) + 1
pr[f"A{i_ben}"] = "Benefícios por pessoa/mês (soma)"; pr[f"A{i_ben}"].font = F(bold=True)
pr[f"B{i_ben}"] = "=SUM(B10:B13)"; pr[f"B{i_ben}"].number_format = MOEDA; pr[f"B{i_ben}"].font = F(bold=True)
BEN = f"Premissas!$B${i_ben}"
TETO_MAN, S1, S2, S3 = NM["Teto manual do exercício (opcional)"], NM["Semáforo: faixa 1 (até)"], NM["Semáforo: faixa 2 (até)"], NM["Semáforo: faixa 3 (até)"]
assert pr["A10"].value.startswith("Seguro saúde") and pr["A13"].value.startswith("Outros")
dv = DataValidation(type="whole", operator="between", formula1="1", formula2="12", showErrorMessage=True, error="Informe um mês de 1 a 12.")
dv.add("B7"); pr.add_data_validation(dv)

# ---------------------------------------------------------------- Pessoal
pe = wb.create_sheet("Pessoal", 1)
cols = ["CC analítico", "Descrição do CC", "Cargo", "Quantidade", "Salário mensal (R$)", "Mês de início (1–12)", "Mês de saída (1–12)", "Observação"]
cols += [f"Massa {m} (prévia)" for m in MESES]
cols += ["Massa anual", "Férias + 1/3", "13º salário", "Encargos", "Benefícios", "Custo anual (prévia)", "Pendências"]
cabecalho(pe, f"Pessoal — orçamento {EXERCICIO} da Administração Central",
          "Preencha só as colunas amarelas (A, C a H). As colunas cinzas são prévia; o sistema recalcula tudo pelo MotorCustoPosicao na importação.",
          cols, [12, 40, 30, 11, 15, 11, 11, 30] + [12] * 12 + [14, 13, 13, 14, 13, 15, 40])
for k in range(12): pe.cell(row=3, column=9 + k, value=k + 1).font = F(size=8, color="808080")
pe["H3"] = "mês →"; pe["H3"].font = F(size=8, color="808080"); pe["H3"].alignment = Alignment(horizontal="right")
faixa(pe, 1, 1, True); faixa(pe, 2, 2, False); faixa(pe, 3, 4, True); faixa(pe, 5, 5, True, MOEDA)
faixa(pe, 6, 8, True); faixa(pe, 9, 26, False, MOEDA); faixa(pe, 27, 27, False)
for r in range(R0, RN + 1):
    pe[f"B{r}"] = f'=IF($A{r}="","",IFERROR(INDEX({CC_B},MATCH($A{r},{CC_A},0)),"CC não encontrado"))'
    ok = f'AND($A{r}<>"",ISNUMBER($D{r}),ISNUMBER($E{r}),ISNUMBER($F{r}),ISNUMBER($G{r}))'
    for k in range(12):
        m = f"{L(9 + k)}$3"
        pe.cell(row=r, column=9 + k, value=f"=IF({ok},IF(AND({m}>=$F{r},{m}<=$G{r}),$D{r}*$E{r}*(1+IF({m}>={DB},{REAJ},0)),0),0)")
    pe[f"U{r}"] = f"=SUM(I{r}:T{r})"
    pe[f"V{r}"] = f"=U{r}*4/3/12"
    pe[f"W{r}"] = f"=U{r}/12"
    pe[f"X{r}"] = f"=(U{r}+V{r}+W{r})*{ENC}"
    pe[f"Y{r}"] = f"=IF({ok},$D{r}*{BEN}*MAX(0,MIN(12,$G{r})-MAX(1,$F{r})+1),0)"
    pe[f"Z{r}"] = f"=U{r}+V{r}+W{r}+X{r}+Y{r}"
    p = (f'IF(ISNA(MATCH($A{r},{CC_A},0)),"CC não é analítico da lista; ","")'
         f'&IF($C{r}="","cargo obrigatório; ","")'
         f'&IF(OR(NOT(ISNUMBER($D{r})),$D{r}<1,$D{r}<>INT($D{r})),"quantidade inteira ≥ 1; ","")'
         f'&IF(OR(NOT(ISNUMBER($E{r})),$E{r}<=0),"salário > 0; ","")'
         f'&IF(OR(NOT(ISNUMBER($F{r})),NOT(ISNUMBER($G{r}))),"meses de início e saída obrigatórios; ",IF($F{r}>$G{r},"início depois da saída; ",""))')
    pe[f"AA{r}"] = f'=IF($A{r}="","",IF({p}="","OK",{p}))'
lista(pe, f"={CC_A}", None, 1, 1, "Use um CC analítico da aba Listas.")
dv = DataValidation(type="whole", operator="between", formula1="1", formula2="12", showErrorMessage=True, error="Informe um mês de 1 a 12.")
dv.add(f"F{R0}:G{RN}"); pe.add_data_validation(dv)
dv = DataValidation(type="whole", operator="greaterThanOrEqual", formula1="1", showErrorMessage=True, error="Quantidade inteira, mínimo 1.")
dv.add(f"D{R0}:D{RN}"); pe.add_data_validation(dv)
dv = DataValidation(type="decimal", operator="greaterThan", formula1="0", showErrorMessage=True, error="Salário maior que zero.")
dv.add(f"E{R0}:E{RN}"); pe.add_data_validation(dv)
pe["D4"].comment = Comment("Número de pessoas na mesma posição (mesmo CC, cargo e salário).", "SGO")
pe["E4"].comment = Comment("Salário base mensal antes do reajuste da data-base.", "SGO")

# ---------------------------------------------------------------- Pacotes base zero
pb = wb.create_sheet("Pacotes base zero", 2)
cols = ["CC analítico", "Descrição do CC", "Conta analítica", "Descrição da conta", "Atividade / justificativa (mín. 10 caracteres)",
        "Prioridade", "Quantidade", "Valor unitário (R$)", "Corrigir pelo IPCA?", "Distribuição", "Mês (se pontual)", "Valor anual"]
cols += [f"{m.capitalize()}" for m in MESES] + ["Pendências"]
cabecalho(pb, f"Pacotes base zero — orçamento {EXERCICIO} da Administração Central",
          "Preencha as colunas amarelas. Contas de pessoal e encargos (4.1.1.1 e 4.1.1.2) não entram aqui: vêm da aba Pessoal.",
          cols, [12, 36, 14, 36, 46, 12, 11, 15, 11, 12, 10, 15] + [12] * 12 + [44])
for k in range(12): pb.cell(row=3, column=13 + k, value=k + 1).font = F(size=8, color="808080")
faixa(pb, 1, 1, True); faixa(pb, 2, 2, False); faixa(pb, 3, 3, True); faixa(pb, 4, 4, False)
faixa(pb, 5, 7, True); faixa(pb, 8, 8, True, MOEDA); faixa(pb, 9, 11, True); faixa(pb, 12, 24, False, MOEDA); faixa(pb, 25, 25, False)
for r in range(R0, RN + 1):
    pb[f"B{r}"] = f'=IF($A{r}="","",IFERROR(INDEX({CC_B},MATCH($A{r},{CC_A},0)),"CC não encontrado"))'
    pb[f"D{r}"] = f'=IF($C{r}="","",IFERROR(INDEX({CT_F},MATCH($C{r},{CT_D},0)),"Conta não permitida"))'
    pb[f"L{r}"] = f'=IF(AND(ISNUMBER($G{r}),ISNUMBER($H{r})),ROUND($G{r}*$H{r}*(1+IF($I{r}="Sim",{IPCA},0)),2),0)'
    for k in range(12):
        m = f"{L(13 + k)}$3"
        mensal = f"ROUND($L{r}/12,2)" if k < 11 else f"$L{r}-11*ROUND($L{r}/12,2)"
        pb.cell(row=r, column=13 + k, value=f'=IF($J{r}="Mensal",{mensal},IF(AND($J{r}="Pontual",$K{r}={m}),$L{r},0))')
    p = (f'IF(ISNA(MATCH($A{r},{CC_A},0)),"CC não é analítico da lista; ","")'
         f'&IF(ISNA(MATCH($C{r},{CT_D},0)),"conta não permitida; ","")'
         f'&IF(LEN(TRIM($E{r}))<10,"justificativa com menos de 10 caracteres; ","")'
         f'&IF(ISNA(MATCH($F{r},{PRI},0)),"prioridade obrigatória; ","")'
         f'&IF(OR(NOT(ISNUMBER($G{r})),$G{r}<1),"quantidade ≥ 1; ","")'
         f'&IF(OR(NOT(ISNUMBER($H{r})),$H{r}<=0),"valor unitário > 0; ","")'
         f'&IF(ISNA(MATCH($I{r},{SN},0)),"informe se corrige pelo IPCA; ","")'
         f'&IF(ISNA(MATCH($J{r},{DIST},0)),"distribuição obrigatória; ",IF(AND($J{r}="Pontual",OR(NOT(ISNUMBER($K{r})),$K{r}<1,$K{r}>12)),"mês do pontual de 1 a 12; ",""))')
    pb[f"Y{r}"] = f'=IF($A{r}="","",IF({p}="","OK",{p}))'
lista(pb, f"={CC_A}", None, 1, 1, "Use um CC analítico da aba Listas.")
lista(pb, f"={CT_D}", None, 3, 3, "Use uma conta analítica permitida (aba Listas).")
lista(pb, f"={PRI}", None, 6, 6, "Essencial, Importante ou Desejável.")
lista(pb, f"={SN}", None, 9, 9, "Sim ou Não.")
lista(pb, f"={DIST}", None, 10, 10, "Mensal ou Pontual.")
dv = DataValidation(type="whole", operator="between", formula1="1", formula2="12", showErrorMessage=True, error="Informe um mês de 1 a 12.")
dv.add(f"K{R0}:K{RN}"); pb.add_data_validation(dv)
pb["H4"].comment = Comment("Preço do ano anterior. O IPCA projetado é aplicado se 'Corrigir pelo IPCA?' = Sim.", "SGO")
pb["L4"].comment = Comment("Mensal: 12 parcelas iguais; a diferença de arredondamento vai para dezembro.", "SGO")

# ---------------------------------------------------------------- Receitas
rc = wb.create_sheet("Receitas", 3)
cols = ["TP / versão", "Descrição", "Situação"] + [m.capitalize() for m in MESES] + ["Total do rateio", "ISS sobre o rateio", "Rateio líquido"]
cabecalho(rc, f"Receitas — rateio dos TPs no exercício {EXERCICIO}",
          "Preenchida pela GFIN. Confirmado = TP oficializado; Previsto = proposta em aprovação (não entra no saldo nem no teto).",
          cols, [18, 40, 13] + [13] * 12 + [16, 16, 16])
rc.freeze_panes = "D5"
faixa(rc, 1, 3, True); faixa(rc, 4, 15, True, MOEDA); faixa(rc, 16, 16, False, MOEDA); faixa(rc, 17, 17, False); faixa(rc, 18, 18, False, MOEDA)
for r in range(R0, RN + 1):
    rc[f"P{r}"] = f"=SUM(D{r}:O{r})"
    rc[f"Q{r}"] = f'=IF($A{r}="","","a definir")'
    rc[f"R{r}"] = f"=P{r}"
lista(rc, f"={SIT}", None, 3, 3, "Confirmado ou Previsto.")
rc["Q4"].comment = Comment("Fórmula do ISS pendente (GAP-ORC-007). Até a definição, rateio líquido = rateio.", "SGO")

# ---------------------------------------------------------------- Resumo
rs = wb.create_sheet("Resumo", 4)
rs["A1"] = f"Resumo — orçamento {EXERCICIO} da Administração Central (prévia)"; rs["A1"].font = F(size=14, bold=True, color="1F3864")
rs["A2"] = "Só leitura. Valores de prévia; o oficial é o calculado pelo sistema após a importação."; rs["A2"].font = F(italic=True, color="595959")
rs["A4"] = "Mês a mês"; rs["A4"].font = F(bold=True, size=11)
hdr = ["Linha"] + [m.capitalize() for m in MESES] + ["Ano"]
for i, h in enumerate(hdr, 1):
    c = rs.cell(row=5, column=i, value=h); c.font = F(bold=True, color="FFFFFF"); c.fill = CAB; c.alignment = Alignment(horizontal="center")
for k in range(12): rs.cell(row=6, column=2 + k, value=k + 1).font = F(size=8, color="808080")
rs["A6"] = "mês"; rs["A6"].font = F(size=8, color="808080")
PE = lambda col: f"Pessoal!${col}${R0}:${col}${RN}"
linhas = ["Pessoal + encargos + benefícios", "Base zero", "Total de despesas", "Receita confirmada (rateio líquido)",
          "Resultado (receita − despesas)", "Receita prevista (fora do saldo)"]
for j, nome in enumerate(linhas, 7):
    rs[f"A{j}"] = nome; rs[f"A{j}"].font = F(bold=nome.startswith(("Total", "Resultado")))
    for k in range(12):
        c = L(2 + k); m = f"{c}$6"; mass = L(9 + k); bz = L(13 + k); rec = L(4 + k)
        f = {7: f"=SUM(Pessoal!{mass}${R0}:{mass}${RN})*(1+4/3/12+1/12)*(1+{ENC})+{BEN}*SUMPRODUCT((Pessoal!$A${R0}:$A${RN}<>\"\")*ISNUMBER(Pessoal!$F${R0}:$F${RN})*ISNUMBER(Pessoal!$G${R0}:$G${RN})*(Pessoal!$F${R0}:$F${RN}<={m})*(Pessoal!$G${R0}:$G${RN}>={m}),Pessoal!$D${R0}:$D${RN})",
             8: f"=SUM('Pacotes base zero'!{bz}${R0}:{bz}${RN})",
             9: f"={c}7+{c}8",
             10: f"=SUMIFS(Receitas!{rec}${R0}:{rec}${RN},Receitas!$C${R0}:$C${RN},\"Confirmado\")",
             11: f"={c}10-{c}9",
             12: f"=SUMIFS(Receitas!{rec}${R0}:{rec}${RN},Receitas!$C${R0}:$C${RN},\"Previsto\")"}[j]
        rs[f"{c}{j}"] = f
    rs[f"N{j}"] = f"=SUM(B{j}:M{j})"
    for col in range(2, 15):
        cc = rs.cell(row=j, column=col); cc.number_format = MOEDA; cc.font = F(bold=j in (9, 11)); cc.border = BORDA
rs.conditional_formatting.add("B11:N11", CellIsRule(operator="lessThan", formula=["0"], font=Font(name=ARIAL, color="C00000", bold=True)))

rs["A14"] = "Teto e semáforo"; rs["A14"].font = F(bold=True, size=11)
TETO = [("Teto do exercício", f'=IF(ISNUMBER({TETO_MAN}),{TETO_MAN},N10)', MOEDA),
        ("Despesas orçadas", "=N9", MOEDA),
        ("% do teto", '=IF(B15>0,B16/B15,0)', PCT),
        ("Saldo (teto − despesas)", "=B15-B16", MOEDA),
        ("Faixa do semáforo", f'=IF(B15<=0,"sem teto",IF(B17<={S1},"Faixa 1 (até "&TEXT({S1},"0%")&")",IF(B17<={S2},"Faixa 2 (até "&TEXT({S2},"0%")&")",IF(B17<={S3},"Faixa 3 (até "&TEXT({S3},"0%")&")","Faixa 4 (acima de "&TEXT({S3},"0%")&")"))))', None),
        ("Conferência: pessoal mensal × anual", f"=ROUND(N7-SUM(Pessoal!$Z${R0}:$Z${RN}),2)", MOEDA)]
for j, (rot, f, fmt) in enumerate(TETO, 15):
    rs[f"A{j}"] = rot; rs[f"B{j}"] = f; rs[f"A{j}"].font = F(); rs[f"B{j}"].font = F(bold=True); rs[f"B{j}"].border = BORDA
    if fmt: rs[f"B{j}"].number_format = fmt
rs["C19"] = "Faixas definidas na aba Premissas (padrão 70/85/95)."; rs["C19"].font = F(color="595959", italic=True)
rs["C20"] = "Deve ser zero."; rs["C20"].font = F(color="595959", italic=True)
for n, cor in [(4, "F4B6B6"), (3, "F8CBAD"), (2, "FFE699"), (1, "C6EFCE")]:
    rs.conditional_formatting.add("B19", FormulaRule(formula=[f'LEFT($B$19,7)="Faixa {n}"'], fill=PatternFill("solid", fgColor=cor)))

base = 23
rs[f"A{base}"] = "Por centro de custo (analíticos)"; rs[f"A{base}"].font = F(bold=True, size=11)
for i, h in enumerate(["CC", "Descrição", "Pessoal", "Base zero", "Total", "% do total", "Posições", "Pacotes"], 1):
    c = rs.cell(row=base + 1, column=i, value=h); c.font = F(bold=True, color="FFFFFF"); c.fill = CAB
for j, cc in enumerate(ccs, base + 2):
    rs[f"A{j}"] = cc["A"]; rs[f"B{j}"] = cc["D"]
    rs[f"C{j}"] = f"=SUMIFS(Pessoal!$Z${R0}:$Z${RN},Pessoal!$A${R0}:$A${RN},$A{j})"
    rs[f"D{j}"] = f"=SUMIFS('Pacotes base zero'!$L${R0}:$L${RN},'Pacotes base zero'!$A${R0}:$A${RN},$A{j})"
    rs[f"E{j}"] = f"=C{j}+D{j}"
    rs[f"F{j}"] = f"=IF($N$9>0,E{j}/$N$9,0)"
    rs[f"G{j}"] = f"=SUMIFS(Pessoal!$D${R0}:$D${RN},Pessoal!$A${R0}:$A${RN},$A{j})"
    rs[f"H{j}"] = f"=COUNTIFS('Pacotes base zero'!$A${R0}:$A${RN},$A{j})"
tot = base + 2 + len(ccs)
rs[f"A{tot}"] = "Total"; rs[f"A{tot}"].font = F(bold=True)
for col in "CDEGH": rs[f"{col}{tot}"] = f"=SUM({col}{base + 2}:{col}{tot - 1})"
rs[f"F{tot}"] = f"=IF($N$9>0,E{tot}/$N$9,0)"
rs[f"B{tot + 1}"] = "Lançamentos em CC fora da lista (devem ser zero):"
rs[f"E{tot + 1}"] = f"=ROUND(N9-E{tot},2)"
for row in rs.iter_rows(min_row=base + 2, max_row=tot + 1, min_col=1, max_col=8):
    for c in row:
        c.font = F(bold=c.row == tot); c.border = BORDA
        if c.column in (3, 4, 5): c.number_format = MOEDA
        if c.column == 6: c.number_format = PCT

pb0 = tot + 4
rs[f"A{pb0}"] = "Base zero por prioridade"; rs[f"A{pb0}"].font = F(bold=True, size=11)
for i, h in enumerate(["Prioridade", "", "Valor anual", "% da base zero"], 1):
    c = rs.cell(row=pb0 + 1, column=i, value=h); c.font = F(bold=True, color="FFFFFF"); c.fill = CAB
for j, p in enumerate(["Essencial", "Importante", "Desejável"], pb0 + 2):
    rs[f"A{j}"] = p
    rs[f"C{j}"] = f"=SUMIFS('Pacotes base zero'!$L${R0}:$L${RN},'Pacotes base zero'!$F${R0}:$F${RN},$A{j})"
    rs[f"D{j}"] = f"=IF($N$8>0,C{j}/$N$8,0)"
    rs[f"C{j}"].number_format = MOEDA; rs[f"D{j}"].number_format = PCT
    for col in "ABCD": rs[f"{col}{j}"].border = BORDA; rs[f"{col}{j}"].font = F()
rs.column_dimensions["A"].width = 36; rs.column_dimensions["B"].width = 44
for col in "CDEFGHIJKLMN": rs.column_dimensions[col].width = 15

# ---------------------------------------------------------------- Instruções
ins = wb.create_sheet("Instruções", 0)
ins.column_dimensions["A"].width = 4; ins.column_dimensions["B"].width = 120
T = [("t", f"Orçamento {EXERCICIO} da Administração Central — planilha-modelo"),
     ("s", f"Layout {LAYOUT} · compatível com a importação do sistema (US-121). Não altere nomes de abas, colunas ou a ordem delas."),
     ("", ""),
     ("h", "Para que serve"),
     ("", "Os gestores lançam aqui as posições de pessoal e os pacotes base zero de cada centro de custo. A GFIN preenche as premissas e as receitas."),
     ("", "Depois a planilha é importada no sistema, que recalcula o pessoal pelo motor oficial. A revisão e a aprovação são feitas no sistema."),
     ("", "Se o sistema ainda não estiver no ar, a aprovação de 30/11/2026 é feita sobre esta planilha, que será importada depois como orçamento oficial."),
     ("", ""),
     ("h", "Legenda"),
     ("amarelo", "Célula amarela com texto azul: você preenche."),
     ("cinza", "Célula cinza: fórmula ou prévia, não editar."),
     ("", "Coluna 'Pendências': mostra OK ou o que falta corrigir na linha. A importação recusa linhas com pendência."),
     ("", ""),
     ("h", "Passo a passo"),
     ("", "1. GFIN: confira a aba Premissas (reajuste, data-base, IPCA, encargo de 51%, benefícios)."),
     ("", "2. Gestores: na aba Pessoal, uma linha por posição (CC, cargo, quantidade, salário, mês de início e de saída)."),
     ("", "3. Gestores: na aba Pacotes base zero, uma linha por pacote (CC, conta, justificativa, prioridade, quantidade, valor unitário, IPCA, distribuição)."),
     ("", "4. GFIN: na aba Receitas, o rateio de cada TP mês a mês, marcando Confirmado ou Previsto."),
     ("", "5. Confira a aba Resumo: resultado, teto e semáforo. Todas as linhas devem estar com Pendências = OK."),
     ("", ""),
     ("h", "Regras"),
     ("", "• Só CCs analíticos (aba Listas). A lista vem da minuta Rev23102026 do plano de centros de custo e será reemitida se a DIREX alterar a minuta (GAP-CC-001)."),
     ("", "• Só contas analíticas. As contas de pessoal e encargos (4.1.1.1 e 4.1.1.2) não entram em pacotes: o custo de pessoal sai da aba Pessoal."),
     ("", "• Na aba Pessoal, o custo é distribuído pelo sistema nas contas de salários, férias, 13º, benefícios e encargos."),
     ("", "• Valores em reais, com centavos. Meses de 1 (janeiro) a 12 (dezembro)."),
     ("", "• Pacote mensal: 12 parcelas iguais, e a diferença de arredondamento vai para dezembro. Pacote pontual: o valor todo no mês informado."),
     ("", "• Prévia do pessoal: massa = quantidade × salário (com reajuste a partir do mês da data-base); férias + 1/3 = massa × 4/3 ÷ 12; 13º = massa ÷ 12;"),
     ("", "   encargos = 51% sobre massa + férias + 13º; benefícios = quantidade × soma dos benefícios por mês ativo."),
     ("", "• ISS sobre o rateio: a definir (GAP-ORC-007). Até lá, rateio líquido = rateio."),
     ("", "• Receita prevista não entra no saldo nem no teto."),
     ("", ""),
     ("h", "Exemplos de preenchimento (não copie para as abas; são só referência)"),
     ("", "Pessoal: CC 4.3.2.11 · Analista de orçamento · 2 · 7.500,00 · início 1 · saída 12 · 'Quadro atual'"),
     ("", "Pacote: CC 4.3.3.13 · conta da lista (ex.: material de expediente) · 'Reposição anual de material de escritório' · Importante · 12 · 350,00 · Sim · Mensal"),
     ("", "Receita: TP 001/2026 · 'Contrato de apoio técnico' · Confirmado · valores de jan a dez"),
     ]
for i, (tipo, txt) in enumerate(T, 1):
    c = ins.cell(row=i, column=2, value=txt); c.alignment = Alignment(wrap_text=True, vertical="top")
    c.font = {"t": F(size=16, bold=True, color="1F3864"), "s": F(italic=True, color="595959"), "h": F(size=12, bold=True, color="1F3864")}.get(tipo, F())
    if tipo in ("amarelo", "cinza"):
        ins.cell(row=i, column=1).fill = AMARELO if tipo == "amarelo" else CINZA
        ins.cell(row=i, column=1).border = BORDA
ins["D1"] = "layout"; ins["E1"] = LAYOUT; ins["D2"] = "exercício"; ins["E2"] = EXERCICIO
for c in ("D1", "D2"): ins[c].font = F(size=8, color="808080")
for c in ("E1", "E2"): ins[c].font = F(size=8, color="808080")
ins.sheet_view.showGridLines = False

# proteção leve (sem senha): fórmulas travadas, entradas liberadas
from openpyxl.styles import Protection
for ws in (pe, pb, rc, pr):
    for row in ws.iter_rows(min_row=1, max_row=ws.max_row):
        for c in row:
            c.protection = Protection(locked=c.fill.fgColor.rgb != AMARELO.fgColor.rgb)
    ws.protection.sheet = True
    ws.protection.formatColumns = ws.protection.formatRows = False
    ws.protection.autoFilter = ws.protection.sort = False
for ws in (li, rs, ins):
    ws.protection.sheet = True
for ws in wb.worksheets: ws.sheet_properties.tabColor = {"Instruções": "1F3864", "Premissas": "BF8F00", "Resumo": "548235", "Listas": "808080"}.get(ws.title, "2F5597")
wb.active = 0
from openpyxl.workbook.properties import CalcProperties
wb.calculation = CalcProperties(fullCalcOnLoad=True)  # sem valores em cache: o Excel recalcula ao abrir
wb.save(saida)
print("ok", saida, "ccs", len(ccs), "contas permitidas", len(permitidas))
