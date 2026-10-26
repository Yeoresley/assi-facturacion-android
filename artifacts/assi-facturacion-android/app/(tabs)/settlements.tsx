import { Feather } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useGetMonthlySettlement } from '@workspace/api-client-react';
import { LoadingPanel, MessagePanel, PageHeader, Panel, Screen } from '@/components/AssiUI';
import { useColors } from '@/hooks/useColors';
import { changePeriod, money, monthPeriod, periodLabel } from '@/lib/format';

export default function SettlementsScreen() {
  const colors = useColors();
  const [period, setPeriod] = useState(monthPeriod());
  const settlement = useGetMonthlySettlement({ period });

  return (
    <Screen>
      <PageHeader eyebrow="Cierre y transparencia" title="Liquidación" subtitle="Tu cálculo mensual según las facturas incluidas." />
      <View style={[styles.period, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Mes anterior" onPress={() => setPeriod((value) => changePeriod(value, -1))} style={styles.periodButton}><Feather name="chevron-left" size={20} color={colors.primary} /></Pressable>
        <Text style={[styles.periodText, { color: colors.foreground }]}>{periodLabel(period)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Mes siguiente" onPress={() => setPeriod((value) => changePeriod(value, 1))} style={styles.periodButton}><Feather name="chevron-right" size={20} color={colors.primary} /></Pressable>
      </View>
      <Panel style={styles.notice}>
        <Feather name="info" size={17} color="#8b6828" />
        <Text style={styles.noticeText}>El importe es una estimación de liquidación; no representa una transferencia bancaria.</Text>
      </Panel>
      {settlement.isLoading ? <LoadingPanel label="Calculando liquidación…" /> : settlement.isError ? (
        <MessagePanel title="No pudimos cargar la liquidación" message="Comprueba tu conexión e inténtalo de nuevo." action={{ label: 'Reintentar', onPress: () => void settlement.refetch() }} />
      ) : settlement.data?.results.length ? settlement.data.results.map((result) => (
        <Panel key={result.specialistId} style={styles.result}>
          <View style={styles.resultHeading}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.resultName, { color: colors.foreground }]}>{result.specialistName}</Text>
              <Text style={[styles.resultMeta, { color: colors.mutedForeground }]}>{result.invoices.length} {result.invoices.length === 1 ? 'factura incluida' : 'facturas incluidas'}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.resultAmount, { color: colors.primary }]}>{money(result.totals.netPayable, settlement.data.baseCurrency)}</Text>
              <Text style={[styles.resultMeta, { color: colors.mutedForeground }]}>neto estimado</Text>
            </View>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Metric label="Licencias brutas" value={money(result.totals.grossLicenses, settlement.data.baseCurrency)} />
          <Metric label="Servicios brutos" value={money(result.totals.grossServices, settlement.data.baseCurrency)} />
          <Metric label="Base de distribución" value={money(result.totals.distributionBase, settlement.data.baseCurrency)} />
          <Metric label="Impuesto sobre ventas" value={money(result.totals.salesTax, settlement.data.baseCurrency)} />
          {result.missingServiceCount > 0 ? (
            <Text style={[styles.warning, { color: '#8b6828' }]}>
              {result.missingServiceCount} línea(s) aún requieren clasificación de licencia o servicio.
            </Text>
          ) : null}
        </Panel>
      )) : (
        <MessagePanel title="Sin ventas incluidas" message="No hay facturas participantes en el cálculo de este período." />
      )}
    </Screen>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return <View style={styles.metric}><Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{label}</Text><Text style={[styles.metricValue, { color: colors.foreground }]}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  period: { minHeight: 48, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 7 },
  periodButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  periodText: { fontSize: 14, fontWeight: '800', textTransform: 'capitalize' },
  notice: { backgroundColor: '#fbf4e4', borderColor: '#efe2c3', flexDirection: 'row', alignItems: 'center' },
  noticeText: { flex: 1, color: '#775d2d', fontSize: 11, lineHeight: 17 },
  result: { gap: 11 },
  resultHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  resultName: { fontSize: 14, fontWeight: '800' },
  resultMeta: { fontSize: 10, marginTop: 3 },
  resultAmount: { fontSize: 15, fontWeight: '800' },
  divider: { height: 1, marginVertical: 2 },
  metric: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  metricLabel: { fontSize: 11 },
  metricValue: { fontSize: 11, fontWeight: '700' },
  warning: { fontSize: 11, lineHeight: 16, fontWeight: '600' },
});
