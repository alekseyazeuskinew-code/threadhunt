import type { Lead } from '@/lib/types';
import { Badge } from './ui/Badge';

const sectionLabel: Record<string, string> = { requests: 'Запросы', hidden: 'Скрытые', main: 'Основной' };

// Таблица лидов — используется и в детали поиска, и на странице «Лиды».
export function LeadTable({ leads, showSearch }: { leads: Lead[]; showSearch: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line">
      <table className="w-full text-sm">
        <thead className="bg-panel text-left text-muted">
          <tr>
            <th className="px-4 py-3 font-medium">Кандидат</th>
            <th className="px-4 py-3 font-medium">Слово</th>
            {showSearch && <th className="px-4 py-3 font-medium">Поиск</th>}
            <th className="px-4 py-3 font-medium">Раздел</th>
            <th className="px-4 py-3 font-medium">Статус</th>
            <th className="px-4 py-3 font-medium">Когда</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => (
            <tr key={l.id} className="border-t border-line">
              <td className="px-4 py-3">{l.fromUsername || '—'}</td>
              <td className="px-4 py-3 font-mono text-xs text-accent-ink">{l.matchedKeyword}</td>
              {showSearch && <td className="px-4 py-3 text-muted">{l.search?.title}</td>}
              <td className="px-4 py-3 text-muted">{l.section ? sectionLabel[l.section] || l.section : '—'}</td>
              <td className="px-4 py-3">
                <Badge tone={l.status === 'REPLIED' ? 'success' : l.status === 'FAILED' ? 'danger' : 'neutral'}>
                  {l.status === 'REPLIED' ? 'ответили' : l.status === 'FAILED' ? 'ошибка' : 'вручную'}
                </Badge>
              </td>
              <td className="px-4 py-3 text-muted">{new Date(l.createdAt).toLocaleString('ru-RU')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
