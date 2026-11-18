/* =============================================================================
   Tela Tarefas: três abas sobre o trabalho da administração.
   - Tarefas: o que cada pessoa tem para fazer (lista ou quadro A fazer | Fazendo | Feito);
   - Processos: cada renovação, cobrança, locação... e em que etapa está; embaixo, os modelos
     (as etapas de cada tipo de processo). Antes eram duas abas (Andamento e Modelos);
   - Automações e comunicados: em cima, os avisos da administração aos inquilinos e
     proprietários (o trabalho do dia a dia, curto); embaixo, as regras que trabalham sozinhas, o
     registro de cada rodada e a caixa de saída de e-mail (consulta, longa: com as automações em
     cima, o comunicado ficava a mais de 3.000 px de rolagem). Antes eram duas abas (06/11). Juntas
     porque respondem à mesma pergunta, "o que sai para as pessoas sem a equipe mandar uma a uma":
     cada comunicado enviado também vira linha na caixa de saída da seção de baixo.
   A aba escolhida fica lembrada no navegador, e quem tinha lembrada uma aba antiga cai na aba que
   a recebeu (ver OLD). Comunicação não ganhou rota própria: o menu foi enxugado de propósito, e
   comunicado é trabalho da mesma equipe que cuida das tarefas.
   ============================================================================= */
import { useState } from 'react'
import { Guard } from '@/app/Guard'
import { readJSON, writeJSON } from '@/lib/storage'
import { PageHeader } from '@/components/ui/Layout'
import { TabPanel, Tabs } from '@/components/ui/Tabs'
import { cn } from '@/components/ui/cn'
import { AnnouncementsTab } from '@/modules/comunicacao/AnnouncementsTab'
import { AutomationsTab } from './AutomationsTab'
import { InstancesTab } from './InstancesTab'
import { TasksTab } from './TasksTab'
import { TemplatesTab } from './TemplatesTab'

const TABS = [
  { value: 'tarefas', label: 'Tarefas' },
  { value: 'processos', label: 'Processos' },
  { value: 'automacoes-comunicados', label: 'Automações e comunicados' },
]
const KEY = 'imobil:processos:aba'
/**
 * Abas antigas que viraram parte de outra: quem tinha uma delas lembrada cai na aba que a recebeu.
 * Andamento e Modelos viraram Processos em 05/11; Automações e Comunicados viraram uma aba em 06/11.
 */
const OLD: Record<string, string> = {
  andamento: 'processos',
  modelos: 'processos',
  automacoes: 'automacoes-comunicados',
  comunicados: 'automacoes-comunicados',
}

/** Qual aba abrir a partir do valor lembrado: o antigo vira o novo; valor desconhecido abre Tarefas. */
export function resolveProcessTab(saved: string | null): string {
  const value = OLD[saved ?? ''] ?? saved ?? ''
  return TABS.some((t) => t.value === value) ? value : 'tarefas'
}

export function ProcessesPage() {
  const [tab, setTab] = useState<string>(() => resolveProcessTab(readJSON<string>(KEY)))
  const change = (v: string) => {
    setTab(v)
    writeJSON(KEY, v)
  }
  return (
    <Guard action="workflows:view" what="os processos">
      <PageHeader eyebrow="Processos" title="Tarefas e processos" description="O trabalho que tem passo a passo: renovação, cobrança, locação nova, vistoria. As automações abrem o processo sozinhas, sem repetir." />
      <Tabs value={tab} onValueChange={change} tabs={TABS}>
        {/* Cada aba só monta (e só consulta) quando aberta. Dentro da aba, as seções empilham com um
            título entre elas (nunca aba dentro de aba). */}
        <TabPanel value="tarefas" className="mt-4 flex flex-col gap-4">
          <TasksTab />
        </TabPanel>
        <TabPanel value="processos" className="mt-4 flex flex-col gap-4">
          <InstancesTab />
          <SectionHeading className="mt-4" title="Modelos de processo" text="As etapas de cada tipo de processo: quem faz, o prazo e se exige aprovação." />
          <TemplatesTab />
        </TabPanel>
        <TabPanel value="automacoes-comunicados" className="mt-4 flex flex-col gap-4">
          {/* Aqui as duas partes levam título: o nome da aba não diz sozinho onde uma acaba e a outra começa. */}
          <SectionHeading title="Comunicados" text="Os avisos da administração aos inquilinos e proprietários. Cada envio também entra na caixa de saída, abaixo." />
          <AnnouncementsTab />
          <SectionHeading className="mt-4" title="Automações" text="As regras que trabalham sozinhas, o registro de cada rodada e a caixa de saída de e-mail." />
          <AutomationsTab />
        </TabPanel>
      </Tabs>
    </Guard>
  )
}

/**
 * Título de uma parte da aba (h2 + uma linha do que ela traz). Fora de cartão de propósito: a parte
 * de baixo já desenha os próprios cartões, e cartão dentro de cartão pesa a tela.
 */
function SectionHeading({ title, text, className }: { title: string; text: string; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <h2 className="text-[15px] font-medium">{title}</h2>
      <p className="text-sm text-muted">{text}</p>
    </div>
  )
}
