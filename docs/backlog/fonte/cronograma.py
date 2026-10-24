# Cronograma do backlog: duas frentes em paralelo, respeitando dependências. Saída: plano.json
import importlib.util, json, re, sys, datetime as dt
src, out = sys.argv[1:3]
spec = importlib.util.spec_from_file_location("d", src); d = importlib.util.module_from_spec(spec); spec.loader.exec_module(d)
INICIO = dt.date(2026, 10, 26)
CONT = 1.20
H_DIA_TRILHA, H_DIA_DEPOIS = float(sys.argv[3]) if len(sys.argv) > 3 else 8, 6         # horas de desenvolvimento por dia útil, por frente
FERIADOS = {dt.date(*x) for x in [(2026,11,2),(2026,11,20),(2026,12,24),(2026,12,25),(2026,12,31),(2027,1,1),
            (2027,2,8),(2027,2,9),(2027,3,26),(2027,4,21),(2027,5,1),(2027,5,27),(2027,9,7),(2027,10,12),(2027,11,2),(2027,11,15),(2027,11,20)]}
uteis = []
x = INICIO
while len(uteis) < 800:
    if x.weekday() < 5 and x not in FERIADOS: uteis.append(x)
    x += dt.timedelta(days=1)
REL = [r[0] for r in d.RELEASES]; EP = {e[0]: e for e in d.EPICOS}; PRI = {"Must": 0, "Should": 1, "Could": 2}
st = {}
for s in d.S:
    sid, ep, hist, pri, tam, refs, crit, dep, gap, modo = s
    st[sid] = dict(id=sid, epico=ep, release=EP[ep][1], historia=hist, prioridade=pri, tamanho=tam, horas=d.H[tam],
                   modo=modo, refs=refs, criterios=crit, dep=re.findall(r"US-\d+", dep), gap=gap,
                   trilha=sid in d.TRILHA_2027, fixa=next(f for f, eps in d.FRENTE_POR_EPICO.items() if ep in eps))
ordem = sorted(st.values(), key=lambda r: (not r["trilha"], REL.index(r["release"]), PRI[r["prioridade"]], r["id"]))
for i, r in enumerate(ordem, 1): r["ordem"] = i
clock = {"A": 0.0, "B": 0.0}; fim = {}
pend = list(ordem)
while pend:
    for f in sorted(clock, key=clock.get):
        pronta = next((r for r in pend if r["fixa"] in (None, f) and all(x in fim for x in r["dep"])), None)
        if pronta: break
    else:
        raise SystemExit("deadlock: " + str([r["id"] for r in pend][:5]))
    r = pronta; pend.remove(r); r["frente"] = f
    ini = max([clock[f]] + [fim[x] for x in r["dep"]])
    taxa = H_DIA_TRILHA if r["trilha"] else H_DIA_DEPOIS
    dur = r["horas"] * CONT / taxa
    r["ini_d"], r["fim_d"] = ini, ini + dur
    fim[r["id"]] = clock[f] = ini + dur
for r in ordem:
    r["inicio"] = uteis[int(r["ini_d"])].isoformat()
    r["fim"] = uteis[max(int(r["ini_d"]), int(r["fim_d"] - 1e-9))].isoformat()
rel_fim = {rid: max(r["fim"] for r in ordem if r["release"] == rid) for rid in REL}
trilha_fim = max(r["fim"] for r in ordem if r["trilha"])
json.dump(dict(stories=ordem, releases=d.RELEASES, epicos=d.EPICOS, rel_fim=rel_fim, trilha_fim=trilha_fim),
          open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("trilha termina:", trilha_fim)
for rid in REL: print(rid, rel_fim[rid])
print("frente A fim", uteis[int(clock["A"])], "B fim", uteis[int(clock["B"])])
