/* =============================================================================
   Criar ou trocar a senha, pelo link do e-mail (convite da portaria ou "Esqueci a senha").
   O link é confirmado só quando a pessoa toca Salvar: alguns provedores de e-mail abrem os links
   sozinhos para procurar vírus, e confirmar ao abrir gastaria o link antes da pessoa.
   Depois de salvar, morador vai para o app e equipe vai para o painel, já entrados.
   ============================================================================= */
import { useState } from 'react'
import { NOME_CONDOMINIO } from './config'
import { api } from './dados/api'
import { mensagem } from './regras'
import type { LinkSenha } from './tipos'
import { Campo, Marca } from './ui'

export function CriarSenha({ link }: { link: LinkSenha }) {
  const [senha, setSenha] = useState('')
  const [repete, setRepete] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const troca = 'tipo' in link && link.tipo === 'recovery'

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (senha.length < 8) return setErro('Use pelo menos 8 caracteres.')
    if (senha !== repete) return setErro('As duas senhas não são iguais.')
    setEnviando(true)
    try {
      const destino = await api.definirSenha(link, senha)
      // Tira o link da barra de endereço (ele não vale mais) e vai para o lugar certo.
      history.replaceState(null, '', location.pathname + (destino === 'equipe' ? '#/adm' : '#/'))
      location.reload()
    } catch (err) {
      setErro(mensagem(err))
      setEnviando(false)
    }
  }

  return (
    <div className="m-app">
      <main className="m-entrar anima-entra">
        <header className="entrada-marca">
          <Marca />
          <span>
            <strong>Condomínio</strong>
            <span className="apagado peq">{NOME_CONDOMINIO || 'Condomínio'}</span>
          </span>
        </header>
        <div className="entrada-texto">
          <h1>{troca ? 'Trocar a senha' : 'Criar sua senha'}</h1>
          <p className="sec">{troca ? 'Escolha uma senha nova.' : 'Você foi cadastrado no condomínio. Crie uma senha para entrar com o seu e-mail.'}</p>
        </div>
        <form className="cartao m-form" onSubmit={salvar} noValidate>
          <Campo rotulo="Senha" dica="Pelo menos 8 caracteres">
            {(p) => <input {...p} data-foco type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} />}
          </Campo>
          <Campo rotulo="Repita a senha">{(p) => <input {...p} type="password" autoComplete="new-password" value={repete} onChange={(e) => setRepete(e.target.value)} />}</Campo>
          {erro ? (
            <p className="faixa-erro" role="alert">
              {erro}
            </p>
          ) : null}
          <button className="btn primario grande" disabled={enviando}>
            {enviando ? 'Salvando…' : 'Salvar e entrar'}
          </button>
        </form>
      </main>
    </div>
  )
}

/** Lê o link do endereço: do Supabase (?token_hash=&type=) ou da demonstração (#/criar-senha?demo=). */
export function linkDoEndereco(): LinkSenha | null {
  const q = new URLSearchParams(location.search)
  const token = q.get('token_hash')
  if (token) return { token_hash: token, tipo: q.get('type') === 'recovery' ? 'recovery' : 'invite' }
  if (location.hash.startsWith('#/criar-senha')) {
    const demo = new URLSearchParams(location.hash.split('?')[1] ?? '').get('demo')
    if (demo) return { demo }
  }
  return null
}
