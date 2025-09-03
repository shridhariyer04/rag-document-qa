import { NextResponse } from 'next/server';
import { getRAGService } from '@/lib/shared-rag-service';

export async function GET() {
  try {
    const ragService = getRAGService();
    const stats = await ragService.getStats();
    return NextResponse.json(stats);
  } catch (error) {
    console.error('Stats error:', error);
    return NextResponse.json({
      error: 'Failed to get stats: ' + (error instanceof Error ? error.message : String(error))
    }, { status: 500 });
  }
}