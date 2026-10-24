# Reaplica um novo plano (frentes/datas) às issues, milestones e campos do projeto já publicados.
# Uso: python atualizar.py <plano_antigo.json> <plano_novo.json>
import json, os, sys, time, importlib.util
BASE = os.path.dirname(os.path.abspath(__file__))
old = {r["id"]: r for r in json.load(open(sys.argv[1], encoding="utf-8"))["stories"]}
sys.argv = [sys.argv[0], sys.argv[2]]
src = open(os.path.join(BASE, "publicar.py"), encoding="utf-8").read()
g = {"__file__": os.path.join(BASE, "publicar.py")}
exec(src.split("# 1. labels")[0], g)                                   # P, E, gh, api
exec(src[src.index("def titulo"):src.index("def criar")], g)           # corpo()
P, E, gh, api, corpo = g["P"], g["E"], g["gh"], g["api"], g["corpo"]
REPO = g["REPO"]
for rid, nome, _ in P["releases"]:
    api("PATCH", f"repos/{REPO}/milestones/{E['ms'][rid]}", due_on=P["rel_fim"][rid] + "T23:59:59Z")
print("milestones ok")
for r in P["stories"]:
    o = old[r["id"]]
    if (o["frente"], o["inicio"], o["fim"], o["ordem"]) == (r["frente"], r["inicio"], r["fim"], r["ordem"]):
        continue
    a = ["issue", "edit", str(E["us"][r["id"]]), "--repo", REPO, "--body-file", "-"]
    if o["frente"] != r["frente"]:
        a += ["--add-label", f"frente:{r['frente']}", "--remove-label", f"frente:{o['frente']}"]
    gh(*a, inp=corpo(r, links=True)); time.sleep(0.8)
print("issues ok")
# campos do projeto
sp = importlib.util.spec_from_file_location("x", os.path.join(BASE, "projeto.py"))
psrc = open(os.path.join(BASE, "projeto.py"), encoding="utf-8").read()
h = {"__file__": os.path.join(BASE, "projeto.py")}
sys.argv = [sys.argv[0], sys.argv[1]]
exec(psrc[:psrc.index("# itens")], h)                                    # F, gql, J, PR (projeto já existe)
F, gql, J, PR = h["F"], h["gql"], h["J"], E["proj"]
S = P["stories"]; it = PR["itens"]
ups = []
for r in S:
    ups += [(it[r["id"]], "Frente", f'{{singleSelectOptionId:{J(F["Frente"]["opts"][r["frente"]])}}}'),
            (it[r["id"]], "Início", f'{{date:{J(r["inicio"])}}}'), (it[r["id"]], "Fim", f'{{date:{J(r["fim"])}}}'),
            (it[r["id"]], "Ordem", f'{{number:{r["ordem"]}}}')]
for e in P["epicos"]:
    hs = [r for r in S if r["epico"] == e[0]]
    ups += [(it[e[0]], "Início", f'{{date:{J(min(r["inicio"] for r in hs))}}}'), (it[e[0]], "Fim", f'{{date:{J(max(r["fim"] for r in hs))}}}')]
for i in range(0, len(ups), 10):
    m = "mutation{%s}" % " ".join(f'u{k}:updateProjectV2ItemFieldValue(input:{{projectId:{J(PR["id"])},itemId:{J(a)},fieldId:{J(F[c]["id"])},value:{v}}}){{clientMutationId}}'
                                  for k, (a, c, v) in enumerate(ups[i:i + 10]))
    gql(m)
print("projeto ok", len(ups))
