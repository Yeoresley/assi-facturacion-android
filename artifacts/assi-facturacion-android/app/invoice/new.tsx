import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  getGetBillingOverviewQueryKey,
  getGetCurrentTeamMemberQueryKey,
  getGetInvoiceQueryKey,
  getListCustomersQueryKey,
  getListInvoicesQueryKey,
  getListTeamMembersQueryKey,
  useCreateInvoice,
  useGetCurrentTeamMember,
  useGetInvoice,
  useGetVersatCatalogs,
  useListCustomers,
  useListInvoiceSeries,
  useListTeamMembers,
  useUpdateInvoice,
} from '@workspace/api-client-react';
import type { InvoiceInput, VersatCatalogEntry } from '@workspace/api-client-react';
import { ActionButton, LoadingPanel, MessagePanel, PageHeader, Panel, Screen, TextField } from '@/components/AssiUI';
import { SelectField, type SelectOption } from '@/components/SelectField';
import { useColors } from '@/hooks/useColors';
import { errorText, isoToday, money } from '@/lib/format';

type LineState = { serviceId: string; description: string; quantity: string; unitPrice: string; groupCode: string };
const emptyLine = (): LineState => ({ serviceId: '', description: '', quantity: '1', unitPrice: '', groupCode: '' });

export default function InvoiceFormScreen() {
  const colors = useColors();
  const router = useRouter();
  const client = useQueryClient();
  const params = useLocalSearchParams<{ id?: string; customerId?: string }>();
  const editId = params.id ? Number(params.id) : null;
  const isEdit = editId !== null && Number.isFinite(editId);
  const member = useGetCurrentTeamMember({ query: { queryKey: getGetCurrentTeamMemberQueryKey(), retry: false } });
  const customers = useListCustomers();
  const catalogs = useGetVersatCatalogs();
  const series = useListInvoiceSeries();
  const team = useListTeamMembers({ query: { queryKey: getListTeamMembersQueryKey(), enabled: member.data?.role === 'owner' } });
  const invoice = useGetInvoice(editId ?? 0, { query: { queryKey: getGetInvoiceQueryKey(editId ?? 0), enabled: isEdit } });
  const create = useCreateInvoice();
  const update = useUpdateInvoice();

  const [customerId, setCustomerId] = useState(params.customerId ?? '');
  const [issueDate, setIssueDate] = useState(isoToday());
  const [dueDate, setDueDate] = useState('');
  const [currency, setCurrency] = useState('');
  const [notes, setNotes] = useState('');
  const [conceptId, setConceptId] = useState('');
  const [operationId, setOperationId] = useState('');
  const [commercialId, setCommercialId] = useState('');
  const [paymentId, setPaymentId] = useState('');
  const [seriesId, setSeriesId] = useState('');
  const [bankMC, setBankMC] = useState('');
  const [bankOM, setBankOM] = useState('');
  const [contract, setContract] = useState('');
  const [responsibleId, setResponsibleId] = useState('');
  const [lines, setLines] = useState<LineState[]>([emptyLine()]);
  const [formError, setFormError] = useState('');
  const [saveError, setSaveError] = useState('');
  const initialized = useRef(false);

  const entries = catalogs.data?.entries ?? [];
  const byKind = useMemo(() => {
    const groups: Record<string, VersatCatalogEntry[]> = { service: [], currency: [], concept: [], operation: [], commercial: [], payment: [], unit: [] };
    for (const entry of entries) (groups[entry.kind] ??= []).push(entry);
    return groups;
  }, [entries]);
  const activeSeries = (series.data ?? []).filter((item) => item.active || String(item.id) === seriesId);
  const activeCustomers = (customers.data ?? []).filter((item) => item.active || String(item.id) === customerId);
  const specialists = (team.data ?? []).filter((item) => item.role === 'specialist');
  const isOwner = member.data?.role === 'owner';
  const assignedCommercial = member.data?.commercialId;
  const saving = create.isPending || update.isPending;
  const total = lines.reduce((sum, line) => sum + (Number(line.quantity.replace(',', '.')) || 0) * (Number(line.unitPrice.replace(',', '.')) || 0), 0);

  useEffect(() => {
    if (!isEdit && !currency) {
      const first = byKind.currency.find((entry) => entry.active);
      if (first) setCurrency(first.code);
    }
    if (!isEdit && !seriesId) {
      const firstSeries = (series.data ?? []).find((item) => item.active);
      if (firstSeries) setSeriesId(String(firstSeries.id));
    }
    if (!isOwner && assignedCommercial != null) setCommercialId(String(assignedCommercial));
  }, [assignedCommercial, byKind.currency, currency, isEdit, isOwner, series.data, seriesId]);

  useEffect(() => {
    const saved = invoice.data;
    if (!isEdit || !saved || initialized.current) return;
    initialized.current = true;
    setCustomerId(String(saved.customerId));
    setIssueDate(saved.issueDate.slice(0, 10));
    setDueDate(saved.dueDate?.slice(0, 10) ?? '');
    setCurrency(saved.currency);
    setNotes(saved.notes ?? '');
    setSeriesId(saved.seriesId ? String(saved.seriesId) : '');
    if (saved.versat) {
      setConceptId(String(saved.versat.conceptId));
      setOperationId(String(saved.versat.operationId));
      setCommercialId(String(saved.versat.commercialId));
      setPaymentId(String(saved.versat.paymentId));
      setBankMC(saved.versat.bankAccountMC ?? '');
      setBankOM(saved.versat.bankAccountOM ?? '');
      setContract(saved.versat.contract ?? '');
    }
    setLines(saved.lines.map((line) => ({
      serviceId: line.serviceId ? String(line.serviceId) : '',
      description: line.description,
      quantity: String(line.quantity),
      unitPrice: String(line.unitPrice),
      groupCode: line.groupCode ?? '',
    })));
  }, [invoice.data, isEdit]);

  function changeLine(index: number, patch: Partial<LineState>) {
    setLines((previous) => previous.map((line, position) => position === index ? { ...line, ...patch } : line));
  }

  function serviceOptions(line: LineState): SelectOption[] {
    return byKind.service
      .filter((entry) => entry.active || String(entry.id) === line.serviceId)
      .map((entry) => ({ value: String(entry.id), label: `${entry.code} · ${entry.name}${entry.active ? '' : ' (desactivado)'}` }));
  }

  function onServiceChange(index: number, value: string) {
    const service = byKind.service.find((entry) => String(entry.id) === value);
    changeLine(index, {
      serviceId: value,
      description: service?.name ?? '',
      groupCode: service?.groupCode ?? '',
    });
  }

  function submit() {
    setFormError('');
    setSaveError('');
    if (!member.data) return setFormError('Aún se está comprobando tu acceso.');
    if (!isOwner && assignedCommercial == null) return setFormError('Tu cuenta no tiene un comercial asignado. Pide al administrador que te asigne uno.');
    if (!customerId) return setFormError('Selecciona un cliente.');
    if (!seriesId) return setFormError('No hay una serie de numeración activa. El administrador debe configurarla desde la web.');
    if (!currency) return setFormError('Selecciona una moneda del catálogo.');
    if (!conceptId || !operationId || !paymentId || !(isOwner ? commercialId : assignedCommercial)) return setFormError('Completa concepto, operación, forma de pago y comercial.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) return setFormError('La fecha de emisión debe tener formato AAAA-MM-DD.');
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return setFormError('La fecha de vencimiento debe tener formato AAAA-MM-DD.');
    if (!lines.length || lines.some((line) => !line.serviceId || !line.description.trim() || !(Number(line.quantity.replace(',', '.')) > 0) || line.unitPrice === '' || Number(line.unitPrice.replace(',', '.')) < 0)) {
      return setFormError('Cada línea debe tener un servicio, una cantidad mayor que cero y un precio válido.');
    }

    const effectiveCommercial = isOwner ? commercialId : String(assignedCommercial);
    const payload: InvoiceInput = {
      seriesId: Number(seriesId),
      customerId: Number(customerId),
      issueDate,
      dueDate: dueDate || null,
      currency,
      notes: notes.trim() || null,
      ...(isOwner ? { specialistId: responsibleId || null } : {}),
      lines: lines.map((line) => ({
        description: line.description.trim(),
        serviceId: Number(line.serviceId),
        groupCode: line.groupCode.trim() || null,
        quantity: Number(Number(line.quantity.replace(',', '.')).toFixed(4)),
        unitPrice: Number(Number(line.unitPrice.replace(',', '.')).toFixed(5)),
      })),
      versat: {
        conceptId: Number(conceptId),
        operationId: Number(operationId),
        commercialId: Number(effectiveCommercial),
        paymentId: Number(paymentId),
        number: null,
        talon: null,
        bankAccountMC: bankMC.trim() || null,
        bankAccountOM: bankOM.trim() || null,
        contract: contract.trim() || null,
      },
    };
    const onSuccess = async (saved: { id: number }) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: getListInvoicesQueryKey() }),
        client.invalidateQueries({ queryKey: getGetBillingOverviewQueryKey() }),
        client.invalidateQueries({ queryKey: getListCustomersQueryKey() }),
      ]);
      router.replace({ pathname: '/invoice/[id]', params: { id: String(saved.id) } });
    };
    const onError = (error: unknown) => setSaveError(errorText(error, 'Revisa los datos e inténtalo de nuevo.'));
    if (isEdit && editId) update.mutate({ id: editId, data: payload }, { onSuccess, onError });
    else create.mutate({ data: payload }, { onSuccess, onError });
  }

  if (member.isLoading || catalogs.isLoading || customers.isLoading || series.isLoading || (isEdit && invoice.isLoading)) {
    return <Screen><LoadingPanel label="Preparando formulario de factura…" /></Screen>;
  }
  if (member.isError || !member.data) {
    return <Screen><MessagePanel title="No pudimos comprobar tu acceso" message="Vuelve a intentarlo cuando tengas conexión." action={{ label: 'Volver', onPress: () => router.back() }} /></Screen>;
  }
  if (isEdit && (invoice.isError || !invoice.data)) {
    return <Screen><MessagePanel title="No pudimos abrir el borrador" message="La factura puede no existir o no estar asignada a tu cuenta." action={{ label: 'Volver', onPress: () => router.back() }} /></Screen>;
  }
  if (isEdit && invoice.data?.status !== 'draft') {
    return <Screen><MessagePanel title="La factura ya no es un borrador" message="Una factura emitida no admite cambios desde este formulario." action={{ label: 'Volver a la factura', onPress: () => router.replace({ pathname: '/invoice/[id]', params: { id: String(editId) } }) }} /></Screen>;
  }

  const optionList = (kind: string, selected: string) => (byKind[kind] ?? [])
    .filter((entry) => entry.active || String(entry.id) === selected)
    .map((entry) => ({ value: String(entry.id), label: `${entry.code} · ${entry.name}${entry.active ? '' : ' (desactivado)'}` }));
  const customerOptions = activeCustomers.map((customer) => ({
    value: String(customer.id),
    label: `${customer.versatCode ? `${customer.versatCode} · ` : ''}${customer.name}`,
  }));
  const currencyOptions = byKind.currency
    .filter((entry) => entry.active || entry.code === currency)
    .map((entry) => ({ value: entry.code, label: `${entry.code} · ${entry.name}${entry.active ? '' : ' (desactivada)'}` }));

  return (
    <Screen>
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
        <Feather name="arrow-left" size={17} color={colors.primary} />
        <Text style={[styles.backText, { color: colors.primary }]}>Volver</Text>
      </Pressable>
      <PageHeader eyebrow={isEdit ? 'Borrador' : 'Nueva emisión'} title={isEdit ? 'Editar factura' : 'Preparar factura'} subtitle="Guarda primero el borrador. La numeración se reserva al terminarla." />
      {catalogs.isError || customers.isError || series.isError ? (
        <MessagePanel title="Faltan datos de configuración" message="No se pudieron cargar clientes, catálogos o series. Reintenta antes de guardar." action={{ label: 'Reintentar', onPress: () => { void catalogs.refetch(); void customers.refetch(); void series.refetch(); } }} />
      ) : null}
      {!activeSeries.length ? <MessagePanel title="No hay una serie activa" message="El administrador debe activar la numeración de Versat desde la web antes de crear facturas." /> : null}
      {!isOwner && assignedCommercial == null ? <MessagePanel title="Falta asignar tu comercial" message="Pide al administrador que vincule tu cuenta con el comercial de Versat correcto." /> : null}

      <Panel>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Cliente y fechas</Text>
        <SelectField label="Cliente" value={customerId} options={customerOptions} onChange={setCustomerId} placeholder="Selecciona un cliente" searchable />
        <TextField label="Fecha de emisión" value={issueDate} onChangeText={setIssueDate} placeholder="AAAA-MM-DD" keyboardType="numbers-and-punctuation" />
        <TextField label="Vencimiento (opcional)" value={dueDate} onChangeText={setDueDate} placeholder="AAAA-MM-DD" keyboardType="numbers-and-punctuation" />
      </Panel>

      <Panel>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Numeración y moneda</Text>
        <SelectField label="Serie de Versat" value={seriesId} options={activeSeries.map((item) => ({ value: String(item.id), label: `${item.name} · Talón ${item.talon} · Siguiente ${item.nextNumber}` }))} onChange={setSeriesId} placeholder="Selecciona una serie" />
        <SelectField label="Moneda" value={currency} options={currencyOptions} onChange={setCurrency} placeholder="Selecciona moneda" />
        {currency ? <Text style={[styles.helper, { color: colors.mutedForeground }]}>La moneda seleccionada es {currency}.</Text> : null}
      </Panel>

      <Panel>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Datos de Versat</Text>
        <SelectField label="Concepto" value={conceptId} options={optionList('concept', conceptId)} onChange={setConceptId} placeholder="Selecciona concepto" searchable />
        <SelectField label="Operación" value={operationId} options={optionList('operation', operationId)} onChange={setOperationId} placeholder="Selecciona operación" searchable />
        {isOwner ? (
          <SelectField label="Comercial en Versat" value={commercialId} options={optionList('commercial', commercialId)} onChange={setCommercialId} placeholder="Selecciona comercial" searchable />
        ) : (
          <View style={[styles.lockedInfo, { backgroundColor: colors.accent }]}>
            <Feather name="lock" size={14} color={colors.primary} />
            <Text style={[styles.lockedText, { color: colors.foreground }]}>Comercial asignado por el administrador</Text>
          </View>
        )}
        <SelectField label="Forma de pago" value={paymentId} options={optionList('payment', paymentId)} onChange={setPaymentId} placeholder="Selecciona forma de pago" searchable />
        <TextField label="Cuenta bancaria MC (opcional)" value={bankMC} onChangeText={setBankMC} placeholder="Cuenta asociada a moneda nacional" />
        <TextField label="Cuenta bancaria OM (opcional)" value={bankOM} onChangeText={setBankOM} placeholder="Cuenta asociada a otra moneda" />
        <TextField label="Contrato (opcional)" value={contract} onChangeText={setContract} placeholder="Número o referencia" />
      </Panel>

      {isOwner ? (
        <Panel>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Responsable de liquidación</Text>
          <SelectField label="Especialista responsable" value={responsibleId} options={[
            { value: '', label: 'Propietario — no se incluye en una liquidación de especialista' },
            ...specialists.map((specialist) => ({ value: specialist.userId, label: specialist.name })),
          ]} onChange={setResponsibleId} placeholder="Selecciona responsable" searchable />
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>Esta asignación define quién recibe el crédito en Liquidaciones. No se deduce del comercial de Versat.</Text>
        </Panel>
      ) : null}

      <Panel>
        <View style={styles.linesHeading}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Servicios facturados</Text>
          <Pressable accessibilityRole="button" onPress={() => setLines((value) => [...value, emptyLine()])} style={styles.addLine}>
            <Feather name="plus-circle" size={17} color={colors.primary} />
            <Text style={[styles.addLineText, { color: colors.primary }]}>Añadir</Text>
          </Pressable>
        </View>
        {lines.map((line, index) => (
          <View key={`line-${index}`} style={[styles.line, { borderColor: colors.border }]}>
            <View style={styles.lineHeading}>
              <Text style={[styles.lineNumber, { color: colors.mutedForeground }]}>Línea {index + 1}</Text>
              {lines.length > 1 ? <Pressable accessibilityRole="button" accessibilityLabel="Eliminar línea" onPress={() => setLines((value) => value.filter((_, current) => current !== index))}><Feather name="trash-2" size={16} color={colors.destructive} /></Pressable> : null}
            </View>
            <SelectField label="Servicio" value={line.serviceId} options={serviceOptions(line)} onChange={(value) => onServiceChange(index, value)} placeholder="Selecciona servicio" searchable />
            <TextField label="Descripción" value={line.description} onChangeText={(value) => changeLine(index, { description: value })} placeholder="Descripción del servicio" />
            <View style={styles.lineInputs}>
              <View style={{ flex: 1 }}>
                <TextField label="Cantidad" value={line.quantity} onChangeText={(value) => changeLine(index, { quantity: value })} keyboardType="decimal-pad" placeholder="1" />
              </View>
              <View style={{ flex: 1 }}>
                <TextField label={`Precio unitario (${currency || 'moneda'})`} value={line.unitPrice} onChangeText={(value) => changeLine(index, { unitPrice: value })} keyboardType="decimal-pad" placeholder="0.00" />
              </View>
            </View>
            <Text style={[styles.lineTotal, { color: colors.foreground }]}>
              Importe: {money((Number(line.quantity.replace(',', '.')) || 0) * (Number(line.unitPrice.replace(',', '.')) || 0), currency || 'CUP')}
            </Text>
          </View>
        ))}
        <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
          <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>Total estimado</Text>
          <Text style={[styles.totalValue, { color: colors.foreground }]}>{money(total, currency || 'CUP')}</Text>
        </View>
      </Panel>

      <Panel>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Notas</Text>
        <TextField label="Observación (opcional)" value={notes} onChangeText={setNotes} multiline placeholder="Información adicional para el documento" />
      </Panel>

      {formError || saveError ? <Text accessibilityRole="alert" style={[styles.formError, { color: colors.destructive }]}>{formError || saveError}</Text> : null}
      <ActionButton label={saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Guardar borrador'} icon="save" onPress={submit} loading={saving} disabled={!activeSeries.length} />
      <Text style={[styles.footerNote, { color: colors.mutedForeground }]}>Al guardar no se consume el contador. Al terminar desde el detalle, el servidor reservará el número y el talón definitivos.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start' },
  backText: { fontSize: 12, fontWeight: '700' },
  sectionTitle: { fontSize: 14, fontWeight: '800', marginBottom: 2 },
  helper: { fontSize: 11, lineHeight: 16 },
  lockedInfo: { minHeight: 38, borderRadius: 10, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 8 },
  lockedText: { fontSize: 11, fontWeight: '700' },
  linesHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  addLine: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  addLineText: { fontSize: 11, fontWeight: '800' },
  line: { borderWidth: 1, borderRadius: 13, padding: 12, gap: 12 },
  lineHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lineNumber: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  lineInputs: { flexDirection: 'row', gap: 10 },
  lineTotal: { fontSize: 11, fontWeight: '800', textAlign: 'right' },
  totalRow: { borderTopWidth: 1, paddingTop: 11, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: 12, fontWeight: '700' },
  totalValue: { fontSize: 16, fontWeight: '900' },
  formError: { borderRadius: 10, backgroundColor: '#f7e8e4', padding: 12, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  footerNote: { fontSize: 10, lineHeight: 15, textAlign: 'center' },
});
