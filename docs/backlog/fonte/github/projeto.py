# Cria o GitHub Project "SGO 2.0 – Roadmap", os campos e preenche os itens a partir de plano.json + estado.json.
import json, os, subprocess, sys
REPO, OWNER, NOME = "fabianojp06/sgov2", "fabianojp06", "SGO 2.0 – Roadmap"
BASE = os.path.dirname(os.path.abspath(__file__))
P = json.load(open(sys.argv[1], encoding="utf-8"))
EST = os.path.join(BASE, "estado.json"); E = json.load(open(EST))
def save(): json.dump(E, open(EST, "w"), indent=1)
def gh(*a, ok_fail=False):
    import time
    for t in range(6):
        r = subprocess.run(["gh", *a], capture_output=True, text=True)
        if r.returncode and ("502" in r.stderr or "504" in r.stderr or "rate" in r.stderr.lower()):
            time.sleep(10 * (t + 1)); continue
        break
    if r.returncode and not ok_fail: raise SystemExit(f"gh {' '.join(a[:4])}: {r.stderr[:800]}")
    return r.stdout if r.returncode == 0 else None
def gql(q, ok_fail=False):
    out = gh("api", "graphql", "-f", f"query={q}", ok_fail=ok_fail)
    return json.loads(out)["data"] if out else None
J = json.dumps
PR = E["proj"]
if "id" not in PR:
    p = json.loads(gh("project", "create", "--owner", OWNER, "--title", NOME, "--format", "json"))
    PR.update(id=p["id"], number=p["number"], url=p["url"]); save()
    gh("project", "link", str(PR["number"]), "--owner", OWNER, "--repo", REPO)
    gh("project", "edit", str(PR["number"]), "--owner", OWNER, "--readme",
       "Roadmap do SGO 2.0 gerado do backlog (`docs/backlog`). Campos Início/Fim vêm de `docs/backlog/fonte/cronograma.py`.\n\n"
       "Trilha 2027 = recorte para o orçamento 2027 da Administração Central (modelo híbrido, meta 30/11/2026).\n"
       "Frente A/B = qual conta do Claude Code desenvolve a história.",
       "--description", "Cronograma, quadro e backlog do SGO 2.0")
N = str(PR["number"])
REL = [r[0] for r in P["releases"]]
CAMPOS = [("Tipo", "SINGLE_SELECT", "Épico,História"), ("Release", "SINGLE_SELECT", ",".join(REL)),
          ("Prioridade", "SINGLE_SELECT", "Must,Should,Could"), ("Tamanho", "SINGLE_SELECT", "XS,P,M,G,GG"),
          ("Modo", "SINGLE_SELECT", "Sessão,Ultracode"), ("Frente", "SINGLE_SELECT", "A,B"),
          ("Trilha 2027", "SINGLE_SELECT", "Sim,Não"), ("Épico", "TEXT", None), ("Horas", "NUMBER", None),
          ("Ordem", "NUMBER", None), ("Início", "DATE", None), ("Fim", "DATE", None)]
if not PR.get("campos"):
    exist = {f["name"] for f in json.loads(gh("project", "field-list", N, "--owner", OWNER, "--format", "json"))["fields"]}
    for nome, tipo, opts in CAMPOS:
        if nome in exist: continue
        a = ["project", "field-create", N, "--owner", OWNER, "--name", nome, "--data-type", tipo]
        if opts: a += ["--single-select-options", opts]
        gh(*a)
    PR["campos"] = True; save()
F = {}
for f in json.loads(gh("project", "field-list", N, "--owner", OWNER, "--format", "json", "--limit", "50"))["fields"]:
    F[f["name"]] = dict(id=f["id"], opts={o["name"]: o["id"] for o in f.get("options", [])})
