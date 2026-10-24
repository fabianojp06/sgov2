# Publica o backlog no GitHub (labels, milestones, issues, sub-issues, dependências, projeto). Idempotente via estado.json.
import json, os, re, subprocess, sys, time
REPO, OWNER = "fabianojp06/sgov2", "fabianojp06"
BASE = os.path.dirname(os.path.abspath(__file__))
P = json.load(open(sys.argv[1], encoding="utf-8"))
EST = os.path.join(BASE, "estado.json")
E = json.load(open(EST)) if os.path.exists(EST) else {"ms": {}, "ep": {}, "us": {}, "ids": {}, "sub": [], "dep": [], "edit": [], "proj": {}}
def save(): json.dump(E, open(EST, "w"), indent=1)
def gh(*a, inp=None, ok_fail=False):
    for t in range(5):
        r = subprocess.run(["gh", *a], input=inp, capture_output=True, text=True)
        if r.returncode == 0: return r.stdout
        if ok_fail: return None
        if "rate limit" in r.stderr.lower() or "secondary" in r.stderr.lower() or "502" in r.stderr:
            time.sleep(30 * (t + 1)); continue
        raise SystemExit(f"gh {' '.join(a[:4])} falhou: {r.stderr[:500]}")
    raise SystemExit("muitas tentativas")
def api(method, path, **f):
    args = ["api", "-X", method, path]
    for k, v in f.items(): args += ["-F" if isinstance(v, int) else "-f", f"{k}={v}"]
    return json.loads(gh(*args) or "null")

S = P["stories"]; ST = {r["id"]: r for r in S}
EPN = {e[0]: e[2] for e in P["epicos"]}; RELN = {r[0]: r[1] for r in P["releases"]}

# 1. labels
LAB = [("tipo:epico", "5319e7", "Épico"), ("tipo:historia", "1d76db", "História de usuário"),
       ("prioridade:must", "b60205", "MoSCoW Must"), ("prioridade:should", "fbca04", "MoSCoW Should"), ("prioridade:could", "c2e0c6", "MoSCoW Could"),
       ("modo:sessao", "0e8a16", "Sessão única com TDD"), ("modo:ultracode", "d93f0b", "Lote em Ultracode"),
       ("trilha-2027", "e11d48", "Trilha do orçamento 2027 (modelo híbrido, meta 30/11/2026)"),
       ("frente:A", "0052cc", "Frente A — núcleo e domínio"), ("frente:B", "006b75", "Frente B — infra, componentes, cargas e testes"),
       ("bloqueada-por-gap", "000000", "Depende de GAP aberto da spec")]
LAB += [(f"tamanho:{t}", "ededed", f"{h} h") for t, h in [("XS", 2), ("P", 4), ("M", 8), ("G", 16), ("GG", 24)]]
LAB += [(f"epico:{e[0]}", "bfd4f2", e[2][:100]) for e in P["epicos"]]
if not E.get("labels"):
    for n, c, desc in LAB: gh("label", "create", n, "--repo", REPO, "--color", c, "--description", desc, "--force")
    E["labels"] = True; save(); print("labels ok")

# 2. milestones
for rid, nome, fase in P["releases"]:
    if rid in E["ms"]: continue
    m = api("POST", f"repos/{REPO}/milestones", title=f"{rid} — {nome}", due_on=P["rel_fim"][rid] + "T23:59:59Z",
            description=f"Fase {fase} da spec. Data estimada pelo cronograma do backlog (docs/backlog/fonte/cronograma.py).")
    E["ms"][rid] = m["number"]; save()
print("milestones ok")
MST = {rid: f"{rid} — {nome}" for rid, nome, _ in P["releases"]}

def titulo(r):
    m = re.search(r"quero (.+?)(?:, para | para que |, para que |$)", r["historia"])
    t = (m.group(1) if m else r["historia"]).strip().rstrip(".")
    t = t[0].upper() + t[1:]
    return f"[{r['id']}] {t}"[:200]

