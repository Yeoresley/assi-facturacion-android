import React, { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, useAuth, useClerk } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Redirect, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ActionButton, LoadingPanel, MessagePanel, Screen } from '@/components/AssiUI';
import { getGetCurrentTeamMemberQueryKey, setAuthTokenGetter, setBaseUrl, useGetCurrentTeamMember } from '@workspace/api-client-react';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const clerkPubKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL;
const apiDomain = process.env.EXPO_PUBLIC_DOMAIN;
if (apiDomain) setBaseUrl(`https://${apiDomain}`);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

function AccessGate() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const segments = useSegments();
  const queryClient = useQueryClient();
  const [apiReady, setApiReady] = useState(false);
  const inAuth = segments[0] === '(auth)';
  const member = useGetCurrentTeamMember({
    query: {
      queryKey: getGetCurrentTeamMemberQueryKey(),
      enabled: isLoaded && Boolean(isSignedIn) && apiReady && !inAuth,
      retry: false,
    },
  });

  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn) {
      setAuthTokenGetter(() => getToken());
      setApiReady(true);
    } else {
      setAuthTokenGetter(null);
      setApiReady(false);
      queryClient.clear();
    }
  }, [getToken, isLoaded, isSignedIn, queryClient]);

  if (!isLoaded) return <Screen><LoadingPanel label="Cargando sesión segura…" /></Screen>;
  if (!isSignedIn && !inAuth) return <Redirect href="/(auth)/sign-in" />;
  if (isSignedIn && inAuth) return <Redirect href="/(tabs)" />;
  if (isSignedIn && !inAuth) {
    if (!apiReady || member.isLoading) return <Screen><LoadingPanel label="Validando el acceso al equipo…" /></Screen>;
    if (member.isError || !member.data) {
      return (
        <Screen>
          <MessagePanel
            title="Cuenta sin acceso al equipo"
            message="El administrador debe invitarte y activar tu cuenta. Si ya tienes acceso, revisa tu conexión e inténtalo otra vez."
            action={{ label: 'Reintentar', onPress: () => void member.refetch() }}
          />
          <SignOutButton />
        </Screen>
      );
    }
    if (member.data.suspended || member.data.role === 'pending') {
      return (
        <Screen>
          <MessagePanel
            title={member.data.suspended ? 'Acceso suspendido' : 'Invitación pendiente'}
            message={member.data.suspended ? 'Contacta al administrador para revisar tu acceso.' : 'El administrador debe activar tu cuenta antes de usar la aplicación.'}
          />
          <SignOutButton />
        </Screen>
      );
    }
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#eef3f2' } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="invoice/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="invoice/[id]" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="customer/[id]" options={{ animation: 'slide_from_right' }} />
    </Stack>
  );
}

function SignOutButton() {
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  return <ActionButton label="Cerrar sesión" icon="log-out" secondary onPress={async () => { await signOut(); queryClient.clear(); }} />;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  if (!clerkPubKey) {
    return (
      <SafeAreaProvider>
        <Screen>
          <MessagePanel title="Inicio de sesión no configurado" message="La aplicación necesita la clave pública de Clerk en su entorno de ejecución." />
        </Screen>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <ClerkProvider publishableKey={clerkPubKey} tokenCache={tokenCache} proxyUrl={clerkProxyUrl}>
          <QueryClientProvider client={queryClient}>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProvider>
                <StatusBar style="dark" />
                <AccessGate />
              </KeyboardProvider>
            </GestureHandlerRootView>
          </QueryClientProvider>
        </ClerkProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
