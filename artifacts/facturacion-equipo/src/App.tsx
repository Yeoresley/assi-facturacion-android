import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ClerkProvider, Show, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  useCreateCustomer, useCreateInvoice, useCreateInvoiceShare, useDeleteCustomer,
  useExportVersatInvoices, useGetBillingOverview, useGetCurrentTeamMember, useGetInvoice,
  useInviteTeamMember, useListTeamMembers,
  useGetSharedInvoice, useHealthCheck, useListCustomers, useListInvoices, useUpdateCustomer, useUpdateInvoice,
  useUpdateInvoiceStatus, getGetBillingOverviewQueryKey, getGetCurrentTeamMemberQueryKey,
  getGetInvoiceQueryKey, getGetSharedInvoiceQueryKey, getListCustomersQueryKey,
  getListInvoicesQueryKey, getExportVersatInvoicesQueryKey, getListTeamMembersQueryKey,
  getHealthCheckQueryKey,
} from '@workspace/api-client-react';
import type { ListInvoicesPaymentStatus, ListInvoicesStatus, Customer, CustomerInput, Invoice, InvoiceInput, InvoiceStatusInputStatus } from '@workspace/api-client-react';
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck, Banknote, BookOpen, CalendarDays,
  Check, ChevronDown, CircleHelp, Clipboard, FilePlus2, FileText, Filter, HandCoins, LayoutDashboard,
  LogOut, Mail, Printer, Search, Settings2, ShieldAlert, Users, WalletCards, X,
} from 'lucide-react';
import { Link, Redirect, Route, Switch, Router as WouterRouter, useLocation, useParams } from 'wouter';
import { BrandMark, EmptyState, PageHeading, QueryError, Status, statusLabels, date, money } from '@/lib/shared';
import CatalogsPage from '@/pages/catalogs';
import CustomersPage from '@/pages/customers';
import Customer360Page from '@/pages/customer-360';
import ExportPage from '@/pages/export';
import InvoiceDetailPage from '@/pages/invoice-detail';
import InvoiceFormPage from '@/pages/invoice-form';
import SharedInvoicePage from '@/pages/shared-invoice';
import TeamMembers from '@/pages/team-members';
import SettlementsPage from '@/pages/settlements';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CorrectPaidButton, MarkPaidButton, PaymentBadge } from '@/components/invoice-payment';
import { IssuerSettings } from '@/components/issuer-settings';
import { NumberingSettings } from '@/components/numbering-settings';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const stripBase = (path: string) => basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/brand/assi-wordmark.png`,
  },
  variables: {
    colorPrimary: '#087eaf', colorForeground: '#12365a', colorMutedForeground: '#617887',
    colorDanger: '#a33f39', colorBackground: '#ffffff', colorInput: '#ffffff',
    colorInputForeground: '#173d5d', colorNeutral: '#c9d9e1', fontFamily: 'DM Sans, sans-serif',
    borderRadius: '0.65rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#12365a] font-bold',
    headerSubtitle: 'text-[#617887]',
    socialButtonsBlockButtonText: 'text-[#204b68] font-semibold',
    formFieldLabel: 'text-[#375b73] font-semibold',
    footerActionLink: 'text-[#087eaf] font-semibold',
    footerActionText: 'text-[#617887]',
    dividerText: 'text-[#617887]',
    identityPreviewEditButton: 'text-[#087eaf]',
    formFieldSuccessText: 'text-[#176d55]',
    alertText: 'text-[#a33f39]',
    logoBox: 'mb-3',
    logoImage: 'h-10',
    socialButtonsBlockButton: 'border-[#c9d9e1] bg-[#f5fafc] hover:bg-[#eaf5f8]',
    formButtonPrimary: 'bg-[#087eaf] hover:bg-[#086d99] text-white',
    formFieldInput: 'border-[#c9d9e1] bg-white text-[#173d5d]',
    footerAction: 'text-[#617887]',
    dividerLine: 'bg-[#dce8ed]',
    alert: 'bg-[#fff1ef] border-[#efd0cc]',
    otpCodeFieldInput: 'border-[#c9d9e1] bg-white text-[#173d5d]',
    formFieldRow: 'mb-4',
    main: 'text-[#213d39]',
  },
};

const navItems = [
  { href: '/dashboard', label: 'Resumen', icon: LayoutDashboard },
  { href: '/invoices', label: 'Facturas', icon: FileText },
  { href: '/customers', label: 'Clientes', icon: Users },
  { href: '/catalogs', label: 'Catálogos', icon: BookOpen },
  { href: '/settlements', label: 'Liquidación', icon: WalletCards },
  { href: '/export', label: 'Exportar', icon: ArrowDownToLine },
  { href: '/settings', label: 'Ajustes', icon: Settings2 },
];

function CacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previousId = useRef<string | null | undefined>(undefined);
  useEffect(() => addListener(({ user }) => {
    const id = user?.id ?? null;
    if (previousId.current !== undefined && previousId.current !== id) client.clear();
    previousId.current = id;
  }), [addListener, client]);
  return null;
}

function RoutedBoundary({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  return <ErrorBoundary resetKey={path}>{children}</ErrorBoundary>;
}

function Home() {
  return <div className="min-h-[100dvh] bg-[#f6f4eb] text-[#12365a]">
    <Show when="signed-in"><Redirect to="/dashboard" /></Show>
    <header className="mx-auto flex max-w-[1240px] items-center justify-between px-6 py-5 md:px-10">
      <BrandMark />
      <nav className="flex items-center gap-5 text-[13px] font-semibold">
        <span className="hidden text-[#75827c] sm:inline">El escritorio de facturación de tu equipo</span>
        <Link href="/sign-in" className="button button-plain !min-h-9">Acceder <ArrowRight size={14} /></Link>
      </nav>
    </header>
    <main>
      <section className="mx-auto grid min-h-[640px] max-w-[1240px] items-center gap-12 px-6 pb-16 pt-10 md:grid-cols-[1.02fr_.98fr] md:px-10 md:pb-24 md:pt-12">
        <div className="fade-in relative z-10">
          <div className="eyebrow mb-6 flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#19a9ca]" /> Facturación compartida, sin perseguir PDFs</div>
          <h1 className="font-display max-w-[660px] text-[clamp(48px,7vw,88px)] font-extrabold leading-[.98] tracking-[-.075em]">Cada factura,<br /><span className="text-[#087eaf]">en su sitio.</span></h1>
          <p className="mt-7 max-w-[490px] text-[17px] leading-7 text-[#687a74]">Un solo escritorio para que especialistas preparen las facturas y quien lleva el negocio cierre el mes con claridad.</p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/sign-up" className="button button-primary !min-h-12 !px-6">Empezar a facturar <ArrowRight size={16} /></Link>
            <Link href="/sign-in" className="button button-plain !min-h-12 !px-5">Ya tengo una cuenta</Link>
          </div>
          <div className="mt-9 flex items-center gap-3 text-[12px] text-[#78847e]"><div className="flex -space-x-2"><span className="grid h-8 w-8 place-items-center rounded-full border-2 border-[#f6f4eb] bg-[#c5dbce] text-[10px] font-bold text-[#31564d]">AN</span><span className="grid h-8 w-8 place-items-center rounded-full border-2 border-[#f6f4eb] bg-[#edcf9e] text-[10px] font-bold text-[#765929]">LM</span><span className="grid h-8 w-8 place-items-center rounded-full border-2 border-[#f6f4eb] bg-[#d7d8c7] text-[10px] font-bold text-[#46554c]">+T</span></div><span>Hecho para equipos pequeños que trabajan en remoto.</span></div>
        </div>
        <div className="relative mx-auto w-full max-w-[550px] fade-in" style={{ animationDelay: '.12s' }}>
          <div className="absolute -right-5 -top-10 h-36 w-36 rounded-full bg-[#19a9ca] opacity-25 blur-3xl" />
          <div className="relative rounded-[22px] border border-[#dce8ed] bg-[#eaf5f8] p-3 shadow-[0_28px_75px_rgba(18,54,90,.13)]">
            <div className="overflow-hidden rounded-[15px] bg-[#fffefa]">
              <div className="flex items-center justify-between border-b border-[#e5edf1] px-5 py-4">
                <div><div className="eyebrow">Ejemplo ilustrativo · cifras en CUP</div><div className="mt-1 font-display text-[16px] font-bold">Panel de facturación</div></div><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#e9f2ec] text-[#347165]"><BadgeCheck size={16} /></span>
              </div>
              <div className="grid grid-cols-2 gap-3 p-4">
                <div className="rounded-xl bg-[#eaf5f8] p-4"><div className="eyebrow">Facturado este mes</div><div className="mt-2 font-display text-[25px] font-bold tracking-[-.05em]">8.420 CUP</div><div className="mt-2 text-[11px] text-[#71817b]">Todo el equipo, una vista</div></div>
                <div className="rounded-xl bg-[#f7edda] p-4"><div className="eyebrow">Pendiente de cobro</div><div className="mt-2 font-display text-[25px] font-bold tracking-[-.05em]">2.180 CUP</div><div className="mt-2 text-[11px] text-[#8a724b]">3 facturas enviadas</div></div>
              </div>
              <div className="px-4 pb-4">
                <div className="mb-2 flex items-center justify-between"><div className="eyebrow">Actividad reciente</div><span className="text-[10px] font-semibold text-[#47756d]">Ver todas</span></div>
                {[
                  ['F-2025-018', 'Estudio Norte', 'Pagada', '1.240 CUP'],
                  ['F-2025-017', 'Marta Soler', 'Enviada', '680 CUP'],
                  ['F-2025-016', 'Taller Orbital', 'Borrador', '940 CUP'],
                ].map(([number, name, status, amount], i) => <div key={number} className="flex items-center justify-between border-t border-[#e9f0f3] py-3">
                  <div className="flex items-center gap-3"><span className={`grid h-8 w-8 place-items-center rounded-lg ${i === 0 ? 'bg-[#e2f0e8] text-[#347765]' : i === 1 ? 'bg-[#fbefd8] text-[#9d762d]' : 'bg-[#f0eee3] text-[#817d64]'}`}><FileText size={14} /></span><div><div className="font-mono text-[10px] text-[#78837e]">{number}</div><div className="mt-0.5 text-[12px] font-semibold">{name}</div></div></div>
                  <div className="text-right"><div className="text-[12px] font-bold">{amount}</div><div className="mt-0.5 text-[10px] text-[#78837e]">{status}</div></div>
                </div>)}
              </div>
              <div className="flex items-center gap-2 bg-[#12365a] px-5 py-3 text-[11px] text-[#e9f1f5]"><ArrowDownToLine size={14} className="text-[#56c9df]" /> Cierre del mes listo para revisar y exportar</div>
            </div>
          </div>
          <div className="absolute -bottom-6 -left-7 hidden items-center gap-3 rounded-xl border border-[#e7e3d7] bg-[#fffefa] px-4 py-3 shadow-lg sm:flex"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#e7f1e9] text-[#347765]"><Check size={16} /></span><div><div className="text-[12px] font-bold">Una factura menos por perseguir</div><div className="mt-0.5 text-[10px] text-[#78837e]">Compartida y lista para el cliente</div></div></div>
        </div>
      </section>
      <section className="border-y border-[#dce8ed] bg-[#eaf5f8]">
        <div className="mx-auto grid max-w-[1240px] gap-8 px-6 py-12 md:grid-cols-[.7fr_1.3fr] md:px-10 md:py-16">
          <div><div className="eyebrow">Menos administración. Más control.</div><h2 className="font-display mt-4 max-w-[360px] text-[32px] font-bold leading-tight tracking-[-.055em]">De preparar a cerrar el mes.</h2></div>
          <div className="grid gap-8 sm:grid-cols-3">
            {[
              ['01', 'Prepara en equipo', 'Cada especialista crea facturas para clientes compartidos, sin archivos sueltos.'],
              ['02', 'Revisa con contexto', 'Estados y actividad se entienden de un vistazo. El propietario ve el mes completo.'],
              ['03', 'Comparte y exporta', 'Envía un enlace al cliente y prepara el período para revisar en Versat Sarasola.'],
            ].map(([n, title, text]) => <div key={n} className="border-t border-[#cfe2e9] pt-4"><div className="font-mono text-[11px] text-[#087eaf]">{n}</div><h3 className="mt-3 font-display text-[16px] font-bold">{title}</h3><p className="mt-2 text-[13px] leading-5 text-[#71807a]">{text}</p></div>)}
          </div>
        </div>
      </section>
      <section className="mx-auto flex max-w-[1240px] flex-col items-start justify-between gap-8 px-6 py-16 md:flex-row md:items-center md:px-10 md:py-20">
        <div><div className="eyebrow">La claridad también es trabajo</div><h2 className="font-display mt-3 text-[34px] font-bold tracking-[-.055em]">El mes, sin perseguir a nadie.</h2></div>
        <Link href="/sign-up" className="button button-primary !min-h-12 !px-6">Crear mi espacio de trabajo <ArrowUpRight size={16} /></Link>
      </section>
    </main>
    <footer className="border-t border-[#e5e1d5] px-6 py-6 text-center text-[11px] text-[#78847e]">ASSI <span className="mx-2">·</span> Facturación de equipo</footer>
  </div>;
}

function SignInPage() {
  return <div className="grain grid min-h-[100dvh] place-items-center bg-[#f4f2e9] px-4 py-10"><div className="absolute left-6 top-6"><Link href="/" aria-label="Volver a inicio"><BrandMark /></Link></div><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>;
}
function SignUpPage() {
  return <div className="grain grid min-h-[100dvh] place-items-center bg-[#f4f2e9] px-4 py-10"><div className="absolute left-6 top-6"><Link href="/" aria-label="Volver a inicio"><BrandMark /></Link></div><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>;
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const client = useQueryClient();
  const member = useGetCurrentTeamMember({ query: { queryKey: getGetCurrentTeamMemberQueryKey(), retry: false, refetchInterval: 30000 } });
  const sig = member.data ? `${member.data.userId}|${member.data.role}|${member.data.commercialId ?? ''}|${member.data.suspended}` : null;
  const lastSig = useRef<string | null>(null);
  useEffect(() => {
    if (member.data?.suspended || member.isError || member.data?.role === 'pending') {
      const filters = { predicate: (q: { queryKey: readonly unknown[] }) => {
        const key = String(q.queryKey[0] ?? '');
        return key.startsWith('/api/') && key !== '/api/team/me' && !key.startsWith('/api/shared-invoices/') && key !== '/api/healthz';
      } };
      // Cancel before removal so an already-running request cannot repopulate private data.
      void client.cancelQueries(filters).then(() => client.removeQueries(filters));
      client.getMutationCache().clear();
    }
  }, [member.data?.suspended, member.data?.role, member.isError, client]);
  useEffect(() => {
    if (!sig) return;
    if (lastSig.current !== null && lastSig.current !== sig) {
      client.resetQueries({ predicate: (q) => { const k = String(q.queryKey[0] ?? ''); return k.startsWith('/api/invoices') || k.startsWith('/api/billing') || k.startsWith('/api/customers'); } });
    }
    lastSig.current = sig;
  }, [sig, client]);
  if (member.isLoading) return <div className="grid min-h-[100dvh] place-items-center bg-[#f6f4eb]"><div className="w-[280px] space-y-3"><div className="skeleton h-5 w-36" /><div className="skeleton h-3 w-full" /><div className="skeleton h-3 w-2/3" /></div></div>;
  if (member.isError || !member.data) return <AccessMessage title="No pudimos comprobar tu acceso" body="La sesión está activa, pero el servicio de equipo no respondió. Comprueba la conexión e inténtalo de nuevo." retry={() => member.refetch()} />;
  const me = member.data;
  if (me.suspended) return <AccessMessage title="Tu acceso está suspendido" body="El propietario ha suspendido tu acceso al equipo. Tus facturas e historial se conservan. Pídele que reactive tu acceso y comprueba de nuevo." retry={() => member.refetch()} />;
  if (me.role === 'pending') return <AccessMessage title="Tu acceso está pendiente" body="La cuenta está creada. El propietario del espacio debe habilitar tu acceso antes de entrar al escritorio." retry={() => member.refetch()} />;
  const visibleNavItems = navItems.filter(({ href }) => me.role === 'owner' || !['/export', '/settings', '/catalogs'].includes(href));
  const sidebarItems = [...visibleNavItems, ...(me.role === 'owner' ? [{ href: '/team/members', label: 'Equipo', icon: Users }] : [])];
  return <div className="app-shell flex bg-[#f6f4eb]">
    <aside className="sidebar fixed inset-y-0 left-0 z-20 flex w-[238px] flex-col px-4 py-5">
      <Link href="/dashboard" className="mb-9 px-2"><BrandMark tone="dark" /></Link>
      <div className="mb-3 px-3 eyebrow !text-[#98aaa2]">Espacio de trabajo</div>
      <nav className="space-y-1">{sidebarItems.map(({ href, label, icon: Icon }) => <Link href={href} key={href} className={`side-link ${location === href || (href === '/invoices' && location.startsWith('/invoices')) ? 'active' : ''}`}><Icon size={17} />{label}{href === '/export' && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#eab45c]" />}</Link>)}</nav>
      <div className="mt-auto">
        <div className="mb-4 rounded-xl border border-white/10 bg-white/[.04] p-3.5"><div className="flex items-center gap-2 text-[11px] font-semibold text-[#e7c17c]"><span className="h-1.5 w-1.5 rounded-full bg-[#e7c17c]" />Todo en orden</div><p className="mt-2 text-[11px] leading-[1.6] text-[#b6c3bc]">Tu equipo factura desde un único sitio. El cierre puede esperar a cuando tú quieras.</p></div>
        <button className="side-link w-full" data-testid="button-sign-out" onClick={() => signOut({ redirectUrl: basePath || '/' })}><LogOut size={16} />Cerrar sesión</button>
      </div>
    </aside>
    <div className="app-content ml-0 flex min-h-[100dvh] w-full flex-col min-[801px]:ml-[238px]">
      <header className="topbar sticky top-0 z-10 flex h-[66px] items-center justify-between border-b border-[#d9e4e7] bg-[#e9f0f2]/95 px-5 backdrop-blur md:px-9">
        <Link href="/dashboard" className="mobile-brand" aria-label="ASSI, ir al resumen"><BrandMark /></Link>
        <div className="desktop-account-label text-[12px] text-[#89918a]">Cuenta del equipo <span className="mx-2">/</span><span className="font-semibold text-[#39534e]">{me.role === 'owner' ? 'Propietario' : 'Especialista'}</span></div>
        <div className="flex items-center gap-3"><div className="account-details hidden text-right sm:block"><div className="text-[12px] font-bold">{me.name || user?.fullName || 'Cuenta'}</div><div className="text-[10px] text-[#84908a]">{me.email || user?.primaryEmailAddress?.emailAddress}</div></div><div className="grid h-9 w-9 place-items-center rounded-full bg-[#dce9df] text-[11px] font-bold text-[#315c51]">{(me.name || user?.firstName || 'CC').split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase()}</div></div>
      </header>
      <main className="main-content min-w-0 flex-1 px-5 py-8 md:px-9 md:py-9">{children}</main>
    </div>
    <nav className="mobile-nav">{visibleNavItems.map(({ href, label, icon: Icon }) => <Link href={href} key={href} className={location === href ? 'active' : ''}><Icon size={18} /><span>{label}</span></Link>)}</nav>
  </div>;
}

function AccessMessage({ title, body, retry }: { title: string; body: string; retry: () => void }) {
  return <div className="grid min-h-[100dvh] place-items-center bg-[#f6f4eb] px-5"><div className="panel max-w-[480px] p-8 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#f7edda] text-[#9a742e]"><ShieldAlert size={22} /></span><h1 className="font-display mt-5 text-2xl font-bold tracking-[-.04em]">{title}</h1><p className="mt-3 text-sm leading-6 text-[#71817b]">{body}</p><button className="button button-primary mt-6" onClick={retry} data-testid="button-access-retry">Comprobar de nuevo</button></div></div>;
}
function Protected({ children }: { children: ReactNode }) {
  return <><Show when="signed-in"><Shell>{children}</Shell></Show><Show when="signed-out"><Redirect to="/" /></Show></>;
}

function InvoiceTable({ invoices, emptyPayment }: { invoices: Invoice[]; emptyPayment?: 'pending' | 'partial' }) {
  if (!invoices.length && emptyPayment === 'pending') return <EmptyState title="No hay pagos pendientes" text="Ninguna factura emitida está pendiente de pago con estos filtros." />;
  if (!invoices.length && emptyPayment === 'partial') return <EmptyState title="No hay abonos parciales pendientes" text="Ninguna factura emitida tiene abonos y saldo pendiente con estos filtros." />;
  if (!invoices.length) return <EmptyState title="Aquí empezará el movimiento" text="Cuando el equipo cree una factura, aparecerá en esta lista." action={<Link className="button button-primary" href="/invoices/new"><FilePlus2 size={15} />Crear factura</Link>} />;
  return <div className="overflow-x-auto"><table className="w-full min-w-[980px] border-collapse text-left"><thead><tr className="eyebrow"><th className="px-5 py-3 font-medium">Factura</th><th className="px-4 py-3 font-medium">Cliente</th><th className="px-4 py-3 font-medium">Fecha</th><th className="px-4 py-3 font-medium">Especialista</th><th className="px-4 py-3 font-medium">Estado</th><th className="px-4 py-3 font-medium">Pago</th><th className="px-5 py-3 text-right font-medium">Total</th><th className="px-4 py-3 text-right font-medium">Acción</th></tr></thead><tbody>{invoices.map((inv) => <tr className="table-row" key={inv.id} data-testid={`row-invoice-${inv.id}`}><td className="px-5 py-4"><Link href={`/invoices/${inv.id}`} className="font-mono text-[12px] font-medium text-[#2e6960]">{inv.number}</Link></td><td className="px-4 py-4 text-[13px] font-semibold">{inv.customerName}</td><td className="px-4 py-4 text-[12px] text-[#71817b]">{date(inv.issueDate)}</td><td className="px-4 py-4 text-[12px] text-[#71817b]">{inv.specialistName}</td><td className="px-4 py-4"><Status status={inv.status} /></td><td className="px-4 py-4"><div className="flex flex-wrap items-center gap-2"><PaymentBadge invoice={inv} /><MarkPaidButton invoice={inv} /><CorrectPaidButton invoice={inv} /></div>{inv.totalPaid > 0 && inv.paymentStatus === 'pending' && <div className="mt-2 text-[10px] leading-4 text-[#71817b]">Abonado {money(inv.totalPaid, inv.currency)} <span aria-hidden="true">·</span> Saldo {money(inv.balanceDue, inv.currency)}</div>}</td><td className="px-5 py-4 text-right text-[13px] font-bold">{money(inv.total, inv.currency)}</td><td className="px-4 py-4 text-right"><Link href={inv.status === 'draft' ? `/invoices/${inv.id}/edit` : `/invoices/${inv.id}`} className="button button-plain !min-h-8 !px-2.5 text-[11px]" data-testid={`link-invoice-action-${inv.id}`}>{inv.status === 'draft' ? 'Editar borrador' : 'Abrir factura'}</Link></td></tr>)}</tbody></table></div>;
}

function Dashboard() {
  const overview = useGetBillingOverview({ query: { queryKey: getGetBillingOverviewQueryKey(), retry: false, refetchInterval: 20000 } });
  const currentMember = useGetCurrentTeamMember({ query: { queryKey: getGetCurrentTeamMemberQueryKey(), retry: false } });
  const owner = currentMember.data?.role === 'owner';
  const [month] = useState(() => new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(new Date()));
  return <div className="fade-in">
    <PageHeading eyebrow="Tu escritorio" title="Buenos días. Aquí está el mes." description={`Resumen compartido · ${month}`} action={<Link href="/invoices/new" className="button button-primary"><FilePlus2 size={16} />Nueva factura</Link>} />
    {overview.isLoading ? <div className="grid gap-4 md:grid-cols-4">{[0,1,2,3].map((i) => <div className="panel p-5" key={i}><div className="skeleton h-3 w-24" /><div className="skeleton mt-4 h-8 w-28" /><div className="skeleton mt-3 h-3 w-32" /></div>)}</div> :
      (overview.isError || !overview.data) ? <QueryError retry={() => overview.refetch()} message="El resumen del equipo no está disponible." /> :
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Facturado este mes', value: money(overview.data.monthTotal, overview.data.currency), note: 'Total del período', icon: Banknote, tint: 'bg-[#e3f0e8] text-[#377868]' },
          { label: 'Facturas en el mes', value: overview.data.invoiceCount, note: 'Actividad del equipo', icon: FileText, tint: 'bg-[#e9eee7] text-[#52756a]' },
          { label: 'Aceptadas', value: overview.data.acceptedCount, note: 'Pendientes de importar en Versat (aceptar no es cobrar)', icon: HandCoins, tint: 'bg-[#f8edd7] text-[#a07832]' },
          { label: 'En edición', value: overview.data.draftCount, note: `${overview.data.finishedCount} terminadas · ${overview.data.confirmedCount} confirmadas`, icon: Clipboard, tint: 'bg-[#efeee4] text-[#837f65]' },
        ].map(({ label, value, note, icon: Icon, tint }) => <div key={label} className="panel p-5"><div className="flex items-start justify-between"><div className="eyebrow">{label}</div><span className={`grid h-9 w-9 place-items-center rounded-xl ${tint}`}><Icon size={17} /></span></div><div className="font-display mt-4 text-[27px] font-bold tracking-[-.06em]">{value}</div><div className="mt-1 text-[11px] text-[#7c8881]">{note}</div></div>)}
      </div>}
    <section className="panel mt-5 p-5" aria-labelledby="outstanding-title" data-testid="outstanding-summary">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><div className="eyebrow">Seguimiento de cobros</div><h2 id="outstanding-title" className="font-display mt-1 text-lg font-bold tracking-[-.04em]">Saldo pendiente por moneda</h2></div>
        <span className="text-[11px] text-[#7c8881]">Facturas emitidas con saldo por cobrar</span>
      </div>
      {overview.isLoading ? <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0,1].map((i) => <div className="rounded-xl border border-[#e8e5da] p-4" key={i}><div className="skeleton h-3 w-12" /><div className="skeleton mt-3 h-7 w-28" /></div>)}</div> :
       overview.isError || !overview.data ? <div className="mt-4"><QueryError retry={() => overview.refetch()} message="No se pudieron consultar los saldos pendientes." /></div> :
       overview.data.outstandingByCurrency.length === 0 ? <div className="mt-4"><EmptyState title="No hay saldos pendientes" text="Las facturas emitidas del equipo están cobradas o todavía no tienen saldo pendiente." /></div> :
       <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{overview.data.outstandingByCurrency.map(({ currency, amount }) => <div className="rounded-xl border border-[#e8e5da] bg-[#fffefa] p-4" key={currency} data-testid={`outstanding-${currency}`}><div className="eyebrow">{currency}</div><div className="font-display mt-2 text-[24px] font-bold tabular-nums tracking-[-.05em]">{money(amount, currency)}</div></div>)}</div>}
    </section>
    <div className="mt-8 grid gap-5 xl:grid-cols-[1fr_300px]">
      <section className="panel overflow-hidden"><div className="flex items-center justify-between px-5 py-5"><div><div className="eyebrow">Trabajo reciente</div><h2 className="font-display mt-1 text-lg font-bold tracking-[-.04em]">Últimas facturas</h2></div><Link href="/invoices" className="flex items-center gap-1 text-[12px] font-bold text-[#387368]">Ver todas <ArrowRight size={14} /></Link></div>
        {overview.isLoading ? <div className="space-y-4 p-5">{[0,1,2].map((x) => <div className="skeleton h-9" key={x} />)}</div> : (overview.isError || !overview.data) ? <div className="p-5"><QueryError retry={() => overview.refetch()} /></div> : <InvoiceTable invoices={overview.data.recentInvoices || []} />}
      </section>
      <aside className="flex flex-col gap-4">
        {owner && <div className="rounded-[14px] bg-[#244a44] p-5 text-[#f4f2e8]"><div className="eyebrow !text-[#c7b078]">Siguiente paso</div><h3 className="font-display mt-3 text-xl font-bold tracking-[-.04em]">Cierra el mes con calma.</h3><p className="mt-2 text-[12px] leading-5 text-[#c5d1c8]">Prepara un período para revisar sus facturas antes de exportarlo a Versat Sarasola.</p><Link href="/export" className="button mt-5 !min-h-9 !border-white/20 !bg-white/10 !text-white">Preparar exportación <ArrowRight size={14} /></Link></div>}
        <div className="panel p-5"><div className="eyebrow">Del equipo</div><div className="mt-4 flex items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#f7ecd6] text-[#a37b37]"><Users size={17} /></div><div><h3 className="text-[13px] font-bold">Un espacio compartido</h3><p className="mt-1 text-[11px] leading-5 text-[#79857e]">Especialistas y propietario trabajan con el mismo estado actualizado.</p></div></div></div>
      </aside>
    </div>
  </div>;
}

function Invoices() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [payment, setPayment] = useState('');
  const params = { ...(search.trim() ? { search: search.trim() } : {}), ...(status ? { status: status as ListInvoicesStatus } : {}), ...(payment ? { paymentStatus: payment as ListInvoicesPaymentStatus } : {}) };
  const query = useListInvoices(params, { query: { queryKey: getListInvoicesQueryKey(params), refetchInterval: 20000 } });
  return <div className="fade-in">
    <PageHeading eyebrow="Archivo del equipo" title="Facturas" description="Busca una factura o filtra por estado." action={<Link href="/invoices/new" className="button button-primary"><FilePlus2 size={16} />Nueva factura</Link>} />
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eeece4] px-4 py-4 md:px-5">
        <label className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a9690]" size={16} /><input className="field !h-10 !pl-9" type="search" placeholder="Buscar por número o cliente" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-invoice-search" /></label>
        <label className="relative flex items-center gap-2 text-[#84908a]"><Filter size={14} /><select className="field !h-10 !w-[155px] appearance-none pr-8 text-[12px]" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtrar por estado" data-testid="select-invoice-status"><option value="">Todos los estados</option>{Object.entries(statusLabels).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3" size={14} /></label>
         <label className="relative flex items-center gap-2 text-[#84908a]"><select className="field !h-10 !w-[190px] appearance-none pr-8 text-[12px]" value={payment} onChange={(e) => setPayment(e.target.value)} aria-label="Filtrar por pago" data-testid="select-invoice-payment"><option value="">Todos los pagos</option><option value="pending">Pendientes de pago</option><option value="partial">Con abonos parciales</option><option value="paid">Pagadas</option></select><ChevronDown className="pointer-events-none absolute right-3" size={14} /></label>
      </div>
      {query.isLoading ? <div className="space-y-4 p-5">{[0,1,2,3,4].map((i) => <div className="skeleton h-10" key={i} />)}</div> : query.isError ? <div className="p-5"><QueryError retry={() => query.refetch()} /></div> : <InvoiceTable invoices={query.data || []} emptyPayment={payment === 'pending' || payment === 'partial' ? payment : undefined} />}
    </section>
  </div>;
}

function Settings() {
  const member = useGetCurrentTeamMember({ query: { queryKey: getGetCurrentTeamMemberQueryKey(), retry: false } });
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), retry: false } });
  const me = member.data;
  return <div className="fade-in max-w-[850px]"><PageHeading eyebrow="Tu espacio" title="Ajustes" description="Información de tu cuenta y nivel de acceso." />
    {member.isLoading ? <div className="panel space-y-3 p-6"><div className="skeleton h-4 w-28" /><div className="skeleton h-8 w-48" /><div className="skeleton h-4 w-56" /></div> : (member.isError || !me) ? <QueryError retry={() => member.refetch()} message="No pudimos consultar tu cuenta." /> :
      <div className="grid gap-5 md:grid-cols-[1fr_280px]"><section className="panel p-6"><div className="eyebrow">Cuenta activa</div><div className="mt-5 flex items-center gap-4"><div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#dce9df] font-display text-lg font-bold text-[#315c51]">{(me.name || 'CC').split(/\s+/).map((s) => s[0]).slice(0,2).join('').toUpperCase()}</div><div><h2 className="font-display text-xl font-bold">{me.name || 'Mi cuenta'}</h2><p className="mt-1 text-[12px] text-[#78857f]">{me.email || 'Sin correo asociado'}</p></div></div><div className="mt-6 grid gap-4 border-t border-[#eeece4] pt-5 sm:grid-cols-2"><div><div className="eyebrow">Rol</div><div className="mt-2 text-[13px] font-semibold">{me.role === 'owner' ? 'Propietario' : me.role === 'specialist' ? 'Especialista' : 'Pendiente'}</div></div><div><div className="eyebrow">Identificador</div><div className="mt-2 break-all font-mono text-[11px] text-[#71817b]">{me.userId}</div></div></div></section>
        <aside className="panel p-5"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e5f0e8] text-[#39776a]"><ShieldAlert size={17} /></span><h3 className="font-display mt-4 text-base font-bold">Acceso del equipo</h3><p className="mt-2 text-[12px] leading-5 text-[#77847e]">{me.role === 'owner' ? 'Tienes acceso de propietario para revisar la facturación del equipo.' : me.role === 'specialist' ? 'Tienes acceso de especialista para preparar y compartir facturas.' : 'El propietario debe habilitar tu acceso.'}</p><div className="mt-4 flex items-center gap-2 border-t border-[#eeece4] pt-4 text-[11px] font-semibold text-[#44776a]"><Check size={14} />Sesión verificada</div></aside>
      </div>}
    {me?.role === 'owner' && <IssuerSettings />}
    {me?.role === 'owner' && <NumberingSettings />}
    <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-[14px] border border-[#e4e1d5] bg-[#efeee5] p-5"><div className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#f7edd9] text-[#9d7739]"><Users size={16} /></span><div><div className="text-[12px] font-bold">Accesos del equipo</div><p className="mt-1 text-[11px] leading-5 text-[#77847e]">Consulta los especialistas autorizados y gestiona nuevas altas.</p></div></div><Link href="/team/members" className="button button-plain !min-h-9">Ver equipo <ArrowRight size={14} /></Link></div>
    <div className="mt-5 flex items-center justify-between rounded-xl border border-[#e4e1d5] bg-[#fffefa] px-4 py-3"><div className="flex items-center gap-2 text-[11px] font-semibold text-[#61736c]"><span className={`h-2 w-2 rounded-full ${health.data?.status === 'ok' ? 'bg-[#4a9278]' : health.isError ? 'bg-[#b66050]' : 'bg-[#c9a44c]'}`} />Conexión con el servicio</div><div className="flex items-center gap-3 text-[10px] text-[#85918a]">{health.isLoading ? 'Comprobando…' : health.isError ? 'No disponible' : health.data?.status || 'Conectado'}{health.isError && <button className="font-semibold text-[#39746a]" onClick={() => health.refetch()}>Reintentar</button>}</div></div>
  </div>;
}

function AuthenticatedRoute({ children }: { children: ReactNode }) { return <Protected>{children}</Protected>; }
function OwnerOnly({ children }: { children: ReactNode }) {
  const member = useGetCurrentTeamMember({ query: { queryKey: getGetCurrentTeamMemberQueryKey(), retry: false } });
  if (member.isLoading) return <div className="grid min-h-[50vh] place-items-center"><div className="skeleton h-6 w-40" aria-label="Verificando permisos" /></div>;
  if (member.isError || !member.data) return <AccessMessage title="No pudimos comprobar tu permiso" body="No se pudo verificar que tu cuenta sea propietaria. Vuelve al escritorio e inténtalo de nuevo." retry={() => member.refetch()} />;
  if (member.data.role !== 'owner') return <Redirect to="/dashboard" />;
  return <>{children}</>;
}
function OwnerRoute({ children }: { children: ReactNode }) { return <AuthenticatedRoute><OwnerOnly>{children}</OwnerOnly></AuthenticatedRoute>; }
function HomeRedirect() { return <><Show when="signed-in"><Redirect to="/dashboard" /></Show><Show when="signed-out"><Home /></Show></>; }

function AppRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}
    localization={{ signIn: { start: { title: 'Qué bueno verte', subtitle: 'Accede al escritorio de tu equipo' } }, signUp: { start: { title: 'Crea tu espacio', subtitle: 'Empieza a facturar con tu equipo' } } }}
    routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })}>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider><CacheInvalidator /><RoutedBoundary><Switch>
        <Route path="/" component={HomeRedirect} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route path="/share/:token"><SharedInvoicePage /></Route>
        <Route path="/dashboard"><AuthenticatedRoute><Dashboard /></AuthenticatedRoute></Route>
        <Route path="/invoices"><AuthenticatedRoute><Invoices /></AuthenticatedRoute></Route>
        <Route path="/invoices/new"><AuthenticatedRoute><InvoiceFormPage /></AuthenticatedRoute></Route>
        <Route path="/invoices/:id/edit"><AuthenticatedRoute><InvoiceFormPage /></AuthenticatedRoute></Route>
        <Route path="/invoices/:id"><AuthenticatedRoute><InvoiceDetailPage /></AuthenticatedRoute></Route>
        <Route path="/catalogs"><OwnerRoute><CatalogsPage /></OwnerRoute></Route>
        <Route path="/customers"><AuthenticatedRoute><CustomersPage /></AuthenticatedRoute></Route>
        <Route path="/customers/:id"><AuthenticatedRoute><Customer360Page /></AuthenticatedRoute></Route>
        <Route path="/export"><OwnerRoute><ExportPage /></OwnerRoute></Route>
        <Route path="/settlements"><AuthenticatedRoute><SettlementsPage /></AuthenticatedRoute></Route>
        <Route path="/settings"><OwnerRoute><Settings /></OwnerRoute></Route>
        <Route path="/team/members"><OwnerRoute><TeamMembers /></OwnerRoute></Route>
        <Route><NotFound /></Route>
      </Switch></RoutedBoundary><Toaster /></TooltipProvider>
    </QueryClientProvider>
  </ClerkProvider>;
}
function NotFound() {
  return <div className="grid min-h-[100dvh] place-items-center bg-[#f6f4eb] px-5"><div className="panel max-w-[420px] p-8 text-center"><div className="mb-3 flex justify-center"><BrandMark /></div><div className="font-mono text-[12px] text-[#087eaf]">404 · PÁGINA NO ENCONTRADA</div><h1 className="font-display mt-3 text-2xl font-bold">No hay nada aquí.</h1><p className="mt-2 text-[13px] text-[#617887]">Vuelve al escritorio para seguir con tu trabajo.</p><Link href="/" className="button button-primary mt-5">Ir al inicio</Link></div></div>;
}

function App() {
  return <WouterRouter base={basePath}><AppRoutes /></WouterRouter>;
}

export default App;
