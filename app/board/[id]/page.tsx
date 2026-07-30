import Board from '@/components/Board';

export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Board boardId={id} />;
}
