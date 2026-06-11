'use server';

import { revalidatePath } from 'next/cache';
import { retryItem } from '@benkyou/core/pipeline';
import { requireAuth } from '@/lib/auth';

export async function retryItemAction(fd: FormData): Promise<void> {
  await requireAuth();
  await retryItem(String(fd.get('itemId')));
  revalidatePath('/admin/jobs');
}
