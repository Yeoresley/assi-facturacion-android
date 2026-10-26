import { Feather } from '@expo/vector-icons';
import { useClerk, useUser } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useGetCurrentTeamMember } from '@workspace/api-client-react';
import { ActionButton, LoadingPanel, PageHeader, Panel, Screen } from '@/components/AssiUI';
import { useColors } from '@/hooks/useColors';

export default function AccountScreen() {
  const colors = useColors();
  const { signOut } = useClerk();
  const { user } = useUser();
  const router = useRouter();
  const queryClient = useQueryClient();
  const member = useGetCurrentTeamMember();

  async function handleSignOut() {
    await signOut();
    queryClient.clear();
    router.replace('/(auth)/sign-in');
  }

  return (
    <Screen>
      <PageHeader eyebrow="Cuenta del equipo" title="Mi cuenta" subtitle="Perfil y acceso seguro de ASSI." />
      {member.isLoading ? <LoadingPanel label="Cargando perfil…" /> : (
        <>
          <Panel style={styles.profile}>
            <View style={[styles.avatar, { backgroundColor: colors.accent }]}><Feather name="user" size={22} color={colors.primary} /></View>
            <Text style={[styles.name, { color: colors.foreground }]}>{member.data?.name || user?.fullName || 'Usuario ASSI'}</Text>
            <Text style={[styles.email, { color: colors.mutedForeground }]}>{member.data?.email || user?.primaryEmailAddress?.emailAddress || '—'}</Text>
            <View style={[styles.roleChip, { backgroundColor: colors.accent }]}>
              <Text style={[styles.roleText, { color: colors.primary }]}>{member.data?.role === 'owner' ? 'Administrador' : 'Especialista'}</Text>
            </View>
          </Panel>
          <Panel style={styles.privacy}>
            <Feather name="shield" size={19} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.privacyTitle, { color: colors.foreground }]}>Acceso por rol</Text>
              <Text style={[styles.privacyText, { color: colors.mutedForeground }]}>
                {member.data?.role === 'owner'
                  ? 'Puedes consultar las facturas y liquidaciones del equipo.'
                  : 'Solo ves las facturas asignadas a tu comercial y tu propia liquidación.'}
              </Text>
            </View>
          </Panel>
          <ActionButton label="Cerrar sesión" icon="log-out" secondary onPress={handleSignOut} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  profile: { alignItems: 'center', paddingVertical: 25, gap: 8 },
  avatar: { width: 62, height: 62, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 5 },
  name: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  email: { fontSize: 12 },
  roleChip: { borderRadius: 30, paddingHorizontal: 12, paddingVertical: 6, marginTop: 4 },
  roleText: { fontSize: 11, fontWeight: '800' },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  privacyTitle: { fontSize: 13, fontWeight: '800' },
  privacyText: { fontSize: 11, lineHeight: 17, marginTop: 3 },
});
