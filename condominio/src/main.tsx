/* Entrada do app. O endereço decide o lado: #/adm... = equipe; qualquer outro = morador.
   Endereço com # funciona em qualquer hospedagem estática (GitHub Pages, Netlify) sem configurar nada. */
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './layout.css'
import { AdmApp } from './adm/Adm'
import { MoradorApp } from './morador/Morador'
import { CriarSenha, linkDoEndereco } from './CriarSenha'

function App() {
  const [rota, setRota] = useState(location.hash)
  useEffect(() => {
    const mudou = () => setRota(location.hash)
    addEventListener('hashchange', mudou)
    return () => removeEventListener('hashchange', mudou)
  }, [])
  useEffect(() => {
    document.title = rota.startsWith('#/adm') ? 'Condomínio · Equipe' : 'Condomínio'
  }, [rota])
  // Link do e-mail (convite ou troca de senha) vem antes de tudo.
  const link = linkDoEndereco()
  if (link) return <CriarSenha link={link} />
  return rota.startsWith('#/adm') ? <AdmApp rota={rota} /> : <MoradorApp />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
