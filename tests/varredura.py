# -*- coding: utf-8 -*-
"""
varredura.py: abre TODAS as telas do Imobil com cada persona, em 4 larguras, e mede o que
quebra sem ninguém olhar.

O que mede em cada tela (cada item é um problema que já mordeu projeto nosso):
  1. erro de JavaScript (exceção ou console.error);
  2. rolagem lateral da PÁGINA (scrollWidth maior que a janela);
  3. largura "afastada": innerWidth diferente da pedida (o navegador afasta o zoom quando algo
     é mais largo que o celular; aconteceu no portfólio em 22-out);
  4. tela de erro ("Não deu para carregar") ou "Página não encontrada";
  5. página provisória que sobrou ("Esta tela entra na etapa");
  6. travessão na tela (regra de texto da casa).

Como acha as telas: lê o MENU de cada persona (o que ela enxerga de verdade) e, em cada lista,
segue o primeiro link de detalhe. Assim a varredura acompanha o app sem lista fixa de rotas.

Rodar (com o servidor de desenvolvimento ligado):
  python tests/varredura.py [--base http://localhost:5173] [--larguras 1680,1366,1024,390] [--fotos] [--personas admin,inquilina]
Saída: tabela no terminal e, com --fotos, PNG em tests/fotos/varredura/.
Sai com código 1 se achar problema (serve de bateria antes de publicar).
"""
import argparse, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp_util import Edge  # noqa: E402

AGENCY = "a0000000-0000-4000-8000-000000000001"
LANDLORD = "a0000000-0000-4000-8000-000000000002"
PERSONAS = {
    "admin": ("b0000000-0000-4000-8000-000000000001", AGENCY),
    "financeiro": ("b0000000-0000-4000-8000-000000000002", AGENCY),
    "proprietario": ("b0000000-0000-4000-8000-000000000005", AGENCY),
    "inquilina": ("b0000000-0000-4000-8000-000000000006", AGENCY),
    "prestador": ("b0000000-0000-4000-8000-000000000007", AGENCY),
    "independente": ("b0000000-0000-4000-8000-000000000008", LANDLORD),
}
# Telas que não estão no menu mas existem (formulários e assistentes).
EXTRAS = {"admin": ["/imoveis/novo", "/contratos/novo", "/dados/importar", "/financeiro/repasses", "/vistorias", "/avisos"]}

CHECK_JS = r"""(() => {
  const t = document.body.innerText;
  return {
    largura: window.innerWidth,
    lateral: document.documentElement.scrollWidth > window.innerWidth + 1,
    erro: t.includes('Não deu para carregar'),
    naoEncontrada: t.includes('Página não encontrada'),
    provisoria: t.includes('Esta tela entra na etapa'),
    travessao: t.includes('\u2014'),
  }
})()"""


def slug(rota):
    return re.sub(r"[^a-z0-9]+", "-", rota.lower()).strip("-") or "inicio"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5173")
    ap.add_argument("--larguras", default="1680,1366,1024,390")
    ap.add_argument("--personas", default=",".join(PERSONAS))
    ap.add_argument("--fotos", action="store_true")
    ap.add_argument("--espera", type=float, default=2.5)
    a = ap.parse_args()
    larguras = [int(x) for x in a.larguras.split(",")]
    pasta = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fotos", "varredura")
    os.makedirs(pasta, exist_ok=True)
    problemas, visitas = [], 0

    with Edge(larguras[0], 900) as ed:
        for nome in a.personas.split(","):
            user, org = PERSONAS[nome]
            # Passo 1: escolher a persona (o mesmo que o seletor "Ver como" grava) e recarregar.
            ed.ir(a.base + "/", a.espera)
            ed.js(f"localStorage.setItem('imobil:persona', JSON.stringify({{userId:'{user}', orgId:'{org}'}}))")
            ed.ir(a.base + "/", a.espera)
            # Passo 2: as telas desta persona = o menu dela + os extras + o 1º detalhe de cada lista.
            menu = ed.js("[...document.querySelectorAll('nav[aria-label=Principal] a')].map(x => x.getAttribute('href'))") or []
            rotas = list(dict.fromkeys(menu + EXTRAS.get(nome, [])))
            detalhes = []
            for r in rotas:
                ed.ir(a.base + r, a.espera)
                if r == "/":
                    continue
                base = r.rstrip("/")
                href = ed.js(f"(() => {{ const l = [...document.querySelectorAll('main a[href^=\"{base}/\"]')].map(x => x.getAttribute('href')).filter(h => !/\\/novo$/.test(h)); return l[0] || null }})()")
                if href:
                    detalhes.append(href)
            rotas += [d for d in dict.fromkeys(detalhes) if d not in rotas]
            # Passo 3: cada tela em cada largura.
            for w in larguras:
                ed.tamanho(w, 900)
                for r in rotas:
                    antes = len(ed.erros())
                    ed.ir(a.base + r, a.espera)
                    m = ed.js(CHECK_JS)
                    erros = ed.erros()[antes:]
                    visitas += 1
                    achados = []
                    if erros:
                        achados.append("JS: " + erros[0][:160])
                    if m["lateral"]:
                        achados.append("rolagem lateral")
                    if m["largura"] != w:
                        achados.append(f"largura afastada ({m['largura']})")
                    if m["erro"]:
                        achados.append("tela de erro")
                    if m["naoEncontrada"]:
                        achados.append("não encontrada")
                    if m["provisoria"]:
                        achados.append("página provisória")
                    if m["travessao"]:
                        achados.append("travessão na tela")
                    if a.fotos and (w in (1440, 1366, 390) or achados):
                        ed.foto(os.path.join(pasta, f"{nome}-{slug(r)}-{w}.png"))
                    for x in achados:
                        problemas.append((nome, r, w, x))

    print(f"\nTelas visitadas: {visitas} · problemas: {len(problemas)}")
    for nome, r, w, x in problemas:
        print(f"  {nome:13} {w:>5}  {r:40} {x}")
    sys.exit(1 if problemas else 0)


if __name__ == "__main__":
    main()
