import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useListCustomers, useListInvoices } from '@workspace/api-client-react';
import { ActionButton, InvoiceRow, LoadingPanel, MessagePanel, PageHeader, Panel, Screen } from '@/components/AssiUI';
import { useColors } from '@/hooks/useColors';
import { money } from '@/lib/format';

export default function CustomerDetailScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = Number(rawId);
  const router = useRouter();
  const colors = useColors();
  const customers = useListCustomers();
  const invoicesQuery = useListInvoices();
  const customer = customers.data?.find((item) => item.id === id);
  const invoices = useMemo(() => (invoicesQuery.data ?? []).filter((item) => item.customerId === id), [id, invoicesQuery.data]);
  const totals = useMemo(() => invoices.reduce((acc, invoice) => {
    acc.total += invoice.total;
    acc.paid += invoice.totalPaid;
    acc.due += invoice.balanceDue;
    return acc;
  }, { total: 0, paid: 0, due: 0 }), [invoices]);
  const services = useMemo(() => {
    const counts = new Map<string, number>();
    for (const invoice of invoices) {
      for (const line of invoice.lines ?? []) counts.set(line.description, (counts.get(line.description) ?? 0) + line.amount);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [invoices]);

  if (customers.isLoading || invoicesQuery.isLoading) return <Screen><LoadingPanel label="Abriendo expediente del cliente…" /></Screen>;
  if (customers.isError || invoicesQuery.isError || !customer) return <Screen><MessagePanel title="No pudimos abrir este cliente" message="Comprueba que el cliente siga activo y que tengas acceso a sus datos." action={{ label: 'Volver', onPress: () => router.back() }} /></Screen>;

  return (
    <Screen>
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}><Feather name="arrow-left" size={17} color={colors.primary} /><Text style={[styles.backText, { color: colors.primary }]}>Clientes</Text></Pressable>
      <PageHeader eyebrow="Expediente del cliente" title={customer.name} subtitle={customer.versatCode ? `Código Versat ${customer.versatCode}` : 'Resumen de la relación comercial'} />
      <ActionButton label="Preparar factura" icon="file-plus" compact onPress={() => router.push({ pathname: '/invoice/new', params: { customerId: String(customer.id) } })} />
      <View style={styles.stats}>
        <Stat label="Facturado" value={money(totals.total, invoices[0]?.currency ?? 'CUP')} />
        <Stat label="Cobrado" value={money(totals.paid, invoices[0]?.currency ?? 'CUP')} />
        <Stat label="Pendiente" value={money(totals.due, invoices[0]?.currency ?? 'CUP')} />
      </View>
      <Panel style={styles.customerInfo}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Datos de contacto</Text>
        <InfoLine label="NIT" value={customer.taxId} />
        <InfoLine label="IRCC" value={customer.ircc} />
        <InfoLine label="Teléfono" value={customer.phone} />
        <InfoLine label="Correo" value={customer.email} />
        <InfoLine label="Dirección" value={customer.address} />
      </Panel>
      {services.length > 0 ? (
        <Panel>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Servicios más facturados</Text>
          {services.map(([name, amount]) => <InfoLine key={name} label={name} value={money(amount, invoices[0]?.currency ?? 'CUP')} />)}
        </Panel>
      ) : null}
      <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 2 }]}>Historial de facturas</Text>
      {invoices.length ? invoices.map((invoice) => (
        <InvoiceRow key={invoice.id} invoice={invoice} onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: String(invoice.id) } })} />
      )) : <MessagePanel title="Sin facturas todavía" message="Las facturas de este cliente aparecerán aquí." />}
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return <Panel style={styles.stat}><Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text><Text style={[styles.statValue, { color: colors.foreground }]} numberOfLines={2}>{value}</Text></Panel>;
}

function InfoLine({ label, value }: { label: string; value?: string | null }) {
  const colors = useColors();
  return <View style={styles.infoLine}><Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{label}</Text><Text style={[styles.infoValue, { color: colors.foreground }]}>{value || '—'}</Text></View>;
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start' },
  backText: { fontSize: 12, fontWeight: '700' },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, padding: 12, gap: 5, minHeight: 75 },
  statLabel: { fontSize: 9, fontWeight: '700' },
  statValue: { fontSize: 11, lineHeight: 16, fontWeight: '800' },
  customerInfo: { gap: 10 },
  sectionTitle: { fontSize: 14, fontWeight: '800' },
  infoLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  infoLabel: { flex: 0.8, fontSize: 11 },
  infoValue: { flex: 1.4, textAlign: 'right', fontSize: 11, fontWeight: '600' },
});