def corpo(r, links=False):
    def ref(x):
        return f"#{E['us'][x]}" if links and x in E["us"] else x
    L = [r["historia"], "", "### Critérios de aceite"] + [f"- [ ] {c}" for c in r["criterios"]]
    L += ["", "### Planejamento", "| Campo | Valor |", "| --- | --- |",
          f"| Release | {r['release']} — {RELN[r['release']]} |", f"| Épico | {r['epico']} — {EPN[r['epico']]} |",
          f"| Prioridade | {r['prioridade']} |", f"| Tamanho | {r['tamanho']} ({r['horas']} h) |",
          f"| Modo | {'Sessão' if r['modo'] == 'S' else 'Ultracode'} |", f"| Frente | {r['frente']} |",
          f"| Trilha 2027 | {'Sim' if r['trilha'] else 'Não'} |", f"| Ordem global | {r['ordem']} |",
          f"| Previsão | {r['inicio']} a {r['fim']} |",
          f"| Depende de | {', '.join(ref(x) for x in r['dep']) or '—'} |", f"| GAP | {r['gap']} |", f"| Referências | {r['refs']} |",
          "", "<sub>Gerado a partir de `docs/backlog/fonte/dados.py`. Fonte das regras: spec oficial em `docs/superpowers/specs/`.</sub>"]
    return "\n".join(L)

def criar(title, body, labels, ms):
    out = gh("issue", "create", "--repo", REPO, "--title", title, "--body-file", "-", "--milestone", ms,
             *sum([["--label", l] for l in labels], []), inp=body)
    n = int(out.strip().rsplit("/", 1)[1]); time.sleep(1.2); return n

# 3. épicos
for eid, rel, nome in P["epicos"]:
    if eid in E["ep"]: continue
    hs = [r for r in S if r["epico"] == eid]
    body = f"Épico **{eid} — {nome}** da release {rel}.\n\n{len(hs)} histórias, {sum(r['horas'] for r in hs)} h. As histórias estão ligadas como sub-issues."
    E["ep"][eid] = criar(f"[{eid}] {nome}", body, ["tipo:epico", f"epico:{eid}"], MST[rel]); save()
print("épicos ok")

# 4. histórias (na ordem do ID)
for r in sorted(S, key=lambda r: r["id"]):
    if r["id"] in E["us"]: continue
    lab = ["tipo:historia", f"epico:{r['epico']}", f"prioridade:{r['prioridade'].lower()}", f"tamanho:{r['tamanho']}",
           "modo:sessao" if r["modo"] == "S" else "modo:ultracode", f"frente:{r['frente']}"]
    if r["trilha"]: lab.append("trilha-2027")
    if r["gap"] != "—": lab.append("bloqueada-por-gap")
    E["us"][r["id"]] = criar(titulo(r), corpo(r), lab, MST[r["release"]]); save()
    print("criada", r["id"], E["us"][r["id"]], flush=True)
print("histórias ok")

def iid(num):
    k = str(num)
    if k not in E["ids"]:
        E["ids"][k] = api("GET", f"repos/{REPO}/issues/{num}")["id"]; save()
    return E["ids"][k]

# 5. sub-issues
for r in S:
    if r["id"] in E["sub"]: continue
    api("POST", f"repos/{REPO}/issues/{E['ep'][r['epico']]}/sub_issues", sub_issue_id=iid(E["us"][r["id"]]))
    E["sub"].append(r["id"]); save()
print("sub-issues ok")

# 6. dependências nativas (blocked by) — se a API não estiver disponível, ficam só os links no corpo
for r in S:
    for x in r["dep"]:
        k = f"{r['id']}<{x}"
        if k in E["dep"] or E.get("dep_off"): continue
        res = gh("api", "-X", "POST", f"repos/{REPO}/issues/{E['us'][r['id']]}/dependencies/blocked_by",
                 "-F", f"issue_id={iid(E['us'][x])}", ok_fail=True)
        if res is None and not E["dep"]:
            E["dep_off"] = True; save(); print("API de dependências indisponível; seguindo só com links"); break
        E["dep"].append(k); save()
print("dependências ok")

# 7. corpo com links #n
for r in S:
    if r["id"] in E["edit"] or not r["dep"]: continue
    gh("issue", "edit", str(E["us"][r["id"]]), "--repo", REPO, "--body-file", "-", inp=corpo(r, links=True))
    E["edit"].append(r["id"]); save(); time.sleep(0.8)
print("links ok")
