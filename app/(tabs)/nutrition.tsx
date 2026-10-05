import { CameraView, useCameraPermissions } from 'expo-camera'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { suggestMeals, type MealSuggestion } from '../../lib/aiProxy'
import { lookupBarcode } from '../../lib/openFoodFacts'
import { currentFightGoal, dayTotals, localDateFrom } from '../../lib/repo'
import { radius, spacing, type, useTheme, type Theme } from '../../lib/theme'

type ScreenMode = 'barcode' | 'suggest'
type BarcodeStatus = 'scanning' | 'looking-up' | 'not-found'
type SuggestPhase =
  | { kind: 'idle' }
  | { kind: 'analyzing' }
  | { kind: 'results'; suggestions: MealSuggestion[] }
  | { kind: 'empty' }

function ModeToggle({ mode, onChange, theme }: { mode: ScreenMode; onChange: (m: ScreenMode) => void; theme: Theme }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: radius.pill, padding: 4 }}>
      {(['barcode', 'suggest'] as const).map((m) => (
        <Pressable
          key={m}
          accessibilityRole="button"
          onPress={() => onChange(m)}
          style={{
            paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.pill,
            backgroundColor: mode === m ? '#fff' : 'transparent',
          }}
        >
          <Text style={{ color: mode === m ? theme.bg : '#fff', fontWeight: '700', fontSize: 13 }}>
            {m === 'barcode' ? 'Scan barcode' : 'Suggest meals'}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}

export default function NutritionScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [permission, requestPermission] = useCameraPermissions()
  const cameraRef = useRef<CameraView>(null)
  const [screenMode, setScreenMode] = useState<ScreenMode>('barcode')

  const [barcodeStatus, setBarcodeStatus] = useState<BarcodeStatus>('scanning')
  // Guards against onBarcodeScanned firing repeatedly for the same
  // still-in-frame barcode before the first lookup has resolved.
  const processingRef = useRef(false)
  // Bumped on focus so a lookup still in flight when the user navigates
  // away can't land a stale result after the screen's already reset.
  const scanTokenRef = useRef(0)

  const [suggestPhase, setSuggestPhase] = useState<SuggestPhase>({ kind: 'idle' })

  useFocusEffect(
    useCallback(() => {
      scanTokenRef.current += 1
      processingRef.current = false
      setBarcodeStatus('scanning')
      setSuggestPhase({ kind: 'idle' })
    }, []),
  )

  function switchMode(m: ScreenMode) {
    setScreenMode(m)
    processingRef.current = false
    setBarcodeStatus('scanning')
    setSuggestPhase({ kind: 'idle' })
  }

  async function handleScan(barcode: string) {
    if (processingRef.current) return
    processingRef.current = true
    const token = scanTokenRef.current
    setBarcodeStatus('looking-up')
    const item = await lookupBarcode(barcode)
    if (scanTokenRef.current !== token) return
    if (!item) {
      setBarcodeStatus('not-found')
      processingRef.current = false
      return
    }
    router.push({ pathname: '/camera', params: { mode: 'manual', template: JSON.stringify([item]) } })
  }

  // Ingredients photo + whatever's left of today's targets -> meal ideas.
  // Reuses the analyze-photo function's "suggest" intent (see
  // backend/supabase/functions/analyze-photo/index.ts) — same entitlement
  // gate, same daily cap, same cost logging as a normal meal scan.
  async function captureForSuggestions() {
    const photo = await cameraRef.current?.takePictureAsync({ base64: true, quality: 0.6 })
    if (!photo?.base64) return
    setSuggestPhase({ kind: 'analyzing' })
    const [goal, totals] = await Promise.all([currentFightGoal(), dayTotals(localDateFrom(Date.now()))])
    const remaining = {
      kcal: Math.max(0, (goal?.targetKcal ?? 0) - totals.calories),
      proteinG: Math.max(0, (goal?.proteinG ?? 0) - totals.proteinG),
      carbsG: Math.max(0, (goal?.carbsG ?? 0) - totals.carbsG),
      fatG: Math.max(0, (goal?.fatG ?? 0) - totals.fatG),
    }
    const result = await suggestMeals(photo.base64, remaining)
    setSuggestPhase(result.suggestions.length > 0 ? { kind: 'results', suggestions: result.suggestions } : { kind: 'empty' })
  }

  function pickSuggestion(s: MealSuggestion) {
    router.push({ pathname: '/camera', params: { mode: 'manual', template: JSON.stringify(s.items) } })
  }

  if (!permission) return <View style={{ flex: 1, backgroundColor: theme.bg }} />

  if (!permission.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
        <Text style={[type.title, { color: theme.text, textAlign: 'center', marginBottom: spacing.sm }]}>Nutrition</Text>
        <Text style={[type.body, { color: theme.textMuted, textAlign: 'center', marginBottom: spacing.lg }]}>
          Weight Cut AI needs camera access to scan barcodes and ingredients.
        </Text>
        <Pressable
          onPress={requestPermission}
          style={{ height: 52, paddingHorizontal: spacing.xl, borderRadius: radius.pill, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={[type.bodyStrong, { color: theme.onPrimary }]}>Allow camera</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        ref={cameraRef}
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={screenMode === 'barcode' ? { barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] } : undefined}
        onBarcodeScanned={screenMode === 'barcode' ? (result) => void handleScan(result.data) : undefined}
      />

      <View style={{ position: 'absolute', top: insets.top + spacing.md, left: spacing.lg, right: spacing.lg, alignItems: 'center', gap: spacing.sm }}>
        <ModeToggle mode={screenMode} onChange={switchMode} theme={theme} />
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center' }}>
          {screenMode === 'barcode' ? 'Scan a barcode' : 'Photograph your ingredients'}
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center' }}>
          {screenMode === 'barcode'
            ? "Point at a product's barcode, on food, in your fridge, or at the store."
            : "What's in your fridge or pantry? Get meal ideas sized to what you have left today."}
        </Text>
      </View>

      {screenMode === 'barcode' ? (
        <>
          <View style={{
            position: 'absolute', top: '38%', left: '15%', right: '15%', height: 140,
            borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)', borderRadius: radius.lg,
          }} />

          {/* Required by Open Food Facts' terms whenever their data is shown. */}
          <Text style={{
            position: 'absolute', bottom: insets.bottom + spacing.sm, alignSelf: 'center',
            color: 'rgba(255,255,255,0.5)', fontSize: 11,
          }}>
            Product data from Open Food Facts
          </Text>

          {barcodeStatus === 'looking-up' ? (
            <View style={{
              position: 'absolute', bottom: insets.bottom + spacing.xl, alignSelf: 'center',
              flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
              backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: radius.pill, paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
            }}>
              <ActivityIndicator color="#fff" />
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>Looking it up…</Text>
            </View>
          ) : null}

          {barcodeStatus === 'not-found' ? (
            <View style={{
              position: 'absolute', bottom: insets.bottom + spacing.xl, alignSelf: 'center', alignItems: 'center',
              backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: radius.lg, padding: spacing.lg, maxWidth: '85%',
            }}>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700', textAlign: 'center' }}>
                Couldn't find that product
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center', marginTop: 4 }}>
                Not every item is in the database yet. You can add it manually instead.
              </Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => { processingRef.current = false; setBarcodeStatus('scanning') }}
                  style={{ paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Try again</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: '/camera', params: { mode: 'manual' } })}
                  style={{ paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: theme.primary }}
                >
                  <Text style={{ color: theme.onPrimary, fontWeight: '700' }}>Add manually</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </>
      ) : (
        <>
          {suggestPhase.kind === 'idle' ? (
            <View style={{ position: 'absolute', bottom: Math.max(insets.bottom, spacing.xl) + spacing.lg, alignSelf: 'center' }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Photograph ingredients"
                onPress={captureForSuggestions}
                style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: '#fff', borderWidth: 4, borderColor: 'rgba(255,255,255,0.4)' }}
              />
            </View>
          ) : null}

          {suggestPhase.kind === 'analyzing' ? (
            <View style={{
              position: 'absolute', bottom: insets.bottom + spacing.xl, alignSelf: 'center',
              flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
              backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: radius.pill, paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
            }}>
              <ActivityIndicator color="#fff" />
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>Thinking of ideas…</Text>
            </View>
          ) : null}

          {suggestPhase.kind === 'empty' ? (
            <View style={{
              position: 'absolute', bottom: insets.bottom + spacing.xl, alignSelf: 'center', alignItems: 'center',
              backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: radius.lg, padding: spacing.lg, maxWidth: '85%',
            }}>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700', textAlign: 'center' }}>
                Couldn't find enough there for a meal idea
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setSuggestPhase({ kind: 'idle' })}
                style={{ marginTop: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' }}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>Try again</Text>
              </Pressable>
            </View>
          ) : null}

          {suggestPhase.kind === 'results' ? (
            <ScrollView
              style={{ position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: '55%', backgroundColor: theme.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }}
              contentContainerStyle={{ padding: spacing.lg, paddingBottom: Math.max(insets.bottom, spacing.lg), gap: spacing.sm }}
            >
              <Text style={[type.label, { color: theme.textMuted }]}>Meal ideas from what you have</Text>
              {suggestPhase.suggestions.map((s, i) => (
                <Pressable
                  key={i}
                  accessibilityRole="button"
                  onPress={() => pickSuggestion(s)}
                  style={{ backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg }}
                >
                  <Text style={[type.bodyStrong, { color: theme.text }]}>{s.title}</Text>
                  <Text style={[type.caption, { color: theme.textMuted, marginTop: spacing.xs }]}>
                    {s.items.map((it) => it.label).join(', ')}
                  </Text>
                  <Text style={[type.caption, { color: theme.textFaint, marginTop: 2 }]}>
                    {Math.round(s.items.reduce((sum, it) => sum + it.calories, 0))} kcal
                  </Text>
                </Pressable>
              ))}
              <Pressable
                accessibilityRole="button"
                onPress={() => setSuggestPhase({ kind: 'idle' })}
                style={{ alignSelf: 'center', marginTop: spacing.xs }}
              >
                <Text style={[type.caption, { color: theme.primary, fontWeight: '700' }]}>Take another photo</Text>
              </Pressable>
            </ScrollView>
          ) : null}
        </>
      )}
    </View>
  )
}
