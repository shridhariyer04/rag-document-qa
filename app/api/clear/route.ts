import { NextResponse } from 'next/server';
import { getRAGService, resetRAGService } from '@/lib/shared-rag-service';

export async function POST() {
  try {
    const ragService = getRAGService();
    await ragService.clearAll();
    
    // Reset the shared service so next upload creates a fresh instance
    resetRAGService();
    
    return NextResponse.json({ 
      success: true, 
      message: 'Documents cleared successfully' 
    });
  } catch (error) {
    console.error('Clear error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to clear documents: ' + (error instanceof Error ? error.message : String(error))
    }, { status: 500 });
  }
}
