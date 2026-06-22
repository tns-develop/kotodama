import { useState } from 'react'
import { WorkerView } from './views/WorkerView'
import { SettingsView } from './views/SettingsView'
import { OverlayView } from './views/OverlayView'

type View = 'worker' | 'settings' | 'overlay'

function currentView(): View {
  const hash = window.location.hash.replace(/^#\/?/, '')
  if (hash === 'settings') return 'settings'
  if (hash === 'overlay') return 'overlay'
  return 'worker'
}

export function App() {
  const [view] = useState<View>(currentView())
  if (view === 'settings') return <SettingsView />
  if (view === 'overlay') return <OverlayView />
  return <WorkerView />
}
