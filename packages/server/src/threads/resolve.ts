// Какой Threads-аккаунт публикует за поиск: явно привязанный к поиску
// (search.connectionId), иначе — аккаунт пользователя по умолчанию (самый
// свежий). Так подключённый через OAuth аккаунт сразу работает для всех
// поисков, даже созданных до подключения, без ручной привязки в UI.
import { db } from '../db.js';
import type { ThreadsConnection } from '@prisma/client';

export async function resolveConnection(search: {
  userId: string;
  connectionId?: string | null;
  connection?: ThreadsConnection | null;
}): Promise<ThreadsConnection | null> {
  if (search.connection?.accessTokenEnc) return search.connection;
  return db.threadsConnection.findFirst({
    where: { userId: search.userId },
    orderBy: { createdAt: 'desc' },
  });
}
