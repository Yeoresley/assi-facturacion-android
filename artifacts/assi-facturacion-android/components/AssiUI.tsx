import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewProps,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import { paymentLabel, statusLabel } from '@/lib/format';

type ScreenProps = {
  children: ReactNode;
  scroll?: boolean;
  contentStyle?: ViewStyle;
  refreshControl?: ScrollViewProps['refreshControl'];
};

export function Screen({ children, scroll = true, contentStyle, refreshControl }: ScreenProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const padding = { paddingTop: Math.max(insets.top ? 8 : 18, 12), paddingBottom: Math.max(insets.bottom, 12) + 100 };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      {scroll ? (
        <KeyboardAwareScrollViewCompat
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
          contentContainerStyle={[styles.content, padding, contentStyle]}
        >
          {children}
        </KeyboardAwareScrollViewCompat>
      ) : (
        <View style={[styles.content, { flex: 1, paddingTop: 0, paddingBottom: 0 }, contentStyle]}>
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

export function BrandHeader({ compact = false }: { compact?: boolean }) {
  const colors = useColors();
  return (
    <View style={styles.brandHeader}>
      <View style={styles.brandMarkWrap}>
        <Image source={require('../assets/images/assi-mark.png')} style={styles.brandMark} contentFit="contain" />
      </View>
      <View>
        <Text style={[styles.brandName, { color: colors.foreground }]}>ASSI</Text>
        {!compact && <Text style={[styles.brandCaption, { color: colors.mutedForeground }]}>FACTURACIÓN DE EQUIPO</Text>}
      </View>
    </View>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  accessory,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  accessory?: ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.pageHeader}>
      <View style={styles.pageHeaderText}>
        {eyebrow ? <Text style={[styles.eyebrow, { color: colors.primary }]}>{eyebrow.toUpperCase()}</Text> : null}
        <Text style={[styles.pageTitle, { color: colors.foreground }]}>{title}</Text>
        {subtitle ? <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text> : null}
      </View>
      {accessory}
    </View>
  );
}

export function Panel({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const colors = useColors();
  return <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }, style]}>{children}</View>;
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
  icon?: keyof typeof Feather.glyphMap;
  compact?: boolean;
};

