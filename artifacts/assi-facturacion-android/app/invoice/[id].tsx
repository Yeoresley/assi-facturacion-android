import { Feather } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useAuth } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  getGetBillingOverviewQueryKey,
  getGetInvoiceQueryKey,
  getGetMonthlySettlementQueryKey,
  getListInvoiceSeriesQueryKey,
  getListInvoicesQueryKey,
  useAuthorizeInvoiceDocument,
  useCreateInvoicePayment,
  useCreateInvoiceShare,
  useGetCurrentTeamMember,
  useGetInvoice,
  useListCustomers,
  useUpdateInvoiceStatus,
} from '@workspace/api-client-react';
import type { DocumentAuthorization } from '@workspace/api-client-react';
import { ActionButton, LoadingPanel, MessagePanel, PageHeader, Panel, Screen, StatusPill, TextField } from '@/components/AssiUI';
import { SelectField } from '@/components/SelectField';
import { useColors } from '@/hooks/useColors';
import { dateLabel, errorText, isoToday, money } from '@/lib/format';

const apiOrigin = process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : '';
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]!));

export default function InvoiceDetailScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = Number(rawId);
  const router = useRouter();
  const colors = useColors();
  const client = useQueryClient();
  const { getToken } = useAuth();
  const member = useGetCurrentTeamMember();
  const customers = useListCustomers();
  const invoiceQuery = useGetInvoice(id, {
    query: {
      queryKey: getGetInvoiceQueryKey(id),
      enabled: Number.isFinite(id) && id > 0,
      refetchInterval: 15000,
    },
  });
  const changeStatus = useUpdateInvoiceStatus();
  const authorize = useAuthorizeInvoiceDocument();
  const payment = useCreateInvoicePayment();
  const createShare = useCreateInvoiceShare();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('transfer');
  const [paymentReference, setPaymentReference] = useState('');
  const [preparedBy, setPreparedBy] = useState('');
  const [preparedPosition, setPreparedPosition] = useState('');
  const [deliveredBy, setDeliveredBy] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  const [receivedPosition, setReceivedPosition] = useState('');
  const [accountedBy, setAccountedBy] = useState('');
  const [printing, setPrinting] = useState(false);
  const [sharing, setSharing] = useState(false);

  async function refreshInvoice() {
    await Promise.all([
      client.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) }),
      client.invalidateQueries({ queryKey: getListInvoicesQueryKey() }),
      client.invalidateQueries({ queryKey: getGetBillingOverviewQueryKey() }),
      client.invalidateQueries({ queryKey: getListInvoiceSeriesQueryKey() }),
    ]);
  }

  if (invoiceQuery.isLoading || member.isLoading) return <Screen><LoadingPanel label="Abriendo factura…" /></Screen>;
  if (invoiceQuery.isError || !invoiceQuery.data || member.isError || !member.data) {
    return <Screen><MessagePanel title="No pudimos abrir esta factura" message="Puede que ya no esté disponible o no esté asignada a tu cuenta." action={{ label: 'Volver', onPress: () => router.back() }} /></Screen>;
  }

  const invoice = invoiceQuery.data;
  const memberName = member.data?.name ?? '';
  const customerIrcc = customers.data?.find((customer) => customer.id === invoice.customerId)?.ircc ?? '';
  const isOwner = member.data.role === 'owner';
  const isMyCommercial = member.data.role === 'specialist'
    && member.data.commercialId != null
    && member.data.commercialId === invoice.versat?.commercialId;
  const canFinish = invoice.status === 'draft' && (isOwner || isMyCommercial);
  const canAccept = ['finished', 'sent', 'paid'].includes(invoice.status) && isMyCommercial;
  const canConfirm = invoice.status === 'accepted' && isOwner;
  const canPay = isOwner && invoice.balanceDue > 0 && !['draft', 'cancelled', 'voided', 'error'].includes(invoice.status);
  const editable = invoice.status === 'draft' && (isOwner || isMyCommercial);

  async function setStatus(status: 'finished' | 'accepted' | 'confirmed') {
    setError('');
    setNotice('');
    try {
      await changeStatus.mutateAsync({ id, data: { status } });
      await refreshInvoice();
      setNotice(status === 'accepted' ? 'Aceptación registrada.' : status === 'confirmed' ? 'Importación en Versat confirmada.' : 'Factura terminada y numeración reservada.');
    } catch (reason) {
      setError(errorText(reason, 'Comprueba los datos requeridos e inténtalo de nuevo.'));
    }
  }

  function confirmFinish() {
    Alert.alert('Terminar factura', 'Se reservarán el número y el talón de la serie. La factura dejará de ser editable. ¿Continuar?', [
      { text: 'Volver', style: 'cancel' },
      { text: 'Terminar', onPress: () => void setStatus('finished') },
    ]);
  }

  function confirmImport() {
    Alert.alert('Confirmar importación', 'Confirma solo después de importar y verificar esta factura en Versat de escritorio.', [
      { text: 'Volver', style: 'cancel' },
      { text: 'Confirmar', onPress: () => void setStatus('confirmed') },
    ]);
  }

  async function authorizeDocument() {
    setError('');
    setNotice('');
    const payload: DocumentAuthorization = {
      preparedBy: preparedBy.trim() || memberName,
      preparedPosition: preparedPosition.trim(),
      deliveredBy: deliveredBy.trim(),
      accountedBy: accountedBy.trim(),
      transportedBy: '',
      transportId: '',
      vehiclePlate: '',
      drivingLicense: '',
      receivedBy: receivedBy.trim(),
      receivedPosition: receivedPosition.trim(),
      receivedId: '',
      customerIrcc,
      customerBankAccount: '',
      useStamp: true,
      useSignature: true,
      confirm: true,
    };
    try {
      await authorize.mutateAsync({ id, data: payload });
      await refreshInvoice();
      setNotice('Pie de factura autorizado con el cuño y la firma configurados por el administrador.');
    } catch (reason) {
      setError(errorText(reason, 'No se pudo autorizar el pie. Comprueba la configuración de emisor, cuño y firma.'));
    }
  }

  async function recordPayment() {
    setError('');
    setNotice('');
    const amount = Number(paymentAmount.replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) return setError('Escribe un importe de abono mayor que cero.');
    if (amount > invoice.balanceDue) return setError('El abono no puede superar el saldo pendiente.');
    try {
      await payment.mutateAsync({
        id,
        data: {
          amount,
          paidOn: isoToday(),
          idempotencyKey: `${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          ...(paymentReference.trim() ? { reference: paymentReference.trim() } : {}),
          paymentMethod: paymentMethod as 'transfer' | 'cash' | 'other',
        },
      });
      setPaymentAmount('');
      setPaymentReference('');
      await refreshInvoice();
      await client.invalidateQueries({ queryKey: getGetMonthlySettlementQueryKey({ period: isoToday().slice(0, 7) }) });
      setNotice('Abono registrado. El saldo y la aceptación se actualizaron automáticamente.');
    } catch (reason) {
      setError(errorText(reason, 'No se pudo registrar el abono.'));
    }
  }

  async function shareInvoiceLink() {
    setError('');
    setNotice('');
    setSharing(true);
    try {
      const link = await createShare.mutateAsync({ id });
      const url = /^https?:\/\//i.test(link.url)
        ? link.url
        : `${apiOrigin}${link.url.startsWith('/') ? '' : '/'}${link.url}`;
      await Share.share({ title: `Factura ${invoice.number}`, message: `Factura ${invoice.number}: ${url}` });
      setNotice('Enlace seguro listo para compartir. El mensaje no se envía automáticamente.');
    } catch (reason) {
      setError(errorText(reason, 'No se pudo crear el enlace para compartir.'));
    } finally {
      setSharing(false);
    }
  }

  async function fetchImage(kind: 'stamp' | 'signature', path: string | null) {
    if (!path) return '';
    if (!apiOrigin) throw new Error('No está configurada la dirección del servidor.');
    const token = await getToken();
    if (!token) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
    const response = await fetch(`${apiOrigin}/api/invoices/${id}/images/${kind}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`No se pudo cargar ${kind === 'stamp' ? 'el cuño' : 'la firma'} autorizado.`);
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('No se pudo preparar la imagen del PDF.'));
      reader.readAsDataURL(blob);
    });
  }

  async function makePdf() {
    if (!invoice.legalDocument) return setError('El pie de factura aún no está autorizado.');
    if (Platform.OS === 'web') return setError('La impresión PDF se habilita desde la aplicación Android.');
    setError('');
    setPrinting(true);
    try {
      const [stamp, signature] = await Promise.all([
        fetchImage('stamp', invoice.legalDocument.stampPath),
        fetchImage('signature', invoice.legalDocument.signaturePath),
      ]);
      const document = invoice.legalDocument;
      const linesHtml = invoice.lines.map((line) => `<tr><td>${escapeHtml(line.description)}</td><td>${escapeHtml(line.quantity)}</td><td>${escapeHtml(line.unitCode ?? '')}</td><td>${escapeHtml(money(line.unitPrice, invoice.currency))}</td><td>${escapeHtml(money(line.amount, invoice.currency))}</td></tr>`).join('');
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        @page{size:A4;margin:13mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#243c4a;font-size:10px;margin:0}
        .top{display:flex;justify-content:space-between;border-bottom:2px solid #12365a;padding-bottom:12px}
        h1{font-size:21px;color:#12365a;margin:0 0 6px}.muted{color:#637887;line-height:1.55}.right{text-align:right}.title{font-size:23px;font-weight:bold;font-style:italic;color:#12365a}
        .section{margin:15px 0}.section h2{font-size:12px;color:#12365a;margin:0 0 8px}.client{background:#f1f6f7;border-radius:7px;padding:10px}
        table{width:100%;border-collapse:collapse;margin-top:12px}th{background:#eaf2f5;color:#12365a;text-align:left}td,th{padding:7px 6px;border-bottom:1px solid #dce5e9}
        .sum{margin-left:auto;width:46%;margin-top:12px}.sum div{display:flex;justify-content:space-between;padding:5px}.sum .total{font-size:13px;font-weight:bold;border-top:2px solid #12365a;color:#12365a}
        .footer{margin-top:22px;padding-top:12px;border-top:1px solid #b9c9d1}.bank{font-weight:bold;margin:8px 0 16px}
        .signatures{display:grid;grid-template-columns:1fr 1fr 1fr;gap:13px;margin-top:22px}.sign{min-height:120px;border-top:1px solid #9eafb8;padding-top:8px;position:relative;line-height:1.55}
        .stamp{width:84px;height:auto;object-fit:contain;position:absolute;top:18px;right:3px;opacity:.78}.signature{max-width:110px;max-height:62px;object-fit:contain;display:block;margin:5px auto}
        .small{font-size:9px;color:#637887}
      </style></head><body>
        <div class="top"><div><h1>${escapeHtml(document.issuer.name)}</h1><div class="muted">${escapeHtml(document.issuer.organization)}<br>NIT: ${escapeHtml(document.issuer.nit)}<br>IRCC: ${escapeHtml(document.issuer.ircc)}<br>${escapeHtml(document.issuer.address)}</div></div><div class="right"><div class="muted">Fecha de emisión: ${escapeHtml(dateLabel(invoice.issueDate))}</div><div class="title">FACTURA</div><div>Número: <b>${escapeHtml(invoice.number)}</b></div><div>Talón: ${escapeHtml(invoice.versat?.talon ?? '')}</div><div>Contrato: ${escapeHtml(invoice.versat?.contract ?? '—')}</div></div></div>
        <div class="section client"><h2>Cliente</h2><b>${escapeHtml(invoice.customerName)}</b><br>${escapeHtml(invoice.versat?.customerAddress ?? '')}<br>NIT: ${escapeHtml(invoice.versat?.customerTaxId ?? '')} · Código: ${escapeHtml(invoice.versat?.customerCode ?? '')}</div>
        <div class="section"><h2>Detalle de servicios · ${escapeHtml(invoice.currency)}</h2><table><thead><tr><th>Descripción</th><th>Cant.</th><th>Unidad</th><th>Precio</th><th>Importe</th></tr></thead><tbody>${linesHtml}</tbody></table>
        <div class="sum"><div><span>Subtotal</span><b>${escapeHtml(money(invoice.subtotal, invoice.currency))}</b></div><div class="total"><span>Total</span><span>${escapeHtml(money(invoice.total, invoice.currency))}</span></div></div></div>
        <div class="footer"><div class="muted">Forma de pago: ${escapeHtml(invoice.versat?.paymentName ?? '')} · Operación: ${escapeHtml(invoice.versat?.operationName ?? '')}</div>
        <div class="bank">Páguese a ${escapeHtml(document.issuer.paymentBeneficiary)} · Cuenta: ${escapeHtml(document.issuer.bankAccount)} · Sucursal: ${escapeHtml(document.issuer.bankBranch)} · ${escapeHtml(document.issuer.bankName)}</div>
        <div class="signatures">
          <div class="sign"><b>Realizada por:</b><br>${escapeHtml(document.preparedBy)}<br>${escapeHtml(document.preparedPosition)}<br>Firma: ____________________<br>Fecha: ${escapeHtml(dateLabel(invoice.issueDate))}</div>
          <div class="sign"><b>Entregada por:</b><br>${escapeHtml(document.deliveredBy || document.preparedBy)}<br>Firma: ____________________<br>Fecha: ${escapeHtml(dateLabel(invoice.issueDate))}</div>
          <div class="sign"><b>Contabilizada por:</b><br>${escapeHtml(document.accountedBy || document.issuer.name)}<br>Firma: ____________________<br>Fecha: ${escapeHtml(dateLabel(invoice.issueDate))}${signature ? `<img class="signature" src="${signature}" />` : ''}${stamp ? `<img class="stamp" src="${stamp}" />` : ''}</div>
          <div class="sign"><b>Recibida por:</b><br>${escapeHtml(document.receivedBy || 'Nombre: ____________________')}<br>${escapeHtml(document.receivedPosition || 'Cargo: ____________________')}<br>Firma: ____________________<br>Fecha: ____________________</div>
          <div class="sign"><b>Transportada por:</b><br>${escapeHtml(document.transportedBy || '____________________')}<br>CH: ${escapeHtml(document.transportId || '____________________')}<br>Firma: ____________________<br>Fecha: ____________________</div>
          <div class="sign small">ASSI S.U.R.L. · NIT ${escapeHtml(document.issuer.nit)}<br>Factura ${escapeHtml(invoice.number)} · ${escapeHtml(dateLabel(invoice.issueDate))}</div>
        </div></div></body></html>`;
      const result = await Print.printToFileAsync({ html, base64: false });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri, { mimeType: 'application/pdf', dialogTitle: `Factura ${invoice.number}` });
      } else {
        await Print.printAsync({ uri: result.uri });
      }
      setNotice('PDF preparado. Puedes imprimirlo o compartirlo con la aplicación que elijas.');
    } catch (reason) {
      setError(errorText(reason, 'No se pudo preparar el PDF.'));
    } finally {
      setPrinting(false);
    }
  }

  return (
    <Screen>
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
        <Feather name="arrow-left" size={17} color={colors.primary} /><Text style={[styles.backText, { color: colors.primary }]}>Facturas</Text>
      </Pressable>
      <PageHeader eyebrow="Detalle de factura" title={invoice.number} subtitle={invoice.customerName} />
      <Panel style={styles.summary}>
        <StatusPill status={invoice.status} balanceDue={invoice.balanceDue} totalPaid={invoice.totalPaid} />
        <View style={styles.totalLine}><Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>Total</Text><Text style={[styles.totalValue, { color: colors.foreground }]}>{money(invoice.total, invoice.currency)}</Text></View>
        <View style={styles.totalLine}><Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>Abonado</Text><Text style={[styles.amountSmall, { color: colors.foreground }]}>{money(invoice.totalPaid, invoice.currency)}</Text></View>
        <View style={styles.totalLine}><Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>Saldo pendiente</Text><Text style={[styles.amountSmall, { color: colors.foreground }]}>{money(invoice.balanceDue, invoice.currency)}</Text></View>
        <View style={styles.totalLine}><Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>Fecha de emisión</Text><Text style={[styles.amountSmall, { color: colors.foreground }]}>{dateLabel(invoice.issueDate)}</Text></View>
        <View style={styles.totalLine}><Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>Especialista</Text><Text style={[styles.amountSmall, { color: colors.foreground }]}>{invoice.specialistName}</Text></View>
      </Panel>

      <Panel>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Servicios</Text>
        {invoice.lines.map((line) => (
          <View key={line.id} style={[styles.line, { borderBottomColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.lineTitle, { color: colors.foreground }]}>{line.description}</Text>
              <Text style={[styles.lineMeta, { color: colors.mutedForeground }]}>{line.quantity} × {money(line.unitPrice, invoice.currency)}</Text>
            </View>
            <Text style={[styles.lineAmount, { color: colors.foreground }]}>{money(line.amount, invoice.currency)}</Text>
          </View>
        ))}
      </Panel>

      {error ? <Text accessibilityRole="alert" style={[styles.errorBox, { color: colors.destructive }]}>{error}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={[styles.notice, { color: colors.primary }]}>{notice}</Text> : null}

      {editable ? (
        <ActionButton label="Editar borrador" icon="edit-3" secondary onPress={() => router.push({ pathname: '/invoice/new', params: { id: String(id) } })} />
      ) : null}

      {canFinish && !invoice.legalDocument ? (
        <Panel>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Autorizar pie de factura</Text>
          <Text style={[styles.lineMeta, { color: colors.mutedForeground }]}>Se incorporarán el cuño y la firma autorizados por el administrador.</Text>
          <TextField label="Realizada por" value={preparedBy || memberName} onChangeText={setPreparedBy} placeholder={memberName} />
          <TextField label="Cargo" value={preparedPosition} onChangeText={setPreparedPosition} placeholder="Cargo de quien la confecciona" />
          <TextField label="Entregada por (opcional)" value={deliveredBy} onChangeText={setDeliveredBy} placeholder="Responsable de entrega" />
          <TextField label="Contabilizada por (opcional)" value={accountedBy} onChangeText={setAccountedBy} placeholder="Responsable contable" />
          <TextField label="Recibida por (opcional)" value={receivedBy} onChangeText={setReceivedBy} placeholder="Nombre de quien recibe" />
          <TextField label="Cargo de quien recibe (opcional)" value={receivedPosition} onChangeText={setReceivedPosition} placeholder="Cargo" />
          <ActionButton label="Guardar pie autorizado" icon="check" onPress={authorizeDocument} loading={authorize.isPending} disabled={!preparedPosition.trim()} />
        </Panel>
      ) : null}

      {canFinish && invoice.legalDocument ? <ActionButton label="Terminar factura" icon="check-circle" onPress={confirmFinish} loading={changeStatus.isPending} /> : null}
      {canAccept ? <ActionButton label="Cliente aceptó · marcar Aceptada" icon="check" onPress={() => void setStatus('accepted')} loading={changeStatus.isPending} /> : null}
      {canConfirm ? <ActionButton label="Confirmar importación en Versat" icon="check-circle" secondary onPress={confirmImport} loading={changeStatus.isPending} /> : null}
      {!isOwner && invoice.status === 'accepted' ? <Text style={[styles.lineMeta, { color: colors.mutedForeground }]}>Aceptada. El administrador confirmará su importación en Versat.</Text> : null}

      {invoice.legalDocument && ['finished', 'accepted', 'confirmed', 'sent', 'paid'].includes(invoice.status) ? (
        <ActionButton label={printing ? 'Preparando PDF…' : 'Imprimir o compartir PDF'} icon="printer" onPress={makePdf} loading={printing} />
      ) : null}
      {['finished', 'accepted', 'confirmed', 'sent', 'paid'].includes(invoice.status) ? (
        <ActionButton label={sharing ? 'Creando enlace…' : 'Compartir enlace seguro'} icon="share-2" secondary onPress={shareInvoiceLink} loading={sharing} />
      ) : null}

      {canPay ? (
        <Panel>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Registrar abono</Text>
          <Text style={[styles.lineMeta, { color: colors.mutedForeground }]}>Solo el administrador puede registrar pagos. El pago parcial o total marca la factura como Aceptada automáticamente.</Text>
          <TextField label={`Importe (${invoice.currency})`} value={paymentAmount} onChangeText={setPaymentAmount} keyboardType="decimal-pad" placeholder="0.00" />
          <SelectField label="Forma de pago" value={paymentMethod} options={[
            { value: 'transfer', label: 'Transferencia' },
            { value: 'cash', label: 'Efectivo' },
            { value: 'other', label: 'Otro' },
          ]} onChange={setPaymentMethod} />
          <TextField label="Referencia (opcional)" value={paymentReference} onChangeText={setPaymentReference} placeholder="Número de comprobante" />
          <ActionButton label="Guardar abono" icon="dollar-sign" onPress={recordPayment} loading={payment.isPending} />
        </Panel>
      ) : null}

      {invoice.payments.length ? (
        <Panel>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Historial de pagos</Text>
          {invoice.payments.map((item) => (
            <View key={item.id} style={[styles.paymentRow, { borderBottomColor: colors.border }]}>
              <View><Text style={[styles.lineTitle, { color: colors.foreground }]}>{money(item.amount, item.currency)}</Text><Text style={[styles.lineMeta, { color: colors.mutedForeground }]}>{dateLabel(item.paidOn)}{item.reference ? ` · ${item.reference}` : ''}</Text></View>
              <Feather name="check-circle" size={17} color={colors.primary} />
            </View>
          ))}
        </Panel>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start' },
  backText: { fontSize: 12, fontWeight: '700' },
  summary: { gap: 12 },
  totalLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  totalLabel: { fontSize: 11 },
  totalValue: { fontSize: 19, fontWeight: '900' },
  amountSmall: { fontSize: 12, fontWeight: '700' },
  sectionTitle: { fontSize: 14, fontWeight: '800', marginBottom: 2 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  lineTitle: { fontSize: 12, fontWeight: '700' },
  lineMeta: { fontSize: 10, lineHeight: 15 },
  lineAmount: { fontSize: 12, fontWeight: '800' },
  errorBox: { backgroundColor: '#f7e8e4', borderRadius: 10, padding: 12, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  notice: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  paymentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
});
