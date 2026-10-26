import { Feather } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder = 'Selecciona una opción',
  searchable = false,
  helper,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchable?: boolean;
  helper?: string;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase();
    if (!normalized) return options;
    return options.filter((option) => option.label.toLocaleLowerCase().includes(normalized));
  }, [options, search]);

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? placeholder}`}
        onPress={() => { setSearch(''); setOpen(true); }}
        style={({ pressed }) => [styles.trigger, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}
      >
        <Text numberOfLines={1} style={[styles.value, { color: selected ? colors.foreground : colors.mutedForeground }]}>
          {selected?.label ?? placeholder}
        </Text>
        <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
      </Pressable>
      {helper ? <Text style={[styles.helper, { color: colors.mutedForeground }]}>{helper}</Text> : null}
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            onPress={() => undefined}
            style={[
              styles.sheet,
              { backgroundColor: colors.background, borderColor: colors.border, paddingBottom: Math.max(insets.bottom, 18) },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>{label}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" onPress={() => setOpen(false)} hitSlop={12}>
                <Feather name="x" size={21} color={colors.mutedForeground} />
              </Pressable>
            </View>
            {searchable ? (
              <View style={[styles.searchWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="search" size={16} color={colors.mutedForeground} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Buscar…"
                  placeholderTextColor={colors.mutedForeground}
                  style={[styles.searchInput, { color: colors.foreground }]}
                  autoCorrect={false}
                />
              </View>
            ) : null}
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.value}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.options}
              ListEmptyComponent={<Text style={[styles.empty, { color: colors.mutedForeground }]}>No hay opciones disponibles.</Text>}
              renderItem={({ item }) => {
                const active = item.value === value;
                return (
                  <Pressable
                    accessibilityRole="button"
                    disabled={item.disabled}
                    onPress={() => { onChange(item.value); setOpen(false); }}
                    style={({ pressed }) => [
                      styles.option,
                      { backgroundColor: active ? colors.accent : colors.card, opacity: item.disabled ? 0.45 : pressed ? 0.78 : 1 },
                    ]}
                  >
                    <Text style={[styles.optionText, { color: colors.foreground }]}>{item.label}</Text>
                    {active ? <Feather name="check" size={17} color={colors.primary} /> : null}
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 7 },
  label: { fontSize: 12, fontWeight: '700' },
  trigger: { minHeight: 48, borderWidth: 1, borderRadius: 11, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  value: { flex: 1, fontSize: 14 },
  helper: { fontSize: 11, lineHeight: 15 },
  backdrop: { flex: 1, backgroundColor: 'rgba(13, 36, 55, 0.35)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '82%', borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, paddingHorizontal: 18, paddingTop: 10 },
  handle: { width: 42, height: 4, borderRadius: 4, alignSelf: 'center', marginBottom: 15 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  sheetTitle: { fontSize: 17, fontWeight: '800' },
  searchWrap: { minHeight: 46, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 7 },
  options: { gap: 7, paddingBottom: 12 },
  option: { minHeight: 48, borderRadius: 11, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  optionText: { flex: 1, fontSize: 13, lineHeight: 18 },
  empty: { fontSize: 13, paddingVertical: 24, textAlign: 'center' },
});
