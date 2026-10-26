import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useGetBillingOverview, useGetCurrentTeamMember, useListInvoices } from '@workspace/api-client-react';
import { ActionButton, InvoiceRow, LoadingPanel, MessagePanel, PageHeader, Panel, Screen } from '@/components/AssiUI';
import { useColors } from '@/hooks/useColors';
import { money } from '@/lib/format';

export default function HomeScreen() {
  const colors = useColors();
  const router = useRouter();
  const member = useGetCurrentTeamMember();
  const overview = useGetBillingOverview();
  const invoices = useListInvoices();
  const pendingByCurrency = useMemo(() => {
    const totals = new Map<string, number>();
    for (const invoice of invoices.data ?? []) {
      if (invoice.balanceDue > 0 && !['voided', 'cancelled'].includes(invoice.status)) {
        totals.set(invoice.currency, (totals.get(invoice.currency) ?? 0) + invoice.balanceDue);
      }
    }
    return [...totals.entries()];
  }, [invoices.data]);
  const refresh = () => {
    void overview.refetch();
    void invoices.refetch();
    void member.refetch();
  };

  if (overview.isLoading || member.isLoading) return <Screen><LoadingPanel label="Preparando tu resumen…" /></Screen>;
  if (overview.isError || !overview.data || member.isError || !member.data) {
    return <Screen><MessagePanel title="No pudimos cargar el resumen" message="Comprueba tu conexión e inténtalo de nuevo." action={{ label: 'Reintentar', onPress: refresh }} /></Screen>;
  }

  const recent = overview.data.recentInvoices.slice(0, 4);

  return (
    <Screen refreshControl={<RefreshControl refreshing={overview.isRefetching || invoices.isRefetching} onRefresh={refresh} tintColor={colors.primary} />}>
      <View style={styles.brandRow}>
        <View>
          <Text style={[styles.brandEyebrow, { color: colors.mutedForeground }]}>ASSI · ESPACIO DE TRABAJO</Text>
          <Text style={[styles.greeting, { color: colors.foreground }]}>Hola, {member.data.name.split(' ')[0]}</Text>
        </View>
        <View style={[styles.secureBadge, { backgroundColor: colors.accent }]}><Feather name="shield" size={15} color={colors.primary} /></View>
      </View>
      <PageHeader title="Resumen" subtitle="Facturación y cobros de tu equipo." />
      <Panel style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroLabel}>FACTURADO ESTE MES</Text>
            <Text style={styles.heroAmount}>{money(overview.data.monthTotal, overview.data.currency)}</Text>
          </View>
          <Feather name="trending-up" size={21} color="#d8f0f5" />
        </View>
        <View style={styles.heroFooter}>
          <Text style={styles.heroMeta}>{overview.data.invoiceCount} {overview.data.invoiceCount === 1 ? 'factura en cartera' : 'facturas en cartera'}</Text>
          <Text style={styles.heroMeta}>{overview.data.acceptedCount} aceptadas</Text>
        </View>
      </Panel>
      <View style={styles.quickActions}>
        <ActionButton label="Nueva factura" icon="file-plus" onPress={() => router.push('/invoice/new')} />
        <ActionButton label="Ver liquidación" icon="bar-chart-2" secondary onPress={() => router.push('/(tabs)/settlements')} />
      </View>
      <Panel>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}><Feather name="clock" size={16} color={colors.primary} /><Text style={[styles.sectionTitle, { color: colors.foreground }]}>Pendiente de cobro</Text></View>
          <Text style={[styles.sectionMeta, { color: colors.mutedForeground }]}>{pendingByCurrency.length} {pendingByCurrency.length === 1 ? 'moneda' : 'monedas'}</Text>
        </View>
        {pendingByCurrency.length ? pendingByCurrency.map(([currency, amount]) => (
          <View key={currency} style={styles.balanceRow}>
            <Text style={[styles.balanceCurrency, { color: colors.mutedForeground }]}>{currency}</Text>
            <Text style={[styles.balanceAmount, { color: colors.foreground }]}>{money(amount, currency)}</Text>
          </View>
        )) : <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No hay saldos pendientes en tus facturas.</Text>}
      </Panel>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Facturas recientes</Text>
        <Text onPress={() => router.push('/(tabs)/invoices')} style={[styles.seeAll, { color: colors.primary }]}>Ver todas</Text>
      </View>
      {recent.length ? recent.map((invoice) => (
        <InvoiceRow key={invoice.id} invoice={invoice} onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: String(invoice.id) } })} />
      )) : <MessagePanel title="Aún no hay facturas" message="Crea tu primera factura desde la pestaña Facturas." />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandEyebrow: { fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  greeting: { fontSize: 19, fontWeight: '800', marginTop: 4 },
  secureBadge: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  hero: { backgroundColor: '#12365a', borderColor: '#12365a', padding: 19, gap: 18 },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  heroLabel: { fontSize: 9, fontWeight: '800', color: '#c7d8e4', letterSpacing: 1.3 },
  heroAmount: { fontSize: 25, lineHeight: 32, color: '#ffffff', fontWeight: '900', marginTop: 7 },
  heroFooter: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.18)', paddingTop: 11 },
  heroMeta: { fontSize: 10, color: '#d8e7ec', fontWeight: '600' },
  quickActions: { gap: 9 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 2 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sectionTitle: { fontSize: 14, fontWeight: '800' },
  sectionMeta: { fontSize: 10 },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  balanceCurrency: { fontSize: 12, fontWeight: '700' },
  balanceAmount: { fontSize: 13, fontWeight: '800' },
  emptyText: { fontSize: 12, lineHeight: 18 },
  seeAll: { fontSize: 11, fontWeight: '800', paddingVertical: 4 },
});
