/* =============================================================================
   Configurações: a conta inteira numa tela de quatro abas. Cada aba empilha seções que
   respondem à mesma pergunta (antes eram sete abas; juntas em 06/11 para a tela ficar mais calma):
   - Empresa: os dados da empresa (com a prévia da cor) e, embaixo, o tema da tela ("quem somos");
   - Usuários e permissões: quem acessa, os convites pendentes e o que cada colaborador pode fazer
     ("quem entra e o que pode");
   - Carteiras e situações: os grupos de imóveis e o nome e a cor de cada situação da unidade
     ("como os imóveis são organizados e pintados");
   - Auditoria: tudo o que mudou na conta.

   Só o administrador entra (Guard "settings:manage"). Carteiras e permissões só aparecem na conta
   de imobiliária (o proprietário independente não tem equipe nem carteira); nessa conta a aba
   leva só o nome do que sobra ("Usuários", "Situações e cores"). A aba escolhida fica lembrada no
   navegador, e quem tinha lembrada uma aba antiga cai na aba que a recebeu (ver OLD_TABS).
   ============================================================================= */
import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link } from '@tanstack/react-router'
import { Moon, Sun } from 'lucide-react'
import { Guard } from '@/app/Guard'
import { useSession, useSessionApi } from '@/auth/SessionProvider'
import { can, hasFeature } from '@/auth/permissions'
import { useRepo, useRepoMutation } from '@/data/hooks'
import type { Organization } from '@/data/types'
import { formatDocument } from '@/lib/documents'
import { readJSON, writeJSON } from '@/lib/storage'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { PageHeader, Section } from '@/components/ui/Layout'
import { ErrorState, Skeleton } from '@/components/ui/States'
import { TabPanel, Tabs, type TabDef } from '@/components/ui/Tabs'
import { cn } from '@/components/ui/cn'
import { AuditoriaTab } from './AuditoriaTab'
import { CarteirasTab } from './CarteirasTab'
import { PapeisTab } from './PapeisTab'
import { ContrastNote } from './Contraste'
import { companySchema, getCompany, PLAN_LABEL, saveCompany, TIMEZONES, type CompanyInput } from './repo'
import { SituacoesTab } from './SituacoesTab'
import { applyTheme, readTheme, saveTheme, type Theme } from './tema'
import { UsuariosTab } from './UsuariosTab'

const TAB_KEY = 'imobil:configuracoes:aba'

/**
 * As abas da conta. `agency` = conta de imobiliária (tem equipe e carteiras).
 * Nenhuma aba some: cada uma tem ao menos uma seção que vale para as duas contas (Usuários e
 * Situações e cores aparecem sempre). Muda só o nome, para a aba não prometer o que não mostra.
 */
export function settingsTabs(agency: boolean): TabDef[] {
  return [
    { value: 'empresa', label: 'Empresa' },
    { value: 'usuarios-permissoes', label: agency ? 'Usuários e permissões' : 'Usuários' },
    { value: 'carteiras-situacoes', label: agency ? 'Carteiras e situações' : 'Situações e cores' },
    { value: 'auditoria', label: 'Auditoria' },
  ]
}

/** Abas de antes de 06/11 (eram sete): quem tinha uma delas lembrada cai na aba que a recebeu. */
const OLD_TABS: Record<string, string> = {
  aparencia: 'empresa',
  usuarios: 'usuarios-permissoes',
  papeis: 'usuarios-permissoes',
  carteiras: 'carteiras-situacoes',
  situacoes: 'carteiras-situacoes',
}

/**
 * Qual aba abrir a partir do valor lembrado no navegador.
 * 1. Valor antigo vira o novo (OLD_TABS);
 * 2. se a aba não existe nesta lista, abre "Empresa" (valor estranho ou apagado no navegador).
 */
export function resolveSettingsTab(saved: string | null, tabs: TabDef[]): string {
  const value = OLD_TABS[saved ?? ''] ?? saved ?? ''
  return tabs.some((t) => t.value === value) ? value : 'empresa'
}

