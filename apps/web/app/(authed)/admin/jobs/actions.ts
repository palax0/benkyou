'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { retryItem } from '@benkyou/core/pipeline';
import { requireAuth } from '@/lib/auth';

// A malformed id can only come from a tampered form, never the rendered UI;
// reject it here instead of letting Postgres throw 22P02 on the uuid cast.
const Uuid = z.uuid();

export async function retryItemAction(fd: FormData): Promise<void> {
  await requireAuth();
  const itemId = Uuid.safeParse(fd.get('itemId'));
  if (!itemId.success) return;
  await retryItem(itemId.data);
  revalidatePath('/admin/jobs');
}