export function ActionButton({
  label,
  onPress,
  secondary = false,
  danger = false,
  disabled = false,
  loading = false,
  icon,
  compact = false,
}: ButtonProps) {
  const colors = useColors();
  const background = danger ? colors.destructive : secondary ? colors.secondary : colors.primary;
  const foreground = secondary ? colors.foreground : colors.primaryForeground;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: background, opacity: disabled || loading ? 0.55 : pressed ? 0.82 : 1 },
      ]}
    >
      {loading ? <ActivityIndicator color={foreground} size="small" /> : icon ? <Feather name={icon} size={16} color={foreground} /> : null}
      <Text style={[styles.buttonText, compact && styles.buttonTextCompact, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

export function TextField({
  label,
  helper,
  error,
  style,
  ...props
}: TextInputProps & { label: string; helper?: string; error?: string }) {
  const colors = useColors();
  return (
    <View style={styles.fieldWrap}>
      <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{label}</Text>
      <TextInput
        {...props}
        placeholderTextColor={colors.mutedForeground}
        style={[
          styles.input,
          {
            color: colors.foreground,
            backgroundColor: colors.card,
            borderColor: error ? colors.destructive : colors.border,
          },
          props.multiline && styles.multiline,
          style,
        ]}
      />
      {error ? <Text style={[styles.helperText, { color: colors.destructive }]}>{error}</Text> : helper ? <Text style={[styles.helperText, { color: colors.mutedForeground }]}>{helper}</Text> : null}
    </View>
  );
}

export function StatusPill({ status, balanceDue, totalPaid }: { status: string; balanceDue?: number; totalPaid?: number }) {
  const colors = useColors();
  const palette: Record<string, { bg: string; fg: string }> = {
    draft: { bg: '#f0eee4', fg: '#71694b' },
    finished: { bg: '#e8f0f6', fg: '#416883' },
    accepted: { bg: '#e1f1eb', fg: '#26705f' },
    confirmed: { bg: '#e1edf5', fg: '#235d7f' },
    sent: { bg: '#e8f0f6', fg: '#416883' },
    paid: { bg: '#e1f1eb', fg: '#26705f' },
    voided: { bg: '#f7e8e4', fg: '#9a453a' },
    cancelled: { bg: '#f7e8e4', fg: '#9a453a' },
    error: { bg: '#f7e8e4', fg: '#9a453a' },
  };
  const colorsFor = palette[status] ?? { bg: colors.secondary, fg: colors.foreground };
  return (
    <View style={styles.badgeRow}>
      <View style={[styles.badge, { backgroundColor: colorsFor.bg }]}>
        <Text style={[styles.badgeText, { color: colorsFor.fg }]}>{statusLabel(status)}</Text>
      </View>
      {typeof balanceDue === 'number' && (
        <View style={[styles.badge, { backgroundColor: balanceDue <= 0 ? '#e1f1eb' : (totalPaid ?? 0) > 0 ? '#fbf0d8' : '#f0eee4' }]}>
          <Text style={[styles.badgeText, { color: balanceDue <= 0 ? '#26705f' : (totalPaid ?? 0) > 0 ? '#8b6828' : '#71694b' }]}>
            {paymentLabel(balanceDue, totalPaid ?? 0)}
          </Text>
        </View>
      )}
    </View>
  );
}

export function InvoiceRow({ invoice, onPress }: { invoice: any; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.invoiceRow, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}
    >
      <View style={styles.invoiceRowTop}>
        <Text style={[styles.invoiceNumber, { color: colors.foreground }]} numberOfLines={1}>{invoice.number}</Text>
        <Text style={[styles.invoiceAmount, { color: colors.foreground }]}>{new Intl.NumberFormat('es-CU', { maximumFractionDigits: 2 }).format(invoice.total)} {invoice.currency}</Text>
      </View>
      <Text style={[styles.invoiceCustomer, { color: colors.mutedForeground }]} numberOfLines={1}>{invoice.customerName}</Text>
      <View style={styles.invoiceRowBottom}>
        <StatusPill status={invoice.status} balanceDue={invoice.balanceDue} totalPaid={invoice.totalPaid} />
        <Text style={[styles.invoiceDate, { color: colors.mutedForeground }]}>{invoice.issueDate?.slice(0, 10)}</Text>
      </View>
    </Pressable>
  );
}

export function MessagePanel({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: { label: string; onPress: () => void };
}) {
  const colors = useColors();
  return (
    <Panel style={styles.messagePanel}>
      <Feather name="info" size={20} color={colors.primary} />
      <Text style={[styles.messageTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.messageText, { color: colors.mutedForeground }]}>{message}</Text>
      {action ? <ActionButton label={action.label} secondary onPress={action.onPress} compact /> : null}
    </Panel>
  );
}

export function LoadingPanel({ label = 'Cargando información…' }: { label?: string }) {
  const colors = useColors();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.primary} />
      <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: 18, gap: 14 },
  brandHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMarkWrap: { width: 42, height: 42, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  brandMark: { width: 42, height: 42 },
  brandName: { fontSize: 17, fontWeight: '800', letterSpacing: 2 },
  brandCaption: { fontSize: 9, fontWeight: '700', letterSpacing: 1.3, marginTop: 2 },
  pageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 },
  pageHeaderText: { flex: 1, gap: 4 },
  eyebrow: { fontSize: 10, letterSpacing: 1.6, fontWeight: '800' },
  pageTitle: { fontSize: 25, lineHeight: 31, fontWeight: '800', letterSpacing: -0.5 },
  pageSubtitle: { fontSize: 13, lineHeight: 19 },
  panel: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 10, shadowColor: '#12365a', shadowOpacity: 0.035, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  button: { minHeight: 48, paddingHorizontal: 16, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonCompact: { minHeight: 40, alignSelf: 'flex-start', paddingHorizontal: 13, borderRadius: 10 },
  buttonText: { fontSize: 14, fontWeight: '700' },
  buttonTextCompact: { fontSize: 12 },
  fieldWrap: { gap: 7 },
  fieldLabel: { fontSize: 12, fontWeight: '700' },
  input: { minHeight: 48, borderRadius: 11, borderWidth: 1, paddingHorizontal: 13, fontSize: 14 },
  multiline: { minHeight: 90, textAlignVertical: 'top', paddingTop: 12 },
  helperText: { fontSize: 11, lineHeight: 16 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  badge: { borderRadius: 30, paddingHorizontal: 9, paddingVertical: 5 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  invoiceRow: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 7 },
  invoiceRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  invoiceNumber: { flex: 1, fontSize: 14, fontWeight: '800' },
  invoiceAmount: { fontSize: 13, fontWeight: '800' },
  invoiceCustomer: { fontSize: 12, lineHeight: 17 },
  invoiceRowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 1 },
  invoiceDate: { fontSize: 10 },
  messagePanel: { alignItems: 'center', paddingVertical: 24 },
  messageTitle: { fontSize: 15, fontWeight: '800', textAlign: 'center' },
  messageText: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
  loading: { alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, padding: 28 },
  loadingText: { fontSize: 12 },
});