export function SettingsPage() {
  // Aplica o tema salvo ao abrir a tela (efeito: mexe na página, fora do desenho do React).
  useEffect(() => applyTheme(readTheme()), [])
  return (
    <Guard action="settings:manage" what="as configurações">
      <Settings />
    </Guard>
  )
}

function Settings() {
  const s = useSession()
  const agency = hasFeature(s, 'team')
  const tabs = settingsTabs(agency)
  const [tab, setTabState] = useState<string>(() => readJSON<string>(TAB_KEY) ?? 'empresa')
  // Resolvida a cada desenho (e não só ao abrir): o "Ver como" troca de conta sem sair da tela,
  // e o valor lembrado pode ser de uma aba antiga.
  const current = resolveSettingsTab(tab, tabs)
  const setTab = (v: string) => {
    setTabState(v)
    writeJSON(TAB_KEY, v)
  }
  return (
    <>
      <PageHeader
        eyebrow="Configurações"
        title="Conta e preferências"
        description={`Dados de ${s.org.name}, quem acessa e com qual papel, cores das situações e o registro de tudo o que mudou.`}
        actions={
          // Dados (importar planilha e editar em lote) saiu do menu e mora aqui (05/11: menu mais curto).
          can(s, 'data:import') && (
            <>
              <Link to="/dados/importar" className="inline-flex h-10 items-center rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:border-border-strong">
                Importar planilha
              </Link>
              <Link to="/dados" className="inline-flex h-10 items-center rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:border-border-strong">
                Editar dados em lote
              </Link>
            </>
          )
        }
      />
      {/* Cada seção já desenha o próprio cartão com título (Section), por isso a aba só empilha:
          embrulhar de novo daria cartão dentro de cartão. A regra de quem vê cada seção é a de antes. */}
      <Tabs value={current} onValueChange={setTab} tabs={tabs}>
        <TabPanel value="empresa" className="mt-4 flex flex-col gap-4 focus-visible:outline-none">
          <CompanyTab />
          <AppearanceTab />
        </TabPanel>
        <TabPanel value="usuarios-permissoes" className="mt-4 flex flex-col gap-4 focus-visible:outline-none">
          <UsuariosTab />
          {agency && <PapeisTab />}
        </TabPanel>
        <TabPanel value="carteiras-situacoes" className="mt-4 flex flex-col gap-4 focus-visible:outline-none">
          {agency && <CarteirasTab />}
          <SituacoesTab />
        </TabPanel>
        <TabPanel value="auditoria" className="mt-4 focus-visible:outline-none">
          <AuditoriaTab />
        </TabPanel>
      </Tabs>
    </>
  )
}

/* ---------------------------------------------------------------- empresa */

function CompanyTab() {
  const q = useRepo('config:empresa', getCompany)
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <Skeleton className="h-96" />
  // key: dados novos (outra conta, ou depois de salvar) remontam o formulário com os valores certos.
  return <CompanyForm key={`${q.data.id}:${q.data.name}:${q.data.document}:${q.data.timezone}:${q.data.brand_color}`} org={q.data} />
}

