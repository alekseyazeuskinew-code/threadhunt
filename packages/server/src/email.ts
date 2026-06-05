// Отправка писем через Resend (REST API, без доп-зависимости) + рендер блоков
// конструктора в HTML письма. Ключ и отправитель — из env (в код не зашиваем):
//   RESEND_API_KEY=re_…   EMAIL_FROM=Threadhunt <noreply@домен>
// Без ключа sendEmail возвращает ошибку (ничего не падает).

export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'Threadhunt <onboarding@resend.dev>';
  if (!key) return { ok: false, error: 'RESEND_API_KEY не задан на сервере' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, error: `Resend ${res.status}: ${t.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 200) };
  }
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Блоки конструктора → HTML письма (инлайн-стили, безопасно для почтовых клиентов).
export function renderEmailHtml(blocks: any[]): string {
  const body = (blocks || [])
    .map((b) => {
      const al = b?.align === 'center' ? 'center' : 'left';
      switch (b?.type) {
        case 'heading':
          return `<h1 style="font-size:22px;font-weight:700;margin:0 0 12px;text-align:${al};color:#111">${esc(b.text)}</h1>`;
        case 'text':
          return `<p style="font-size:15px;line-height:1.6;margin:0 0 12px;text-align:${al};color:#333;white-space:pre-wrap">${esc(b.text)}</p>`;
        case 'button':
          return `<div style="text-align:${al};margin:16px 0"><a href="${esc(b.url)}" style="display:inline-block;background:#c6f24e;color:#0b0b0f;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;font-size:15px">${esc(b.text || 'Открыть')}</a></div>`;
        case 'image':
          return b?.url ? `<img src="${esc(b.url)}" alt="" style="max-width:100%;border-radius:10px;margin:8px 0"/>` : '';
        case 'divider':
          return `<hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>`;
        default:
          return `<div style="height:16px"></div>`; // spacer
      }
    })
    .join('');
  return `<div style="max-width:560px;margin:0 auto;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#fff">${body}<div style="margin-top:24px;color:#999;font-size:12px;text-align:center">Threadhunt</div></div>`;
}
