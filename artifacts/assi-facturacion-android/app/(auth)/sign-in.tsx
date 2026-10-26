import { useSignIn } from '@clerk/expo';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { ActionButton, BrandHeader, Panel, Screen, TextField } from '@/components/AssiUI';
import { useColors } from '@/hooks/useColors';

export default function SignInScreen() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const router = useRouter();
  const colors = useColors();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [formError, setFormError] = useState('');
  const busy = fetchStatus === 'fetching';

  async function finishSignIn() {
    await signIn.finalize({
      navigate: () => router.replace('/(tabs)'),
    });
  }

  async function submitPassword() {
    setFormError('');
    try {
      const result = await signIn.password({ emailAddress: email.trim(), password });
      if (result.error) {
        setFormError(result.error.message || 'Comprueba el correo y la contraseña.');
        return;
      }
      if (signIn.status === 'complete') {
        await finishSignIn();
        return;
      }
      if (signIn.status === 'needs_client_trust' || signIn.status === 'needs_second_factor') {
        const emailFactor = signIn.supportedSecondFactors?.find((factor) => factor.strategy === 'email_code');
        if (emailFactor) {
          await signIn.mfa.sendEmailCode();
          setNeedsCode(true);
        } else {
          setFormError('La cuenta requiere una verificación adicional no disponible en esta pantalla. Contacta al administrador.');
        }
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'No se pudo iniciar sesión.');
    }
  }

  async function verifyCode() {
    setFormError('');
    try {
      const result = await signIn.mfa.verifyEmailCode({ code: code.trim() });
      if (result.error) {
        setFormError(result.error.message || 'El código no es válido.');
        return;
      }
      if (signIn.status === 'complete') await finishSignIn();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'No se pudo validar el código.');
    }
  }

  return (
    <Screen contentStyle={styles.screenContent}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.avoider}>
        <View style={styles.loginTop}>
          <BrandHeader />
          <View style={styles.intro}>
            <Text style={[styles.title, { color: colors.foreground }]}>Facturación, estés donde estés.</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Accede con la cuenta autorizada por el administrador de ASSI.
            </Text>
          </View>
          <Panel style={styles.loginPanel}>
            <Text style={[styles.panelTitle, { color: colors.foreground }]}>
              {needsCode ? 'Verifica tu acceso' : 'Iniciar sesión'}
            </Text>
            {needsCode ? (
              <>
                <Text style={[styles.help, { color: colors.mutedForeground }]}>
                  Escribe el código que enviamos al correo de tu cuenta.
                </Text>
                <TextField
                  label="Código de verificación"
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  placeholder="000000"
                />
                {errors.fields.code?.message ? <Text style={[styles.error, { color: colors.destructive }]}>{errors.fields.code.message}</Text> : null}
                <ActionButton label="Verificar y entrar" onPress={verifyCode} loading={busy} disabled={!code.trim()} />
                <ActionButton label="Volver" secondary onPress={() => { setNeedsCode(false); setCode(''); signIn.reset(); }} />
              </>
            ) : (
              <>
                <TextField
                  label="Correo electrónico"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  autoComplete="email"
                  placeholder="nombre@empresa.com"
                />
                {errors.fields.identifier?.message ? <Text style={[styles.error, { color: colors.destructive }]}>{errors.fields.identifier.message}</Text> : null}
                <TextField
                  label="Contraseña"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete="password"
                  placeholder="Tu contraseña"
                  onSubmitEditing={submitPassword}
                  returnKeyType="go"
                />
                {errors.fields.password?.message ? <Text style={[styles.error, { color: colors.destructive }]}>{errors.fields.password.message}</Text> : null}
                <ActionButton label="Entrar" icon="arrow-right" onPress={submitPassword} loading={busy} disabled={!email.trim() || !password} />
              </>
            )}
            {formError ? <Text accessibilityRole="alert" style={[styles.errorBox, { color: colors.destructive }]}>{formError}</Text> : null}
          </Panel>
        </View>
        <Text style={[styles.footer, { color: colors.mutedForeground }]}>
          ¿No tienes acceso? Pide al administrador que active tu cuenta.
        </Text>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, justifyContent: 'center', paddingTop: 28, paddingBottom: 26 },
  avoider: { flex: 1, justifyContent: 'space-between', gap: 28 },
  loginTop: { gap: 28, width: '100%', maxWidth: 480, alignSelf: 'center' },
  intro: { gap: 8 },
  title: { fontSize: 31, lineHeight: 38, letterSpacing: -0.8, fontWeight: '800' },
  subtitle: { fontSize: 14, lineHeight: 21 },
  loginPanel: { padding: 20, gap: 16 },
  panelTitle: { fontSize: 19, fontWeight: '800', marginBottom: 2 },
  help: { fontSize: 12, lineHeight: 18 },
  error: { fontSize: 12, lineHeight: 17, marginTop: -5 },
  errorBox: { fontSize: 12, lineHeight: 18, fontWeight: '600' },
  footer: { fontSize: 12, lineHeight: 18, textAlign: 'center', maxWidth: 320, alignSelf: 'center' },
});
