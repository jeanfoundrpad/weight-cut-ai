import * as Linking from 'expo-linking'

/**
 * expo-router's own linking config consumes the launch URL to pick the
 * initial route before any screen mounts. By the time a screen like
 * reset-password mounts and calls Linking.useURL() itself, the one-time
 * 'url' delivery has often already fired and gone unheard, leaving that
 * hook with null forever. Capturing it here at module load, imported at the
 * top of _layout.tsx before any routing/rendering happens, sidesteps that
 * race entirely.
 */
let capturedUrl: string | null = null

const initialUrlPromise: Promise<string | null> = Linking.getInitialURL().then((url) => {
  if (url) capturedUrl = url
  return url
})

Linking.addEventListener('url', ({ url }) => {
  capturedUrl = url
})

export function getPendingDeepLink(): string | null {
  return capturedUrl
}

export function waitForInitialDeepLink(): Promise<string | null> {
  return initialUrlPromise
}
