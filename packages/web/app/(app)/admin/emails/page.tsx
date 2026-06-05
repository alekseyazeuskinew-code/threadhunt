'use client';
import { PageHeader } from '@/components/PageHeader';
import { EmailSequenceBuilder } from '@/components/email/EmailSequenceBuilder';

// Конструктор email-цепочек (drip) для новых пользователей. Доступ — админ
// (серверные роуты /api/admin/email-sequences отдают 403 не-админам).
export default function AdminEmailsPage() {
  return (
    <>
      <PageHeader
        title="Email-цепочки"
        subtitle="Конструктор писем (drag-and-drop) и автоцепочки с задержками для новых пользователей."
      />
      <div className="p-8">
        <EmailSequenceBuilder />
      </div>
    </>
  );
}
