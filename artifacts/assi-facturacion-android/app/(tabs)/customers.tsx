import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useListCustomers, useListInvoices } from '@workspace/api-client-react';
import { LoadingPanel, MessagePanel, PageHeader, Screen } from '@/components/AssiUI';
import { useColors } from '@/hooks/useColors';

export default function CustomersScreen() {
  const colors = useColors();
  const router = useRouter();
  const customers = useListCustomers();
  const invoices = useListInvoices();
  const [search, setSearch] = useState('');
  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (customers.data ?? []).filter((customer) =>
      !query || `${customer.name} ${customer.versatCode ?? ''} ${customer.taxId ?? ''}`.toLocaleLowerCase().includes(query),
    );
  }, [customers.data, search]);

  return (
    <Screen scroll={false} contentStyle={styles.screen}>
      {customers.isLoading ? <LoadingPanel label="Cargando clientes…" /> : customers.isError ? (
        <MessagePanel title="No pudimos cargar los clientes" message="Comprueba tu conexión e inténtalo de nuevo." action={{ label: 'Reintentar', onPress: () => void customers.refetch() }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={{ height: 9 }} />}
          ListHeaderComponent={
            <View style={styles.headerBlock}>
              <PageHeader eyebrow="Cartera" title="Clientes" subtitle="Consulta su actividad y los saldos de tus facturas." />
              <View style={[styles.search, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="search" size={16} color={colors.mutedForeground} />
                <TextInput value={search} onChangeText={setSearch} placeholder="Buscar cliente o código" placeholderTextColor={colors.mutedForeground} style={[styles.searchInput, { color: colors.foreground }]} />
              </View>
            </View>
          }
          ListEmptyComponent={<MessagePanel title="No hay clientes para mostrar" message="Los clientes del catálogo aparecerán aquí." />}
          refreshControl={<RefreshControl refreshing={customers.isRefetching || invoices.isRefetching} onRefresh={() => { void customers.refetch(); void invoices.refetch(); }} tintColor={colors.primary} />}
          renderItem={({ item }) => {
            const count = (invoices.data ?? []).filter((invoice) => invoice.customerId === item.id).length;
            return (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/customer/[id]', params: { id: String(item.id) } })}
                style={({ pressed }) => [styles.customerRow, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.76 : 1 }]}
              >
                <View style={[styles.icon, { backgroundColor: colors.accent }]}><Feather name="briefcase" size={17} color={colors.primary} /></View>
                <View style={styles.customerText}>
                  <Text style={[styles.customerName, { color: colors.foreground }]} numberOfLines={2}>{item.name}</Text>
                  <Text style={[styles.customerMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {item.versatCode ? `Código ${item.versatCode} · ` : ''}{count} {count === 1 ? 'factura' : 'facturas'}
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </Pressable>
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: 0, gap: 0 },
  listContent: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 112 },
  headerBlock: { gap: 14, paddingBottom: 16 },
  search: { minHeight: 46, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, fontSize: 13, paddingVertical: 8 },
  customerRow: { minHeight: 76, borderWidth: 1, borderRadius: 14, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11 },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  customerText: { flex: 1, gap: 4 },
  customerName: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  customerMeta: { fontSize: 11 },
});
