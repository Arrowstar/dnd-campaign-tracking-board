import type { Metadata } from 'next';
import BoardView from '@/components/BoardView';

/**
 * Feature 09 — public read-only board view. The token in the URL is the
 * credential; everything loads client-side via the share API so the token
 * never ends up rendered into the HTML. Private content by default: noindex.
 */
export async function generateMetadata(): Promise<Metadata> {
  return {
    robots: { index: false, follow: false },
  };
}

export default async function BoardViewPage({
  params,
}: {
  params: Promise<{ id: string; token: string }>;
}) {
  const { id, token } = await params;
  return <BoardView boardId={id} token={token} />;
}