function CompanyForm({ org }: { org: Organization }) {
  const s = useSession()
  const { setPersona } = useSessionApi()
  const form = useForm<CompanyInput>({
    resolver: zodResolver(companySchema),
    mode: 'onBlur',
    defaultValues: { name: org.name, document: formatDocument(org.document), timezone: org.timezone, brand_color: org.brand_color },
  })
  const { register, handleSubmit, setValue, control, formState } = form
  const color = useWatch({ control, name: 'brand_color' })
  const validColor = /^#[0-9a-fA-F]{6}$/.test(color ?? '') ? color : org.brand_color
  const save = useRepoMutation(saveCompany, {
    success: 'Dados da empresa salvos.',
    // Remonta a sessão para o nome novo aparecer na barra de cima e o "hoje" seguir o fuso novo.
    onSuccess: () => setPersona(s.user.id, s.org.id),
  })
  const submit = handleSubmit((v) => save.mutate(v))
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Section title="Empresa">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit} noValidate>
          <Field label={org.kind === 'agency' ? 'Nome da imobiliária' : 'Nome da conta'} required error={formState.errors.name?.message} className="sm:col-span-2">
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('name')} />}
          </Field>
          <Field label={org.kind === 'agency' ? 'CNPJ' : 'CPF ou CNPJ'} required hint="Com ou sem pontuação. CNPJ com letras (novo formato da Receita) também vale." error={formState.errors.document?.message}>
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} inputMode="text" autoComplete="off" {...register('document')} />}
          </Field>
          <Field label="Fuso horário" required hint={`"Hoje" e o vencido de cada cobrança são contados neste fuso.`} error={formState.errors.timezone?.message}>
            {({ id, describedBy, invalid }) => (
              <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('timezone')}>
                {TIMEZONES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Cor da marca" required hint="Usada no portal e nos documentos gerados." error={formState.errors.brand_color?.message}>
            {({ id, describedBy, invalid }) => (
              <span className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Escolher a cor da marca"
                  className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-border bg-surface p-1"
                  value={validColor.toLowerCase()}
                  onChange={(e) => setValue('brand_color', e.target.value, { shouldValidate: true, shouldDirty: true })}
                />
                <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} className="font-mono uppercase" maxLength={7} {...register('brand_color')} />
              </span>
            )}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">Plano</span>
            <p className="flex h-10 items-center rounded-lg border border-border bg-surface-2 px-3 text-sm">{PLAN_LABEL[org.plan]}</p>
            <p className="text-xs text-muted">Muda pela assinatura, não por aqui.</p>
          </div>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" variant="primary" loading={save.isPending} disabled={!formState.isDirty}>
              Salvar
            </Button>
          </div>
        </form>
      </Section>
      <Section title="Prévia da cor">
        <div className="flex flex-col gap-3">
          <span className="inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold text-white" style={{ background: validColor }}>
            Botão do portal
          </span>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-md px-2.5 py-0.5 text-xs font-semibold" style={{ background: `color-mix(in srgb, ${validColor} 14%, transparent)`, color: `color-mix(in srgb, ${validColor} 70%, black)` }}>
            <span className="size-1.5 rounded-full" style={{ background: validColor }} aria-hidden="true" /> Selo de exemplo
          </span>
          <ContrastNote color={validColor} min={4.5} />
          <p className="text-xs text-muted">Tipo de conta: {org.kind === 'agency' ? 'imobiliária' : 'proprietário independente'}.</p>
        </div>
      </Section>
    </div>
  )
}

/* ---------------------------------------------------------------- aparência */

function AppearanceTab() {
  const [theme, setTheme] = useState<Theme>(readTheme)
  const choose = (t: Theme) => {
    saveTheme(t)
    setTheme(t)
  }
  const options: { value: Theme; label: string; text: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Claro', text: 'Fundo claro, o padrão.', icon: Sun },
    { value: 'dark', label: 'Escuro', text: 'Fundo escuro, cansa menos à noite.', icon: Moon },
  ]
  return (
    <Section title="Tema">
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Tema da tela</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
          {options.map((o) => (
            <label key={o.value} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-4', theme === o.value ? 'border-primary bg-primary-soft/60' : 'border-border hover:border-border-strong')}>
              <input type="radio" name="tema" className="mt-1 size-4 accent-[var(--primary)]" checked={theme === o.value} onChange={() => choose(o.value)} />
              <o.icon className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden="true" />
              <span>
                <span className="block font-semibold">{o.label}</span>
                <span className="block text-sm text-muted">{o.text}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted">Vale para este navegador. Na versão com login, a preferência acompanha o seu usuário.</p>
      </fieldset>
    </Section>
  )
}
