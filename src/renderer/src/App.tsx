import { useState } from 'react'
import { WorkerView } from './views/WorkerView'
import { SettingsView } from './views/SettingsView'
import { OverlayView } from './views/OverlayView'
import { LongRecordingDialogView } from './views/LongRecordingDialogView'

type View = 'worker' | 'settings' | 'overlay' | 'long-recording'

function currentView(): View {
  const hash = window.location.hash.replace(/^#\/?/, '')
  if (hash === 'settings') return 'settings'
  if (hash === 'overlay') return 'overlay'
  if (hash === 'long-recording' || hash.startsWith('long-recording?')) return 'long-recording'
  return 'worker'
}

export function App() {
  const [view] = useState<View>(currentView())
  if (view === 'settings') return <SettingsView />
  if (view === 'overlay') return <OverlayView />
  if (view === 'long-recording') return <LongRecordingDialogView />
  return <WorkerView />
}
