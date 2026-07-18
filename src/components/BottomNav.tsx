import { Icon, type IconName } from './Icon'

interface BottomNavProps {
  tab: 'library' | 'collections' | 'settings'
  setTab: (tab: 'library' | 'collections' | 'settings') => void
}

const ITEMS: { id: BottomNavProps['tab']; label: string; icon: IconName }[] = [
  { id: 'library', label: '라이브러리', icon: 'library' },
  { id: 'collections', label: '컬렉션', icon: 'collections' },
  { id: 'settings', label: '설정', icon: 'settings' }
]

export function BottomNav({ tab, setTab }: BottomNavProps): React.JSX.Element {
  return (
    <nav className="bottom-nav">
      {ITEMS.map((item) => {
        const active = tab === item.id
        return (
          <button
            key={item.id}
            className={active ? 'bottom-nav-item active' : 'bottom-nav-item'}
            aria-current={active ? 'page' : undefined}
            onClick={() => setTab(item.id)}
          >
            <span className="bottom-nav-icon">
              <Icon name={item.icon} size={23} />
            </span>
            <span className="bottom-nav-label">{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
