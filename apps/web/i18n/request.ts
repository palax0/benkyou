import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

const SUPPORTED = ['zh', 'en'] as const;
type Locale = (typeof SUPPORTED)[number];

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get('locale')?.value as Locale | undefined;
  const locale: Locale =
    cookieLocale && SUPPORTED.includes(cookieLocale) ? cookieLocale : 'zh';

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
