import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, hashPassword, verifyPassword } from '@/lib/auth';
import { getSql } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { oldPassword, newPassword } = (await request.json()) as {
      oldPassword?: string;
      newPassword?: string;
    };
    if (!oldPassword || !newPassword) {
      return NextResponse.json(
        { error: 'Current password and new password are required.' },
        { status: 400 }
      );
    }
    if (newPassword.length < 6) {
      return NextResponse.json(
        { error: 'New password must be at least 6 characters long.' },
        { status: 400 }
      );
    }

    const valid = await verifyPassword(oldPassword, user.passwordHash, user.salt);
    if (!valid) {
      return NextResponse.json({ error: 'Incorrect current password.' }, { status: 401 });
    }

    const { hash, salt } = await hashPassword(newPassword);
    const sql = getSql();
    await sql`UPDATE users SET password_hash = ${hash}, salt = ${salt} WHERE id = ${user.id}`;

    return NextResponse.json({ success: true, message: 'Password successfully updated.' });
  } catch (err) {
    console.error('Change password error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
