import React from 'react';
import { StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
 
function ClassicTabLayout() {
  const colors = useColors();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: styles.label,
        tabBarStyle: {
          position: 'absolute',
          height: 68,
          paddingTop: 7,
          paddingBottom: 8,
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          elevation: 9,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Inicio', tabBarIcon: ({ color }) => <Feather name="home" size={19} color={color} /> }} />
      <Tabs.Screen name="invoices" options={{ title: 'Facturas', tabBarIcon: ({ color }) => <Feather name="file-text" size={19} color={color} /> }} />
      <Tabs.Screen name="customers" options={{ title: 'Clientes', tabBarIcon: ({ color }) => <Feather name="users" size={19} color={color} /> }} />
      <Tabs.Screen name="settlements" options={{ title: 'Liquidación', tabBarIcon: ({ color }) => <Feather name="bar-chart-2" size={19} color={color} /> }} />
      <Tabs.Screen name="account" options={{ title: 'Cuenta', tabBarIcon: ({ color }) => <Feather name="user" size={19} color={color} /> }} />
    </Tabs>
  );
}

export default function TabLayout() { return <ClassicTabLayout />; }

const styles = StyleSheet.create({
  label: { fontSize: 9, fontWeight: '700', marginTop: 1 },
});
