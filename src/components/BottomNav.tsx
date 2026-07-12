interface BottomNavProps {
  tab: 'library' | 'collections' | 'settings'
  setTab: (tab: 'library' | 'collections' | 'settings') => void
}

const ITEMS = [
  { id: 'library', label: '라이브러리', icon: '📚' },
  { id: 'collections', label: '컬렉션', icon: '🗂️' },
  { id: 'settings', label: '설정', icon: '⚙️' }
] as const

export function BottomNav({ tab, setTab }: BottomNavProps): React.JSX.Element {
  return (
    <nav className="bottom-nav">
      {ITEMS.map((item) => (
        <button
          key={item.id}
          className={tab === item.id ? 'bottom-nav-item active' : 'bottom-nav-item'}
          onClick={() => setTab(item.id)}
        >
          <span className="bottom-nav-icon" aria-hidden>
            {item.icon}
          </span>
          {item.label}
        </button>
      ))}
    </nav>
  )
}
