import csv, importlib.util, math, sys, collections

src, out_md, out_csv = sys.argv[1:4]
spec = importlib.util.spec_from_file_location("d", src)
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)

REL = {r[0]: r for r in d.RELEASES}
EP = {e[0]: e for e in d.EPICOS}
PRI = {"Must": 0, "Should": 1, "Could": 2}
MODO = {"S": "Sessão", "U": "Ultracode"}
CONT = 0.20      # contingência para GAPs, retrabalho e ajustes de homologação
PO_PCT = 0.15    # tempo do PO: revisão de planos, validação, homologação
HOMOLOG = 16     # horas de homologação com usuários-chave por release

rows = []
for s in d.S:
    sid, ep, hist, pri, tam, refs, crit, dep, gap, modo = s
    rel = EP[ep][1]
    rows.append(dict(id=sid, epico=ep, release=rel, historia=hist, prioridade=pri, tamanho=tam,
                     horas=d.H[tam], modo=MODO[modo], refs=refs, criterios=crit, dep=dep, gap=gap))
order = {r[0]: i for i, r in enumerate(d.RELEASES)}
rows.sort(key=lambda r: (order[r["release"]], PRI[r["prioridade"]], r["id"]))
for i, r in enumerate(rows, 1):
    r["ordem"] = i

def soma(f):
    return sum(r["horas"] for r in rows if f(r))

por_rel = []
for rid, nome, fase in d.RELEASES:
    rr = [r for r in rows if r["release"] == rid]
    h = sum(r["horas"] for r in rr)
    hc = math.ceil(h * (1 + CONT))
    po = math.ceil(h * PO_PCT) + HOMOLOG
    por_rel.append(dict(rid=rid, nome=nome, fase=fase, n=len(rr), h=h,
                        must=sum(r["horas"] for r in rr if r["prioridade"] == "Must"),
                        u=sum(r["horas"] for r in rr if r["modo"] == "Ultracode"),
                        hc=hc, po=po))
T = dict(n=len(rows), h=soma(lambda r: True), must=soma(lambda r: r["prioridade"] == "Must"),
         u=soma(lambda r: r["modo"] == "Ultracode"))
T["hc"] = sum(x["hc"] for x in por_rel)
T["po"] = sum(x["po"] for x in por_rel)

# Trilha do orçamento 2027 (modelo híbrido)
mvp_ids = set(d.TRILHA_2027)
mvp_h = sum(r["horas"] for r in rows if r["id"] in mvp_ids)
mvp_hc = math.ceil(mvp_h * (1 + CONT))

def semanas(h, ritmo):
    return math.ceil(h / ritmo)

