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

// Тёплое приветственное письмо при попадании в лист ожидания.
export function renderWaitlistWelcomeHtml(name?: string | null, opts?: { siteUrl?: string; promoBenefit?: string }): string {
  const site = opts?.siteUrl || 'https://thread-hunt.com';
  const benefit = opts?.promoBenefit || '−50% на старте';
  const hi = name && name.trim() ? `Привет, ${esc(name.trim())}!` : 'Привет!';
  return `<div style="max-width:560px;margin:0 auto;padding:28px 24px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#fff;color:#111">
  <div style="font-size:24px;font-weight:800;letter-spacing:-0.02em">Ты в списке первых 🎉</div>
  <p style="font-size:15px;line-height:1.65;color:#333;margin:16px 0 0">${hi} Спасибо, что поверил в нас — для нас это правда много значит. Мы небольшая команда и строим <b>Threadhunt</b>: наём через Threads на автопилоте — авто-отбивка в директе по кодовым словам и посты-приманки, которые сами приводят кандидатов.</p>
  <p style="font-size:15px;line-height:1.65;color:#333;margin:14px 0 0">Ты среди первых, кто получит <b>ранний доступ</b> и персональный промокод <b>${esc(benefit)}</b> — раньше всех. Напомним о запуске <b>один раз</b>, без спама.</p>
  <div style="text-align:center;margin:24px 0 8px">
    <a href="${esc(site)}" style="display:inline-block;background:#c6f24e;color:#0b0b0f;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:12px;font-size:15px">Открыть Threadhunt</a>
  </div>
  <p style="font-size:13px;line-height:1.6;color:#777;margin:18px 0 0">Обнимаем и до связи 🫶<br/>Команда Threadhunt</p>
  <div style="margin-top:22px;color:#aaa;font-size:12px;text-align:center;border-top:1px solid #eee;padding-top:14px">Ты получил это письмо, потому что оставил заявку на thread-hunt.com</div>
</div>`;
}

// Email-безопасные семейства шрифтов (с фолбэками). Ключ хранится в блоке.
const FONT_STACKS: Record<string, string> = {
  system: "-apple-system,Segoe UI,Roboto,Arial,sans-serif",
  arial: "Arial,Helvetica,sans-serif",
  verdana: "Verdana,Geneva,sans-serif",
  tahoma: "Tahoma,Geneva,sans-serif",
  trebuchet: "'Trebuchet MS',Helvetica,sans-serif",
  georgia: "Georgia,'Times New Roman',serif",
  times: "'Times New Roman',Times,serif",
  courier: "'Courier New',Courier,monospace",
};
function fontStack(key: unknown): string | null {
  return key && FONT_STACKS[String(key)] ? FONT_STACKS[String(key)] : null;
}
// Доп. инлайн-стили текста из блока (шрифт/размер/жирность/курсив/цвет).
function textStyle(b: any, defaults: { size: number; weight: number }): string {
  const css: string[] = [];
  const ff = fontStack(b?.fontFamily);
  css.push(`font-size:${Number(b?.fontSize) > 0 ? Number(b.fontSize) : defaults.size}px`);
  css.push(`font-weight:${b?.bold === true ? 700 : b?.bold === false ? 400 : defaults.weight}`);
  if (b?.italic) css.push('font-style:italic');
  if (ff) css.push(`font-family:${ff}`);
  if (typeof b?.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(b.color)) css.push(`color:${b.color}`);
  return css.join(';');
}

// Блоки конструктора → HTML письма (инлайн-стили, безопасно для почтовых клиентов).
export function renderEmailHtml(blocks: any[]): string {
  const body = (blocks || [])
    .map((b) => {
      const al = b?.align === 'center' ? 'center' : b?.align === 'right' ? 'right' : 'left';
      switch (b?.type) {
        case 'heading':
          return `<h1 style="${textStyle(b, { size: 22, weight: 700 })};margin:0 0 12px;text-align:${al};color:#111">${esc(b.text)}</h1>`;
        case 'text':
          return `<p style="${textStyle(b, { size: 15, weight: 400 })};line-height:1.6;margin:0 0 12px;text-align:${al};color:#333;white-space:pre-wrap">${esc(b.text)}</p>`;
        case 'button': {
          const bs = fontStack(b?.fontFamily);
          const sz = Number(b?.fontSize) > 0 ? Number(b.fontSize) : 15;
          return `<div style="text-align:${al};margin:16px 0"><a href="${esc(b.url)}" style="display:inline-block;background:#c6f24e;color:#0b0b0f;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;font-size:${sz}px${bs ? `;font-family:${bs}` : ''}">${esc(b.text || 'Открыть')}</a></div>`;
        }
        case 'image': {
          if (!b?.url) return '';
          const w = b.width === 'half' ? '50%' : b.width === 'small' ? '30%' : '100%';
          const img = `<img src="${esc(b.url)}" alt="" style="width:${w};border-radius:10px;margin:8px 0"/>`;
          const inner = b.linkUrl ? `<a href="${esc(b.linkUrl)}">${img}</a>` : img;
          return `<div style="text-align:${al}">${inner}</div>`;
        }
        case 'divider':
          return `<hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>`;
        default:
          return `<div style="height:16px"></div>`; // spacer
      }
    })
    .join('');
  return `<div style="max-width:560px;margin:0 auto;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#fff">${body}<div style="margin-top:24px;color:#999;font-size:12px;text-align:center">Threadhunt</div></div>`;
}
