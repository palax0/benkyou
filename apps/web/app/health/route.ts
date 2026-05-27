import { NextResponse } from 'next/server';
import { getDbClient, sql } from '@benkyou/core/db';

export async function GET() {
  let dbOk = false;
  try {
    const db = getDbClient();
    await db.execute(sql`SELECT 1`);
    dbOk = true;
  } catch {
    dbOk = false;
  }

  return NextResponse.json({
    status: dbOk ? 'ok' : 'degraded',
    db: dbOk,
    version: process.env.npm_package_version ?? 'dev',
  });
}
