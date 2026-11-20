import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';

/**
 * Hides or restores the Android navigation bar to match `enabled`.
 *
 * The status bar is the caller's job (`<StatusBar hidden={enabled} />`): it is a
 * declarative component, while the navigation bar is an imperative, per-activity
 * setting that has no React surface.
 *
 * Android only. iOS has no navigation-bar API — the home indicator is drawn by
 * the system and cannot be hidden from JavaScript — and the web build has no
 * system bars at all, so both are no-ops rather than errors.
 */
export function useFullscreen(enabled: boolean): void {
  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    let active = true;

    /**
     * Hides or shows the bar.
     *
     * One call, deliberately: SDK 58's `expo-navigation-bar` dropped the
     * behavior setters along with non-edge-to-edge layouts, and the hidden state
     * already defaults to "a swipe from the edge reveals the bars, then they go
     * away again" — which is exactly the behaviour wanted here.
     *
     * Failures are swallowed: these promises reject on some OEM builds, and a
     * system bar left visible is a cosmetic loss next to an unhandled rejection
     * during a render commit.
     */
    const apply = (hidden: boolean): void => {
      void NavigationBar.setVisibilityAsync(hidden ? 'hidden' : 'visible').catch(() => {});
    };

    apply(enabled);

    // Android restores the bars when the activity loses and regains focus, so
    // the preference has to be re-applied on every return to the foreground.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && active) {
        apply(enabled);
      }
    });

    return () => {
      active = false;
      subscription.remove();

      // Leaving fullscreen (or unmounting) must always give the bars back, even
      // when the screen is torn down while enabled.
      void NavigationBar.setVisibilityAsync('visible').catch(() => {});
    };
  }, [enabled]);
}