# Status em português
if not PR.get("status"):
    opts = [("A fazer", "GRAY", "Pronta para começar"), ("Em andamento", "YELLOW", "Em desenvolvimento"),
            ("Em homologação", "PURPLE", "Em hml com o usuário-chave"), ("Concluído", "GREEN", "Em produção")]
    so = ",".join(f'{{name:{J(n)},color:{c},description:{J(d)}}}' for n, c, d in opts)
    if gql(f'mutation{{updateProjectV2Field(input:{{fieldId:{J(F["Status"]["id"])},singleSelectOptions:[{so}]}}){{projectV2Field{{...on ProjectV2SingleSelectField{{id}}}}}}}}', ok_fail=True):
        PR["status"] = True; save()
        for f in json.loads(gh("project", "field-list", N, "--owner", OWNER, "--format", "json", "--limit", "50"))["fields"]:
            F[f["name"]] = dict(id=f["id"], opts={o["name"]: o["id"] for o in f.get("options", [])})
    else:
        print("aviso: não foi possível renomear o Status")
# itens
S = P["stories"]
eps = {}
for e in P["epicos"]:
    hs = [r for r in S if r["epico"] == e[0]]
    eps[e[0]] = dict(num=E["ep"][e[0]], release=e[1], horas=sum(r["horas"] for r in hs), inicio=min(r["inicio"] for r in hs),
                     fim=max(r["fim"] for r in hs), ordem=min(r["ordem"] for r in hs), trilha=any(r["trilha"] for r in hs), nome=e[2])
alvos = [("US", r["id"], E["us"][r["id"]]) for r in S] + [("EP", k, v["num"]) for k, v in eps.items()]
it = PR.setdefault("itens", {})
pend = [a for a in alvos if a[1] not in it]
for i in range(0, len(pend), 15):
    lote = pend[i:i + 15]
    q = "query{repository(owner:%s,name:\"sgov2\"){%s}}" % (J(OWNER), " ".join(f"i{n}:issue(number:{n}){{id}}" for _, _, n in lote))
    nid = gql(q)["repository"]
    m = "mutation{%s}" % " ".join(f'a{k}:addProjectV2ItemById(input:{{projectId:{J(PR["id"])},contentId:{J(nid["i" + str(n)]["id"])}}}){{item{{id}}}}'
                                  for k, (_, _, n) in enumerate(lote))
    res = gql(m)
    for k, (_, key, _) in enumerate(lote): it[key] = res[f"a{k}"]["item"]["id"]
    save()
print("itens:", len(it))
def val(campo, v):
    f = F[campo]
    if f["opts"]: return f'{{singleSelectOptionId:{J(f["opts"][v])}}}'
    if campo in ("Horas", "Ordem"): return f"{{number:{v}}}"
    if campo in ("Início", "Fim"): return f"{{date:{J(v)}}}"
    return f"{{text:{J(v)}}}"
ups = []
for r in S:
    vs = {"Tipo": "História", "Release": r["release"], "Prioridade": r["prioridade"], "Tamanho": r["tamanho"],
          "Modo": "Sessão" if r["modo"] == "S" else "Ultracode", "Frente": r["frente"], "Trilha 2027": "Sim" if r["trilha"] else "Não",
          "Épico": f"{r['epico']} — {eps[r['epico']]['nome']}", "Horas": r["horas"], "Ordem": r["ordem"], "Início": r["inicio"], "Fim": r["fim"]}
    ups += [(it[r["id"]], c, v) for c, v in vs.items()]
for k, e in eps.items():
    vs = {"Tipo": "Épico", "Release": e["release"], "Trilha 2027": "Sim" if e["trilha"] else "Não", "Épico": f"{k} — {e['nome']}",
          "Horas": e["horas"], "Ordem": e["ordem"], "Início": e["inicio"], "Fim": e["fim"]}
    ups += [(it[k], c, v) for c, v in vs.items()]
done = PR.setdefault("ups_feitos", 0)
for i in range(done, len(ups), 10):
    lote = ups[i:i + 10]
    m = "mutation{%s}" % " ".join(f'u{k}:updateProjectV2ItemFieldValue(input:{{projectId:{J(PR["id"])},itemId:{J(iid)},fieldId:{J(F[c]["id"])},value:{val(c, v)}}}){{clientMutationId}}'
                                  for k, (iid, c, v) in enumerate(lote))
    gql(m); PR["ups_feitos"] = i + len(lote); save()
print("campos preenchidos:", PR["ups_feitos"], "de", len(ups))
print("URL:", PR["url"])
