import { Redirect } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { LoadingPanel, Screen } from '@/components/AssiUI';

export default function IndexScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) {
    return <Screen><LoadingPanel label="Comprobando acceso…" /></Screen>;
  }
  return <Redirect href={isSignedIn ? '/(tabs)' : '/(auth)/sign-in'} />;
}