L = []
w = L.append
w("# SGO 2.0 — Backlog do Produto")
w("")
w("| Campo | Valor |")
w("| --- | --- |")
w("| Versão | 1.0 — 24/10/2026 |")
w("| Fonte | `docs/superpowers/specs/2026-10-24-sgo-v2-especificacao-oficial-design.md` (spec oficial) |")
w("| Product Owner | Fabiano Garcia (BA/PO) |")
w("| Arquivo para importação | `docs/backlog/backlog-sgo-v2.csv` (Jira, Azure DevOps, planilha) |")
w("")
w("## 1. Como ler este backlog")
w("")
w("- **Ordem**: a coluna *Ordem* é a prioridade global (1 = primeiro). Ela segue as releases, depois MoSCoW, depois as dependências.")
w("- **Prioridade (MoSCoW)**: *Must* = sem isso a release não vai para produção; *Should* = importante, entra se houver capacidade; *Could* = desejável.")
w("- **Tamanho e horas**: XS = 2 h · P = 4 h · M = 8 h · G = 16 h · GG = 24 h. As horas são o esforço de desenvolvimento com Claude Code (código, testes automatizados e revisão), não o tempo de relógio de uma pessoa digitando.")
w("- **Modo de execução**: *Sessão* = núcleo crítico, desenvolvido numa sessão com TDD guiado e revisão a cada tarefa. *Ultracode* = lote paralelizável sobre um padrão já pronto (cadastros, relatórios, testes), executado por vários agentes em paralelo (seção 4).")
w("- **GAP**: pendência da spec (seção 9 dela) que bloqueia toda a história ou parte dela. História com GAP aberto só entra em sprint com o GAP resolvido ou com a parte bloqueada isolada.")
w("")
w("## 2. Resumo por release")
w("")
w("| Release | Escopo | Fase da spec | Histórias | Horas (histórias) | Horas *Must* | Horas em Ultracode | Horas com contingência (+20%) | Horas do PO |")
w("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
for x in por_rel:
    w(f"| {x['rid']} | {x['nome']} | {x['fase']} | {x['n']} | {x['h']} | {x['must']} | {x['u']} | {x['hc']} | {x['po']} |")
w(f"| **Total** | | | **{T['n']}** | **{T['h']}** | **{T['must']}** | **{T['u']}** | **{T['hc']}** | **{T['po']}** |")
w("")
w("*Horas do PO* = 15% das horas de desenvolvimento (aprovar planos, tirar dúvidas, revisar entregas) + 16 h de homologação com usuários-chave por release.")
w("")
w("## 3. Prazo estimado")
w("")
w("O ritmo depende de quanto tempo por semana há para conduzir as sessões, revisar e homologar. Os cenários abaixo usam o total com contingência, com margem de ±30%.")
w("")
w("| Cenário | Ritmo (horas de desenvolvimento por semana) | Sistema completo (R0–R9) | Trilha 2027 (seção 3.1) |")
w("| --- | --- | --- | --- |")
for nome, ritmo in [("Conservador: só sessões, PO em meio período", 25), ("Recomendado: sessões no núcleo + Ultracode nos lotes", 40), ("Intensivo: Ultracode amplo, PO dedicado", 60)]:
    sc, sm = semanas(T["hc"], ritmo), semanas(mvp_hc, ritmo)
    w(f"| {nome} | {ritmo} h | {sc} semanas (~{math.ceil(sc/4.3)} meses) | {sm} semanas (~{math.ceil(sm/4.3)} meses) |")
w("")
w("### 3.1 Trilha do orçamento 2027 (modelo híbrido)")
w("")
w("Decisão do PO em 24/10/2026: o orçamento 2027 da Administração Central deve estar **lançado e aprovado até 30/11/2026**, no modelo híbrido:")
w("")
w("1. Os gestores lançam na **planilha-modelo** (US-120), que tem o mesmo layout da importação do sistema.")
w("2. O sistema entra em produção com o recorte mínimo, **importa a planilha** (US-121), recalcula o pessoal pelo MotorCustoPosicao e a revisão e a aprovação acontecem nele.")
w("3. **Plano B:** se o sistema não estiver em produção a tempo, a aprovação de 30/11 é feita sobre a planilha, e o sistema a importa como orçamento oficial de 2027 assim que entrar no ar. A execução de 2027 roda no sistema de qualquer forma.")
w("")
w(f"Recorte da trilha: {len(mvp_ids)} histórias, {mvp_h} h ({mvp_hc} h com contingência), marcadas com o label `trilha-2027`. As telas de lançamento de posições e pacotes (US-056/057), o isolamento por TP (US-007), as alçadas configuráveis (US-042), a sessão única, os perfis configuráveis e a IA ficam para depois de 30/11.")
w("")
w("**Duas frentes em paralelo** (duas contas do Claude Code): cada história vai para a frente dona do código (spec §12). O caminho crítico da trilha tem só 96 h, então o prazo depende da vazão. Pelo cronograma (`fonte/cronograma.py`), com 40 h/semana por frente a trilha termina por volta de **09/12/2026**; com 60 h/semana por frente, por volta de **24/11/2026**. Por isso o plano B da planilha é obrigatório.")
w("")
w("## 4. Estratégia de execução e economia de tokens")
w("")
w("**Sobre o Ultracode.** O Ultracode orquestra vários agentes em paralelo, com etapas de verificação. Ele **acelera** o trabalho e **aumenta a qualidade** em lotes grandes, mas **gasta mais tokens** por tarefa do que uma sessão única, porque cada agente lê o contexto de novo. Para economizar, o certo é usá-lo onde o paralelismo compensa, e não em tudo:")
w("")
w("| Usar | Onde | Por quê |")
w("| --- | --- | --- |")
w(f"| **Sessão única** (superpowers: plano → TDD por tarefa → revisão) | Núcleo crítico: fundação, dinheiro, auditoria, isolamento por TP, login, motores de cálculo, workflows, IA ({T['h']-T['u']} h) | Exige raciocínio encadeado e contexto contínuo. Dividir entre agentes gera retrabalho, e retrabalho é o maior desperdício de tokens |")
w(f"| **Ultracode** | Lotes sobre um padrão já pronto: cadastros, relatórios UC05.x, demonstrativos, testes de segurança, manual ({T['u']} h) | Muitas peças independentes e parecidas. O paralelismo reduz o prazo, e a verificação cruzada pega erro de padrão cedo |")
w("")
w("**Regras para economizar tokens em qualquer modo**")
w("1. **Primeiro o padrão, depois o lote.** O primeiro cadastro e o primeiro relatório são feitos em sessão e viram o modelo; só então o Ultracode replica o padrão.")
w("2. **Plano com tarefas exatas** (writing-plans) antes de cada release: arquivos, testes e critérios definidos. A IA não \"descobre\" o projeto a cada tarefa.")
w("3. **`CLAUDE.md` enxuto e estável** (US-002), com comandos e regras. Isso evita reexplicar o projeto e aproveita o cache.")
w("4. **Componentes genéricos da R1** (grade, formulário, exportação): cada cadastro novo vira configuração, não código novo.")
w("5. **Lotes de 3 a 5 histórias por execução de Ultracode**, sempre com critérios de aceite fechados. Lote grande demais aumenta o custo de correção.")
w("6. **GAP resolvido antes de começar.** História bloqueada que começa e para é o pior caso de custo.")
w("")
w("## 5. Definition of Ready e Definition of Done")
w("")
w("**Pronta para desenvolver (DoR):** história com critérios de aceite claros; dependências entregues; GAPs que a afetam resolvidos ou isolados; regra de negócio rastreável até o documento-fonte.")
w("")
w("**Pronta (DoD):**")
w("- Critérios de aceite cobertos por testes automatizados (domínio com TDD; integração com PostgreSQL real; E2E nos fluxos principais).")
w("- Testes de diretriz da spec 10.2 verdes (auditoria, isolamento por TP, Half-Even, versão otimista, ORIGEM BLINDADA).")
w("- Revisão de código e de segurança feitas; lint, tipos e build verdes; sem \"CTCEA\" no código.")
w("- Implantada em hml e aceita pelo usuário-chave da release.")
w("")
w("## 6. Backlog priorizado")
w("")
for rid, nome, fase in d.RELEASES:
    rr = [r for r in rows if r["release"] == rid]
    x = next(p for p in por_rel if p["rid"] == rid)
    w(f"### {rid} — {nome} ({x['n']} histórias, {x['h']} h)")
    w("")
    for eid, erel, enome in d.EPICOS:
        if erel != rid:
            continue
        er = [r for r in rr if r["epico"] == eid]
        w(f"#### {eid} — {enome} ({sum(r['horas'] for r in er)} h)")
        w("")
        for r in er:
            w(f"**{r['id']}** · Ordem {r['ordem']} · {r['prioridade']} · {r['tamanho']} ({r['horas']} h) · {r['modo']}")
            w("")
            w(r["historia"])
            w("")
            w("Critérios de aceite:")
            for c in r["criterios"]:
                w(f"- {c}")
            meta = [f"Referências: {r['refs']}", f"Depende de: {r['dep']}"]
            if r["gap"] != "—":
                meta.append(f"**GAP:** {r['gap']}")
            w("")
            w("<sub>" + " · ".join(meta) + "</sub>")
            w("")
w("## 7. GAPs que bloqueiam histórias")
w("")
gm = collections.defaultdict(list)
for r in rows:
    if r["gap"] != "—":
        gm[r["gap"]].append(r["id"])
w("| GAP | Histórias afetadas |")
w("| --- | --- |")
for g in sorted(gm):
    w(f"| {g} | {', '.join(gm[g])} |")
w("")
open(out_md, "w", encoding="utf-8").write("\n".join(L) + "\n")

with open(out_csv, "w", encoding="utf-8-sig", newline="") as f:
    cw = csv.writer(f, delimiter=";")
    cw.writerow(["Ordem", "ID", "Release", "Épico", "História", "Prioridade", "Tamanho", "Horas", "Modo", "Critérios de aceite", "Dependências", "GAP", "Referências"])
    for r in rows:
        cw.writerow([r["ordem"], r["id"], r["release"], f"{r['epico']} — {EP[r['epico']][2]}", r["historia"], r["prioridade"], r["tamanho"], r["horas"], r["modo"],
                     " | ".join(r["criterios"]), r["dep"], r["gap"], r["refs"]])
print(T, "mvp", len(mvp_ids), mvp_h, mvp_hc)
for x in por_rel:
    print(x)
