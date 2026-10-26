import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useListInvoices } from '@workspace/api-client-react';
import { InvoiceRow, LoadingPanel, MessagePanel, PageHeader, Screen } from '@/components/AssiUI';
import { useColors } from '@/hooks/useColors';

const filters = [
  { key: 'all', label: 'Todas' },
  { key: 'open', label: 'Pendientes' },
  { key: 'paid', label: 'Pagadas' },
];

export default function InvoicesScreen() {
  const router = useRouter();
  const colors = useColors();
  const invoices = useListInvoices();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (invoices.data ?? []).filter((invoice) => {
      const matchesSearch = !query || `${invoice.number} ${invoice.customerName} ${invoice.specialistName}`.toLocaleLowerCase().includes(query);
      const matchesFilter = filter === 'all' || (filter === 'paid' ? invoice.balanceDue <= 0 : invoice.balanceDue > 0);
      return matchesSearch && matchesFilter;
    });
  }, [filter, invoices.data, search]);

  const listHeader = (
    <View style={styles.headerBlock}>
      <PageHeader
        eyebrow="Archivo del equipo"
        title="Facturas"
        subtitle="Consulta tus facturas y su estado de cobro."
        accessory={<Pressable accessibilityRole="button" accessibilityLabel="Crear factura" onPress={() => router.push('/invoice/new')} style={({ pressed }) => [styles.addButton, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}><Feather name="plus" size={18} color={colors.primaryForeground} /></Pressable>}
      />
      <View style={[styles.search, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput value={search} onChangeText={setSearch} placeholder="Buscar número, cliente o especialista" placeholderTextColor={colors.mutedForeground} style={[styles.searchInput, { color: colors.foreground }]} autoCapitalize="none" />
      </View>
      <View style={styles.filters}>
        {filters.map((item) => (
          <Pressable key={item.key} onPress={() => setFilter(item.key)} style={[styles.filter, { backgroundColor: filter === item.key ? colors.primary : colors.card, borderColor: colors.border }]}>
            <Text style={{ color: filter === item.key ? colors.primaryForeground : colors.mutedForeground, fontWeight: '700', fontSize: 11 }}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  return (
    <Screen scroll={false} contentStyle={styles.screen}>
      {invoices.isLoading ? <LoadingPanel label="Cargando facturas…" /> : invoices.isError ? (
        <MessagePanel title="No pudimos cargar las facturas" message="Comprueba tu conexión e inténtalo de nuevo." action={{ label: 'Reintentar', onPress: () => void invoices.refetch() }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={{ height: 9 }} />}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={<MessagePanel title="No hay facturas para mostrar" message={search ? 'Prueba con otro texto o cambia el filtro.' : 'Las facturas asignadas aparecerán aquí.'} />}
          refreshControl={<RefreshControl refreshing={invoices.isRefetching} onRefresh={() => void invoices.refetch()} tintColor={colors.primary} />}
          renderItem={({ item }) => <InvoiceRow invoice={item} onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: String(item.id) } })} />}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: 0, gap: 0 },
  listContent: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 112 },
  headerBlock: { gap: 14, paddingBottom: 16 },
  addButton: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  search: { minHeight: 46, borderRadius: 11, borderWidth: 1, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, fontSize: 13, paddingVertical: 8 },
  filters: { flexDirection: 'row', gap: 8 },
  filter: { borderRadius: 24, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 8 },
});
