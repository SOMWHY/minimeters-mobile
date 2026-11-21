import { DarkTheme, DefaultTheme, Slot, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { PcmConnectionProvider } from '@/features/connection/connection-context';
import { I18nProvider } from '@/i18n';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <I18nProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <PcmConnectionProvider>
          <AnimatedSplashOverlay />
          <Slot />
        </PcmConnectionProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}
