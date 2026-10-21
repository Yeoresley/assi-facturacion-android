import { BookOpen, CalendarDays, Check, Download, FileText, LayoutDashboard, LogOut, Settings2, ShieldCheck, Users, WalletCards } from 'lucide-react';
import './_group.css';

const navItems = [
  { label: 'Resumen', icon: LayoutDashboard },
  { label: 'Facturas', icon: FileText },
  { label: 'Clientes', icon: Users },
  { label: 'Catálogos', icon: BookOpen },
  { label: 'Liquidación', icon: WalletCards, active: true },
  { label: 'Exportar', icon: Download, notice: true },
  { label: 'Ajustes', icon: Settings2 },
];

const mobileItems = [
  { label: 'Resumen', icon: LayoutDashboard },
  { label: 'Facturas', icon: FileText },
  { label: 'Clientes', icon: Users },
  { label: 'Liquidación', icon: WalletCards, active: true },
  { label: 'Ajustes', icon: Settings2 },
];

const metrics = [
  { label: 'Licencias brutas', value: '1.248,00 CUP', note: 'Ingresos clasificados como licencia' },
  { label: 'Servicios brutos', value: '836,50 CUP', note: 'Ingresos clasificados como servicio' },
  { label: 'Base de distribución', value: '1.672,40 CUP', note: 'Tras impuestos y costos aplicables' },
  { label: 'Neto estimado', value: '1.284,75 CUP', note: 'Preliminar · no es un pago registrado', emphasis: true },
];

export function Current() {
  return (
    <div className="assi-settlement">
      <div className="assi-frame">
        <aside className="assi-sidebar">
          <div className="assi-brand">
            <img className="assi-wordmark" src="/__mockup/images/assi-wordmark.png" alt="ASSI" />
          </div>
          <div className="assi-workspace-label">Espacio de trabajo</div>
          <nav className="assi-nav" aria-label="Navegación principal">
            {navItems.map(({ label, icon: Icon, active, notice }) => (
              <a className={`assi-nav-link${active ? ' is-active' : ''}`} href="#" key={label} onClick={(event) => event.preventDefault()}>
                <Icon aria-hidden="true" />{label}{notice && <span className="assi-nav-notice" />}
              </a>
            ))}
          </nav>
          <div className="assi-sidebar-bottom">
            <div className="assi-order-note">
              <div className="assi-order-title"><span className="assi-order-dot" />Todo en orden</div>
              <p className="assi-order-copy">Tu equipo factura desde un único sitio. El cierre puede esperar a cuando tú quieras.</p>
            </div>
            <div className="assi-signout"><LogOut aria-hidden="true" />Cerrar sesión</div>
          </div>
        </aside>

        <div className="assi-main">
          <header className="assi-topbar">
            <div className="assi-crumb">Cuenta del equipo <span aria-hidden="true">/</span> <strong>Propietario</strong></div>
            <div className="assi-account">
              <div><div className="assi-account-name">kcodguez@gmail.com</div><div className="assi-account-email">kcodguez@gmail.com</div></div>
              <div className="assi-avatar" aria-label="KC">K</div>
            </div>
          </header>
          <main className="assi-content">
            <div className="assi-heading">
              <div>
                <div className="assi-eyebrow">Cierre y transparencia</div>
                <h1 className="assi-title">Liquidación mensual</h1>
                <p className="assi-description">Misma plantilla para todos. Cada especialista ve solo su cálculo; el administrador puede consultar todo el equipo y descargar la nómina del mes.</p>
              </div>
              <label className="assi-period"><CalendarDays aria-hidden="true" /><span className="sr-only">Período mensual</span><input type="month" value="2026-10" readOnly aria-label="Período mensual" /></label>
            </div>

            <div className="assi-warning" role="note">
              <ShieldCheck aria-hidden="true" />
              <p><strong>Importante:</strong> el importe payable es una estimación preliminar, no un registro de pago. La aplicación todavía no registra la transferencia bancaria al especialista.</p>
            </div>

            <section className="assi-roster" aria-labelledby="assi-roster-title">
              <div className="assi-roster-head">
                <div>
                  <div className="assi-eyebrow">Octubre de 2026 · Nóminas</div>
                  <h2 className="assi-roster-title" id="assi-roster-title">Especialistas con ventas</h2>
                  <p className="assi-roster-subtitle">Incluye especialistas con facturas participantes en el cálculo del mes.</p>
                </div>
                <button className="assi-button" type="button" disabled><FileText aria-hidden="true" />Descargar nómina CSV</button>
              </div>
              <div className="assi-empty">
                <div className="assi-empty-icon"><FileText aria-hidden="true" /></div>
                <div className="assi-empty-title">Sin ventas incluidas</div>
                <p className="assi-empty-copy">No hay facturas participantes en el cálculo de este período.</p>
              </div>
            </section>

            <section className="assi-metrics" aria-label="Resumen de liquidación">
              {metrics.map(({ label, value, note, emphasis }) => (
                <article className={`assi-metric${emphasis ? ' is-emphasis' : ''}`} key={label}>
                  <div className="assi-metric-label">{label}</div>
                  <div className="assi-metric-value">{value}</div>
                  <div className="assi-metric-note">{note}</div>
                </article>
              ))}
            </section>
            <div className="assi-footnote"><Check aria-hidden="true" />Cada cifra deriva de facturas, tasas y ajustes del período seleccionado. Las excepciones y anulaciones requieren motivo y quedan asociadas a la auditoría.</div>
          </main>
        </div>
        <nav className="assi-mobile-nav" aria-label="Navegación móvil">
          {mobileItems.map(({ label, icon: Icon, active }) => <a href="#" onClick={(event) => event.preventDefault()} className={`assi-mobile-link${active ? ' is-active' : ''}`} key={label}><Icon aria-hidden="true" /><span>{label}</span></a>)}
        </nav>
      </div>
    </div>
  );
}
